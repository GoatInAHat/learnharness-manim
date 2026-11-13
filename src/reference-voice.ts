import { release as kernelRelease } from 'node:os';
import { lstat, readFile } from 'node:fs/promises';

export const referenceSupported = process.platform === 'darwin' && process.arch === 'arm64' && Number.parseInt(kernelRelease(), 10) >= 23;
export const referenceRevision = '50f45ef0047cde7e84c2ef04326acb8ada2436a7';
export const referenceURL = `https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit/resolve/${referenceRevision}`;
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
  if (typeof raw !== 'string' || !raw || raw.length > Math.ceil(referenceWavBytes / 3) * 4) {
    throw new Error('Choose a mono 24 kHz PCM16 WAV with 3–30 seconds of speech.');
  }
  const audio = Buffer.from(raw, 'base64');
  if (audio.length > referenceWavBytes || audio.toString('base64') !== raw ||
      audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE') {
    throw new Error('Choose a mono 24 kHz PCM16 WAV with 3–30 seconds of speech.');
  }
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
