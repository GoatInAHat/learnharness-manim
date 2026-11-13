import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, cp, glob, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { readReferenceVoice, referenceRevision, referenceSample, referenceSupported, referenceTranscript, referenceURL } from './reference-voice';
import type { ReferenceVoice } from './reference-voice';
import { INLINE_VIDEO_BYTES, WAV_BYTES } from './protocol';
import type { Narration } from './protocol';
import { emptyNarration, placeUtterance, readUtterance, voiceBinary, voiceConfig, voiceDownloadMiB, voiceModels, voiceModelURL,
  voiceRelease, voiceRevision } from './voice';

const release = '2.9.0-0';
const binaries = {
  'darwin-arm64': ['osx-arm64', 'micromamba-osx-arm64', 'ec2a072f028e1a7cf20f3e2e74d5a8127cf5a5f27636375b5359811565f4e5be', 200],
  'linux-x64': ['linux-64', 'micromamba-linux-64', '366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3', 303],
  'win32-x64': ['win-64', 'micromamba-win-64.exe', 'a6d804394b2418991c4e29562853eaace2f2ce9d9da661a98e74e02e8dbb44b0', 295],
} as const;
const host = `${process.platform}-${process.arch}`;
const binary = binaries[host as keyof typeof binaries];
const windows = process.platform === 'win32';
const windowsRoot = 'C:\\Windows';
const system32 = join(windowsRoot, 'System32');

export const versions = { python: '3.14.10', manim: '0.22.1', typst: '0.15.2' } as const;
export const defaultRenderSeconds = 720;

type ValidatedPlan = {
  valid: boolean;
  message?: string;
  duration: number;
  beats: [string, number, number][];
  source?: true;
  timeoutSeconds?: number;
};

export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error('Expected a private directory.');
  return realpath(path);
}

export function environment(scratch: string, prefix?: string): NodeJS.ProcessEnv {
  const path = windows
    ? [...(prefix ? [prefix, join(prefix, 'Library', 'bin'), join(prefix, 'Scripts')] : []), system32]
    : prefix ? [join(prefix, 'bin')] : ['/usr/bin', '/bin'];
  return {
    PATH: path.join(delimiter), HOME: scratch, USERPROFILE: scratch,
    TMPDIR: scratch, TEMP: scratch, TMP: scratch, XDG_CONFIG_HOME: scratch,
    XDG_CACHE_HOME: scratch, XDG_DATA_HOME: scratch, APPDATA: scratch, LOCALAPPDATA: scratch,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1',
    ...(windows ? { SystemRoot: windowsRoot, ComSpec: join(system32, 'cmd.exe') } : {}),
    ...(prefix && !windows ? { FONTCONFIG_PATH: join(prefix, 'etc', 'fonts') } : {}),
  };
}

export function run(program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal, stage: string): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
    let output = '';
    let stderr = '';
    let error: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (!windows && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') error = new Error(`${stage} cancellation failed.`);
      }
    };
    const abort = () => {
      if (windows && child.pid) {
        const tree = spawn(join(system32, 'taskkill.exe'), ['/T', '/F', '/PID', String(child.pid)],
          { cwd, env, stdio: 'ignore', windowsHide: true });
        tree.once('error', () => kill('SIGKILL'));
        tree.once('exit', (status) => { if (status !== 0 && child.exitCode === null) kill('SIGKILL'); });
        return;
      }
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1500);
    };
    child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-48 * 1024); });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-512); });
    child.once('error', () => { error = new Error(`${stage} could not start.`); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('close', (code, stoppedBy) => {
      signal.removeEventListener('abort', abort);
      clearTimeout(killTimer);
      if (signal.aborted) {
        if (!windows) kill('SIGKILL');
        reject(signal.reason);
      } else if (code !== 0 || error) {
        const detail = ((stage === 'Manim render' || stage === 'Reference narration') && code === 2 ||
          stage === 'Private TeX setup') ? stderr.trim() : '';
        reject(error ?? new Error(detail || `${stage} failed (exit ${code ?? stoppedBy}).`));
      } else resolve(output);
    });
  });
}

async function digest(path: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

function request(url: URL, signal: AbortSignal) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = get(url, { signal, headers: { 'User-Agent': 'learnharness-manim/0.1' } }, resolve);
    req.on('error', reject);
  });
}

async function download(source: string, path: string, sha: string, maxBytes: number, signal: AbortSignal, exact = false) {
  let url = new URL(source);
  const allowed = new Set(url.host === 'huggingface.co' ? ['huggingface.co', 'us.aws.cdn.hf.co', 'eu.aws.cdn.hf.co'] :
    ['github.com', 'release-assets.githubusercontent.com', 'conda.anaconda.org']);
  for (let redirects = 0; redirects < 4; redirects++) {
    signal.throwIfAborted();
    if (url.protocol !== 'https:' || !allowed.has(url.host) || url.username || url.password) throw new Error('Unexpected runtime download host.');
    const response = await request(url, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Runtime download failed (HTTP ${response.statusCode}).`);
    }
    const hash = createHash('sha256');
    let size = 0;
    const check = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        size += chunk.length;
        if (size > maxBytes) return next(new Error('Runtime download exceeded its locked size.'));
        hash.update(chunk);
        next(null, chunk);
      },
    });
    await pipeline(response, check, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
    if (exact && size !== maxBytes) throw new Error('Runtime download did not match its locked size.');
    if (hash.digest('hex') !== sha) throw new Error('Runtime download failed SHA-256 verification.');
    return;
  }
  throw new Error('Runtime download exceeded the redirect limit.');
}

function packages(lock: string, platform: string) {
  const names = new Set<string>();
  return lock.trim().split('\n').map((line) => {
    const [entry, sha, size, extra] = line.split('\t');
    const [subdir, file, trailing] = entry.split('/');
    const bytes = Number(size);
    if (extra !== undefined || trailing !== undefined || ![platform, 'noarch'].includes(subdir) ||
        !/^[a-zA-Z0-9_.+!-]+\.(?:conda|tar\.bz2)$/.test(file ?? '') || names.has(file) ||
        !/^[a-f0-9]{64}$/.test(sha ?? '') || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 500_000_000) {
      throw new Error('Invalid bundled runtime lock.');
    }
    names.add(file);
    return { entry, file, sha, bytes };
  });
}

// Prefix replacement changes signed Mach-O pages. Re-sign only verified packages'
// relocated native files before executing Python or loading native libraries.
async function signRelocatedMachO(prefix: string, scratch: string, signal: AbortSignal) {
  const meta = join(prefix, 'conda-meta');
  const magic = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
  const signed = new Set<string>();
  for (const record of await readdir(meta)) {
    if (!record.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(join(meta, record), 'utf8'));
    for (const entry of data.paths_data.paths) {
      signal.throwIfAborted();
      if (!entry.sha256_in_prefix || entry.sha256_in_prefix === entry.sha256 || entry.path_type !== 'hardlink') continue;
      const path = resolve(prefix, entry._path);
      if (!path.startsWith(prefix + sep) || signed.has(path)) continue;
      if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error('Unexpected relocated runtime file.');
      const file = await open(path, 'r');
      const header = Buffer.alloc(4);
      try { await file.read(header, 0, 4, 0); } finally { await file.close(); }
      if (!magic.has(header.toString('hex'))) continue;
      // Replace the inode too, since macOS may have cached a post-link launch failure.
      const copy = path + '.resign';
      await cp(path, copy, { force: false, errorOnExist: true });
      await run('/usr/bin/codesign', ['--force', '--sign', '-', copy], scratch, environment(scratch), signal, 'Runtime code signing');
      await rename(copy, path);
      signed.add(path);
    }
  }
}

const pythonAt = (prefix: string) => join(prefix, ...(windows ? ['python.exe'] : ['bin', 'python']));
const ffmpegAt = (prefix: string) => join(prefix, ...(windows ? ['Library', 'bin', 'ffmpeg.exe'] : ['bin', 'ffmpeg']));
const readyFile = 'ready.json';
const voiceDirectory = `pocket-tts-${voiceRelease}-${voiceRevision.slice(0, 12)}-${voiceConfig.sha.slice(0, 12)}`;
const voiceRequired = 'Install the offline voice for automatic narration, or choose Silent or a narration WAV.';
const uvRelease = '0.13.8';
const referenceRuntime = `qwen-${referenceRevision.slice(0, 12)}-mlx-0.32.4-py314-v1`;
const voiceCPU = process.arch === 'x64' ? ' (requires an AVX2 CPU)' : '';

async function checkVoiceFiles(folder: string, signal?: AbortSignal) {
  if (!voiceBinary) return false;
  for (const asset of [voiceBinary.executable, ...voiceModels, voiceConfig, { file: 'LICENSE', sha: voiceBinary.licenseSha }]) {
    const path = join(folder, asset.file);
    const stat = await lstat(path);
    if (!stat.isFile() || ('bytes' in asset ? stat.size !== asset.bytes : stat.size <= 0 || stat.size > 4096) ||
        (signal && await digest(path, signal) !== asset.sha)) return false;
  }
  return true;
}

async function runtimeFile(prefix: string, path: string) {
  const file = await realpath(path);
  const target = relative(await realpath(prefix), file);
  if (!target || isAbsolute(target) || target === '..' || target.startsWith(`..${sep}`) || !(await lstat(file)).isFile()) {
    throw new Error('Runtime executable escapes the verified prefix.');
  }
  return file;
}

export class Runtime {
  private voiceInvalid = false;
  private referenceChecks = new Map<string, string>();
  private referenceCheck?: Promise<boolean>;
  private activeReferenceRuns = 0;
  private switchingReference = false;
  constructor(private readonly assets: string, private readonly data: string) {}

  async setupKey() {
    return [binary ? (await this.paths()).id : host, voiceRelease, voiceRevision, voiceConfig.sha,
      voiceBinary?.sha, voiceDownloadMiB].join(':');
  }

  private async paths() {
    if (!binary) throw new Error('Runtime platform is unsupported.');
    const lock = await readFile(join(this.assets, 'assets', 'runtime', `${binary[0]}.tsv`), 'utf8');
    const id = createHash('sha256').update('layout-v1:').update(release).update('\n').update(lock).digest('hex');
    return { lock, id, root: join(this.data, 'runtime', `${versions.manim}-${binary[0]}-${id.slice(0, 12)}`) };
  }

  async ready() {
    if (!binary) return null;
    const { id, root } = await this.paths();
    try {
      if (!(await lstat(root)).isDirectory() || !(await lstat(join(root, readyFile))).isFile()) return null;
      const marker = JSON.parse(await readFile(join(root, readyFile), 'utf8'));
      if (!marker || typeof marker !== 'object') return null;
      const { directory, lock, pythonSha, ffmpegSha } = marker;
      if (lock !== id || !/^install-[a-zA-Z0-9]{6}$/.test(directory ?? '') || !/^[a-f0-9]{64}$/.test(pythonSha ?? '')) return null;
      const prefix = join(root, directory, 'env');
      if (!(await lstat(prefix)).isDirectory() || !(await lstat(dirname(prefix))).isDirectory()) return null;
      const python = await runtimeFile(prefix, pythonAt(prefix));
      if (await digest(python) !== pythonSha) return null;
      const ffmpeg = await runtimeFile(prefix, ffmpegAt(prefix));
      if (!windows) {
        await access(python, constants.X_OK);
        await access(ffmpeg, constants.X_OK);
      }
      if (ffmpegSha !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(ffmpegSha) || await digest(ffmpeg) !== ffmpegSha) return null;
      } else {
        // Existing preview locks predate the FFmpeg hash. Mach-O relocation
        // changes the hash by prefix; the pinned arm64 file length is stable.
        const size = (await lstat(ffmpeg)).size;
        if (size < 64 * 1024 || (process.platform === 'darwin' && size !== 426128)) return null;
      }
      return { prefix, python };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ||
          error instanceof SyntaxError || (error as Error).message === 'Runtime executable escapes the verified prefix.') return null;
      throw error;
    }
  }

  async status() {
    const referenceVoice = referenceSupported ? await this.referenceProfile().catch(() => null) : null;
    return { referenceVoiceEnabled: referenceVoice?.enabled === true, supported: Boolean(binary), platform: binary?.[0] ?? host,
      downloadMiB: binary?.[3] ?? null, ready: Boolean(await this.ready()), versions,
      voiceReady: !this.voiceInvalid && Boolean(await this.voiceReady()), voiceDownloadMiB, setupKey: await this.setupKey() };
  }

  private async voiceReady(signal?: AbortSignal) {
    if (!voiceBinary) return null;
    const voices = join(this.data, 'voice');
    const root = join(voices, voiceDirectory);
    const marker = join(root, readyFile);
    try {
      if (!(await lstat(voices)).isDirectory() || !(await lstat(root)).isDirectory()) return null;
      const stat = await lstat(marker);
      if (!stat.isFile() || stat.size !== 14) return null;
      const directory = await readFile(marker, 'utf8');
      if (!/^install-[a-zA-Z0-9]{6}$/.test(directory)) return null;
      const folder = join(root, directory);
      if (!(await lstat(folder)).isDirectory() || !await checkVoiceFiles(folder, signal)) return null;
      return realpath(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async hasVerifiedVoice(signal: AbortSignal) {
    const ready = Boolean(await this.voiceReady(signal));
    this.voiceInvalid = !ready;
    return ready;
  }

  async installVoice(signal: AbortSignal, progress: (message: string) => void) {
    signal.throwIfAborted();
    if (!voiceBinary) throw new Error('The offline voice is unavailable on this platform.');
    if (await this.voiceReady(signal)) { this.voiceInvalid = false; return; }
    const config = (await readFile(join(this.assets, 'assets', 'runtime', 'voice', voiceConfig.file), 'utf8')).replaceAll('\r\n', '\n');
    if (createHash('sha256').update(config).digest('hex') !== voiceConfig.sha) throw new Error('Offline voice configuration failed verification.');
    const voices = await privateDirectory(join(this.data, 'voice'));
    const root = await privateDirectory(join(voices, voiceDirectory));
    const folder = await mkdtemp(join(root, 'install-'));
    let committed = false;
    try {
      const archive = join(folder, voiceBinary.archive);
      const layout = voiceBinary.archive.replace(/\.(tar\.gz|zip)$/, '');
      const { file } = voiceBinary.executable;
      progress('Downloading the pinned Pocket TTS executable.');
      await download(`https://github.com/kyutai-labs/pocket-tts/releases/download/${voiceRelease}/${voiceBinary.archive}`,
        archive, voiceBinary.sha, voiceBinary.bytes, signal, true);
      await run(windows ? join(system32, 'tar.exe') : '/usr/bin/tar',
        ['-xf', archive, `${layout}/${file}`, `${layout}/LICENSE`], folder, environment(folder), signal, 'Voice archive extraction');
      await rename(join(folder, layout, file), join(folder, file));
      await rename(join(folder, layout, 'LICENSE'), join(folder, 'LICENSE'));
      await rm(join(folder, layout), { recursive: true });
      await rm(archive);
      const executable = join(folder, file);
      if (!(await lstat(executable)).isFile() || await digest(executable, signal) !== voiceBinary.executable.sha) {
        throw new Error('Offline voice executable failed verification.');
      }
      if (!windows) await chmod(executable, 0o700);
      // This pinned upstream release reports the same 3.3.0 version as its asset filenames.
      const version = await run(executable, ['--version'], folder, environment(folder), signal, `Offline voice startup${voiceCPU}`);
      if (version.trim() !== 'pocket-tts 3.3.0') throw new Error('Offline voice executable version did not match.');
      for (const asset of voiceModels) {
        progress(`Downloading and verifying the offline voice: ${asset.file}.`);
        await download(`${voiceModelURL}/${asset.remote ?? asset.file}`, join(folder, asset.file), asset.sha, asset.bytes, signal, true);
      }
      await writeFile(join(folder, voiceConfig.file), config, { flag: 'wx', mode: 0o600 });
      if (!await checkVoiceFiles(folder, signal)) throw new Error('Installed voice files failed verification.');
      const marker = join(folder, readyFile);
      await writeFile(marker, basename(folder), { flag: 'wx', mode: 0o600 });
      signal.throwIfAborted();
      await rename(marker, join(root, readyFile));
      committed = true;
      this.voiceInvalid = false;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      if (!committed) await rm(folder, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  async install(signal: AbortSignal, progress: (message: string) => void) {
    signal.throwIfAborted();
    if (await this.ready()) return;
    if (!binary) throw new Error('Runtime platform is unsupported.');
    const { lock, id, root } = await this.paths();
    const entries = packages(lock, binary[0]);
    const canonicalRoot = await privateDirectory(root);
    const folder = await mkdtemp(join(canonicalRoot, 'install-'));
    const scratch = join(folder, 'bootstrap');
    const prefix = join(folder, 'env');
    const launcher = join(scratch, windows ? 'micromamba.exe' : 'micromamba');
    const mambaRoot = join(scratch, 'mamba');
    let committed = false;
    try {
      await privateDirectory(scratch);
      progress('Downloading the verified runtime installer.');
      await download(`https://github.com/mamba-org/micromamba-releases/releases/download/${release}/${binary[1]}`, launcher, binary[2], 40_000_000, signal);
      if (!windows) await chmod(launcher, 0o700);
      const archives = await privateDirectory(join(scratch, 'archives'));
      const transfer = new AbortController();
      const downloading = AbortSignal.any([signal, transfer.signal]);
      let next = 0;
      let complete = 0;
      const results = await Promise.allSettled(Array.from({ length: 8 }, async () => {
        try {
          while (next < entries.length) {
            const entry = entries[next++];
            await download(`https://conda.anaconda.org/conda-forge/${entry.entry}`, join(archives, entry.file), entry.sha, entry.bytes, downloading);
            progress(`Verified ${++complete} of ${entries.length} runtime packages.`);
          }
        } catch (error) {
          transfer.abort(error);
          throw error;
        }
      }));
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const explicit = join(scratch, 'explicit.txt');
      await writeFile(explicit, `@EXPLICIT\n${entries.map(({ file, sha }) => pathToFileURL(join(archives, file)).href + '#' + sha).join('\n')}\n`);
      progress('Installing verified packages into plugin data.');
      await run(launcher, ['create', '--no-rc', '--no-env', '--offline', '--always-copy', '--safety-checks', 'enabled', '--root-prefix', mambaRoot, '--prefix', prefix, '--file', explicit, '--yes'], scratch, environment(scratch), signal, 'Runtime installation');
      const cache = join(mambaRoot, 'pkgs');
      for await (const licenses of glob('**/info/licenses', { cwd: cache })) {
        const name = basename(dirname(dirname(licenses)));
        await cp(join(cache, licenses), join(prefix, 'licenses', name), { recursive: true });
      }
      if (process.platform === 'darwin') await signRelocatedMachO(prefix, scratch, signal);
      progress('Checking Python, Manim, Typst, FFmpeg and native libraries.');
      const python = await runtimeFile(prefix, pythonAt(prefix));
      const output = await run(python, ['-I', '-B', '-c', 'import sys, manim, typst, cairo, manimpango, av; print(sys.version.split()[0], manim.__version__, typst.__version__)'], scratch, environment(scratch, prefix), signal, 'Runtime verification');
      if (output.trim() !== Object.values(versions).join(' ')) throw new Error('Installed runtime versions do not match the lock.');
      const ffmpeg = await runtimeFile(prefix, ffmpegAt(prefix));
      const media = await run(ffmpeg, ['-version'], scratch, environment(scratch, prefix), signal, 'FFmpeg verification');
      if (!media.startsWith('ffmpeg version 9.0.2 ')) throw new Error('Installed FFmpeg version does not match the lock.');
      const marker = join(folder, readyFile);
      // Windows can spell the same temp root with either an 8.3 alias or its long path.
      await writeFile(marker, JSON.stringify({ directory: basename(folder), lock: id, pythonSha: await digest(python),
        ffmpegSha: await digest(ffmpeg) }), { mode: 0o600 });
      await rm(scratch, { recursive: true, force: true });
      signal.throwIfAborted();
      await rename(marker, join(canonicalRoot, readyFile));
      committed = true;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      if (!committed) await rm(folder, { recursive: true, force: true });
    }
  }

  async validate(scratch: string, signal: AbortSignal, narration = false) {
    const runtime = await this.ready();
    if (!runtime) throw new Error('Install the pinned runtime before validating a plan.');
    const output = await run(runtime.python, ['-I', '-B', join(this.assets, 'assets', 'renderer', 'semantic.py'), join(scratch, 'plan.json'),
      ...(narration ? ['--narration'] : [])],
      scratch, environment(scratch, runtime.prefix), signal, 'Plan validation');
    const result = JSON.parse(output) as ValidatedPlan;
    if (result.valid !== true) throw new Error(result.message || 'Invalid lesson plan.');
    return result;
  }

  private get referencePath() { return join(this.data, 'reference-voice.json'); }
  private get referenceRoot() { return join(this.data, 'voice', referenceRuntime); }
  private referenceLock(name: string) { return join(this.assets, 'assets', 'runtime', 'voice', name); }

  referenceProfile() { return readReferenceVoice(this.referencePath); }

  private async referenceFiles() {
    const lock = await readFile(this.referenceLock('qwen-model.tsv'), 'utf8');
    return lock.trim().split('\n').map(line => {
      const [file, size, sha] = line.split('\t');
      return { file, size: Number(size), sha };
    });
  }

  async referenceReady() {
    if (!referenceSupported || this.switchingReference) return false;
    this.referenceCheck ??= this.checkReferenceAssets().finally(() => { this.referenceCheck = undefined; });
    return this.referenceCheck;
  }

  private async checkReferenceAssets() {
    try {
      for (const name of ['', 'model', 'model/speech_tokenizer', 'site', 'site/mlx', 'site/mlx_audio', 'site/transformers']) {
        if (!(await lstat(join(this.referenceRoot, name))).isDirectory()) return false;
      }
      for (const name of ['mlx/core.cpython-314-darwin.so', 'mlx/lib/libmlx.dylib', 'mlx/lib/mlx.metallib',
        'mlx_audio/tts/models/qwen3_tts/qwen3_tts.py', 'safetensors/_safetensors_rust.abi3.so', 'tokenizers/tokenizers.abi3.so']) {
        const file = await lstat(join(this.referenceRoot, 'site', name));
        if (!file.isFile() || file.size === 0) return false;
      }
      for (const { file, size, sha } of await this.referenceFiles()) {
        const path = join(this.referenceRoot, 'model', file);
        const stat = await lstat(path, { bigint: true });
        if (!stat.isFile() || stat.size !== BigInt(size)) return false;
        const fingerprint = [sha, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
        if (this.referenceChecks.get(path) === fingerprint) continue;
        if (await digest(path) !== sha) return false;
        this.referenceChecks.set(path, fingerprint);
      }
      return true;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  }

  async installReference(signal: AbortSignal, progress: (text: string) => void, force = false) {
    if (!referenceSupported) {
      throw new Error('Reference narration requires Apple Silicon and macOS 14 or later.');
    }
    const manim = await this.ready();
    if (!manim) throw new Error('Set up local rendering in Manim Explainer before enabling the reference voice.');
    if (!force && await this.referenceReady()) return;
    const voices = await privateDirectory(join(this.data, 'voice'));
    const staging = await mkdtemp(join(voices, 'reference-install-'));
    try {
      const env = environment(staging);
      const uvArchive = 'uv-aarch64-apple-darwin.tar.gz';
      progress('Downloading the verified reference voice installer.');
      await download(`https://github.com/astral-sh/uv/releases/download/${uvRelease}/${uvArchive}`,
        join(staging, uvArchive), '6b71028a6b904f2ae3340ef52e595512de807d06c0a20eaef2f692581b246558', 14_375_545, signal, true);
      await run('/usr/bin/tar', ['-xzf', uvArchive, 'uv-aarch64-apple-darwin/uv'],
        staging, env, signal, 'Reference voice installer extraction');
      const uv = join(staging, 'uv-aarch64-apple-darwin', 'uv');
      const install = await privateDirectory(join(staging, 'install'));
      const site = join(install, 'site');
      progress('Installing verified MLX packages into Manim plugin data.');
      await run(uv, ['--no-config', '--no-cache', '--no-progress', 'pip', 'sync', '--python', manim.python,
        '--target', site, '--only-binary', ':all:', '--require-hashes', this.referenceLock('qwen-osx-arm64.txt')],
        staging, env, signal, 'Reference voice packages');
      await run(manim.python, ['-I', '-B', '-c',
        "import sys; sys.path.insert(0, sys.argv[1]); import mlx.core as mx; assert mx.metal.is_available() and mx.default_device() == mx.gpu", site],
        staging, env, signal, 'Reference voice Metal verification');
      const model = await privateDirectory(join(install, 'model'));
      await privateDirectory(join(model, 'speech_tokenizer'));
      const files = await this.referenceFiles();
      for (const [index, { file, size, sha }] of files.entries()) {
        progress(`Downloading and verifying reference voice file ${index + 1} of ${files.length}.`);
        await download(`${referenceURL}/${file}?download=true`, join(model, file), sha, size, signal, true);
      }
      const saved = await this.referenceProfile();
      if (saved?.enabled) {
        progress('Checking the replacement with your saved reference voice.');
        await this.runReference(saved, staging, ['This is the local narration voice.'], signal, manim, install);
      }
      signal.throwIfAborted();
      if (this.activeReferenceRuns) throw new Error('Wait for the current narration to finish before replacing the reference voice.');
      const previous = join(voices, basename(staging) + '-previous');
      this.switchingReference = true;
      let moved = false;
      try {
        const existing = await lstat(this.referenceRoot).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (existing && !existing.isDirectory()) throw new Error('The reference runtime path is not a regular directory.');
        if (existing) {
          await rename(this.referenceRoot, previous);
          moved = true;
        }
        signal.throwIfAborted();
        await rename(install, this.referenceRoot);
        this.referenceChecks.clear();
      } catch (error) {
        if (moved) await rename(previous, this.referenceRoot);
        throw error;
      } finally {
        this.switchingReference = false;
      }
      if (moved) await rm(previous, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async saveReferenceProfile(raw: unknown, signal: AbortSignal, progress: (text: string) => void) {
    if (!raw || typeof raw !== 'object') throw new Error('Choose a local reference voice sample.');
    const { transcript, enabled, sample } = raw as Partial<ReferenceVoice>;
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to enable reference narration.');
    const previous = sample === undefined ? await this.referenceProfile() : null;
    const profile = { transcript: referenceTranscript(transcript), enabled, sample: sample ?? previous?.sample ?? '' };
    referenceSample(profile.sample);
    if (profile.enabled) await this.installReference(signal, progress);
    const root = await privateDirectory(this.data);
    const scratch = await mkdtemp(join(root, 'voice-check-'));
    try {
      if (profile.enabled) {
        progress('Checking the sample and running local reference synthesis.');
        await this.synthesizeReference(profile, scratch, ['This is the local narration voice.'], signal);
      }
      signal.throwIfAborted();
      const candidate = join(scratch, 'profile.json');
      await writeFile(candidate, JSON.stringify(profile), { flag: 'wx', mode: 0o600, signal });
      signal.throwIfAborted();
      await rename(candidate, this.referencePath);
      return { enabled, transcript: profile.transcript };
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async removeReferenceProfile() { await rm(this.referencePath, { force: true }); }

  private async synthesizeReference(profile: ReferenceVoice, scratch: string, utterances: string[], signal: AbortSignal) {
    const manim = await this.ready();
    if (!manim || !await this.referenceReady()) throw new Error('The local reference voice runtime is unavailable. Set it up in Manim settings.');
    if (this.switchingReference) throw new Error('Wait for reference voice setup to finish.');
    this.activeReferenceRuns++;
    try {
      await this.runReference(profile, scratch, utterances, signal, manim, this.referenceRoot);
    } finally {
      this.activeReferenceRuns--;
    }
  }

  private async runReference(profile: ReferenceVoice, scratch: string, utterances: string[], signal: AbortSignal,
    manim: { python: string; prefix: string }, root: string) {
    const request = join(scratch, 'reference-request.json');
    const wav = join(scratch, 'reference-input.wav');
    try {
      await writeFile(wav, referenceSample(profile.sample), { flag: 'wx', mode: 0o600, signal });
      await writeFile(request, JSON.stringify({ wav, transcript: profile.transcript, utterances,
        model: join(root, 'model'), sitePackages: join(root, 'site'),
        modelLock: this.referenceLock('qwen-model.tsv') }), { flag: 'wx', mode: 0o600, signal });
      await run(manim.python, ['-I', '-B', join(this.assets, 'assets', 'renderer', 'reference_voice.py'), request], scratch,
        { ...environment(scratch, manim.prefix), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
        signal, 'Reference narration');
    } finally {
      await Promise.allSettled([rm(request, { force: true }), rm(wav, { force: true })]);
    }
  }

  private async synthesizeUtterances(scratch: string, signal: AbortSignal, utterances: string[],
    accept: (index: number, path: string) => Promise<void>) {
    const profile = referenceSupported ? await this.referenceProfile() : null;
    if (profile?.enabled) {
      try {
        await this.synthesizeReference(profile, scratch, utterances, signal);
        for (const [index] of utterances.entries()) {
          await accept(index, join(scratch, `reference-beat-${index + 1}.wav`));
        }
      } finally {
        await Promise.allSettled(utterances.map((_, i) => rm(join(scratch, `reference-beat-${i + 1}.wav`), { force: true })));
      }
      return;
    }
    const folder = await this.voiceReady(signal);
    if (!folder || !voiceBinary) {
      this.voiceInvalid = true;
      throw new Error(voiceRequired);
    }
    const env = { ...environment(scratch), KPOCKET_TTS_ERROR_WITHOUT_EOS: '1' };
    const utterance = join(scratch, 'utterance.wav');
    for (const [index, text] of utterances.entries()) {
      const beat = index + 1;
      const stage = `Automatic narration for beat ${beat}${voiceCPU}`;
      try {
        await run(join(folder, voiceBinary.executable.file),
          ['generate', '--quiet', '--config', voiceConfig.file, '--voice', 'alba.safetensors', `--text=${text}`, '--output-path', utterance],
          folder, env, AbortSignal.any([signal, AbortSignal.timeout(60_000)]), stage);
        await accept(index, utterance);
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') throw new Error(`${stage} timed out.`);
        throw error;
      } finally {
        await rm(utterance, { force: true });
      }
    }
  }

  async prepareNarration(scratch: string, signal: AbortSignal, plan?: ValidatedPlan) {
    const { duration, beats } = plan ?? await this.validate(scratch, signal, true);
    const wav = emptyNarration(duration);
    await this.synthesizeUtterances(scratch, signal, beats.map(([words]) => words), (index, path) => {
      const [, cue, end] = beats[index];
      return placeUtterance(wav, path, index + 1, cue, end);
    });
    await writeFile(join(scratch, 'narration.wav'), wav, { flag: 'wx', mode: 0o600, signal });
  }

  private async prepareSourceNarration(scratch: string, signal: AbortSignal, speech: Record<string, string>) {
    const entries = Object.entries(speech);
    const clips: [string, { path: string; duration: number }][] = [];
    if (entries.length) {
      const folder = await privateDirectory(join(scratch, 'voice'));
      await this.synthesizeUtterances(scratch, signal, entries.map(([, words]) => words), async (index, path) => {
        const pcm = await readUtterance(path, index + 1, WAV_BYTES - 44);
        const file = `voice/${index + 1}.wav`;
        await writeFile(join(folder, `${index + 1}.wav`), pcm, { flag: 'wx', mode: 0o600, signal });
        clips.push([entries[index][0], { path: file, duration: (pcm.length - 44) / 48_000 }]);
      });
    }
    await writeFile(join(scratch, 'voice.json'), JSON.stringify(Object.fromEntries(clips)),
      { flag: 'wx', mode: 0o600, signal });
  }

  private async sourceEnvironment(scratch: string, runtime: { python: string; prefix: string }, signal: AbortSignal) {
    const env = environment(scratch, runtime.prefix);
    const tex = join(this.data, 'tex', 'bin');
    const mac = process.platform === 'darwin' ? ['/Library/TeX/texbin', '/opt/homebrew/bin'] : [];
    const bins = await readdir(tex, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const paths = [...(env.PATH ?? '').split(delimiter), tex,
      ...bins.filter((entry) => entry.isDirectory()).map((entry) => join(tex, entry.name)),
      ...mac, ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean);
    const available = await Promise.all(['latex', 'dvisvgm'].map(async (name) => {
      const executable = windows ? `${name}.exe` : name;
      for (const folder of paths) {
        try {
          await access(join(folder, executable), constants.X_OK);
          return true;
        } catch { /* Check the next executable directory. */ }
      }
      return false;
    }));
    let texError: string | undefined;
    if (!available.every(Boolean)) {
      try {
        const asset = (folder: string, file: string) => join(this.assets, 'assets', folder, file);
        const setup = AbortSignal.any([signal, AbortSignal.timeout(3 * 60 * 1000)]);
        const bin = await run(runtime.python, ['-I', '-B', asset('renderer', 'tex_setup.py'), this.data,
          asset('runtime/tex', 'lock.json')], scratch, env, setup, 'Private TeX setup');
        paths.unshift(bin.trim());
      } catch (error) {
        signal.throwIfAborted();
        texError = (error as Error).message;
      }
    }
    env.PATH = paths.join(delimiter);
    env.TEXMFVAR = join(scratch, 'texmf-var');
    env.TEXMFCONFIG = join(scratch, 'texmf-config');
    env.TEXMFCACHE = env.TEXMFVAR;
    return { env, texError };
  }

  async render(scratch: string, signal: AbortSignal, narration: Narration, height: 720 | 1080 = 720) {
    const runtime = await this.ready();
    if (!runtime) throw new Error('Install the pinned runtime before rendering.');
    const plan = await this.validate(scratch, signal, narration === 'automatic');
    if (plan.source) {
      const source = JSON.parse(await readFile(join(scratch, 'plan.json'), 'utf8')) as { narration?: Record<string, string> };
      await this.prepareSourceNarration(scratch, signal, narration === 'automatic' ? source.narration ?? {} : {});
    } else if (narration === 'automatic') {
      await this.prepareNarration(scratch, signal, plan);
    }
    const { env, texError } = plan.source ? await this.sourceEnvironment(scratch, runtime, signal) :
      { env: environment(scratch, runtime.prefix), texError: undefined };
    try {
      await run(runtime.python, ['-I', '-B', join(this.assets, 'assets', 'renderer', 'scene.py'), scratch, String(height),
        plan.source || narration === 'silent' ? 'silent' : 'wav'],
        scratch, env, signal, 'Manim render');
    } catch (error) {
      signal.throwIfAborted();
      if (texError) throw new Error(`${(error as Error).message}\n${texError}`, { cause: error });
      throw error;
    }
    const path = join(scratch, 'video.mp4');
    const pcm = join(scratch, 'pcm.wav');
    if (!plan.source && narration !== 'silent') {
      const ffmpeg = await runtimeFile(runtime.prefix, ffmpegAt(runtime.prefix));
      const muxed = join(scratch, 'muxed.mp4');
      await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', path, '-i', pcm,
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
        '-shortest', muxed], scratch, env, signal, 'Narration mux');
      await rename(muxed, path);
    }
    const video = await lstat(path);
    if (!video.isFile() || !Number.isSafeInteger(video.size) || video.size <= 0) throw new Error('Expected a nonempty MP4.');
    if (!plan.source && video.size > INLINE_VIDEO_BYTES) throw new Error('Graph lesson MP4 exceeds 96 MiB.');
    if (plan.source) {
      const ffprobe = await runtimeFile(runtime.prefix, join(dirname(ffmpegAt(runtime.prefix)), windows ? 'ffprobe.exe' : 'ffprobe'));
      const length = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration',
        '-of', 'csv=p=0', path], scratch, env, signal, 'Manim video verification');
      if (!(Number(length) > 0 && Number.isFinite(Number(length)))) throw new Error('Manim did not produce a playable video stream.');
    }
    if (!windows) await chmod(path, 0o600);
    signal.throwIfAborted();
    return video.size;
  }
}
