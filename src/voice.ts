import { lstat, readFile } from 'node:fs/promises';

export const voiceRelease = 'v4.0.1';
export const voiceRevision = 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739';
export const voiceModelURL = `https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/${voiceRevision}/languages/english_18m_2026-10`;
export const voiceModels = [
  { file: 'model.safetensors', bytes: 111_728_528, sha: '599329dcea2f2a8d17b575e1c6e11b78822453c9073040d55c26faadf4883188' },
  { file: 'alba.safetensors', remote: 'embeddings/alba.safetensors', bytes: 4_163_992, sha: '11554cbe9f3d3a3e10722932df9952bb44928e534f7af3200524659166b5627a' },
  { file: 'tokenizer.model', bytes: 59_339, sha: 'd461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6' },
];
export const voiceConfig = { file: 'english.yaml', sha: '0ed0981e783eba2e3b611340a94911d97100737e93673b36547937875d0dfa86' };
const unixLicense = '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3';
const voiceBinaries = {
  'darwin-arm64': {
    archive: 'pocket-tts-3.3.0-aarch64-apple-darwin.tar.gz', bytes: 7_696_220,
    sha: 'ee9ca6c7c000ee72c5846e3a8ba01d08f56636d94a614d2259c3f12b8fd69afa',
    executable: { file: 'pocket-tts', bytes: 20_048_208, sha: '447d95181e133b3fda268d248126041722cf1bdf767093f44f2a0d047ab192be' },
    licenseSha: unixLicense,
  },
  'linux-x64': {
    archive: 'pocket-tts-3.3.0-x86_64-unknown-linux-gnu.tar.gz', bytes: 8_641_335,
    sha: '9abff0aa138a804e44052952d8c3bdaae247fb267ca8f4b83fe178897d1a0559',
    executable: { file: 'pocket-tts', bytes: 24_634_728, sha: '3bb8962b52b04be0144fba2ac01f4a9f2b390337649d7b2460b722f1830f4c51' },
    licenseSha: unixLicense,
  },
  'win32-x64': {
    archive: 'pocket-tts-3.3.0-x86_64-pc-windows-msvc.zip', bytes: 7_914_990,
    sha: '98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c',
    executable: { file: 'pocket-tts.exe', bytes: 22_080_000, sha: '813cabfc2f8fc7a4e5310deda6025426b3164610dd9f3c3098a6078e5cc1895a' },
    licenseSha: '36516aefdc84c5d5a1e7485425913a22dbda69eb1930c5e84d6ae4972b5194b9',
  },
};
const host = `${process.platform}-${process.arch}`;
export const voiceBinary = voiceBinaries[host as keyof typeof voiceBinaries];
export const voiceDownloadMiB = voiceBinary
  ? Math.ceil((voiceBinary.bytes + voiceModels.reduce((total, asset) => total + asset.bytes, 0)) / 2 ** 20) : null;

// Both local voices write mono PCM16 at 24 kHz (800 samples per video frame).
const header = Buffer.from('524946460000000057415645666d74201000000001000100c05d000080bb0000020010006461746100000000', 'hex');
const frameBytes = 1600;

export function emptyNarration(durationFrames: number) {
  const bytes = durationFrames * frameBytes;
  const wav = Buffer.alloc(header.length + bytes);
  header.copy(wav);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

export async function readUtterance(path: string, index: number, maxFrames: number) {
  const stat = await lstat(path);
  const limit = maxFrames * frameBytes;
  if (stat.size > header.length + limit) {
    throw new Error(`Automatic narration for beat ${index} exceeds its cue window. Shorten the narration, adjust the timing, or select a different audio option.`);
  }
  const invalid = () => new Error(`Automatic narration for beat ${index} did not produce complete mono PCM.`);
  if (!stat.isFile() || stat.size <= header.length || stat.size % 2 !== 0) throw invalid();
  const speech = await readFile(path);
  if (speech.length !== stat.size || !speech.subarray(0, 4).equals(header.subarray(0, 4)) ||
      speech.readUInt32LE(4) !== speech.length - 8 || !speech.subarray(8, 40).equals(header.subarray(8, 40)) ||
      speech.readUInt32LE(40) !== speech.length - header.length) throw invalid();
  for (let offset = header.length; offset < speech.length; offset += 2) {
    if (Math.abs(speech.readInt16LE(offset)) >= 16) return speech.subarray(header.length);
  }
  throw new Error(`Automatic narration for beat ${index} is silent.`);
}

export async function placeUtterance(wav: Buffer, path: string, index: number, cue: number, end: number) {
  const pcm = await readUtterance(path, index, end - cue);
  pcm.copy(wav, header.length + cue * frameBytes);
}

type BeatTiming = { startFrame: number; settleFrame: number; cueFrame: number };

// Keep the authored motion and cue offsets. Use spare hold time if a longer beat
// would otherwise push the scene beyond the contract's 120-second limit.
export function alignReferenceNarration<T extends BeatTiming>(plan: { durationSeconds: number; beats: T[] }, audio: Buffer[]) {
  const fps = 30;
  const duration = plan.durationSeconds * fps;
  const minimum = plan.beats.map((beat, i) => Math.max(beat.settleFrame - beat.startFrame + 1,
    beat.cueFrame - beat.startFrame + Math.ceil(audio[i].length / frameBytes) + 9));
  const lengths = plan.beats.map((beat, i) => Math.max(minimum[i], (plan.beats[i + 1]?.startFrame ?? duration) - beat.startFrame));
  let excess = lengths.reduce((sum, length) => sum + length, 0) - 120 * fps;
  for (const [i, length] of lengths.entries()) {
    if (excess <= 0) break;
    const trim = Math.min(excess, length - minimum[i]);
    lengths[i] -= trim;
    excess -= trim;
  }
  if (excess > 0) throw new Error('The Sesame narration needs more than 120 seconds. Shorten the lesson narration.');

  let start = 0;
  const beats = plan.beats.map((beat, i) => {
    const shift = start - beat.startFrame;
    const timing = { ...beat, startFrame: start, settleFrame: beat.settleFrame + shift, cueFrame: beat.cueFrame + shift };
    start += lengths[i];
    return timing;
  });
  const durationSeconds = Math.ceil(start / fps);
  const wav = emptyNarration(durationSeconds * fps);
  for (const [i, beat] of beats.entries()) audio[i].copy(wav, header.length + beat.cueFrame * frameBytes);
  return { plan: { ...plan, durationSeconds, beats }, wav };
}
