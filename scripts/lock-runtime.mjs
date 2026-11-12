import { readFile, writeFile } from 'node:fs/promises';

const [platform, input] = process.argv.slice(2);
if (!['osx-arm64', 'linux-64', 'win-64'].includes(platform) || !input) {
  throw new Error('Usage: node scripts/lock-runtime.mjs PLATFORM MICROMAMBA-SOLVE.json');
}
const solve = JSON.parse(await readFile(input, 'utf8'));
if (!solve.success || !solve.actions?.LINK?.length) throw new Error('The solve did not succeed.');
const lock = solve.actions.LINK.map(({ url, fn, subdir, sha256, size }) => {
  if (!['noarch', platform].includes(subdir) || !/^[a-f0-9]{64}$/.test(sha256) ||
      decodeURI(url) !== `https://conda.anaconda.org/conda-forge/${subdir}/${fn}` || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Unexpected package in the solve.');
  }
  return `${subdir}/${fn}\t${sha256}\t${size}`;
}).join('\n');
await writeFile(new URL(`../runtime/${platform}.tsv`, import.meta.url), `${lock}\n`);
