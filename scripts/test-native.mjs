import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleTestModule } from './bundle-test-module.mjs';

const [data] = process.argv.slice(2);
if (!data) throw new Error('Usage: npm run test:native -- DATA');
const { Runtime, environment } = await bundleTestModule('src/runtime.ts');
const installed = await new Runtime(resolve('dist'), resolve(data)).ready();
if (!installed) throw new Error('Build the plugin and install the pinned runtime before running native tests.');
const scratch = await mkdtemp(join(tmpdir(), 'manim-native-tests-'));
try {
  const result = spawnSync(installed.python, ['-I', '-B', resolve('scripts/test_native.py'), resolve('renderer'), scratch],
    { cwd: scratch, env: environment(scratch, installed.prefix), stdio: 'inherit', timeout: 30_000, windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
