import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Use the packaged runtime paths and real Pocket TTS, without a second Manim render in CI.
export async function checkAutomaticNarration(runtime, planFile, scratch) {
  const folder = await mkdtemp(join(scratch, 'auto-voice-'));
  try {
    const plan = join(folder, 'plan.json');
    const audio = join(folder, 'narration.wav');
    await copyFile(planFile, plan);
    await runtime.prepareNarration(folder, AbortSignal.timeout(120_000));
    const wav = await readFile(audio);
    const fixture = JSON.parse(await readFile(plan, 'utf8'));
    const offset = (frame) => 44 + frame * 1600;
    const duration = fixture.durationSeconds * 30;
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.length, offset(duration));
    let last = 44;
    for (const [index, beat] of fixture.beats.entries()) {
      const start = offset(beat.cueFrame);
      const end = offset((fixture.beats[index + 1]?.startFrame ?? duration) - 9);
      assert.ok(wav.subarray(last, start).every((byte) => byte === 0), `Audio before beat ${index + 1}`);
      let peak = 0;
      for (let sample = start; sample < Math.min(start + 24_000, end); sample += 2) {
        peak = Math.max(peak, Math.abs(wav.readInt16LE(sample)));
      }
      assert.ok(peak >= 16, `Beat ${index + 1} is silent near the cue`);
      last = end;
    }
    assert.ok(wav.subarray(last).every((byte) => byte === 0), 'Audio after last beat');
    await rm(audio);
    fixture.beats[0].cueFrame = fixture.beats[1].startFrame - 10;
    await writeFile(plan, JSON.stringify(fixture));
    await assert.rejects(runtime.prepareNarration(folder, AbortSignal.timeout(120_000)), /beat 1 exceeds its cue window/);
    await assert.rejects(readFile(audio), { code: 'ENOENT' });
    console.log('Automatic PCM is audible at every cue, zero outside windows, and rejects overruns.');
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}
