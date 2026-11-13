import { release as kernelRelease } from 'node:os';
import { lstat, readFile } from 'node:fs/promises';

export const referenceSupported = process.platform === 'darwin' && process.arch === 'arm64' && Number.parseInt(kernelRelease(), 10) >= 23;
export const referenceRevision = 'fcf0cc857eade3615a60f30722cf5197d4f88406';
export const referenceSources = {
  csm: `mlx-community/csm-1b-8bit/resolve/${referenceRevision}`,
  mimi: 'kyutai/moshiko-pytorch-bf16/resolve/2bfc9ae6e89079a5cc7ed2a68436010d91a3d289',
  tokenizer: 'unsloth/Llama-3.2-1B/resolve/9535bd9b1d1dea6acafbdc4813b728796aeb28da',
};
export const referenceWavBytes = 30 * 24000 * 2 + 4096;

export interface ReferenceVoice {
  transcript: string;
  enabled: boolean;
  sample: string;
}

export function referenceTranscript(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 1800) {
    throw new Error('Enter the exact transcript of the reference WAV (up to 1800 UTF-8 bytes).');
  }
  return raw.trim();
}

export function referenceSample(raw: unknown) {
  const invalid = () => new Error('Choose a mono 24 kHz PCM16 WAV with 3–30 seconds of speech.');
  if (typeof raw !== 'string' || !raw || raw.length > Math.ceil(referenceWavBytes / 3) * 4) throw invalid();
  const audio = Buffer.from(raw, 'base64');
  if (audio.length < 44 || audio.length > referenceWavBytes || audio.toString('base64') !== raw ||
      audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE' ||
      audio.readUInt32LE(4) !== audio.length - 8) throw invalid();
  // Match the Python check: 1% of 32768 requires an integer peak of at least 328.
  const minimumPeak = 328;
  let format = false;
  let data = false;
  for (let offset = 12; offset < audio.length;) {
    if (offset + 8 > audio.length) throw invalid();
    const chunk = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    offset = start + size + (size % 2);
    if (offset > audio.length) throw invalid();
    if (chunk === 'fmt ') {
      if (format || size < 16 || audio.readUInt16LE(start) !== 1 ||
          audio.readUInt16LE(start + 2) !== 1 || audio.readUInt32LE(start + 4) !== 24000 ||
          audio.readUInt32LE(start + 8) !== 48000 || audio.readUInt16LE(start + 12) !== 2 ||
          audio.readUInt16LE(start + 14) !== 16) throw invalid();
      format = true;
    } else if (chunk === 'data') {
      if (!format || data || size % 2 || size < 3 * 48000 || size > 30 * 48000) throw invalid();
      let audible = false;
      for (let sample = start; sample < start + size; sample += 2) {
        if (Math.abs(audio.readInt16LE(sample)) >= minimumPeak) {
          audible = true;
          break;
        }
      }
      if (!audible) throw new Error('Reference WAV is silent or too quiet.');
      data = true;
    }
  }
  if (!data) throw invalid();
  return audio;
}

export async function readReferenceVoice(path: string): Promise<ReferenceVoice | null> {
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size > Math.ceil(referenceWavBytes / 3) * 4 + 4096 || (file.mode & 0o077)) {
      throw new Error('The reference voice profile must be a private file.');
    }
    const profile = JSON.parse(await readFile(path, 'utf8'));
    if (typeof profile.enabled !== 'boolean' || typeof profile.sample !== 'string') {
      throw new Error('The reference voice profile is invalid.');
    }
    return { ...profile, transcript: referenceTranscript(profile.transcript) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
