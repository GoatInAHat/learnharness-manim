import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { bundleTestModule } from './bundle-test-module.mjs';
import { pack, packageFiles, pluginId, zipTool } from './package.mjs';

const require = createRequire(import.meta.url);
const [{ Jobs }, { environment, run }, { CHUNK_BYTES, WAV_BYTES }, { emptyNarration, placeUtterance }, { SavedLessons }] = await Promise.all(
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
  assert.equal(manifest.minAppVersion, '0.6.0');
  for (const file of [manifest.main, manifest.backend, manifest.styles]) assert.ok(packageFiles.includes(file));
  const main = await readFile(join(dist, manifest.main));
  assert.equal(typeof (await import(`data:text/javascript;base64,${main.toString('base64')}`)).activate, 'function');

  const operations = new Map();
  const cleanup = [];
  const abort = new AbortController();
  require(join(dist, manifest.backend)).activate({
    directory: dist, dataDirectory: join(plugin, 'data'), signal: abort.signal,
    handle: (name, handler) => { operations.set(name, handler); return () => operations.delete(name); },
    cleanup: (fn) => cleanup.push(fn), registerTools: () => () => {},
  });
  t.after(async () => {
    abort.abort();
    await Promise.all(cleanup.map((fn) => fn()));
  });
  const status = await operations.get('status')();
  assert.equal(status.ready, false);
  assert.equal(status.install, null);
  assert.equal(status.voiceReady, false);
  assert.throws(() => operations.get('install')({ confirmed: 'true', narration: 'automatic' }), /Confirm the local setup download/);
  assert.throws(() => operations.get('install')({ confirmed: true, narration: 'unexpected' }), /Select a narration option/);
  assert.throws(() => operations.get('install')({ confirmed: true, narration: 'silent', allowRuntime: false, allowVoice: true }), /Confirm the components/);
  assert.throws(() => operations.get('install')({ confirmed: true, narration: 'automatic', allowRuntime: true, allowVoice: true, setupKey: 'stale' }), /setup changed/);
  await assert.rejects(operations.get('install')({ confirmed: true, narration: 'automatic', allowRuntime: false,
    allowVoice: true, setupKey: status.setupKey }), /setup changed/);
  assert.deepEqual(await readdir(plugin), ['dist']);
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
  for (const title of ['First lesson', 'Second lesson']) {
    const id = await jobs.create(JSON.stringify({ title }), 'silent');
    ids.push(id);
    jobs.start(id);
    for (let i = 0; i < 100 && !jobs.list().some(j => j.id === id && j.state === 'ready'); i++) {
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
  assert.deepEqual((await reopened.views()).map(j => j.id), [ids[1]]);
  const saved = new SavedLessons(join(folder, 'saved'));
  await assert.rejects(saved.keep(ids[1], 'Cannot overwrite', join(folder, 'saved', ids[1], 'video.mp4'), signal));
  assert.equal((await saved.list())[0].title, 'Second lesson');
  const aborted = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(saved.keep(randomUUID(), 'Cancelled', join(folder, 'saved', ids[1], 'video.mp4'), aborted), /cancelled/);
  assert.equal((await saved.list()).length, 1);
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
