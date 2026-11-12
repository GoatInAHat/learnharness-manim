import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleTestModule } from './bundle-test-module.mjs';
import { pluginId, zipTool } from './package.mjs';

const [source, archive = `${pluginId}.zip`] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/check-host.mjs LEARNHARNESS_SOURCE [ZIP]');
const sourceRoot = resolve(source);
const checkout = process.cwd();
const { createPluginHost } = await bundleTestModule(join(sourceRoot, 'src/server/plugin-host.ts'));
const root = await mkdtemp(join(tmpdir(), 'manim-host-test-'));
try {
  const directory = join(root, 'plugins');
  await mkdir(directory);
  zipTool('unpack', resolve(archive), directory);
  await cp(join(sourceRoot, 'scripts/plugin-loader.cjs'), join(root, 'scripts/plugin-loader.cjs'));
  process.chdir(root);
  const host = createPluginHost({
    directory, appVersion: '0.6.0',
    createServices: () => ({
      learning: {}, inference: {},
      agents: { dispose: async () => {} }, workers: { dispose: async () => {} },
      createBackgroundTool() { throw new Error('Unexpected background tool'); },
    }),
  });
  try {
    await host.initialize();
    assert.equal(host.list().find((item) => item.id === pluginId)?.status, 'disabled');
    await host.setEnabled(pluginId, true);
    const enabled = host.list().find((item) => item.id === pluginId);
    assert.equal(enabled?.status, 'active', enabled?.error);
    assert.equal((await host.call(pluginId, 'status')).ready, false);
    await assert.rejects(host.call(pluginId, 'install', { confirmed: false }), /Confirm the runtime download/);
    await host.setEnabled(pluginId, false);
    assert.equal(host.list().find((item) => item.id === pluginId)?.status, 'disabled');
    console.log('LearnHarness 0.6.0 package discovery, activation, consent and disable passed.');
  } finally {
    await host.dispose();
  }
} finally {
  process.chdir(checkout);
  await rm(root, { recursive: true, force: true });
}
