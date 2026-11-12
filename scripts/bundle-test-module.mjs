import { build } from 'esbuild';

export async function bundleTestModule(entryPoint) {
  const { outputFiles } = await build({
    entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
}
