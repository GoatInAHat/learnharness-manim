# Manim Explainer for LearnHarness

Manim Explainer renders calculus lessons as local MP4s. It speaks the narration in a [semantic math scene v3 plan](contract/semantic-math-v3.md) using an offline English voice by default. You can choose a silent video or supply a cue-aligned WAV. The lesson renderer uses Manim Community, Cairo and Typst. You can also draft a plan with a model available in LearnHarness.

This is a source preview. The macOS Apple Silicon runtime and packaged renderer have been exercised locally; see the qualification workflow for Windows and Linux results.

## Install and render

1. Build `manim-explainer.zip` using the commands below. Open **Settings → Community plugins** in LearnHarness 0.6.0 or later and copy the plugins directory path.
2. Extract the ZIP there so that `<plugins directory>/manim-explainer/dist/manifest.json` exists. Refresh the plugin list and enable **Manim Explainer**. When upgrading, replace the plugin's `dist/` folder and restart LearnHarness. The sibling `data/` folder holds the installed runtime.
3. Open **Manim Explainer** from the sidebar. Keep the default **Automatic offline voice (English)**, or choose **Silent video** or **Use a cue-aligned WAV**. Check the box showing the downloads for that mode and select **Set up local rendering**. The setup reports verification and progress and can be cancelled. Later renders reuse the downloads. Automatic voice adds about 118 MiB on Apple Silicon or 119 MiB on x64; x64 voice requires AVX2, and Linux voice needs glibc 2.34 or newer.
4. Import, paste or draft a plan, then select **Render offline**. A supplied WAV must be mono PCM16 at 16–48 kHz, padded to the full lesson and aligned to the plan's cues. Select **Preview** to play the result or **Save MP4** to keep a copy. Temporary jobs expire after 30 minutes.

Import, validation and rendering run locally. **Draft plan** sends the brief and public contract to your selected LearnHarness model and may incur provider charges. The resulting JSON goes through the same validator as an imported plan.

Automatic narration uses the same fixed, non-cloning English voice for every plan and needs no account or speech API. Each utterance is measured and starts at its cue frame. If it cannot finish nine frames before the next beat (or the end of the lesson), the render fails with the beat number. Shorten that utterance or move its cue within the plan's timing rules.

## Runtime and platform evidence

The first-use download includes micromamba and the full pinned conda-forge stack. Installation uses the plugin's private data folder and needs additional temporary space for verified archives and extraction.

| Platform | First-use download | Qualification |
| --- | ---: | --- |
| macOS Apple Silicon (12 or later per the lock) | ~200 MiB | Clean native install, 720p synthetic smoke and matched 1080p render. Installed footprint was approximately 840 MiB. |
| Linux x64 (glibc 2.17 or later per the render lock) | ~303 MiB | Clean Ubuntu 24.04 hosted runtime, package, render, decode, and update checks. |
| Windows x64 (standard `C:\Windows` system location) | ~295 MiB | Clean Windows Server 2025 hosted runtime, package, render, decode, and update checks. |

The installer verifies SHA-256 before executing micromamba or extracting a package. It links packages offline with a fresh private environment and checks Python, Manim, Typst, FFmpeg and their native libraries before marking the runtime ready. The optional voice installer verifies the native executable and assets; inference uses only the verified local files. The renderer uses fixed packaged code and math templates. Plans contain bounded arithmetic, camera coordinates and plain text. WAV audio is validated and rewritten to canonical PCM before encoding.

## Build and package

Use Node.js 22 or later with npm. On macOS or Linux, the package and archive test use `zip` and `unzip`. On Windows they use the OS-provided `tar.exe`.

```sh
npm ci
npm run typecheck
npm test
npm run package
```

The build writes `dist/`. The package command creates `manim-explainer.zip` with the LearnHarness directory layout, bundled code and pinned runtime locks. Installation of this archive needs only LearnHarness and an archive extractor.

## Command-line rendering

Use an explicit data folder to store the runtime, voice and temporary jobs. `render` produces 1280×720 and defaults to automatic narration. You can pass `--silent` or a WAV path instead. `compare` produces 1920×1080 and requires the external comparison WAV. Both commands produce 30 fps H.264 MP4, with mono AAC when audio is present.

```sh
npm run cli -- status ../manim-data
npm run cli -- install ../manim-data --allow-download
npm run cli -- install-voice ../manim-data --allow-download
npm run cli -- validate ../manim-data lesson.json
npm run cli -- render ../manim-data lesson.json preview.mp4
npm run cli -- render ../manim-data lesson.json silent.mp4 --silent
npm run cli -- compare ../manim-data lesson.json comparison.mp4 narration.wav
npm run test:native -- ../manim-data
```

See [NOTICE](NOTICE) for SDK and runtime provenance.
