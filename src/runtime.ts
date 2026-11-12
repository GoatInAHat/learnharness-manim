import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, cp, glob, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { VIDEO_BYTES } from './protocol';

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
    child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-16_384); });
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
        const detail = stage === 'Manim render' && code === 2 ? stderr.trim() : '';
        reject(error ?? new Error(detail || `${stage} failed (exit ${code ?? stoppedBy}).`));
      } else resolve(output);
    });
  });
}

async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function request(url: URL, signal: AbortSignal) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = get(url, { signal, headers: { 'User-Agent': 'learnharness-manim/0.1' } }, resolve);
    req.on('error', reject);
  });
}

async function download(source: string, path: string, sha: string, maxBytes: number, signal: AbortSignal) {
  let url = new URL(source);
  const allowed = new Set(['github.com', 'release-assets.githubusercontent.com', 'conda.anaconda.org']);
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

async function runtimeFile(prefix: string, path: string) {
  const file = await realpath(path);
  const target = relative(await realpath(prefix), file);
  if (!target || isAbsolute(target) || target === '..' || target.startsWith(`..${sep}`) || !(await lstat(file)).isFile()) {
    throw new Error('Runtime executable escapes the verified prefix.');
  }
  return file;
}

export class Runtime {
  constructor(private readonly assets: string, private readonly data: string) {}

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
      const { directory, lock, pythonSha } = marker;
      if (lock !== id || !/^install-[a-zA-Z0-9]{6}$/.test(directory ?? '') || !/^[a-f0-9]{64}$/.test(pythonSha ?? '')) return null;
      const prefix = join(root, directory, 'env');
      if (!(await lstat(prefix)).isDirectory() || !(await lstat(dirname(prefix))).isDirectory()) return null;
      const python = await runtimeFile(prefix, pythonAt(prefix));
      if (await digest(python) !== pythonSha) return null;
      return { prefix, python };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async status() {
    return { supported: Boolean(binary), platform: binary?.[0] ?? host,
      downloadMiB: binary?.[3] ?? null, ready: Boolean(await this.ready()), versions };
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
      await writeFile(marker, JSON.stringify({ directory: basename(folder), lock: id, pythonSha: await digest(python) }), { mode: 0o600 });
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

  async validate(scratch: string, signal: AbortSignal) {
    const runtime = await this.ready();
    if (!runtime) throw new Error('Install the pinned runtime before validating a plan.');
    const output = await run(runtime.python, ['-I', '-B', join(this.assets, 'assets', 'renderer', 'semantic.py'), join(scratch, 'plan.json')],
      scratch, environment(scratch, runtime.prefix), signal, 'Plan validation');
    const result = JSON.parse(output);
    if (result.valid !== true) throw new Error(result.message || 'Invalid lesson plan.');
  }

  async render(scratch: string, signal: AbortSignal, height: 720 | 1080 = 720) {
    const runtime = await this.ready();
    if (!runtime) throw new Error('Install the pinned runtime before rendering.');
    const env = environment(scratch, runtime.prefix);
    await run(runtime.python, ['-I', '-B', join(this.assets, 'assets', 'renderer', 'scene.py'), scratch, String(height)],
      scratch, env, signal, 'Manim render');
    const path = join(scratch, 'video.mp4');
    const pcm = join(scratch, 'pcm.wav');
    if (await lstat(pcm).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    })) {
      const ffmpeg = await runtimeFile(runtime.prefix, ffmpegAt(runtime.prefix));
      const muxed = join(scratch, 'muxed.mp4');
      await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', path, '-i', pcm,
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
        '-shortest', muxed], scratch, env, signal, 'Narration mux');
      await rename(muxed, path);
    }
    const video = await lstat(path);
    if (!video.isFile() || video.size <= 0 || video.size > VIDEO_BYTES) throw new Error('Expected a nonempty MP4 of at most 96 MiB.');
    if (!windows) await chmod(path, 0o600);
    signal.throwIfAborted();
    return video.size;
  }
}
