import { constants } from 'node:fs';
import { copyFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PLAN_BYTES, WAV_BYTES } from './protocol';
import { privateDirectory, Runtime } from './runtime';

async function copyBounded(source: string, destination: string, limit: number) {
  const file = await open(resolve(source), 'r');
  try {
    const { size } = await file.stat();
    if (!(await file.stat()).isFile() || size <= 0 || size > limit) throw new Error('Input is empty, oversized, or not a regular file.');
    const buffer = Buffer.alloc(size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== size) throw new Error('Input changed during read.');
    await writeFile(destination, buffer.subarray(0, size), { mode: 0o600 });
  } finally {
    await file.close();
  }
}

async function main(args: string[]) {
  const [command, root, plan, output, wav, extra] = args;
  if (!root || extra || !((command === 'status' && !plan) || (command === 'install' && plan === '--allow-download' && !output) ||
      (command === 'validate' && plan && !output) || (command === 'render' && plan && output))) {
    throw new Error('Usage: cli.cjs status DATA | install DATA --allow-download | validate DATA PLAN.json | render DATA PLAN.json OUTPUT.mp4 [NARRATION.wav]');
  }
  const runtime = new Runtime(__dirname, resolve(root));
  if (command === 'status') {
    console.log(JSON.stringify(await runtime.status()));
    return;
  }
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Cancelled.'));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (command === 'install') {
      await runtime.install(AbortSignal.any([abort.signal, AbortSignal.timeout(20 * 60 * 1000)]), (progress) => console.log(progress));
      console.log('Runtime ready.');
      return;
    }
    if (!await runtime.ready()) throw new Error('Install the pinned runtime before importing a plan.');
    const scratch = await mkdtemp(join(await privateDirectory(join(resolve(root), 'cli-jobs')), 'render-'));
    try {
      await copyBounded(plan, join(scratch, 'plan.json'), PLAN_BYTES);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12 * 60 * 1000)]);
      await runtime.validate(scratch, signal);
      if (command === 'validate') {
        console.log('Plan valid.');
        return;
      }
      if (wav) await copyBounded(wav, join(scratch, 'narration.wav'), WAV_BYTES);
      await runtime.render(scratch, signal);
      signal.throwIfAborted();
      await copyFile(join(scratch, 'video.mp4'), resolve(output), constants.COPYFILE_EXCL);
      console.log('Video rendered.');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
