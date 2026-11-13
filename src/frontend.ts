import type { PluginFrontendModule } from 'learnharness-plugin-api';
import { CHUNK_BYTES, INLINE_VIDEO_BYTES, SOURCE_PLAN_BYTES, WAV_BYTES } from './protocol';
import type { ReferenceVoice } from './reference-voice';
import type { DraftModel, JobView, Narration, Status } from './protocol';

export const activate: PluginFrontendModule['activate'] = (ctx) => {
  ctx.cleanup(ctx.registerView({ id: 'explainer', name: 'Manim Explainer', mount }));
  ctx.cleanup(ctx.registerAction({ id: 'open-explainer', name: 'Manim Explainer', run: () => ctx.app.openView('explainer') }));
  ctx.cleanup(ctx.placeAction({ id: 'explainer-sidebar', actionId: 'open-explainer', location: 'sidebar' }));

  type VoiceSettings = { profile: Pick<ReferenceVoice, 'enabled' | 'transcript'> | null; supported: boolean; renderReady: boolean; ready: boolean; progress: string | null };
  ctx.cleanup(ctx.registerSettings(mountReferenceSettings));

  function mountReferenceSettings(container: HTMLElement, signal: AbortSignal) {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Checking reference voice settings…';
    container.append(status);
    void (async () => {
      const { profile, ready, supported, renderReady } = await ctx.call<VoiceSettings>('referenceProfile');
      if (signal.aborted) return;
      if (!supported) {
        status.textContent = 'Reference narration is available on Apple Silicon with macOS 14 or later.';
        return;
      }
      if (!renderReady) {
        status.textContent = 'Set up local rendering in Manim Explainer first. You can choose Silent video for that setup to download only the renderer.';
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Open Manim Explainer';
        open.addEventListener('click', () => { void ctx.app.openView('explainer'); });
        container.append(open);
        return;
      }
      status.textContent = profile?.enabled && !ready ? 'The reference runtime needs repair. Reinstall it to resume automatic reference narration.' :
        'Use a WAV you have permission to synthesize. The sample and transcript stay on this Mac.';
      const form = document.createElement('form');
      container.append(form);
      function field(input: HTMLInputElement | HTMLTextAreaElement, title: string) {
        const label = document.createElement('label');
        label.append(title, input);
        const row = document.createElement('div');
        row.append(label);
        form.append(row);
      }
      const sample = document.createElement('input');
      sample.type = 'file';
      sample.accept = '.wav,audio/wav';
      sample.required = !profile;
      field(sample, 'Reference WAV (3–30 seconds, mono 24 kHz PCM16)');
      let setupReady = ready;
      let hasProfile = Boolean(profile);
      const transcript = document.createElement('textarea');
      transcript.rows = 3;
      transcript.maxLength = 1800;
      transcript.required = true;
      transcript.value = profile?.transcript ?? '';
      field(transcript, 'Exact WAV transcript');
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = profile?.enabled ?? true;
      field(enabled, 'Use reference voice for automatic narration');
      const save = document.createElement('button');
      function updateSave() {
        save.textContent = enabled.checked && !setupReady ? 'Download and enable reference voice (~2.2 GB)' : 'Save voice profile';
      }
      updateSave();
      enabled.addEventListener('change', updateSave);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove voice profile';
      remove.disabled = !profile;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel reference voice setup';
      cancel.hidden = true;
      const repair = document.createElement('button');
      repair.type = 'button';
      repair.textContent = 'Reinstall reference voice (~2.2 GB)';
      repair.hidden = !hasProfile && !setupReady;
      form.append(save, remove, repair, cancel);
      const showError = (error: unknown) => { if (!signal.aborted) status.textContent = (error as Error).message; };
      let checking = false;
      signal.addEventListener('abort', () => {
        if (checking) void ctx.call('cancelReferenceCheck').catch(() => undefined);
      }, { once: true });
      cancel.addEventListener('click', () => { void ctx.call('cancelReferenceCheck').catch(showError); });
      remove.addEventListener('click', () => {
        save.disabled = remove.disabled = repair.disabled = true;
        void ctx.call('removeReferenceProfile').then(() => {
          if (signal.aborted) return;
          hasProfile = false;
          sample.value = '';
          sample.required = true;
          transcript.value = '';
          enabled.checked = true;
          updateSave();
          repair.hidden = !setupReady;
          status.textContent = 'Reference voice removed. Automatic narration uses the stock voice.';
        }).catch((error) => { if (!signal.aborted) remove.disabled = false; showError(error); }).finally(() => { save.disabled = repair.disabled = false; });
      });
      function runVoiceAction(message: string, cancellable: boolean, action: () => Promise<void>) {
        if (checking || save.disabled) return;
        checking = save.disabled = remove.disabled = repair.disabled = true;
        cancel.hidden = !cancellable;
        status.textContent = message;
        const timer = setInterval(() => {
          void ctx.call<VoiceSettings>('referenceProfile').then(({ progress }) => {
            if (progress && checking && !signal.aborted) status.textContent = progress;
          }).catch(() => undefined);
        }, 1200);
        void action().catch(showError).finally(() => {
          clearInterval(timer);
          checking = save.disabled = repair.disabled = false;
          remove.disabled = !hasProfile;
          repair.hidden = !hasProfile && !setupReady;
          cancel.hidden = true;
        });
      }
      repair.addEventListener('click', () => {
        runVoiceAction('Preparing the reference voice reinstall…', true, async () => {
          await ctx.call('repairReferenceVoice', { confirmed: true });
          if (signal.aborted) return;
          setupReady = true;
          updateSave();
          status.textContent = 'Reference voice reinstalled.';
        });
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const requested = enabled.checked;
        runVoiceAction(requested ? 'Checking the reference WAV and running local synthesis…' : 'Saving voice settings…',
          requested, async () => {
            const file = sample.files?.[0];
            if (file && file.size > 30 * 24000 * 2 + 4096) throw new Error('Choose a WAV with at most 30 seconds of speech.');
            let encoded: string | undefined;
            if (file) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 8192) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              }
              encoded = btoa(binary);
            }
            signal.throwIfAborted();
            await ctx.call('saveReferenceProfile', { sample: encoded, transcript: transcript.value, enabled: requested });
            if (signal.aborted) return;
            setupReady ||= requested;
            hasProfile = true;
            sample.required = false;
            sample.value = '';
            updateSave();
            status.textContent = requested ? 'Reference voice enabled.' : 'Reference voice disabled.';
        });
      });
    })().catch((error) => { if (!signal.aborted) status.textContent = (error as Error).message; });
  }

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
    const install = button('Set up local rendering', async () => {
      install.disabled = true;
      const confirmed = consent.checked;
      consent.checked = false;
      try { await ctx.call('install', { confirmed, narration: narration.value, ...setupScope }); }
      finally { if (!signal.aborted) await refresh(); }
    });
    consent.addEventListener('change', updateControls);
    const cancelInstall = button('Cancel installation', () => ctx.call('cancelInstall'));
    const voiceLine = paragraph('Checking offline voice…');
    const planFile = document.createElement('input');
    planFile.type = 'file';
    planFile.accept = '.json,application/json';
    const plan = document.createElement('textarea');
    plan.rows = 7;
    plan.maxLength = SOURCE_PLAN_BYTES;
    const audio = document.createElement('input');
    audio.type = 'file';
    audio.accept = '.wav,audio/wav';
    const narration = document.createElement('select');
    narration.add(new Option('Automatic offline voice (English)', 'automatic'));
    narration.add(new Option('Silent video', 'silent'));
    narration.add(new Option('Use a cue-aligned WAV', 'wav'));
    const importBox = document.createElement('section');
    importBox.className = 'lh-manim-panel';
    root.append(importBox);
    field(planFile, 'Import Manim lesson JSON', importBox);
    field(plan, 'Lesson plan JSON', importBox);
    field(narration, 'Narration', importBox);
    const audioField = field(audio, 'Narration WAV', importBox);
    narration.addEventListener('change', () => { consent.checked = false; updateControls(); });
    audio.addEventListener('change', updateControls);
    planFile.addEventListener('change', () => report(async () => {
      const file = planFile.files?.[0];
      if (!file) return;
      if (!file.size || file.size > SOURCE_PLAN_BYTES) throw new Error('Plan JSON exceeds 1 MiB or is empty.');
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (signal.aborted) return;
      plan.value = value;
      updateControls();
    }));
    plan.addEventListener('input', updateControls);
    const render = button('Render offline', async () => {
      const mode = narration.value as Narration;
      const file = mode === 'wav' ? audio.files?.[0] : undefined;
      if (mode === 'wav' && !file) throw new Error('Attach a cue-aligned WAV before rendering.');
      if (file && (!file.size || file.size > WAV_BYTES)) throw new Error('Narration WAV exceeds 12 MiB or is empty.');
      submitting = true;
      updateControls();
      let id: string | undefined;
      try {
        id = await ctx.call<string>('create', { plan: plan.value, narration: mode });
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
    const recentHeading = document.createElement('h2');
    recentHeading.textContent = 'Recent lessons';
    const recent = document.createElement('ul');
    root.append(recentHeading, recent);
    let savedOffset = 0;
    const newer = button('Newer lessons', () => { savedOffset = Math.max(0, savedOffset - 12); return refresh(); });
    const older = button('Older lessons', () => { savedOffset += 12; return refresh(); });
    newer.hidden = older.hidden = true;
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
    let setupScope = { allowRuntime: false, allowVoice: false, setupKey: '' };
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
      let automatic = narration.value === 'automatic';
      if (automatic && plan.value.trim()) {
        try {
          const value = JSON.parse(plan.value);
          if (typeof value?.source === 'string') automatic = Boolean(Object.keys(value.narration ?? {}).length);
        } catch { /* The render validator reports malformed plans. */ }
      }
      const needsRuntime = Boolean(current?.supported && !current.ready);
      const needsVoice = automatic && !current?.referenceVoiceEnabled && Boolean(current?.voiceDownloadMiB) && !current?.voiceReady;
      const setupKey = current?.setupKey ?? '';
      if (setupScope.allowRuntime !== needsRuntime || setupScope.allowVoice !== needsVoice || setupScope.setupKey !== setupKey) {
        consent.checked = false;
      }
      setupScope = { allowRuntime: needsRuntime, allowVoice: needsVoice, setupKey };
      const runtimeMiB = needsRuntime ? current?.downloadMiB ?? 0 : 0;
      const voiceMiB = needsVoice ? current?.voiceDownloadMiB ?? 0 : 0;
      const downloads = [needsRuntime && 'Manim runtime', needsVoice && 'offline English voice'].filter(Boolean).join(' and ');
      const avx = needsVoice && current?.platform.endsWith('-64') ? ' The voice needs AVX2.' : '';
      const glibc = needsVoice && current?.platform === 'linux-64' ? ' The voice needs glibc 2.34 or newer.' : '';
      downloadNote.textContent = `Allow the ${downloads} download (approximately ${runtimeMiB + voiceMiB} MiB).${avx}${glibc}`;
      installNote.hidden = !current?.supported || !(needsRuntime || needsVoice) || Boolean(current.install);
      install.hidden = installNote.hidden;
      install.disabled = install.hidden || !consent.checked;
      cancelInstall.hidden = !current?.install;
      narration.disabled = Boolean(current?.install);
      audioField.hidden = narration.value !== 'wav';
      render.disabled = !current?.ready || Boolean(current.install) || !plan.value.trim() || submitting || current.jobs.some((job) => job.state === 'rendering') ||
        (automatic && !current.voiceReady && !current.referenceVoiceEnabled) || (narration.value === 'wav' && !audio.files?.[0]);
      draft.disabled = !current?.ready || Boolean(drafting) || !brief.value.trim() || !picker.value;
      cancelDraft.hidden = !drafting;
    }

    async function refresh() {
      if (refreshing || signal.aborted) return;
      refreshing = true;
      try {
        const offset = savedOffset;
        const status = await ctx.call<Status>('status', { offset });
        if (signal.aborted || offset !== savedOffset) return;
        if (offset && offset >= status.savedCount) {
          savedOffset = Math.max(0, Math.floor((status.savedCount - 1) / 12) * 12);
          return;
        }
        current = status;
        runtimeLine.textContent = status.install || (!status.supported ? `Runtime unavailable for ${status.platform}.` :
          status.ready ? `Local Manim ${status.versions.manim} is ready.` : 'Set up local rendering to render or validate plans.');
        narration.options[0].text = status.referenceVoiceEnabled ? 'Automatic local reference voice (English)' : 'Automatic offline voice (English)';
        voiceLine.textContent = status.referenceVoiceEnabled ? 'Local reference narration is enabled.' : status.voiceReady ? 'Offline English narration is ready.' : status.voiceDownloadMiB ? '' :
          'Automatic narration is unavailable on this platform. Select Silent or WAV.';
        updateControls();
        newer.hidden = offset === 0;
        older.hidden = offset + 12 >= status.savedCount;
        const signature = JSON.stringify(status.jobs);
        if (jobSignature === signature) return;
        jobSignature = signature;
        jobs.replaceChildren(...status.jobs.filter((job) => !job.saved).map(jobRow));
        recent.replaceChildren(...status.jobs.filter((job) => job.saved).map(jobRow));
        recentHeading.hidden = recent.hidden = !recent.childElementCount;
        if (loaded && !status.jobs.some((job) => job.id === loaded?.id)) clearPreview();
      } finally { refreshing = false; }
    }

    function jobRow(job: JobView) {
      const row = document.createElement('li');
      row.append(job.saved ? (job.title ?? 'Saved lesson') : job.warning ?? (job.error ? `Render failed. ${job.error}` : `Render ${job.state}`));
      if (job.state === 'ready' || job.state === 'save-error') {
        if ((job.size ?? 0) > INLINE_VIDEO_BYTES) {
          button('Open in video player', () => ctx.call('openVideo', { id: job.id }), row);
        } else {
          button('Preview', () => preview(job), row);
        }
      }
      if (job.saved) {
        button('Delete saved lesson', async () => {
          await ctx.call('deleteSaved', { id: job.id });
          if (!signal.aborted) await refresh();
        }, row);
        return row;
      }
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
      if (loading || !job.size || !Number.isSafeInteger(job.size) || job.size <= 0 || job.size > INLINE_VIDEO_BYTES) return;
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
