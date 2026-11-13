import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';
import type { PluginBackendModule, PluginModelSpec } from 'learnharness-plugin-api';
import { integer, Jobs, object, text } from './jobs';
import { PLAN_BYTES } from './protocol';
import type { DraftModel, Status } from './protocol';
import { referenceSupported } from './reference-voice';
import { privateDirectory, Runtime } from './runtime';

interface Installation {
  abort: AbortController;
  work?: Promise<void>;
  progress: string;
}

export const activate: PluginBackendModule['activate'] = (ctx) => {
  const runtime = new Runtime(ctx.directory, ctx.dataDirectory);
  const scratch = join(ctx.dataDirectory, 'manim-jobs');
  const jobs = new Jobs(scratch, runtime, ctx.signal);
  let installation: Installation | undefined;
  let checkingVoice: AbortController | undefined;
  let voiceProgress: string | undefined;
  let voiceWork: Promise<unknown> | undefined;
  const drafts = new Map<string, AbortController>();
  const nativeAgents = ['teacher', 'practice'] as const;

  ctx.cleanup(async () => {
    installation?.abort.abort(new Error('Installation cancelled.'));
    checkingVoice?.abort(new Error('Reference voice check cancelled.'));
    await Promise.allSettled([jobs.dispose(), installation?.work, voiceWork]);
  });

  ctx.cleanup(ctx.handle('status', async (raw): Promise<Status> => {
    const offset = raw === undefined ? 0 : integer(object(raw).offset, Number.MAX_SAFE_INTEGER);
    const all = await jobs.views();
    const saved = all.filter(job => job.saved);
    return { ...await runtime.status(), install: installation?.progress ?? null, savedCount: saved.length,
      jobs: [...all.filter(job => !job.saved), ...saved.slice(offset, offset + 12)] };
  }));
  ctx.cleanup(ctx.handle('referenceProfile', async () => {
    const profile = await runtime.referenceProfile();
    return { profile: profile ? { enabled: profile.enabled, transcript: profile.transcript } : null,
      supported: referenceSupported, ready: await runtime.referenceReady(), progress: voiceProgress ?? null };
  }));
  function checkVoice<T>(work: (signal: AbortSignal, progress: (message: string) => void) => Promise<T>) {
    if (checkingVoice) throw new Error('A reference voice check is already running.');
    if (installation) throw new Error('Wait for local setup to finish.');
    ctx.signal.throwIfAborted();
    const abort = new AbortController();
    checkingVoice = abort;
    const signal = AbortSignal.any([ctx.signal, abort.signal, AbortSignal.timeout(20 * 60 * 1000)]);
    voiceProgress = 'Preparing the reference voice…';
    const task = work(signal, message => { voiceProgress = message; })
      .finally(() => { checkingVoice = undefined; voiceProgress = undefined; });
    voiceWork = task;
    return task;
  }
  ctx.cleanup(ctx.handle('saveReferenceProfile', raw =>
    checkVoice((signal, progress) => runtime.saveReferenceProfile(raw, signal, progress))));
  ctx.cleanup(ctx.handle('repairReferenceVoice', raw => {
    if (object(raw).confirmed !== true) throw new Error('Confirm the reference voice download first.');
    return checkVoice((signal, progress) => runtime.installReference(signal, progress, true));
  }));
  ctx.cleanup(ctx.handle('cancelReferenceCheck', () => {
    checkingVoice?.abort(new Error('Reference voice check cancelled.'));
    return true;
  }));
  ctx.cleanup(ctx.handle('removeReferenceProfile', () => {
    if (checkingVoice) throw new Error('Cancel the reference voice check first.');
    ctx.signal.throwIfAborted();
    return runtime.removeReferenceProfile();
  }));
  ctx.cleanup(ctx.handle('install', (raw) => {
    const { confirmed, narration, allowRuntime, allowVoice, setupKey } = object(raw);
    if (confirmed !== true) throw new Error('Confirm the local setup download first.');
    if (narration !== 'automatic' && narration !== 'silent' && narration !== 'wav') throw new Error('Select a narration option.');
    if (typeof allowRuntime !== 'boolean' || typeof allowVoice !== 'boolean' ||
        (!allowRuntime && !allowVoice) || (allowVoice && narration !== 'automatic')) {
      throw new Error('Confirm the components shown for this narration option.');
    }
    const changed = 'The local setup changed. Check the updated download size and confirm it again.';
    if (installation || checkingVoice) throw new Error('An installation is already running.');
    ctx.signal.throwIfAborted();
    const abort = new AbortController();
    const timer = AbortSignal.timeout(20 * 60 * 1000);
    const signal = AbortSignal.any([ctx.signal, abort.signal, timer]);
    const task: Installation = { abort, progress: 'Preparing local setup.' };
    installation = task;
    const progress = (message: string) => { task.progress = message; };
    task.work = (async () => {
      if (setupKey !== await runtime.setupKey()) throw new Error(changed);
      if (!allowRuntime && !await runtime.ready()) throw new Error(changed);
      if (narration === 'automatic' && !allowVoice && !(await runtime.referenceProfile())?.enabled && !await runtime.hasVerifiedVoice(signal)) throw new Error(changed);
      if (allowRuntime) await runtime.install(signal, progress);
      if (allowVoice) await runtime.installVoice(signal, progress);
    })().finally(() => { installation = undefined; });
    return task.work.then(() => ({ installed: true }));
  }));
  ctx.cleanup(ctx.handle('cancelInstall', () => {
    installation?.abort.abort(new Error('Installation cancelled.'));
    return true;
  }));
  ctx.cleanup(ctx.handle('create', (raw) => {
    const { plan, narration } = object(raw);
    return jobs.create(plan, narration);
  }));
  ctx.cleanup(ctx.handle('upload', async (raw) => {
    const { id, offset, data } = object(raw);
    await jobs.upload(id, offset, data);
    return true;
  }));
  ctx.cleanup(ctx.handle('start', (raw) => { jobs.start(object(raw).id); return true; }));
  ctx.cleanup(ctx.handle('chunk', (raw) => {
    const { id, offset } = object(raw);
    return jobs.chunk(id, offset);
  }));
  ctx.cleanup(ctx.handle('remove', async (raw) => { await jobs.remove(object(raw).id); return true; }));
  ctx.cleanup(ctx.handle('deleteSaved', async (raw) => { await jobs.deleteSaved(object(raw).id); return true; }));

  async function availableModels(): Promise<DraftModel[]> {
    const catalog = await ctx.inference.catalog();
    const available = new Set(catalog.providers.filter((provider) => provider.keyPresent).map((provider) => provider.id));
    return catalog.models.filter((model) => available.has(model.provider))
      .map(({ id, name, provider }) => ({ id, name, provider }));
  }

  ctx.cleanup(ctx.handle('models', availableModels));
  ctx.cleanup(ctx.handle('cancelDraft', (raw) => {
    const id = text(object(raw).id, 40);
    drafts.get(id)?.abort(new Error('Draft cancelled.'));
    return true;
  }));
  ctx.cleanup(ctx.handle('draft', async (raw) => {
    const input = object(raw);
    const id = text(input.id, 40);
    const brief = text(input.brief, 1600);
    const selection = object(input.model);
    if (drafts.size || drafts.has(id)) throw new Error('One model draft can run at a time.');
    const abort = new AbortController();
    drafts.set(id, abort);
    const signal = AbortSignal.any([ctx.signal, abort.signal, AbortSignal.timeout(120_000)]);
    let folder: string | undefined;
    try {
      if (!await runtime.ready()) throw new Error('Install the pinned runtime before drafting.');
      const selected = (await availableModels()).find((model) => model.id === selection.id && model.provider === selection.provider);
      if (!selected) throw new Error('Select an available model explicitly.');
      const model: PluginModelSpec = { id: selected.id, provider: selected.provider };
      const [contract, schema] = await Promise.all(['semantic-math-v3.md', 'semantic-math-v3.schema.json']
        .map((file) => readFile(join(ctx.directory, 'assets', 'contract', file), 'utf8')));
      signal.throwIfAborted();
      const result = await ctx.inference.complete({
        model, purpose: 'user', signal, options: { maxTokens: 5200, maxRetries: 0 },
        context: {
          systemPrompt: `Draft a bounded declarative teaching scene matching the supplied public contract. Return only JSON, with no code or fences. Start from a simple curve that fits the full scene.\n\n${contract}\n\n${schema}`,
          messages: [{ role: 'user', content: brief, timestamp: Date.now() }],
        },
      });
      signal.throwIfAborted();
      if (result.stopReason !== 'stop') throw new Error('The model did not finish a usable draft.');
      const plan = text(result.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim(), PLAN_BYTES);
      folder = await mkdtemp(join(await privateDirectory(scratch), 'draft-'));
      await writeFile(join(folder, 'plan.json'), plan, { mode: 0o600 });
      await runtime.validate(folder, signal);
      return plan;
    } finally {
      drafts.delete(id);
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }));

  ctx.cleanup(ctx.registerTools({
    agents: [...nativeAgents],
    create: () => [{
      name: 'manim_render_lesson', label: 'Render Manim lesson',
      description: 'Render an already validated semantic math scene v3 JSON plan. Requires the local runtime and defaults to automatic narration with the installed offline voice. Use silent only when requested. Find completed videos under Recent lessons in Manim Explainer.',
      parameters: Type.Object({ plan: Type.String({ minLength: 1, maxLength: PLAN_BYTES }),
        narration: Type.Optional(Type.Union([Type.Literal('automatic'), Type.Literal('silent')])) }, { additionalProperties: false }),
      async execute(_call, input, signal) {
        signal?.throwIfAborted();
        const { plan, narration } = object(input);
        if (narration !== undefined && narration !== 'automatic' && narration !== 'silent') throw new Error('Unknown narration option.');
        const id = await jobs.create(plan, narration);
        try {
          signal?.throwIfAborted();
          jobs.start(id);
        } catch (error) {
          await jobs.remove(id);
          throw error;
        }
        return { content: [{ type: 'text', text: `Render queued in Manim Explainer. Job ${id}.` }], details: { id } };
      },
    }],
  }));
};
