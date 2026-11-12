import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { bundleTestModule } from './bundle-test-module.mjs';
import { pack, packageFiles, pluginId, zipTool } from './package.mjs';

const require = createRequire(import.meta.url);
const [{ Jobs }, { environment, run }, { CHUNK_BYTES, WAV_BYTES }] = await Promise.all(
  ['src/jobs.ts', 'src/runtime.ts', 'src/protocol.ts'].map(bundleTestModule),
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
  assert.throws(() => operations.get('install')({ confirmed: 'true' }), /Confirm the runtime download/);
  assert.deepEqual(await readdir(plugin), ['dist']);
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
  const id = await jobs.create('{}');
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
