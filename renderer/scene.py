"""Fixed offline Cairo scene for the shared semantic math format."""

import math
import subprocess
import sys
import textwrap
import wave
from array import array
from functools import lru_cache
from pathlib import Path

import numpy as np
from manim import (
    DOWN, LEFT, RIGHT, UP, Animation, Dot, MathTypst, Rectangle, Scene,
    Text, VGroup, VMobject, linear, tempconfig,
)

# Isolated Python omits the script directory. This path is trusted packaged code.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan import PlanError, load, require, value_and_derivative
from semantic import DISPLAYS, FPS, MAX_PLAN, MAX_SOURCE_PLAN, Frame, compile_frame, narration_windows, validate

BACKGROUND = '#111827'
PAPER = '#F8FAFC'
MUTED = '#ADBCD2'
BLUE = '#70A5FF'
TEAL = '#64E5CD'
PINK = '#F4A1CB'
YELLOW = '#F9D77E'
GRID = '#2D3B51'
PLOT_MIN = np.array([-5.5, -2.91])
PLOT_MAX = np.array([6.55, 2.43])
PLOT_SIZE = PLOT_MAX - PLOT_MIN


def label(text, size, color=PAPER, width=12):
    result = Text(text, font_size=size, color=color, disable_ligatures=True)
    if result.width > width:
        result.scale_to_fit_width(width)
    return result


def ticks(low, span, count):
    spacing = span / count
    exponent = 10 ** math.floor(math.log10(spacing))
    step = next(n * exponent for n in (1, 2, 5, 10) if n * exponent >= spacing)
    return [i * step for i in range(math.ceil(low / step), math.floor((low + span) / step) + 1)]


def clip_segments(starts, ends):
    """Intersect each parametric segment with the screen-space plot rectangle."""
    delta = ends - starts
    parallel = delta == 0
    divisor = np.where(parallel, 1, delta)
    first = (PLOT_MIN - starts) / divisor
    last = (PLOT_MAX - starts) / divisor
    enter = np.max(np.where(parallel, -np.inf, np.minimum(first, last)), axis=1).clip(0, 1)
    leave = np.min(np.where(parallel, np.inf, np.maximum(first, last)), axis=1).clip(0, 1)
    outside = np.any(parallel & ((starts < PLOT_MIN) | (starts > PLOT_MAX)), axis=1)
    visible = (enter < leave) & ~outside & np.any(~parallel, axis=1)
    start = starts[visible]
    direction = delta[visible]
    return ((start + enter[visible, None] * direction).clip(PLOT_MIN, PLOT_MAX),
            (start + leave[visible, None] * direction).clip(PLOT_MIN, PLOT_MAX))


def set_segments(path, starts, ends):
    starts, ends = np.asarray(starts).reshape(-1, 2), np.asarray(ends).reshape(-1, 2)
    # Straight cubic segments. Manim joins adjacent segments with coincident ends.
    points = starts[:, None] + (ends - starts)[:, None] * np.linspace(0, 1, 4)[None, :, None]
    path.set_points(np.pad(points.reshape(-1, 2), ((0, 0), (0, 1))))


def slope_text(value):
    if value == 0:
        return '0.000'
    return f'{value:.3f}' if 0.001 <= abs(value) < 10_000 else f'{value:.4g}'


class Timeline(Animation):
    def __init__(self, scene):
        self.scene = scene
        super().__init__(scene.content, run_time=scene.plan['duration'], rate_func=linear)

    def interpolate_mobject(self, alpha):
        frame = min(round(alpha * self.run_time * FPS), self.scene.plan['duration'] * FPS - 1)
        self.scene.draw_frame(compile_frame(self.scene.plan, frame))


class LessonScene(Scene):
    def __init__(self, plan):
        self.plan = plan
        super().__init__()

    def setup(self):
        self.content = VGroup()
        self.last_visual = None
        self.make_plot()
        self.make_geometry()
        self.make_hud()
        self.add(self.content)

    def construct(self):
        self.play(Timeline(self))

    def get_moving_and_static_mobjects(self, animations):
        # Resolve the group's current children on each frame, including new tick
        # labels and captions. Cairo's default snapshot holds on to old children.
        return [self.content], []

    def make_plot(self):
        self.grid = VMobject(color=GRID, stroke_width=1.2)
        self.axes = VMobject(color=MUTED, stroke_width=1.35, stroke_opacity=0.65)
        self.curve = VMobject(color=BLUE, stroke_width=3.3)
        self.tick_labels = VGroup()
        self.tick_label = lru_cache(maxsize=128)(label)
        self.viewport = None
        self.content.add(self.grid, self.axes, self.tick_labels, self.curve)
        self.pin(label(self.plan['y_label'], 19, MUTED, 4), PLOT_MIN[0], 2.64, edge=1)
        self.pin(label(self.plan['x_label'], 19, MUTED, 4), PLOT_MAX[0], -3.37, edge=-1)

    def draw_grid(self, viewport):
        if viewport == self.viewport:
            return
        cx, cy, width, height = viewport
        self.span = np.array([width, height])
        self.low = np.array([cx, cy]) - self.span / 2
        self.viewport = viewport
        starts, ends, labels = [], [], []
        for axis, count, direction in [(0, 8, DOWN), (1, 6, LEFT)]:
            for value in ticks(self.low[axis], self.span[axis], count):
                start, end = PLOT_MIN.copy(), PLOT_MAX.copy()
                start[axis] = end[axis] = PLOT_MIN[axis] + (value - self.low[axis]) / self.span[axis] * PLOT_SIZE[axis]
                starts.append(start)
                ends.append(end)
                tick = self.tick_label(f'{value:.8g}', 17, MUTED, 1.42 if axis else 1.1).copy()
                labels.append(tick.next_to((*start, 0), direction, buff=0.14))
        set_segments(self.grid, starts, ends)
        self.tick_labels.submobjects[:] = labels
        starts, ends = [PLOT_MIN, PLOT_MIN], [(PLOT_MAX[0], PLOT_MIN[1]), (PLOT_MIN[0], PLOT_MAX[1])]
        zero_x, zero_y = self.project((0, 0))
        if PLOT_MIN[0] < zero_x < PLOT_MAX[0]:
            starts.append((zero_x, PLOT_MIN[1]))
            ends.append((zero_x, PLOT_MAX[1]))
        if PLOT_MIN[1] < zero_y < PLOT_MAX[1]:
            starts.append((PLOT_MIN[0], zero_y))
            ends.append((PLOT_MAX[0], zero_y))
        set_segments(self.axes, starts, ends)

    def project(self, points):
        return PLOT_MIN + (np.asarray(points) - self.low) / self.span * PLOT_SIZE

    def draw_curve(self, state):
        low = max(self.plan['domain'][0], self.low[0])
        high = min(self.plan['domain'][1], self.low[0] + self.span[0])
        expr = self.plan['expr']
        if low >= high:
            self.curve.clear_points()
            return
        anchors = [state['p'][0], state['q'][0]]
        if state['reference']:
            anchors.append(state['reference'][0])
        if expr[0] == 'piece':
            anchors.append(expr[1])
        # Sample across the visible domain so zoomed curves still pass through P and Q.
        xs = sorted(set(np.linspace(low, high, 401)) | {x for x in anchors if low < x < high})
        points = self.project([(x, value_and_derivative(expr, x)[0]) for x in xs])
        set_segments(self.curve, *clip_segments(points[:-1], points[1:]))

    def pin(self, obj, x, y, edge=0):
        self.content.add(obj.move_to((x + edge * obj.width / 2, y, 0)))

    def make_hud(self):
        self.pin(label(self.plan['title'], 33, width=9.8), -6.6, 3.55, edge=1)
        self.pin(Rectangle(width=14.2, height=0.012, stroke_width=0, fill_color=GRID, fill_opacity=1),
                 0, 2.56)
        f, x = self.plan['function'], self.plan['variable']
        # Only single validated ASCII identifiers enter these static math templates.
        fraction = f'frac({f}(a+h) - {f}(a), h)'
        limit = f'lim_(h arrow.r 0) {fraction}'
        formulas = (
            f'{f}({x})', f'P = (a, {f}(a)), quad Q = (a+h, {f}(a+h))',
            f'Delta {x} = h, quad Delta {f} = {f}(a+h) - {f}(a)',
            f'm = {fraction}', limit, f"{f}'(a) = {limit}", f'{f}\'(a) quad "and" quad {f}\'(b)',
        )
        self.formulas = {}
        self.modes = {}
        for mode, formula in zip(DISPLAYS, formulas):
            obj = MathTypst(formula, font_size=34, color=PAPER)
            obj.scale(min(1, 5.7 / obj.width, 0.65 / obj.height))
            # Keep Typst's imported fraction rule and native glyph styles.
            self.formulas[mode] = obj.move_to((0, 3.09, 0))
            badge = label(mode.title(), 19, YELLOW if mode in {'secant', 'limit'} else TEAL, 3.6)
            self.modes[mode] = badge.move_to((6.6 - badge.width / 2, 3.55, 0))
        self.captions = {}
        for beat in self.plan['beats']:
            caption = beat.get('caption')
            if caption and caption not in self.captions:
                self.captions[caption] = label(textwrap.fill(caption, width=85), 25, width=12).move_to((0, -3.65, 0))
        self.hud = VGroup()
        self.readouts = {}
        self.content.add(self.hud)

    def readout(self, key, text, y, color, edge):
        previous, obj = self.readouts.get(key, (None, None))
        if previous != text:
            obj = label(text, 20, color, 4) if text else None
            if obj is not None:
                obj.move_to((edge * (-6.6 + obj.width / 2), y, 0))
            self.readouts[key] = (text, obj)
        return obj

    def draw_hud(self, state):
        display = state['display']
        secant = state['lineKind'] == 'secant'
        items = [self.formulas[display], self.modes[display], self.captions.get(state['caption'])]
        if display != 'function':
            anchor = f"P at {self.plan['variable']} = {state['p'][0]:.8g}"
            interval = f"h = {state['h']:.4g} · Q distinct" if secant else 'Limit: h → 0 · Q → P'
            items.extend([self.readout('anchor', anchor, 3.22, MUTED, 1),
                          self.readout('interval', interval, 2.93, PINK if secant else PAPER, 1)])
        if display in {'secant', 'limit', 'tangent', 'compare'}:
            unit = ' ' + self.plan['unit'] if self.plan['unit'] else ''
            kind = state['lineKind'].title()
            slope = f"{kind} ≈ {slope_text(state['slope'])}{unit}"
            items.append(self.readout('slope', slope, 3.16, YELLOW if secant else TEAL, -1))
            if state['reference']:
                x, _, rate = state['reference']
                reference = f"{self.plan['function']}′({x:g}) ≈ {slope_text(rate)}{unit}"
                items.append(self.readout('reference', reference, 2.88, PINK, -1))
        self.hud.submobjects[:] = [obj for obj in items if obj is not None]

    def make_geometry(self):
        self.slope_line = VMobject(stroke_width=2.5)
        self.reference_line = VMobject(stroke_width=2.5, color=PINK)
        self.base = Dot(radius=0.073, color=PAPER)
        self.moving = Dot(radius=0.073, color=PINK)
        self.reference = Dot(radius=0.073, color=PINK)
        self.base_label = MathTypst('P', font_size=28, color=PAPER)
        self.moving_label = label('Q', 24, PINK)
        self.reference_label = MathTypst('B', font_size=28, color=PINK)
        self.run = VMobject(stroke_width=1.6, color=YELLOW)
        self.rise = VMobject(stroke_width=1.6, color=PINK)
        self.interval = MathTypst('h', font_size=24, color=YELLOW)
        self.delta_time = MathTypst(f'Delta {self.plan["variable"]}', font_size=24, color=YELLOW)
        self.delta_distance = MathTypst(f'Delta {self.plan["function"]}', font_size=24, color=PINK)
        self.geometry = VGroup()
        self.content.add(self.slope_line, self.reference_line, self.run, self.rise, self.geometry)

    def draw_frame(self, state: Frame):
        visual = (state['viewport'], state['display'], state['p'], state['q'], state['h'],
                  state['slope'], state['reference'], state['caption'])
        if visual == self.last_visual:
            return
        self.last_visual = visual
        self.draw_grid(state['viewport'])
        self.draw_curve(state)
        self.draw_hud(state)
        display = state['display']
        first, second = self.project((state['p'], state['q']))
        secant = state['lineKind'] == 'secant'
        reference = state['reference']
        left_to_right = (reference[0] >= state['p'][0]) if reference else state['h'] >= 0
        side = RIGHT if left_to_right else LEFT
        self.geometry.submobjects.clear()
        if display != 'function':
            self.point(self.base, self.base_label, first, -side)
            if secant:
                separation = float(np.linalg.norm(first - second))
                self.moving.set_opacity(min(1, max(0, (separation - 0.075) / 0.09)))
                self.moving_label.set_opacity(min(1, max(0, (separation - 0.10) / 0.13)))
                self.point(self.moving, self.moving_label, second, side, gap=0.24)
        if display in {'difference', 'secant', 'limit'}:
            elbow = np.array([second[0], first[1]])
            set_segments(self.run, *clip_segments(first[None, :], elbow[None, :]))
            set_segments(self.rise, *clip_segments(elbow[None, :], second[None, :]))
            if display == 'difference':
                run_length = float(np.linalg.norm(elbow - first))
                rise_length = float(np.linalg.norm(second - elbow))
                if run_length >= self.delta_time.width + 0.18 and self.inside((first + elbow) / 2):
                    center = (first + elbow) / 2
                    center[1] += 0.22 if center[1] < PLOT_MIN[1] + 0.32 else -0.22
                    self.place_label(self.delta_time, center)
                    self.geometry.add(self.delta_time)
                if rise_length >= self.delta_distance.height + 0.18 and self.inside((elbow + second) / 2):
                    center = (elbow + second) / 2 - side[:2] * (self.delta_distance.width / 2 + 0.12)
                    self.place_label(self.delta_distance, center)
                    self.geometry.add(self.delta_distance)
            elif abs(elbow[0] - first[0]) >= self.interval.width + 0.18 and self.inside((first + elbow) / 2):
                center = (first + elbow) / 2
                center[1] += 0.22 if center[1] < PLOT_MIN[1] + 0.32 else -0.22
                self.place_label(self.interval, center)
                self.geometry.add(self.interval)
        else:
            self.run.clear_points()
            self.rise.clear_points()
        if display in {'secant', 'limit', 'tangent', 'compare'}:
            self.slope_line.set_color(YELLOW if secant else TEAL)
            self.slope(self.slope_line, *state['p'], state['slope'])
        else:
            self.slope_line.clear_points()
        if reference:
            self.point(self.reference, self.reference_label, self.project(reference[:2]), side)
            self.slope(self.reference_line, *reference)
        else:
            self.reference_line.clear_points()

    def slope(self, line, x, y, slope):
        low, high = self.low[0], self.low[0] + self.span[0]
        start, end = self.project(((low, y + slope * (low - x)), (high, y + slope * (high - x))))
        set_segments(line, *clip_segments(start[None, :], end[None, :]))

    @staticmethod
    def inside(point):
        return np.all((PLOT_MIN - 1e-8 <= point) & (point <= PLOT_MAX + 1e-8))

    @staticmethod
    def place_label(obj, center):
        padding = np.array([obj.width, obj.height]) / 2 + 0.05
        obj.move_to((*np.clip(center, PLOT_MIN + padding, PLOT_MAX - padding), 0))

    def point(self, dot, label_, point, side, gap=0.08):
        if self.inside(point):
            dot.move_to((*point, 0))
            center = point + (side * (dot.radius + label_.width / 2 + gap) + UP * 0.23)[:2]
            self.place_label(label_, center)
            self.geometry.add(dot, label_)


def narration_at(job, plan):
    path = job / 'narration.wav'
    if not path.is_file():
        return None
    size = path.stat().st_size
    require(44 <= size <= 12 * 1024 * 1024, 'Narration WAV is empty, truncated or exceeds 12 MiB.')
    try:
        with path.open('rb') as source:
            header = source.read(12)
            require(header[:4] == b'RIFF' and header[8:] == b'WAVE' and
                    int.from_bytes(header[4:8], 'little') == size - 8, 'Narration WAV has an invalid RIFF header.')
            source.seek(0)
            with wave.open(source, 'rb') as audio:
                frames, rate = audio.getnframes(), audio.getframerate()
                require(audio.getnchannels() == 1 and audio.getsampwidth() == 2 and
                        16_000 <= rate <= 48_000 and frames == plan['duration'] * rate,
                        'Narration needs mono PCM16 at 16–48 kHz, padded to the exact lesson duration.')
                pcm = audio.readframes(frames)
                require(len(pcm) == frames * 2, 'Narration WAV is truncated.')
    except (EOFError, wave.Error) as error:
        raise PlanError('Narration is not a supported PCM WAV file.') from error

    samples = array('h', pcm)
    if sys.byteorder != 'little':
        samples.byteswap()

    def peak(start, end):
        segment = memoryview(samples)[start:end]
        return max(max(segment, default=0), -min(segment, default=0))

    previous_end = 0
    for index, (cue, end_frame) in enumerate(narration_windows(plan), 1):
        start = (cue * rate + FPS // 2) // FPS
        end = (end_frame * rate + FPS // 2) // FPS
        require(peak(previous_end, start) <= 100, 'Narration WAV has audio outside its cue windows.')
        require(peak(start, end) >= 16, f'Narration WAV is silent at beat {index}.')
        previous_end = end
    require(peak(previous_end, frames) <= 100, 'Narration WAV has audio outside its cue windows.')

    # Only canonical PCM reaches the media decoder.
    normalized = job / 'pcm.wav'
    with wave.open(str(normalized), 'wb') as audio:
        audio.setparams((1, 2, rate, frames, 'NONE', 'not compressed'))
        audio.writeframes(pcm)
    return normalized


def render_source(job, plan, height):
    source = job / 'lesson.py'
    source.write_text(plan['source'], encoding='utf-8')
    output = job / 'video.mp4'
    log = job / 'manim.log'
    with log.open('wb') as diagnostics:
        result = subprocess.run([
            sys.executable, '-I', '-B', '-m', 'manim', 'render', '--silent', '--disable_caching',
            '--progress_bar', 'none', '-v', 'error', '--format', 'mp4', '--renderer', plan['renderer'],
            '--resolution', f'{height * 16 // 9},{height}', '--fps', str(FPS), '--media_dir', str(job / 'media'),
            '--output_file', str(output), str(source), plan['scene'],
        ], cwd=job, stdin=subprocess.DEVNULL, stdout=diagnostics, stderr=subprocess.STDOUT)
    if result.returncode != 0 or not output.is_file():
        with log.open('rb') as diagnostics:
            diagnostics.seek(max(0, log.stat().st_size - 400))
            detail = diagnostics.read().decode('utf-8', errors='replace').strip()
        raise PlanError(f'Manim could not render the named scene. {detail}')


def render(job, height, with_audio):
    plan = load(job / 'plan.json', validate, MAX_PLAN, MAX_SOURCE_PLAN)
    if 'source' in plan:
        require(not with_audio, 'Direct scenes place their own audio in Python.')
        render_source(job, plan, height)
        return
    if with_audio:
        require(narration_at(job, plan) is not None, 'Expected a cue-aligned narration WAV.')
    with tempconfig({
        'renderer': 'cairo', 'format': 'mp4', 'output_file': 'video', 'media_dir': str(job / 'media'),
        'video_dir': str(job), 'pixel_width': height * 16 // 9, 'pixel_height': height, 'frame_rate': FPS,
        'background_color': BACKGROUND, 'disable_caching': True, 'progress_bar': 'none',
        'verbosity': 'ERROR', 'flush_cache': False, 'preview': False, 'notify_outdated_version': False,
    }):
        LessonScene(plan).render()
    require((job / 'video.mp4').is_file(), 'Manim did not create the expected MP4.')


if __name__ == '__main__':
    try:
        require(sys.argv[2] in {'720', '1080'}, 'Unsupported render resolution.')
        require(sys.argv[3] in {'wav', 'silent'}, 'Unsupported narration option.')
        render(Path(sys.argv[1]).resolve(), int(sys.argv[2]), sys.argv[3] == 'wav')
    except PlanError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
