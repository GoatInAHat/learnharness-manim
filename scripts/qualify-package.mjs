import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { bundleTestModule } from './bundle-test-module.mjs';
import { packageFiles, pluginId, zipTool } from './package.mjs';
import { checkAutomaticNarration } from './qualify-voice.mjs';

const { Runtime, environment, run } = await bundleTestModule('src/runtime.ts');
const { SavedLessons } = await bundleTestModule('src/saved-lessons.ts');
const archive = resolve(`${pluginId}.zip`);
const fixture = resolve('scripts/fixture.py');
const scratch = await mkdtemp(join(resolve(process.argv[2] ?? tmpdir()), 'manim-ci-'));
const plugin = join(scratch, pluginId);
const dist = join(plugin, 'dist');
const data = join(plugin, 'data');
const video = join(scratch, 'synthetic.mp4');
const windows = process.platform === 'win32';
const minute = 60_000;

function cli(args, minutes = 1, denied = false) {
  const result = spawnSync(process.execPath, [join(dist, 'cli.cjs'), ...args], {
    cwd: scratch, env: environment(scratch), encoding: 'utf8', timeout: minutes * minute, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, denied ? 1 : 0, `${args[0]}: ${result.stderr || result.signal || result.stdout}`);
  return denied ? result.stderr : result.stdout;
}

function status(ready) {
  const current = JSON.parse(cli(['status', data]));
  assert.equal(current.supported, true);
  assert.equal(current.ready, ready);
  return current;
}

try {
  zipTool('unpack', archive, scratch);
  assert.deepEqual(await readdir(scratch), [pluginId]);
  assert.deepEqual(await readdir(plugin), ['dist']);
  const files = [];
  for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), `Unexpected ZIP entry: ${entry.name}`);
    files.push(relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  assert.deepEqual(files.sort(), [...packageFiles].sort());
  status(false);
  assert.match(cli(['install', data], 1, true), /^Usage: .*--allow-download/);
  assert.match(cli(['install-voice', data], 1, true), /^Usage: .*--allow-download/);
  await assert.rejects(lstat(data), { code: 'ENOENT' });

  console.log('ZIP layout and download consent verified; installing pinned runtime.');
  cli(['install', data, '--allow-download'], 21);
  assert.equal(status(true).voiceReady, false);
  const runtime = new Runtime(dist, data);
  const local = await runtime.ready();
  assert.ok(local, 'Expected a verified runtime prefix in the isolated data directory.');
  const env = environment(scratch, local.prefix);
  const bin = windows ? join(local.prefix, 'Library', 'bin') : join(local.prefix, 'bin');
  const media = (tool, args, minutes = 1) => run(join(bin, tool + (windows ? '.exe' : '')), args,
    scratch, env, AbortSignal.timeout(minutes * minute), tool);

  await run(local.python, ['-I', '-B', fixture, scratch], scratch, env, AbortSignal.timeout(minute), 'Fixture');
  const plan = join(scratch, 'plan.json');
  assert.match(cli(['render', data, plan, video], 1, true), /Install the offline voice/);
  await assert.rejects(lstat(video), { code: 'ENOENT' });
  console.log('Qualifying the pinned offline voice with the synthetic fixture.');
  cli(['install-voice', data, '--allow-download'], 21);
  const installed = status(true);
  assert.equal(installed.voiceReady, true);
  await checkAutomaticNarration(runtime, plan, scratch);

  console.log('Rendering the 90-second synthetic fixture with automatic offline narration.');
  cli(['render', data, plan, video], 13);
  const probe = JSON.parse(await media('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,duration', '-of', 'json', video]));
  assert.deepEqual(probe.streams.map(({ codec_type, codec_name }) => `${codec_type}/${codec_name}`).sort(),
    ['audio/aac', 'video/h264']);
  for (const { duration } of [...probe.streams, probe.format]) {
    assert.ok(Math.abs(Number(duration) - 90) <= 0.1, `Expected 90 seconds, got ${duration}.`);
  }
  await media('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', video,
    '-map', '0:v:0', '-map', '0:a:0', '-abort_on', 'empty_output_stream', '-f', 'null', '-'], 3);

  const libraryDir = join(data, 'saved');
  const first = randomUUID();
  const second = randomUUID();
  const signal = AbortSignal.timeout(minute);
  const library = new SavedLessons(libraryDir);
  await library.keep(first, 'First synthetic lesson', video, signal);
  await library.keep(second, 'Second synthetic lesson', video, signal);

  const sentinel = join(data, 'qualification-sentinel');
  await writeFile(sentinel, 'keep plugin data\n', { flag: 'wx' });
  await rm(dist, { recursive: true });
  zipTool('unpack', archive, scratch);
  assert.equal(await readFile(sentinel, 'utf8'), 'keep plugin data\n');
  assert.deepEqual(status(true), installed);
  assert.deepEqual(await runtime.ready(), local);
  const reopened = new SavedLessons(libraryDir);
  assert.deepEqual(new Set((await reopened.list()).map(({ id }) => id)), new Set([first, second]));
  const firstBytes = await reopened.chunk(first, 0);
  assert.equal(Buffer.from(firstBytes, 'base64').subarray(4, 8).toString(), 'ftyp');
  assert.deepEqual(await reopened.chunk(second, 0), firstBytes);
  console.log('H.264/AAC duration, full decode, and two saved lessons after dist replacement verified.');
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
