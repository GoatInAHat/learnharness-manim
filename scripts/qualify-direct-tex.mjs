import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleTestModule } from './bundle-test-module.mjs';
import { pluginId, zipTool } from './package.mjs';

const { Runtime, environment, run } = await bundleTestModule('src/runtime.ts');
const scratch = await mkdtemp(join(tmpdir(), 'manim-tex-ci-'));
const dist = join(scratch, pluginId, 'dist');
const data = join(scratch, pluginId, 'data');
const plan = join(scratch, 'plan.json');
const video = join(scratch, 'native-source.mp4');
const windows = process.platform === 'win32';
const minute = 60_000;
const source = String.raw`
import math
import struct
import wave
from manim import MathTex, Dot, UP, RIGHT, ValueTracker, VGroup, Scene, linear

class NativeTexProbe(Scene):
    def construct(self):
        formula = MathTex(r"\frac{d}{dx}e^{2x}=2e^{2x}")
        matrix = MathTex(r"\begin{pmatrix}1&2\\3&4\end{pmatrix}")
        self.add(VGroup(formula, matrix).arrange(RIGHT, buff=0.6).to_edge(UP))
        track = ValueTracker(0)
        marker = Dot()
        marker.add_updater(lambda obj: obj.move_to(4 * track.get_value() * RIGHT - 2 * RIGHT))
        self.add(marker)
        with wave.open("native-tone.wav", "wb") as wav:
            wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            wav.writeframes(b"".join(struct.pack("<h", round(1800 * math.sin(i * 2 * math.pi * 440 / 24000)))
                                      for i in range(24000)))
        self.add_sound("native-tone.wav")
        self.play(track.animate.set_value(1), run_time=1, rate_func=linear)
        self.wait(0.2)
`;

function cli(args, minutes) {
  const result = spawnSync(process.execPath, [join(dist, 'cli.cjs'), ...args], {
    cwd: scratch, env: environment(scratch), encoding: 'utf8',
    timeout: minutes * minute, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.signal || result.stdout);
}

try {
  zipTool('unpack', resolve(pluginId + '.zip'), scratch);
  cli(['install', data, '--allow-download'], 21);
  await assert.rejects(lstat(join(data, 'tex')), { code: 'ENOENT' });
  await writeFile(plan, JSON.stringify({
    version: 3, title: 'Native MathTex and source audio', sceneName: 'NativeTexProbe', source,
  }));
  cli(['render', data, plan, video, '--silent'], 10);
  const lock = (await readFile(join(data, 'tex', 'manim-tex.lock'), 'utf8')).trim();
  assert.match(lock, /^[0-9a-f]{64}$/);
  const local = await new Runtime(dist, data).ready();
  assert.ok(local);
  const bin = windows ? join(local.prefix, 'Library', 'bin') : join(local.prefix, 'bin');
  const media = (tool, args) => run(join(bin, tool + (windows ? '.exe' : '')), args,
    scratch, environment(scratch, local.prefix), AbortSignal.timeout(minute), tool);
  const probe = JSON.parse(await media('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,codec_name,duration,nb_read_frames', '-of', 'json', video]));
  assert.deepEqual(probe.streams.map(({ codec_type, codec_name }) => codec_type + '/' + codec_name).sort(),
    ['audio/aac', 'video/h264']);
  assert.equal(Number(probe.streams.find(s => s.codec_type === 'video').nb_read_frames), 36);
  await media('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', video,
    '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  console.log('Fresh managed TeX, default MathTex, custom updater and source-authored AAC passed.');
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
