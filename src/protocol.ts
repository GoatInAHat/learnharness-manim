export const PLAN_BYTES = 64 * 1024;
export const SOURCE_PLAN_BYTES = 1024 * 1024;
export const WAV_BYTES = 12 * 1024 * 1024;
export const INLINE_VIDEO_BYTES = 96 * 1024 * 1024;
export const CHUNK_BYTES = 192 * 1024;
export type Narration = 'automatic' | 'silent' | 'wav';

export interface JobView {
  id: string;
  state: 'upload' | 'rendering' | 'ready' | 'save-error' | 'failed' | 'cancelled';
  size?: number;
  error?: string;
  title?: string;
  warning?: string;
  saved?: true;
}

export interface Status {
  supported: boolean;
  ready: boolean;
  platform: string;
  downloadMiB: number | null;
  versions: { python: string; manim: string; typst: string };
  install: string | null;
  voiceReady: boolean;
  referenceVoiceEnabled: boolean;
  voiceDownloadMiB: number | null;
  setupKey: string;
  jobs: JobView[];
  savedCount: number;
}

export interface DraftModel {
  id: string;
  provider: string;
  name: string;
}
