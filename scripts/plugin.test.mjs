import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { bundleTestModule } from './bundle-test-module.mjs';
import { pack, packageFiles, pluginId, zipTool } from './package.mjs';

const require = createRequire(import.meta.url);
const [{ Jobs }, { environment, run, Runtime }, { CHUNK_BYTES, INLINE_VIDEO_BYTES, PLAN_BYTES, WAV_BYTES },
  { emptyNarration, placeUtterance }, { SavedLessons }] = await Promise.all(
  ['src/jobs.ts', 'src/runtime.ts', 'src/protocol.ts', 'src/voice.ts', 'src/saved-lessons.ts'].map(bundleTestModule),
);

async function scratch(t) {
  const folder = await mkdtemp(join(tmpdir(), 'manim-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('standalone package extracts to the LearnHarness plugin layout and activates without downloads', async (t) => {
  const folder = await scratch(t);
  const archive = join(folder, 'release.zip');
  await pack(archive);
  zipTool('unpack', archive, folder);
  const plugin = join(folder, pluginId);
  const dist = join(plugin, 'dist');
  const entries = await readdir(dist, { withFileTypes: true, recursive: true });
  assert.ok(entries.every((entry) => entry.isDirectory() || entry.isFile()));
  assert.deepEqual(entries.filter((entry) => entry.isFile())
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/')).sort(), [...packageFiles].sort());
  assert.deepEqual(await readdir(plugin), ['dist']);
  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, pluginId);
  assert.equal(manifest.apiVersion, 1);
  assert.equal(manifest.version, '0.4.0');
  assert.equal(manifest.minAppVersion, '0.6.0');
  for (const file of [manifest.main, manifest.backend, manifest.styles]) assert.ok(packageFiles.includes(file));
  const main = await readFile(join(dist, manifest.main));
  assert.equal(typeof (await import(`data:text/javascript;base64,${main.toString('base64')}`)).activate, 'function');

  const operations = new Map();
  const cleanup = [];
  const tools = [];
  const abort = new AbortController();
  require(join(dist, manifest.backend)).activate({
    directory: dist, dataDirectory: join(plugin, 'data'), signal: abort.signal,
    handle: (name, handler) => { operations.set(name, handler); return () => operations.delete(name); },
    cleanup: (fn) => cleanup.push(fn), registerInstructions: () => () => {},
    registerTools: ({ create }) => { tools.push(...create()); return () => {}; },
  });
  t.after(async () => {
    abort.abort();
    await Promise.all(cleanup.map((fn) => fn()));
  });
  const status = await operations.get('status')();
  assert.equal(status.ready, false);
  assert.equal(status.install, null);
  assert.equal(status.voiceReady, false);
  assert.deepEqual(tools.map(({ name }) => name), ['manim_render_scene', 'manim_render_lesson']);
  assert.throws(() => operations.get('repairReferenceVoice')({ confirmed: false }), /Confirm the reference voice download/);
  assert.throws(() => operations.get('install')({ confirmed: 'true', narration: 'automatic' }), /Confirm the local setup download/);
  assert.throws(() => operations.get('install')({ confirmed: true, narration: 'unexpected' }), /Select a narration option/);
  assert.throws(() => operations.get('install')({ confirmed: true, narration: 'silent', allowRuntime: false, allowVoice: true }), /Confirm the components/);
  await assert.rejects(operations.get('install')({ confirmed: true, narration: 'automatic', allowRuntime: true,
    allowVoice: true, setupKey: 'stale' }), /setup changed/);
  await assert.rejects(operations.get('install')({ confirmed: true, narration: 'automatic', allowRuntime: false,
    allowVoice: true, setupKey: status.setupKey }), /setup changed/);
  assert.deepEqual(await readdir(plugin), ['dist']);
});

test('reference profile validates inputs, survives restart, and is removable', async (t) => {
  const folder = await scratch(t);
  const runtime = new Runtime(folder, folder);
  const wav = emptyNarration(120);
  wav.writeInt16LE(-328, 44);
  const profile = { sample: wav.toString('base64'), transcript: 'This is an authorized fixture.', enabled: false };
  const signal = new AbortController().signal;
  const saved = { enabled: false, transcript: profile.transcript };
  assert.equal(await runtime.referenceProfile(), null);
  await assert.rejects(runtime.saveReferenceProfile({ ...profile, sample: 'bad' }, signal), /Choose a mono/);
  await assert.rejects(runtime.saveReferenceProfile({ ...profile, transcript: '' }, signal), /exact transcript/);
  if (process.platform !== 'win32') {
    assert.deepEqual(await runtime.saveReferenceProfile(profile, signal), saved);
    await assert.rejects(runtime.saveReferenceProfile({ ...profile, transcript: 'Changed' },
      AbortSignal.abort(new Error('cancelled'))), /cancelled/);
    const reopened = new Runtime(folder, folder);
    assert.deepEqual(await reopened.referenceProfile(), profile);
    assert.deepEqual(await reopened.saveReferenceProfile({ ...saved, sample: undefined }, signal), saved);
    await reopened.removeReferenceProfile();
    assert.equal(await reopened.referenceProfile(), null);
  }
});

test('invalid reference WAVs fail before setup or staging', async (t) => {
  const folder = await scratch(t);
  const runtime = new Runtime(folder, folder);
  const stereo = emptyNarration(120);
  stereo.writeUInt16LE(2, 22);
  const truncated = emptyNarration(120).subarray(0, -1);
  const wrongRate = emptyNarration(120);
  wrongRate.writeUInt32LE(44100, 24);
  const badChunk = emptyNarration(120);
  badChunk.writeUInt32LE(0xffffffff, 40);
  const signal = new AbortController().signal;
  let setups = 0;
  runtime.installReference = async () => { setups++; };
  for (const wav of [stereo, truncated, wrongRate, badChunk, emptyNarration(89), emptyNarration(901)]) {
    await assert.rejects(runtime.saveReferenceProfile({
      sample: wav.toString('base64'), transcript: 'This is an authorized fixture.', enabled: true,
    }, signal), /Choose a mono/);
  }
  const silent = emptyNarration(120);
  const nearSilent = emptyNarration(120);
  nearSilent.writeInt16LE(-327, 44);
  for (const wav of [silent, nearSilent]) {
    await assert.rejects(runtime.saveReferenceProfile({
      sample: wav.toString('base64'), transcript: 'This is an authorized fixture.', enabled: true,
    }, signal), /silent or too quiet/);
  }
  assert.equal(setups, 0);
  assert.deepEqual(await readdir(folder), []);
});

test('reference setup requires an existing Manim runtime', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async (t) => {
  const folder = await scratch(t);
  const runtime = new Runtime(folder, folder);
  runtime.ready = async () => null;
  runtime.install = async () => assert.fail('reference setup must not download the base runtime');
  await assert.rejects(runtime.installReference(new AbortController().signal, () => {}), /Set up local rendering/);
  assert.deepEqual(await readdir(folder), []);
});

test('reference readiness detects missing companions and same-size model corruption', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async (t) => {
  const folder = await scratch(t);
  const lockDir = join(folder, 'assets', 'runtime', 'voice');
  const root = join(folder, 'voice', 'qwen-50f45ef0047c-mlx-0.32.4-py314-v1');
  const model = join(root, 'model', 'speech_tokenizer', 'fixture.safetensors');
  const files = ['mlx/core.cpython-314-darwin.so', 'mlx/lib/libmlx.dylib', 'mlx/lib/mlx.metallib',
    'mlx_audio/tts/models/qwen3_tts/qwen3_tts.py', 'safetensors/_safetensors_rust.abi3.so', 'tokenizers/tokenizers.abi3.so'];
  await mkdir(lockDir, { recursive: true });
  await mkdir(join(root, 'model', 'speech_tokenizer'), { recursive: true });
  await mkdir(join(root, 'site', 'transformers'), { recursive: true });
  for (const file of files) {
    const path = join(root, 'site', file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'companion');
  }
  const expected = createHash('sha256').update('good').digest('hex');
  await writeFile(join(lockDir, 'qwen-model.tsv'), `speech_tokenizer/fixture.safetensors\t4\t${expected}\n`);
  const runtime = new Runtime(folder, folder);
  assert.equal(await runtime.referenceReady(), false);
  await writeFile(model, 'good');
  assert.equal(await runtime.referenceReady(), true);
  await writeFile(model, 'evil');
  assert.equal(await runtime.referenceReady(), false);
  await writeFile(model, 'good');
  assert.equal(await runtime.referenceReady(), true);
  await rm(join(root, 'site', files[1]));
  assert.equal(await runtime.referenceReady(), false);
});

test('completed lessons reopen after a new backend and disposing temporary jobs never deletes them', async (t) => {
  const folder = await scratch(t);
  const signal = new AbortController().signal;
  const video = Buffer.alloc(CHUNK_BYTES + 3, 52);
  const runtime = { ready: async () => true, validate: async () => {}, render: async (job) => {
    await writeFile(join(job, 'video.mp4'), video);
    return video.length;
  } };
  const jobs = new Jobs(folder, runtime, signal);
  const ids = [];
  for (let n = 1; n <= 6; n++) {
    const title = `Lesson ${n}`;
    const id = await jobs.create(JSON.stringify({ title }), 'silent');
    ids.push(id);
    jobs.start(id);
    for (let i = 0; i < 100 && !(await jobs.views()).some(j => j.id === id && j.saved); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok((await jobs.views()).some(j => j.id === id && j.saved));
  }
  await jobs.dispose();
  const reopened = new Jobs(folder, runtime, signal);
  assert.deepEqual(new Set((await reopened.views()).map(j => j.id)), new Set(ids));
  for (const id of ids) {
    assert.equal(await reopened.chunk(id, 0), video.subarray(0, CHUNK_BYTES).toString('base64'));
    assert.equal(await reopened.chunk(id, CHUNK_BYTES), video.subarray(CHUNK_BYTES).toString('base64'));
  }
  await assert.rejects(reopened.chunk('../video.mp4', 0), /unavailable/);
  await assert.rejects(reopened.remove(ids[0]), /expired/);
  await reopened.deleteSaved(ids[0]);
  assert.deepEqual(new Set((await reopened.views()).map(j => j.id)), new Set(ids.slice(1)));
  const saved = new SavedLessons(join(folder, 'saved'));
  const retained = join(folder, 'saved', ids[1], 'video.mp4');
  await assert.rejects(saved.keep(ids[1], 'Cannot overwrite', retained, signal, true));
  assert.deepEqual(await readFile(retained), video);
  assert.equal((await saved.list()).find(lesson => lesson.id === ids[1]).title, 'Lesson 2');
  const aborted = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(saved.keep(randomUUID(), 'Cancelled', join(folder, 'saved', ids[1], 'video.mp4'), aborted), /cancelled/);
  assert.equal((await saved.list()).length, 5);
});

test('malformed metadata does not hide healthy lessons and no prior lesson is evicted', async (t) => {
  const folder = await scratch(t);
  const directory = join(folder, 'saved');
  const source = join(folder, 'fixture.mp4');
  await writeFile(source, Buffer.from('small fixture'));
  const malformed = join(directory, randomUUID());
  await mkdir(malformed, { recursive: true });
  await writeFile(join(malformed, 'lesson.json'), '{malformed');
  const library = new SavedLessons(directory);
  const signal = new AbortController().signal;
  for (let n = 1; n <= 15; n++) await library.keep(randomUUID(), `Lesson ${n}`, source, signal);
  assert.equal((await readdir(directory)).length, 16);
  assert.equal((await library.list()).length, 15);
});

test('a storage error leaves the rendered video recoverable without calling it saved', async (t) => {
  const folder = await scratch(t);
  await writeFile(join(folder, 'saved'), 'Deliberately block the library directory');
  const signal = new AbortController().signal;
  const bytes = Buffer.from('rendered video');
  const runtime = { ready: async () => true, validate: async () => {}, render: async (job) => {
    await writeFile(join(job, 'video.mp4'), bytes);
    return bytes.length;
  } };
  const jobs = new Jobs(folder, runtime, signal);
  const id = await jobs.create('{"title":"Recoverable lesson"}', 'silent');
  jobs.start(id);
  for (let i = 0; i < 100 && jobs.list()[0].state === 'rendering'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(jobs.list()[0].state, 'save-error');
  assert.equal(await jobs.chunk(id, 0), bytes.toString('base64'));
  await jobs.dispose();
  const temp = (await readdir(folder)).find(name => name.startsWith('render-'));
  assert.deepEqual(await readFile(join(folder, temp, 'video.mp4')), bytes);
});

test('job API caps UTF-8 plans, chunk ordering, and total WAV bytes, and cancels running work', async (t) => {
  const folder = await scratch(t);
  let stopped = false;
  const jobs = new Jobs(folder, {
    ready: async () => true,
    validate: async () => {},
    render: (_folder, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { stopped = true; reject(signal.reason); }, { once: true });
    }),
  }, new AbortController().signal);
  t.after(() => jobs.dispose());
  await assert.rejects(jobs.create('é'.repeat(32769)), /allowed size/);
  const id = await jobs.create('{}', 'wav');
  assert.throws(() => jobs.start(id), /Attach a cue-aligned WAV/);
  const chunk = Buffer.alloc(CHUNK_BYTES, 0x8e).toString('base64');
  await assert.rejects(jobs.upload(id, 1, chunk), /out of sequence/);
  await assert.rejects(jobs.upload(id, 0, 'AA'), /Invalid audio chunk/);
  for (let offset = 0; offset < WAV_BYTES; offset += CHUNK_BYTES) await jobs.upload(id, offset, chunk);
  await assert.rejects(jobs.upload(id, WAV_BYTES, 'AA=='), /exceeds 12 MiB/);
  jobs.start(id);
  assert.equal(jobs.list()[0].state, 'rendering');
  await jobs.remove(id);
  assert.equal(stopped, true);
  assert.deepEqual(await readdir(folder), []);
});

test('jobs default to automatic narration and require an explicit silent or WAV selection', async (t) => {
  const folder = await scratch(t);
  const rendered = [];
  const jobs = new Jobs(folder, {
    ready: async () => true, validate: async () => {},
    render: async (_folder, _signal, narration) => { rendered.push(narration); return 1; },
  }, new AbortController().signal);
  t.after(() => jobs.dispose());
  await assert.rejects(jobs.create('{}', 'other'), /Unknown narration option/);
  for (const mode of [undefined, 'silent', 'wav']) {
    const id = await jobs.create('{}', mode);
    if (mode === 'wav') await jobs.upload(id, 0, 'AA==');
    else await assert.rejects(jobs.upload(id, 0, 'AA=='), /Select the WAV narration option/);
    jobs.start(id);
    await jobs.remove(id);
  }
  assert.deepEqual(rendered, ['automatic', 'silent', 'wav']);
});

test('source jobs accept larger inputs and keep videos beyond the inline preview limit', async (t) => {
  const folder = await scratch(t);
  const size = INLINE_VIDEO_BYTES + 1;
  const jobs = new Jobs(folder, {
    ready: async () => true,
    validate: async () => ({ source: true }),
    render: async (directory) => {
      const path = join(directory, 'video.mp4');
      await writeFile(path, 'fixture');
      await truncate(path, size);
      return size;
    },
  }, new AbortController().signal);
  t.after(() => jobs.dispose());
  await assert.rejects(jobs.create(JSON.stringify({ graph: 'x'.repeat(PLAN_BYTES) })), /64 KiB/);
  const id = await jobs.create(JSON.stringify({ title: 'Large source', source: ' '.repeat(PLAN_BYTES) }));
  jobs.start(id);
  for (let i = 0; i < 100 && !(await jobs.views()).some((job) => job.saved); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok((await jobs.views()).some((job) => job.id === id && job.saved && job.size === size));
  assert.equal(await jobs.videoPath(id), join(folder, 'saved', id, 'video.mp4'));
  await assert.rejects(jobs.videoPath('../video.mp4'), /unavailable/);
});

test('PCM placement starts at the exact cue and rejects truncation, silence and overrun', async (t) => {
  const path = join(await scratch(t), 'beat.wav');
  const speech = emptyNarration(1);
  const wav = emptyNarration(4);
  await writeFile(path, speech);
  await assert.rejects(placeUtterance(wav, path, 1, 1, 2), /silent/);
  speech.writeInt16LE(1200, 44);
  speech.writeInt16LE(-800, speech.length - 2);
  await writeFile(path, speech.subarray(0, -2));
  await assert.rejects(placeUtterance(wav, path, 1, 1, 2), /complete mono PCM/);
  await writeFile(path, speech);
  await assert.rejects(placeUtterance(wav, path, 1, 1, 1), /exceeds its cue window/);
  await placeUtterance(wav, path, 1, 1, 2);
  assert.ok(wav.subarray(44, 1644).every((byte) => byte === 0));
  assert.deepEqual(wav.subarray(1644, 3244), speech.subarray(44));
  assert.ok(wav.subarray(3244).every((byte) => byte === 0));
});

test('subprocesses receive a private environment and are terminated on cancel and timeout', async (t) => {
  const folder = await scratch(t);
  const env = environment(folder);
  assert.equal(env.HOME, folder);
  assert.equal(env.TMPDIR, folder);
  assert.ok(Object.keys(env).every((key) => /^(PATH|HOME|USERPROFILE|TMPDIR|TEMP|TMP|XDG_(CONFIG|CACHE|DATA)_HOME|APPDATA|LOCALAPPDATA|LANG|LC_ALL|OPENBLAS_NUM_THREADS|OMP_NUM_THREADS|SystemRoot|ComSpec)$/.test(key)));
  const script = join(folder, 'wait.cjs');
  await writeFile(script, 'setInterval(() => {}, 1000);');
  const abort = new AbortController();
  const running = run(process.execPath, [script], folder, env, abort.signal, 'Test child');
  abort.abort(new Error('Cancelled by test'));
  await assert.rejects(running, /Cancelled by test/);
  await assert.rejects(run(process.execPath, [script], folder, env, AbortSignal.timeout(150), 'Test child'),
    { name: 'TimeoutError' });
});
