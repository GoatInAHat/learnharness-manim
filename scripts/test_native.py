"""Semantic and WAV regression tests in the verified Manim runtime."""

import copy
import json
import math
import struct
import sys
import unittest
from pathlib import Path

import numpy as np
from manim import tempconfig

sys.path[:0] = [sys.argv[1], str(Path(__file__).resolve().parent)]
from fixture import fixture
from plan import PlanError, load, value_and_derivative
from scene import PINK, PLOT_MAX, PLOT_MIN, LessonScene, Timeline, narration_at
from semantic import FPS, MAX_PLAN, compile_frame, graph_ast, validate

ROOT = Path(sys.argv[2])


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = fixture(ROOT / 'fixture')
        cls.wav = (ROOT / 'fixture' / 'narration.wav').read_bytes()

    def test_semantic_frames_match_the_shared_secant_and_tangent_rules(self):
        plan = validate(self.raw)
        wide = compile_frame(plan, 1080)
        middle = compile_frame(plan, 1110)
        near = compile_frame(plan, 1140)
        self.assertEqual(wide['display'], 'secant')
        self.assertEqual(middle['display'], 'secant')
        self.assertAlmostEqual(middle['h'], 0.505)
        self.assertAlmostEqual(middle['viewport'][2], math.sqrt(5 * 3.8))
        self.assertEqual(near['display'], 'limit')
        self.assertEqual(near['lineKind'], 'secant')
        self.assertAlmostEqual(near['slope'], 1.01)
        self.assertIsNone(compile_frame(plan, 1154)['caption'])
        self.assertIsNotNone(compile_frame(plan, 1155)['caption'])
        last_secant = compile_frame(plan, 1679)
        self.assertGreater(last_secant['h'], 0)
        self.assertEqual(last_secant['lineKind'], 'secant')
        tangent = compile_frame(plan, 1680)
        self.assertEqual(tangent['lineKind'], 'tangent')
        self.assertEqual(tangent['display'], 'tangent')
        self.assertEqual(tangent['p'], tangent['q'])
        self.assertEqual(tangent['slope'], 1)
        self.assertEqual(compile_frame(plan, 2220)['reference'], (-1, 1, -2))

        offset = copy.deepcopy(self.raw)
        offset['graph']['expression'] = {
            'op': 'add', 'left': {'op': 'constant', 'value': 500},
            'right': {'op': 'multiply', 'left': {'op': 'constant', 'value': 1e-10},
                      'right': self.raw['graph']['expression']},
        }
        for beat in offset['beats']:
            beat['camera']['y'] = 500
        small = compile_frame(validate(offset), 1679)
        self.assertEqual(small['p'][1], small['q'][1])
        self.assertAlmostEqual(small['slope'], (1 + small['h']) * 1e-10, delta=1e-23)

    def test_process_narration_requires_visible_motion_and_valid_cue(self):
        raw = copy.deepcopy(self.raw)
        beat = raw['beats'][2]
        beat.update(narrationScope='process', cueFrame=1155, settleFrame=1380)
        plan = validate(raw)
        cue = compile_frame(plan, 1155)
        self.assertEqual(cue['narrationScope'], 'process')
        self.assertEqual(cue['display'], 'secant')
        self.assertIsNotNone(cue['caption'])
        self.assertEqual(compile_frame(plan, 1380)['display'], 'limit')
        self.assertEqual(compile_frame(plan, 1680)['narrationScope'], 'settled')
        for change in ({'narrationScope': 'moving'}, {'cueFrame': 1080}, {'cueFrame': 1369},
                       {'settleFrame': 1381}, {'h': 1, 'camera': raw['beats'][1]['camera']}):
            invalid = copy.deepcopy(raw)
            invalid['beats'][2].update(change)
            with self.subTest(change=change), self.assertRaises(PlanError):
                validate(invalid)
        raw['beats'][0]['narrationScope'] = 'process'
        with self.assertRaisesRegex(PlanError, 'visible motion'):
            validate(raw)

    def test_cairo_viewport_keeps_geometry_and_readouts_at_the_secant_boundary(self):
        raw = copy.deepcopy(self.raw)
        raw['graph']['slopeUnit'] = 'm/s'
        tight = dict(x=0.505, y=0.255, width=0.08, height=0.08)
        raw['beats'][2].update(camera=tight, narrationScope='process', cueFrame=1110)
        raw['beats'][3].update(camera=tight, h=-0.0)
        with tempconfig({'renderer': 'cairo', 'media_dir': str(ROOT / 'visual'), 'write_to_movie': False,
                         'pixel_width': 1920, 'pixel_height': 1080, 'notify_outdated_version': False,
                         'verbosity': 'ERROR'}):
            scene = LessonScene(validate(raw))
            scene.setup()
            timeline = Timeline(scene)
            timeline.begin()
            moving, _ = scene.get_moving_and_static_mobjects([timeline])

            def draw(frame):
                timeline.interpolate(frame / (FPS * scene.plan['duration']))
                scene.renderer.update_frame(scene, moving)
                return scene.renderer.get_frame()[:, :, :3]

            draw(600)
            marker_sizes = [(dot.width, dot.height) for dot in (scene.base, scene.moving)]
            draw(1110)
            self.assertIn(scene.formulas['secant'], scene.hud)
            self.assertIn(scene.captions[raw['beats'][2]['caption']], scene.hud)
            near_secant = draw(1140)
            self.assertIn(scene.formulas['limit'], scene.hud)
            self.assertNotIn(scene.formulas['secant'], scene.hud)
            self.assertEqual(scene.readouts['slope'][0], 'Secant ≈ 1.010 m/s')
            self.assertGreater(len(scene.tick_labels), 6)
            self.assertTrue(any(0 < part.get_stroke_width() < 4
                                for part in scene.formulas['limit'].family_members_with_points()))
            for path in (scene.curve, scene.slope_line, scene.run, scene.rise):
                self.assertTrue(path.has_points())
                self.assertTrue(np.all(path.points[:, :2] >= PLOT_MIN - 1e-10))
                self.assertTrue(np.all(path.points[:, :2] <= PLOT_MAX + 1e-10))
            np.testing.assert_allclose([(dot.width, dot.height) for dot in (scene.base, scene.moving)], marker_sizes)
            draw(1679)
            self.assertIn(scene.moving, scene.geometry)
            self.assertIn('Q distinct', scene.readouts['interval'][0])
            tangent = draw(1680)
            self.assertNotIn(scene.moving, scene.geometry)
            self.assertFalse(scene.run.has_points())
            self.assertFalse(scene.rise.has_points())
            self.assertEqual(scene.readouts['interval'][0], 'Limit: h → 0 · Q → P')
            self.assertEqual(scene.readouts['slope'][0], 'Tangent ≈ 1.000 m/s')
            pink = tuple(bytes.fromhex(PINK[1:]))
            self.assertGreater(np.sum(np.all(near_secant[225:930] == pink, axis=2)), 10)
            self.assertEqual(np.sum(np.all(tangent[225:930] == pink, axis=2)), 0)

    def test_normalized_logistic_and_piecewise_join(self):
        def num(value):
            return {'op': 'constant', 'value': value}

        def binary(op, left, right):
            return dict(op=op, left=left, right=right)

        def smooth(origin):
            return {'op': 'smooth', 'steepness': 7,
                    'input': binary('multiply', num(0.5), binary('subtract', {'op': 'x'}, num(origin)))}

        raw = copy.deepcopy(self.raw)
        raw['graph']['expression'] = {
            'op': 'piecewise', 'at': 0,
            'before': smooth(-2), 'after': binary('add', num(1), smooth(0)),
        }
        raw['beats'][3]['a'] = 0
        plan = validate(raw)
        expr = plan['expr']
        self.assertEqual(value_and_derivative(expr, -2)[0], 0)
        self.assertEqual(value_and_derivative(expr, 0)[0], 1)
        self.assertEqual(value_and_derivative(expr, 2)[0], 2)
        endpoint = 1 / (1 + math.exp(3.5))
        expected = 3.5 * endpoint * (1 - endpoint) / (1 - 2 * endpoint)
        self.assertAlmostEqual(value_and_derivative(expr, 0)[1], expected)
        self.assertAlmostEqual(value_and_derivative(expr, -1e-8)[1], expected)
        tangent = compile_frame(plan, 1680)
        self.assertEqual(tangent['lineKind'], 'tangent')
        self.assertEqual(tangent['p'], tangent['q'])
        for h in (-1e-13, 1e-13):
            plan['beats'][3].update(h=h, display='secant')
            secant = compile_frame(plan, 1680)
            self.assertEqual(secant['lineKind'], 'secant')
            self.assertEqual(secant['q'][0], h)
            self.assertAlmostEqual(secant['slope'], expected, delta=1e-12)

        x = {'op': 'x'}
        for after in (binary('add', x, num(1e-9)), binary('multiply', x, num(1.000000001))):
            bad = dict(op='piecewise', at=0, before=x, after=after)
            raw['graph']['expression'] = bad
            with self.subTest(after=after), self.assertRaisesRegex(PlanError, 'must match'):
                validate(raw)
            with self.assertRaisesRegex(PlanError, 'must match'):
                value_and_derivative(graph_ast(bad), 0)

    def test_smooth_endpoints_are_exact_and_tails_stay_analytic(self):
        x = {'op': 'x'}
        smooth = graph_ast(dict(op='smooth', input=x, steepness=10))
        lo, dlo = value_and_derivative(smooth, 0)
        hi, dhi = value_and_derivative(smooth, 1)
        self.assertEqual((lo, hi), (0, 1))
        self.assertEqual(dlo, dhi)
        below, dbelow = value_and_derivative(smooth, -0.2)
        above, dabove = value_and_derivative(smooth, 1.2)
        self.assertTrue(below < 0 and above > 1 and dbelow > 0 and dabove > 0)
        with self.assertRaisesRegex(PlanError, 'operator'):
            graph_ast(dict(op='clamp', input=x, min=0, max=1))

    def test_frame_points_stay_within_the_closed_domain(self):
        raw = copy.deepcopy(self.raw)
        raw['beats'][0].update(a=-2, h=4, camera=dict(x=0, y=2, width=6, height=8))
        plan = validate(raw)
        edge = compile_frame(plan, 0)
        self.assertEqual((edge['p'][0], edge['q'][0]), (-2, 2))
        for a, h in ((-2.01, 1), (-2, -0.01), (0, 2.01)):
            raw['beats'][0].update(a=a, h=h)
            plan['beats'][0].update(a=a, h=h)
            with self.subTest(a=a, h=h), self.assertRaisesRegex(PlanError, 'within the graph domain'):
                validate(raw)
            with self.assertRaisesRegex(PlanError, 'within the graph domain'):
                compile_frame(plan, 0)
        raw['graph'].update(domain=[-2, 0.11], expression={'op': 'x'})
        for beat in raw['beats']:
            beat.update(a=0.1, h=0.01 if beat['h'] else 0,
                        camera=dict(x=0, y=0, width=4, height=4))
        held_edge = compile_frame(validate(raw), raw['beats'][1]['startFrame'] + 4)
        self.assertEqual(held_edge['q'][0], 0.11)

    def test_import_rejects_untrusted_code_fields_and_malformed_data(self):
        plan_path = ROOT / 'import.json'
        plan_path.write_text(json.dumps(self.raw), encoding='utf-8')
        self.assertEqual(load(plan_path, validate, MAX_PLAN)['duration'], 90)
        for data in (b'\xff', b' ' * (MAX_PLAN + 1), b'{"version":3,"version":3}',
                     b'```python\nimport os\n```'):
            with self.subTest(size=len(data)), self.assertRaises(PlanError):
                plan_path.write_bytes(data)
                load(plan_path, validate, MAX_PLAN)
        for change in ({'script': 'import os'}, {'caption': '<script>bad()</script>'},
                       {'narration': 'bad\u200btext'}, {'h': 0}, {'h': -1}, {'cueFrame': 1090}):
            raw = copy.deepcopy(self.raw)
            raw['beats'][2].update(change)
            with self.subTest(field=next(iter(change))), self.assertRaises(PlanError):
                validate(raw)
        raw = copy.deepcopy(self.raw)
        raw['graph']['expression'] = {'op': 'eval', 'source': '#read("payload")'}
        with self.assertRaisesRegex(PlanError, 'operator'):
            validate(raw)
        expression = {'op': 'x'}
        for _ in range(9):
            expression = {'op': 'power', 'base': expression, 'exponent': 1}
        raw['graph']['expression'] = expression
        with self.assertRaisesRegex(PlanError, 'structural limits'):
            validate(raw)

    def test_narration_admits_only_bounded_cue_aligned_pcm(self):
        folder = ROOT / 'audio'
        folder.mkdir()
        source = folder / 'narration.wav'
        plan = validate(self.raw)
        self.assertIsNone(narration_at(folder, plan))
        source.write_bytes(self.wav)
        self.assertEqual(narration_at(folder, plan).read_bytes(), self.wav)
        early = bytearray(self.wav)
        struct.pack_into('<h', early, 44, 200)
        quiet = self.wav[:44] + bytes(len(self.wav) - 44)
        for data, error in ((self.wav[:-1], 'RIFF'), (early, 'cue windows'), (quiet, 'silent at beat 1')):
            source.write_bytes(data)
            with self.assertRaisesRegex(PlanError, error):
                narration_at(folder, plan)
        with source.open('wb') as output:
            output.truncate(12 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(PlanError, 'exceeds 12 MiB'):
            narration_at(folder, plan)


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])
