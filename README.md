# Manim Explainer for LearnHarness

Manim Explainer renders calculus lessons as local MP4s. It takes a [semantic math scene v3 plan](contract/semantic-math-v3.md) and an optional cue-aligned narration WAV. The lesson renderer uses Manim Community, Cairo and Typst. You can also draft a plan with a model available in LearnHarness.

## Install and render

1. Download `manim-explainer.zip` from this repository's Releases. Open **Settings → Community plugins** in LearnHarness 0.6.0 or later and copy the plugins directory path.
2. Extract the ZIP there so that `<plugins directory>/manim-explainer/dist/manifest.json` exists. Refresh the plugin list and enable **Manim Explainer**. When upgrading, replace the plugin's `dist/` folder and restart LearnHarness. The sibling `data/` folder holds the installed runtime.
3. Open **Manim Explainer** from the sidebar. Check the download consent box and select **Install local runtime**. The view shows download verification and installation progress and offers cancellation. Later renders reuse the runtime.
4. Import or paste a plan, optionally attach a mono PCM16 WAV at 16–48 kHz padded to the full lesson and aligned to the plan's cues, and select **Render offline**. Select **Preview** to play the result or **Save MP4** to keep a copy. Renders without WAV input are silent. Temporary jobs expire after 30 minutes.

Import, validation and rendering run locally. **Draft plan** sends the brief and public contract to your selected LearnHarness model and may incur provider charges. The resulting JSON goes through the same validator as an imported plan.

## Runtime and platform evidence

The first-use download includes micromamba and the full pinned conda-forge stack. Installation uses the plugin's private data folder and needs additional temporary space for verified archives and extraction.

| Platform | First-use download | Qualification |
| --- | ---: | --- |
| macOS Apple Silicon (12 or later per the lock) | ~200 MiB | Clean native install, 720p synthetic smoke and matched 1080p render. Installed footprint was approximately 840 MiB. |
| Linux x64 (glibc 2.17 or later per the lock) | ~303 MiB | Conda-forge solve and lock verified. Native install and rendering pending. |
| Windows x64 (standard `C:\Windows` system location) | ~295 MiB | Conda-forge solve and lock verified. Native install and rendering pending. |

The installer verifies SHA-256 before executing micromamba or extracting a package. It links packages offline with a fresh private environment and checks Python, Manim, Typst, FFmpeg and their native libraries before marking the runtime ready. The renderer uses fixed packaged code and math templates. Plans contain bounded arithmetic, camera coordinates and plain text. WAV audio is validated and rewritten to canonical PCM before encoding.

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

Use an explicit data folder to store the runtime and temporary jobs. Supply separate plan and WAV files for a 1920×1080 comparison. `render` produces 1280×720 and accepts an optional WAV. Both commands produce 30 fps H.264 MP4, with mono AAC when audio is present.

```sh
npm run cli -- status ../manim-data
npm run cli -- install ../manim-data --allow-download
npm run cli -- validate ../manim-data lesson.json
npm run cli -- render ../manim-data lesson.json preview.mp4
npm run cli -- compare ../manim-data lesson.json comparison.mp4 narration.wav
npm run test:native -- ../manim-data
```

See [NOTICE](NOTICE) for SDK and runtime provenance.
