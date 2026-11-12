export const PLAN_BYTES = 64 * 1024;
export const WAV_BYTES = 12 * 1024 * 1024;
export const VIDEO_BYTES = 96 * 1024 * 1024;
export const CHUNK_BYTES = 192 * 1024;

export interface JobView {
  id: string;
  state: 'upload' | 'rendering' | 'ready' | 'failed' | 'cancelled';
  size?: number;
  error?: string;
}

export interface Status {
  supported: boolean;
  ready: boolean;
  platform: string;
  versions: { python: string; manim: string; typst: string };
  install: string | null;
  jobs: JobView[];
}

export interface DraftModel {
  id: string;
  provider: string;
  name: string;
}
