import type { PluginFrontendModule } from 'learnharness-plugin-api';
import { CHUNK_BYTES, PLAN_BYTES, VIDEO_BYTES, WAV_BYTES } from './protocol';
import type { DraftModel, JobView, Status } from './protocol';

export const activate: PluginFrontendModule['activate'] = (ctx) => {
  ctx.cleanup(ctx.registerView({ id: 'explainer', name: 'Manim Explainer', mount }));
  ctx.cleanup(ctx.registerAction({ id: 'open-explainer', name: 'Manim Explainer', run: () => ctx.app.openView('explainer') }));
  ctx.cleanup(ctx.placeAction({ id: 'explainer-sidebar', actionId: 'open-explainer', location: 'sidebar' }));

  function mount(container: HTMLElement, signal: AbortSignal) {
    const root = document.createElement('div');
    root.className = 'lh-manim';
    container.append(root);
    const runtimeLine = paragraph('Checking local runtime…');
    const consent = document.createElement('input');
    consent.type = 'checkbox';
    const installNote = field(consent, '');
    const downloadNote = document.createElement('span');
    installNote.append(downloadNote);
    const install = button('Install local runtime', async () => {
      install.disabled = true;
      try { await ctx.call('install', { confirmed: consent.checked }); }
      finally { if (!signal.aborted) await refresh(); }
    });
    consent.addEventListener('change', updateControls);
    const cancelInstall = button('Cancel installation', () => ctx.call('cancelInstall'));
    const planFile = document.createElement('input');
    planFile.type = 'file';
    planFile.accept = '.json,application/json';
    const plan = document.createElement('textarea');
    plan.rows = 7;
    plan.maxLength = PLAN_BYTES;
    const audio = document.createElement('input');
    audio.type = 'file';
    audio.accept = '.wav,audio/wav';
    const importBox = document.createElement('section');
    importBox.className = 'lh-manim-panel';
    root.append(importBox);
    field(planFile, 'Import semantic math plan v3', importBox);
    field(plan, 'Lesson plan JSON', importBox);
    field(audio, 'Optional narration WAV', importBox);
    planFile.addEventListener('change', () => report(async () => {
      const file = planFile.files?.[0];
      if (!file) return;
      if (!file.size || file.size > PLAN_BYTES) throw new Error('Plan JSON exceeds 64 KiB or is empty.');
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (signal.aborted) return;
      plan.value = value;
      updateControls();
    }));
    plan.addEventListener('input', updateControls);
    const render = button('Render offline', async () => {
      const file = audio.files?.[0];
      if (file && (!file.size || file.size > WAV_BYTES)) throw new Error('Narration WAV exceeds 12 MiB or is empty.');
      submitting = true;
      updateControls();
      let id: string | undefined;
      try {
        id = await ctx.call<string>('create', { plan: plan.value });
        for (let offset = 0; file && offset < file.size; offset += CHUNK_BYTES) {
          signal.throwIfAborted();
          const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
          let binary = '';
          for (let index = 0; index < bytes.length; index += 8192) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
          }
          const data = btoa(binary);
          await ctx.call('upload', { id, offset, data });
        }
        signal.throwIfAborted();
        await ctx.call('start', { id });
        id = undefined;
      } finally {
        if (id) await ctx.call('remove', { id }).catch(() => undefined);
        submitting = false;
        if (!signal.aborted) await refresh();
      }
    }, importBox);

    const draftBox = document.createElement('details');
    const draftTitle = document.createElement('summary');
    draftTitle.textContent = 'Draft a plan with a LearnHarness model';
    draftBox.append(draftTitle);
    importBox.append(draftBox);
    const brief = document.createElement('textarea');
    brief.rows = 3;
    brief.maxLength = 1600;
    field(brief, 'What should the lesson teach?', draftBox);
    const picker = document.createElement('select');
    field(picker, 'Model', draftBox);
    const draft = button('Draft plan (may incur model charges)', async () => {
      const model = models[Number(picker.value)];
      if (!model) throw new Error('Select a model.');
      const id = crypto.randomUUID();
      drafting = id;
      updateControls();
      try {
        const value = await ctx.call<string>('draft', { id, model, brief: brief.value });
        if (!signal.aborted) plan.value = value;
      } finally {
        drafting = undefined;
        if (!signal.aborted) updateControls();
      }
    }, draftBox);
    const cancelDraft = button('Cancel draft', () => ctx.call('cancelDraft', { id: drafting }), draftBox);
    draftBox.addEventListener('toggle', () => report(async () => {
      if (!draftBox.open || modelsLoaded) return;
      models = await ctx.call<DraftModel[]>('models');
      if (signal.aborted) return;
      modelsLoaded = true;
      picker.replaceChildren(new Option('Choose a model', ''));
      for (const [index, model] of models.entries()) picker.add(new Option(`${model.name} (${model.provider})`, String(index)));
      updateControls();
    }));
    brief.addEventListener('input', updateControls);
    picker.addEventListener('change', updateControls);

    const notice = paragraph('');
    notice.setAttribute('role', 'status');
    const jobs = document.createElement('ul');
    root.append(jobs);
    const player = document.createElement('video');
    player.controls = true;
    player.preload = 'metadata';
    player.hidden = true;
    const download = document.createElement('a');
    download.textContent = 'Save MP4';
    download.download = 'manim-lesson.mp4';
    download.hidden = true;
    root.append(player, download);
    let current: Status | undefined;
    let submitting = false;
    let refreshing = false;
    let loaded: { id: string; url: string } | undefined;
    let loading = false;
    let jobSignature = '';
    let drafting: string | undefined;
    let models: DraftModel[] = [];
    let modelsLoaded = false;
    updateControls();
    void report(refresh);
    const poll = setInterval(() => { void report(refresh); }, 1500);
    const unsub = ctx.onResync(() => { void report(refresh); });
    return () => {
      clearInterval(poll);
      unsub();
      if (drafting) void ctx.call('cancelDraft', { id: drafting }).catch(() => undefined);
      clearPreview();
      root.remove();
    };

    function paragraph(value: string) {
      const p = document.createElement('p');
      p.textContent = value;
      root.append(p);
      return p;
    }

    function field(input: HTMLElement, name: string, parent: HTMLElement = root) {
      const label = document.createElement('label');
      label.append(name, input);
      parent.append(label);
      return label;
    }

    function button(name: string, fn: () => unknown, parent: HTMLElement = root) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.addEventListener('click', () => { void report(fn, true); });
      parent.append(button);
      return button;
    }

    async function report(fn: () => unknown, clear = false) {
      if (signal.aborted) return;
      if (clear) notice.textContent = '';
      try { await fn(); }
      catch (error) { if (!signal.aborted) notice.textContent = (error as Error).message; }
    }

    function updateControls() {
      installNote.hidden = !current?.supported || current.ready || Boolean(current.install);
      install.hidden = installNote.hidden;
      install.disabled = install.hidden || !consent.checked;
      cancelInstall.hidden = !current?.install;
      render.disabled = !current?.ready || !plan.value.trim() || submitting || current.jobs.some((job) => job.state === 'rendering');
      draft.disabled = !current?.ready || Boolean(drafting) || !brief.value.trim() || !picker.value;
      cancelDraft.hidden = !drafting;
    }

    async function refresh() {
      if (refreshing || signal.aborted) return;
      refreshing = true;
      try {
        const status = await ctx.call<Status>('status');
        if (signal.aborted) return;
        current = status;
        downloadNote.textContent = `Allow the pinned runtime download (approximately ${status.downloadMiB} MiB).`;
        runtimeLine.textContent = status.install || (!status.supported ? `Runtime unavailable for ${status.platform}.` :
          status.ready ? `Local Manim ${status.versions.manim} is ready.` : `Install Manim ${status.versions.manim} to render or validate plans.`);
        updateControls();
        const signature = JSON.stringify(status.jobs);
        if (jobSignature === signature) return;
        jobSignature = signature;
        jobs.replaceChildren(...status.jobs.map(jobRow));
        if (loaded && !status.jobs.some((job) => job.id === loaded?.id)) clearPreview();
      } finally { refreshing = false; }
    }

    function jobRow(job: JobView) {
      const row = document.createElement('li');
      row.append(job.error ? `Render failed. ${job.error}` : `Render ${job.state}`);
      if (job.state === 'ready') button('Preview', () => preview(job), row);
      button(job.state === 'rendering' ? 'Cancel' : 'Delete', async () => {
        await ctx.call('remove', { id: job.id });
        if (!signal.aborted) await refresh();
      }, row);
      return row;
    }

    function clearPreview() {
      if (loaded) URL.revokeObjectURL(loaded.url);
      loaded = undefined;
      player.removeAttribute('src');
      player.load();
      player.hidden = true;
      download.removeAttribute('href');
      download.hidden = true;
    }

    async function preview(job: JobView) {
      if (loading || !job.size || !Number.isSafeInteger(job.size) || job.size <= 0 || job.size > VIDEO_BYTES) return;
      loading = true;
      try {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for (let offset = 0; offset < job.size; offset += CHUNK_BYTES) {
          signal.throwIfAborted();
          const data = await ctx.call<string>('chunk', { id: job.id, offset });
          const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
          if (bytes.length !== Math.min(CHUNK_BYTES, job.size - offset)) throw new Error('Received an invalid video chunk.');
          parts.push(bytes);
        }
        if (signal.aborted || !current?.jobs.some((item) => item.id === job.id)) return;
        clearPreview();
        const url = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
        loaded = { id: job.id, url };
        player.src = download.href = url;
        player.hidden = download.hidden = false;
      } finally { loading = false; }
    }
  }
};
