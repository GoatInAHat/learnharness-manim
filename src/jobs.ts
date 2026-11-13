import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHUNK_BYTES, PLAN_BYTES, SOURCE_PLAN_BYTES, WAV_BYTES } from './protocol';
import type { JobView, Narration } from './protocol';
import { defaultRenderSeconds, privateDirectory, Runtime } from './runtime';
import { readVideoChunk, SavedLessons } from './saved-lessons';

const lifetime = 30 * 60 * 1000;

export function object(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}

export function text(raw: unknown, max: number) {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > max) throw new Error('Text is empty or exceeds its allowed size.');
  return raw;
}

export function integer(raw: unknown, max: number) {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > max) throw new Error('Number is outside its allowed range.');
  return raw;
}

interface Job extends JobView {
  folder: string;
  narration: Narration;
  timeoutSeconds: number;
  timer: ReturnType<typeof setTimeout>;
  audioSize: number;
  writing: boolean;
  abort: AbortController;
  work?: Promise<void>;
}

export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly saved: SavedLessons;
  private starting = 0;

  constructor(private readonly root: string, private readonly runtime: Runtime, private readonly signal: AbortSignal) {
    this.saved = new SavedLessons(join(root, 'saved'));
  }

  list(): JobView[] {
    return [...this.jobs.values()].map(({ id, state, size, error, title, warning }) =>
      ({ id, state, size, error, title, warning })).reverse();
  }

  async views() {
    const saved = await this.saved.list();
    const ids = new Set(saved.map(({ id }) => id));
    return [...this.list().filter(({ id }) => !ids.has(id)), ...saved];
  }

  private find(id: unknown) {
    const job = typeof id === 'string' ? this.jobs.get(id) : undefined;
    if (!job) throw new Error('This render job has expired or was removed.');
    return job;
  }

  async create(plan: unknown, narration: unknown = 'automatic') {
    const input = text(plan, SOURCE_PLAN_BYTES);
    if (Buffer.byteLength(input, 'utf8') > PLAN_BYTES) {
      let source: unknown;
      try { source = JSON.parse(input)?.source; }
      catch { /* Large inputs must be valid source envelopes. */ }
      if (typeof source !== 'string') throw new Error('Graph lesson JSON exceeds its allowed size of 64 KiB.');
    }
    if (narration !== 'automatic' && narration !== 'silent' && narration !== 'wav') throw new Error('Unknown narration option.');
    if (this.jobs.size + this.starting >= 5) throw new Error('Delete an earlier render before starting another job.');
    this.starting++;
    let folder: string | undefined;
    try {
      this.signal.throwIfAborted();
      if (!await this.runtime.ready()) throw new Error('Install the pinned runtime before importing a plan.');
      folder = await mkdtemp(join(await privateDirectory(this.root), 'render-'));
      await writeFile(join(folder, 'plan.json'), input, { mode: 0o600 });
      const validated = await this.runtime.validate(folder, AbortSignal.any([this.signal, AbortSignal.timeout(15_000)]));
      this.signal.throwIfAborted();
      const title = JSON.parse(input).title as string | undefined;
      const id = randomUUID();
      const timer = setTimeout(() => { void this.remove(id).catch(() => undefined); }, lifetime);
      timer.unref();
      this.jobs.set(id, { id, state: 'upload', folder, title, narration, timer, abort: new AbortController(),
        audioSize: 0, writing: false, timeoutSeconds: validated?.timeoutSeconds ?? defaultRenderSeconds });
      folder = undefined;
      return id;
    } finally {
      this.starting--;
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }

  async upload(id: unknown, offset: unknown, raw: unknown) {
    const job = this.find(id);
    if (job.narration !== 'wav') throw new Error('Select the WAV narration option before uploading.');
    if (job.state !== 'upload' || job.writing || integer(offset, WAV_BYTES) !== job.audioSize) throw new Error('Audio upload is out of sequence.');
    const encoded = text(raw, CHUNK_BYTES * 4 / 3);
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encoded || bytes.length > CHUNK_BYTES || job.audioSize + bytes.length > WAV_BYTES) {
      throw new Error('Invalid audio chunk or WAV exceeds 12 MiB.');
    }
    this.signal.throwIfAborted();
    job.writing = true;
    job.work = appendFile(join(job.folder, 'narration.wav'), bytes, { mode: 0o600 });
    try {
      await job.work;
      job.audioSize += bytes.length;
    } catch (error) {
      job.state = 'failed';
      job.error = 'Could not store the narration chunk.';
      throw error;
    } finally {
      job.writing = false;
    }
  }

  start(id: unknown) {
    const job = this.find(id);
    if (job.state !== 'upload' || job.writing) throw new Error('The job is already running or its audio is still uploading.');
    if (job.narration === 'wav' && !job.audioSize) throw new Error('Attach a cue-aligned WAV before rendering.');
    if ([...this.jobs.values()].some(({ state }) => state === 'rendering')) throw new Error('One render can run at a time.');
    this.signal.throwIfAborted();
    job.state = 'rendering';
    clearTimeout(job.timer);
    const timeout = AbortSignal.timeout(job.timeoutSeconds * 1000);
    const signal = AbortSignal.any([this.signal, job.abort.signal, timeout]);
    job.work = (async () => {
      try {
        const size = await this.runtime.render(job.folder, signal, job.narration);
        signal.throwIfAborted();
        job.size = size;
        try {
          await this.saved.keep(job.id, job.title ?? 'Manim lesson', join(job.folder, 'video.mp4'), signal, true);
          job.saved = true;
          job.state = 'ready';
        }
        catch (error) {
          signal.throwIfAborted();
          job.state = 'save-error';
          clearTimeout(job.timer);
          job.warning = `Could not add this video to Recent lessons. Export the MP4, or recover it from ${join(job.folder, 'video.mp4')}.`;
        }
      } catch (error) {
        job.state = job.abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = timeout.aborted ? `Render exceeded its ${job.timeoutSeconds}-second timeout.` :
          job.state === 'failed' ? (error as Error).message : undefined;
      } finally {
        if (job.saved) {
          // Finished jobs leave the active quota as soon as their durable copy exists.
          clearTimeout(job.timer);
          this.jobs.delete(job.id);
          await rm(job.folder, { recursive: true, force: true }).catch(() => undefined);
        } else {
          if (job.state !== 'save-error' && this.jobs.has(job.id)) {
            job.timer = setTimeout(() => { void this.remove(job.id).catch(() => undefined); }, lifetime);
            job.timer.unref();
          }
          // Retain a temporary MP4 only if we could not keep the durable copy.
          const entries = await readdir(job.folder);
          await Promise.allSettled(entries.filter((path) => path !== 'video.mp4' || job.state !== 'save-error')
            .map((path) => rm(join(job.folder, path), { recursive: true, force: true })));
        }
      }
    })();
  }

  async chunk(id: unknown, value: unknown) {
    if (typeof id !== 'string') throw new Error('Expected a lesson ID.');
    const job = this.jobs.get(id);
    if (!job || job.saved || (job.state !== 'ready' && job.state !== 'save-error')) {
      return this.saved.chunk(id, integer(value, Number.MAX_SAFE_INTEGER));
    }
    if (!job.size) throw new Error('Video is still unavailable.');
    return readVideoChunk(join(job.folder, 'video.mp4'), job.size, integer(value, job.size - 1));
  }

  async deleteSaved(id: unknown) {
    this.signal.throwIfAborted();
    if (typeof id !== 'string') throw new Error('Expected a lesson ID.');
    await this.saved.delete(id);
    if (this.jobs.has(id)) await this.remove(id);
  }

  async videoPath(id: unknown) {
    if (typeof id !== 'string') throw new Error('Expected a lesson ID.');
    const job = this.jobs.get(id);
    if (job?.state === 'save-error' && job.size) {
      const path = join(job.folder, 'video.mp4');
      const file = await lstat(path);
      if (file.isFile() && file.size === job.size) return path;
    }
    return this.saved.videoPath(id);
  }

  async remove(id: unknown, preserveUnsaved = false) {
    const job = this.find(id);
    this.jobs.delete(job.id);
    clearTimeout(job.timer);
    job.abort.abort(new Error('Render cancelled.'));
    try { await job.work; }
    finally {
      if (!(preserveUnsaved && job.state === 'save-error')) await rm(job.folder, { recursive: true, force: true });
    }
  }

  async dispose() {
    await Promise.allSettled([...this.jobs.keys()].map((id) => this.remove(id, true)));
  }
}
