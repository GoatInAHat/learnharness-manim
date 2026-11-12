"""Fixed offline Cairo scene for the shared semantic math format."""

import math
import sys
import textwrap
import wave
from pathlib import Path

import numpy as np
from manim import (
    DOWN, LEFT, RIGHT, UP, Animation, Axes, Dot, Line, MathTypst, MovingCameraScene,
    Rectangle, Text, VMobject, linear, tempconfig,
)

# Isolated Python omits the script directory. This path is trusted packaged code.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan import PlanError, load, require
from semantic import DISPLAYS, FPS, MAX_PLAN, compile_frame, validate

BACKGROUND = '#111827'
PAPER = '#F8FAFC'
MUTED = '#ADBCD2'
BLUE = '#70A5FF'
TEAL = '#64E5CD'
PINK = '#F4A1CB'
YELLOW = '#F9D77E'


def label(text, size, color=PAPER, width=12):
    result = Text(text, font_size=size, color=color, disable_ligatures=True)
    if result.width > width:
        result.scale_to_fit_width(width)
    return result


def ticks(low, high):
    exponent = 10 ** math.floor(math.log10((high - low) / 6))
    step = next(multiplier * exponent for multiplier in (1, 2, 5, 10) if multiplier * exponent >= (high - low) / 8)
    return step


class Timeline(Animation):
    def __init__(self, scene):
        self.scene = scene
        super().__init__(scene.camera.frame, run_time=scene.plan['duration'], rate_func=linear)

    def interpolate_mobject(self, alpha):
        frame = min(round(alpha * self.run_time * FPS), self.scene.plan['duration'] * FPS - 1)
        self.scene.draw_frame(compile_frame(self.scene.plan, frame))


class LessonScene(MovingCameraScene):
    def __init__(self, plan, narration):
        self.plan = plan
        self.narration = narration
        super().__init__()

    def construct(self):
        self.frame = self.camera.frame
        self.width, self.height = self.frame.width, self.frame.height
        self.hud = []
        self.make_plot()
        self.make_geometry()
        self.make_hud()
        if self.narration:
            self.add_sound(str(self.narration))
        self.play(Timeline(self))

    def make_plot(self):
        x_min, x_max = self.plan['domain']
        values = [y for _, y in self.plan['samples']]
        viewports = [beat['camera'] for beat in self.plan['beats']]
        y_min = min(min(values), *(y - h / 2 for _, y, _, h in viewports))
        y_max = max(max(values), *(y + h / 2 for _, y, _, h in viewports))
        x_step, y_step = ticks(x_min, x_max), ticks(y_min, y_max)
        self.axes = Axes(x_range=(x_min, x_max, x_step), y_range=(y_min, y_max, y_step),
                         x_length=10.4, y_length=5.0, axis_config={'color': MUTED, 'stroke_width': 1.5, 'include_tip': False})
        self.add(self.axes)
        for low, high, step, axis, direction in [(x_min, x_max, x_step, self.axes.x_axis, DOWN),
                                                 (y_min, y_max, y_step, self.axes.y_axis, LEFT)]:
            for i in range(math.ceil(low / step), math.floor(high / step) + 1):
                if i == 0 and direction is LEFT and x_min <= 0 <= x_max:
                    continue
                self.add(label(f'{i * step:.4g}', 17, MUTED).next_to(axis.n2p(i * step), direction, buff=0.11))
        curve = VMobject(color=BLUE, stroke_width=4).set_points_as_corners([self.axes.c2p(x, y) for x, y in self.plan['samples']])
        self.add(curve)

    def pin(self, obj, x, y, edge=0):
        obj.set_z_index(10)
        self.hud.append((obj, obj.width, obj.height, x, y, edge))
        self.add(obj)
        return obj

    def make_hud(self):
        for y, height in [(0.421, 0.16), (-0.457, 0.089)]:
            self.pin(Rectangle(width=self.width * 1.01, height=self.height * height, stroke_width=0,
                               fill_color=BACKGROUND, fill_opacity=1), 0, y)
        self.pin(label(self.plan['title'], 33, width=10), -0.451, 0.456, edge=1)
        self.pin(label(self.plan['y_label'], 19, MUTED, 3.6), -0.451, 0.386, edge=1)
        self.pin(label(self.plan['x_label'], 19, MUTED, 3.6), 0.451, 0.386, edge=-1)
        f, x = self.plan['function'], self.plan['variable']
        # Only single validated ASCII identifiers enter these static math templates.
        fraction = f'frac({f}(a+h) - {f}(a), h)'
        formulas = (
            f'{f}({x})', 'P, Q', f'Delta {x} = h, quad Delta {f} = {f}(a+h) - {f}(a)',
            f'm = {fraction}', f'lim_(h arrow.r 0) {fraction}', f"m = {f}'(a)", f"{f}'(a) quad {f}'(b)",
        )
        self.formulas = {}
        self.modes = {}
        for mode, formula in zip(DISPLAYS, formulas):
            obj = MathTypst(formula, font_size=32, color=PAPER)
            if obj.width > 6.3:
                obj.scale_to_fit_width(6.3)
            if obj.height > 0.48:
                obj.scale_to_fit_height(0.48)
            self.formulas[mode] = self.pin(obj, 0, 0.382)
            text = mode.title()
            if self.plan['unit'] and mode in {'secant', 'limit', 'tangent', 'compare'}:
                text += ' · ' + self.plan['unit']
            self.modes[mode] = self.pin(label(text, 19, YELLOW if mode in {'secant', 'limit'} else TEAL, 3.6), 0.451, 0.454, edge=-1)
        self.captions = {}
        for beat in self.plan['beats']:
            caption = beat.get('caption')
            if caption and caption not in self.captions:
                self.captions[caption] = self.pin(label(textwrap.fill(caption, width=85), 25, width=12), 0, -0.455)

    def make_geometry(self):
        self.slope_line = Line(LEFT, RIGHT, stroke_width=4)
        self.reference_line = Line(LEFT, RIGHT, stroke_width=4, color=PINK)
        self.base = Dot(radius=0.073, color=PAPER)
        self.moving = Dot(radius=0.073, color=PINK)
        self.reference = Dot(radius=0.073, color=PINK)
        self.base_label = MathTypst('P', font_size=28, color=PAPER)
        self.moving_label = MathTypst('Q', font_size=28, color=PINK)
        self.reference_label = MathTypst('R', font_size=28, color=PINK)
        self.delta_x = Line(LEFT, RIGHT, stroke_width=2.7, color=PINK)
        self.delta_y = Line(DOWN, UP, stroke_width=2.7, color=PINK)
        self.interval = MathTypst('h', font_size=24, color=PINK)
        self.add(self.slope_line, self.reference_line, self.delta_x, self.delta_y, self.interval,
                 self.base, self.moving, self.reference, self.base_label, self.moving_label, self.reference_label)

    def draw_frame(self, state):
        cx, cy, width, height = state['viewport']
        center = self.axes.c2p(cx, cy)
        size = self.axes.c2p(cx + width, cy + height) - center
        self.frame.stretch_to_fit_width(size[0]).stretch_to_fit_height(size[1]).move_to(center)
        for item, w, h, x, y, edge in self.hud:
            item.stretch_to_fit_width(w * size[0] / self.width).stretch_to_fit_height(h * size[1] / self.height)
            item.move_to(center + RIGHT * (x * size[0] + edge * item.width / 2) + UP * (y * size[1]))
        display = state['display']
        for mode in DISPLAYS:
            self.formulas[mode].set_opacity(float(mode == display))
            self.modes[mode].set_opacity(float(mode == display))
        for caption, obj in self.captions.items():
            obj.set_opacity(float(caption == state['caption']))
        first, second = self.axes.c2p(*state['p']), self.axes.c2p(*state['q'])
        secant = state['lineKind'] == 'secant'
        show_points = display != 'function'
        self.point(self.base, self.base_label, first, show_points, UP + LEFT)
        self.point(self.moving, self.moving_label, second, show_points and secant, UP + RIGHT)
        show_changes = display in {'difference', 'secant', 'limit'}
        elbow = self.axes.c2p(state['q'][0], state['p'][1])
        self.place_line(self.delta_x, first, elbow, show_changes)
        self.place_line(self.delta_y, elbow, second, show_changes)
        self.interval.move_to((first + elbow) / 2 + DOWN * 0.18).set_opacity(float(show_changes))
        self.slope_line.set_color(YELLOW if secant else TEAL)
        if display in {'secant', 'limit', 'tangent', 'compare'}:
            self.slope(self.slope_line, *state['p'], state['slope'], state['viewport'])
        else:
            self.slope_line.set_opacity(0)
        reference = state['reference']
        if reference:
            self.point(self.reference, self.reference_label, self.axes.c2p(*reference[:2]), True, UP + RIGHT)
            self.slope(self.reference_line, *reference, state['viewport'])
        else:
            for item in (self.reference, self.reference_label, self.reference_line):
                item.set_opacity(0)

    def slope(self, line, x, y, slope, viewport):
        cx, cy, w, h = viewport
        low, high = cx - w * 0.49, cx + w * 0.49
        if slope:
            bounds = sorted(x + (edge - y) / slope for edge in (cy - h * 0.41, cy + h * 0.34))
            low, high = max(low, bounds[0]), min(high, bounds[1])
        self.place_line(line, self.axes.c2p(low, y + slope * (low - x)),
                        self.axes.c2p(high, y + slope * (high - x)), high > low)

    @staticmethod
    def point(dot, label_, point, visible, direction):
        dot.move_to(point).set_opacity(float(visible))
        label_.next_to(dot, direction, buff=0.06).set_opacity(float(visible))

    @staticmethod
    def place_line(line, start, end, visible):
        visible = visible and np.linalg.norm(end - start) > 1e-9
        if visible:
            line.put_start_and_end_on(start, end)
        line.set_opacity(float(visible))


def narration_at(job, duration):
    path = job / 'narration.wav'
    if not path.is_file():
        return None
    require(path.stat().st_size <= 12 * 1024 * 1024, 'Narration WAV exceeds 12 MiB.')
    try:
        with wave.open(str(path), 'rb') as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            require(audio.getnchannels() == 1 and audio.getsampwidth() == 2 and
                    16_000 <= rate <= 48_000 and frames == duration * rate,
                    'Narration needs mono PCM16 at 16–48 kHz, padded to the exact lesson duration.')
            require(len(audio.readframes(frames)) == frames * 2, 'Narration WAV is truncated.')
    except (EOFError, wave.Error) as error:
        raise PlanError('Narration is not a supported PCM WAV file.') from error
    return path


def render(job):
    plan = load(job / 'plan.json', validate, MAX_PLAN)
    narration = narration_at(job, plan['duration'])
    with tempconfig({
        'renderer': 'cairo', 'format': 'mp4', 'output_file': 'video', 'media_dir': str(job / 'media'),
        'video_dir': str(job), 'pixel_width': 1280, 'pixel_height': 720, 'frame_rate': FPS,
        'background_color': BACKGROUND, 'disable_caching': True, 'progress_bar': 'none',
        'verbosity': 'ERROR', 'flush_cache': False, 'preview': False, 'notify_outdated_version': False,
    }):
        LessonScene(plan, narration).render()
    require((job / 'video.mp4').is_file(), 'Manim did not create the expected MP4.')


if __name__ == '__main__':
    try:
        render(Path(sys.argv[1]).resolve())
    except PlanError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
