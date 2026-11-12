import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHUNK_BYTES, VIDEO_BYTES } from './protocol';
import type { JobView } from './protocol';
import { privateDirectory } from './runtime';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxLessons = 12;
const maxLibraryBytes = 512 * 1024 * 1024;
const maxMetadata = 1024;
const safeTitle = (title: unknown): title is string => typeof title === 'string' &&
  title.trim().length > 0 && Buffer.byteLength(title) <= 360 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(title);

type Saved = JobView & { state: 'ready'; size: number; title: string; createdAt: number; saved: true };

export class SavedLessons {
  constructor(private readonly directory: string) {}

  private async read(id: string): Promise<Saved | undefined> {
    if (!uuid.test(id)) return;
    const folder = join(this.directory, id);
    const metaPath = join(folder, 'lesson.json');
    try {
      if (!(await lstat(this.directory)).isDirectory() || !(await lstat(folder)).isDirectory()) return;
      const meta = await lstat(metaPath);
      const video = await lstat(join(folder, 'video.mp4'));
      if (!meta.isFile() || meta.size > maxMetadata || !video.isFile() || video.size <= 0 || video.size > VIDEO_BYTES) return;
      const value = JSON.parse(await readFile(metaPath, 'utf8'));
      if (!value || value.id !== id || value.size !== video.size || !safeTitle(value.title) ||
          !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) return;
      return { id, size: video.size, title: value.title, createdAt: value.createdAt, state: 'ready', saved: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }

  async list(): Promise<Saved[]> {
    try {
      if (!(await lstat(this.directory)).isDirectory()) return [];
      const entries = (await readdir(this.directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && uuid.test(entry.name));
      if (entries.length > maxLessons) throw new Error('Saved lesson storage has too many entries.');
      const lessons = await Promise.all(entries.map(({ name }) => this.read(name)));
      return lessons.filter((lesson) => lesson !== undefined).sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return [];
    }
  }

  async keep(id: string, title: string, source: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const video = await lstat(source);
    if (!uuid.test(id) || !safeTitle(title) || !video.isFile() || video.size <= 0 || video.size > VIDEO_BYTES) {
      throw new Error('The finished video could not be kept in Manim.');
    }
    const root = await privateDirectory(this.directory);
    const lessons = await this.list();
    if (lessons.length >= maxLessons || lessons.reduce((bytes, lesson) => bytes + lesson.size, video.size) > maxLibraryBytes) {
      throw new Error('Recent lessons is full. Save the MP4 or delete a saved lesson to free space.');
    }
    const staging = await mkdtemp(join(root, '.saving-'));
    try {
      await copyFile(source, join(staging, 'video.mp4'), constants.COPYFILE_EXCL);
      await writeFile(join(staging, 'lesson.json'), JSON.stringify({ id, title, size: video.size, createdAt: Date.now() }),
        { mode: 0o600, flag: 'wx' });
      signal.throwIfAborted();
      await rename(staging, join(root, id));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async chunk(id: string, offset: number) {
    const lesson = await this.read(id);
    if (!lesson) throw new Error('This saved lesson is unavailable.');
    return readVideoChunk(join(this.directory, id, 'video.mp4'), lesson.size, offset);
  }

  async delete(id: string) {
    if (!await this.read(id)) throw new Error('This saved lesson is unavailable.');
    await rm(join(this.directory, id), { recursive: true });
  }
}

export async function readVideoChunk(path: string, size: number, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) throw new Error('Video position is outside its allowed range.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== size) throw new Error('The video has changed.');
    const bytes = Buffer.alloc(Math.min(CHUNK_BYTES, size - offset));
    if ((await file.read(bytes, 0, bytes.length, offset)).bytesRead !== bytes.length) throw new Error('The video was truncated.');
    return bytes.toString('base64');
  } finally { await file.close(); }
}
