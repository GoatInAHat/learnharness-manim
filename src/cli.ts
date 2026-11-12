import { constants } from 'node:fs';
import { copyFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PLAN_BYTES, WAV_BYTES } from './protocol';
import { privateDirectory, Runtime } from './runtime';

async function copyBounded(source: string, destination: string, limit: number) {
  const file = await open(resolve(source), constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    const { size } = stat;
    if (!stat.isFile() || size <= 0 || size > limit) throw new Error('Input is empty, oversized, or not a regular file.');
    const buffer = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset <= size) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) throw new Error('Input changed during read.');
    await writeFile(destination, buffer.subarray(0, size), { mode: 0o600 });
  } finally {
    await file.close();
  }
}

async function main(args: string[]) {
  const [command, root, plan, output, wav, extra] = args;
  if (!root || extra || !((command === 'status' && !plan) ||
      ((command === 'install' || command === 'install-voice') && plan === '--allow-download' && !output) ||
      (command === 'validate' && plan && !output) || (command === 'render' && plan && output) ||
      (command === 'compare' && plan && output && wav))) {
    throw new Error('Usage: cli.cjs status DATA | install DATA --allow-download | install-voice DATA --allow-download | validate DATA PLAN.json | render DATA PLAN.json OUTPUT.mp4 [--silent | NARRATION.wav] | compare DATA PLAN.json OUTPUT.mp4 NARRATION.wav');
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
    if (command === 'install-voice') {
      await runtime.installVoice(AbortSignal.any([abort.signal, AbortSignal.timeout(20 * 60 * 1000)]), (progress) => console.log(progress));
      console.log('Offline voice ready.');
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
      const narration = command === 'render' && wav === '--silent' ? 'silent' : wav ? 'wav' : 'automatic';
      if (narration === 'wav') await copyBounded(wav, join(scratch, 'narration.wav'), WAV_BYTES);
      await runtime.render(scratch, signal, narration, command === 'compare' ? 1080 : 720);
      signal.throwIfAborted();
      // A private, exclusive output stays private even under a permissive umask.
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
