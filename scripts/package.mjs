import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginId = 'manim-explainer';
export const staticFiles = [
  ...['manifest.json', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'styles.css'].map((path) => [path, path]),
  ['node_modules/typebox/license', 'TYPEBOX-LICENSE'],
  ['runtime/voice/POCKET-TTS-LICENSE', 'POCKET-TTS-LICENSE'],
  ...[
    'renderer/scene.py', 'renderer/plan.py', 'renderer/semantic.py', 'renderer/reference_voice.py',
    'contract/semantic-math-v3.md', 'contract/semantic-math-v3.schema.json',
    'runtime/osx-arm64.tsv', 'runtime/linux-64.tsv', 'runtime/win-64.tsv', 'runtime/voice/english.yaml',
    'runtime/voice/sesame-model.tsv', 'runtime/voice/mlx-osx-arm64.txt', 'skills/manim-narration/SKILL.md',
  ].map((path) => [path, `assets/${path}`]),
];
export const packageFiles = ['main.js', 'backend.cjs', 'cli.cjs', ...staticFiles.map(([, target]) => target)];
const windows = process.platform === 'win32';

export function zipTool(operation, archive, directory) {
  const compress = operation === 'pack';
  const program = windows ? 'tar.exe' : compress ? 'zip' : 'unzip';
  const args = compress
    ? windows ? ['-a', '-cf', archive, pluginId] : ['-Xqr', archive, pluginId]
    : windows ? ['-xf', archive] : ['-q', archive];
  execFileSync(program, args, { cwd: directory, stdio: 'inherit' });
}

export async function pack(target) {
  const dist = resolve('dist');
  if (!(await lstat(dist)).isDirectory()) throw new Error('Build the plugin into a real dist directory first.');
  const root = await realpath(dist);
  const folder = await mkdtemp(join(dirname(target), '.manim-package-'));
  try {
    for (const file of packageFiles) {
      const source = join(dist, file);
      if (!(await lstat(source)).isFile() || await realpath(source) !== join(root, file)) {
        throw new Error(`Unexpected build entry: ${file}`);
      }
      await cp(source, join(folder, pluginId, 'dist', file));
    }
    const archive = join(folder, `${pluginId}.zip`);
    zipTool('pack', archive, folder);
    await rename(archive, target);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await pack(resolve(process.argv[2] ?? `${pluginId}.zip`));
}
