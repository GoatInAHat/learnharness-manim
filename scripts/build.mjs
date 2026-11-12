import { build } from 'esbuild';
import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { staticFiles } from './package.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const stat = async (path) => lstat(path).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
const dist = await stat('dist');
if ((dist && !dist.isDirectory()) || await stat('dist/data')) {
  throw new Error('Build requires a real dist directory with no data entry.');
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await Promise.all([
  build({ entryPoints: { main: 'src/frontend.ts' }, bundle: true, outdir: 'dist', format: 'esm', target: 'es2023' }),
  build({ entryPoints: { backend: 'src/backend.ts', cli: 'src/cli.ts' }, bundle: true, outdir: 'dist', platform: 'node', target: 'node22', format: 'cjs', outExtension: { '.js': '.cjs' } }),
  ...staticFiles.map(([source, target]) => cp(source, `dist/${target}`)),
]);
