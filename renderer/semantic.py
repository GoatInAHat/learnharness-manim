"""Validate and compile the shared semantic math scene v3 contract."""

import bisect
import json
import math
import sys
from pathlib import Path
from typing import Literal, TypedDict

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from plan import PlanError, array, fields, line, load, number, require, small_rise, value_and_derivative

FPS = 30
MAX_PLAN = 64 * 1024
DISPLAYS = ('function', 'points', 'difference', 'secant', 'limit', 'tangent', 'compare')
NONZERO = {'difference', 'secant', 'limit'}
ZERO = {'tangent', 'compare'}

Viewport = tuple[float, float, float, float]


class Frame(TypedDict):
    frame: int
    beat: int
    cue: int
    narrationScope: Literal['settled', 'process']
    display: str
    viewport: Viewport
    p: tuple[float, float]
    q: tuple[float, float]
    h: float
    lineKind: Literal['secant', 'tangent']
    slope: float
    reference: tuple[float, float, float] | None
    caption: str | None


def integer(value, low, high):
    require(type(value) in (int, float) and low <= value <= high and int(value) == value,
            'Expected an integer within its allowed range.')
    return int(value)


def coordinate(value):
    return number(value, -1000, 1000)


def graph_ast(node, depth=1, budget=None):
    if budget is None:
        budget = [64]
    budget[0] -= 1
    require(depth <= 8 and budget[0] >= 0 and isinstance(node, dict), 'Graph expression exceeds its structural limits.')
    op = node.get('op')
    require(isinstance(op, str), 'Unknown graph expression operator.')

    def child(key):
        return graph_ast(node[key], depth + 1, budget)

    if op == 'constant':
        fields(node, ('op', 'value'))
        return 'num', coordinate(node['value'])
    if op == 'x':
        fields(node, ('op',))
        return 'var',
    if op in {'add', 'subtract', 'multiply'}:
        fields(node, ('op', 'left', 'right'))
        return {'add': 'add', 'subtract': 'sub', 'multiply': 'mul'}[op], child('left'), child('right')
    if op == 'power':
        fields(node, ('op', 'base', 'exponent'))
        return 'pow', child('base'), integer(node['exponent'], 1, 5)
    if op == 'smooth':
        fields(node, ('op', 'input', 'steepness'))
        return 'smooth', child('input'), number(node['steepness'], 1, 16)
    if op == 'piecewise' and depth == 1:
        fields(node, ('op', 'at', 'before', 'after'))
        return 'piece', coordinate(node['at']), child('before'), child('after')
    raise PlanError('Unsupported graph expression operator or nested piecewise expression.')


def bounded(*values):
    require(all(math.isfinite(v) and abs(v) <= 1_000_000 for v in values), 'Rendered values and slopes must be finite and at most 1e6 in magnitude.')


def name(value):
    require(isinstance(value, str) and len(value) == 1 and 'a' <= value <= 'z', 'Math identifiers must be lowercase ASCII letters.')
    return value


def viewport(camera) -> Viewport:
    fields(camera, ('x', 'y', 'width', 'height'))
    return (coordinate(camera['x']), coordinate(camera['y']), number(camera['width'], 0.02, 2000),
            number(camera['height'], 0.02, 2000))


def compatible(display, h):
    return display not in (ZERO if h else NONZERO)


def compile_frame(plan, frame: int) -> Frame:
    require(0 <= frame < plan['duration'] * FPS, 'Frame outside the lesson.')
    index = bisect.bisect_right(plan['starts'], frame) - 1
    beat = plan['beats'][index]
    a, h, camera, display = beat['a'], beat['h'], beat['camera'], beat['display']
    if frame < beat['settleFrame']:
        previous = plan['beats'][index - 1]
        u = (frame - beat['startFrame']) / (beat['settleFrame'] - beat['startFrame'])
        w = u * u * (3 - 2 * u)
        a = (1 - w) * previous['a'] + w * a
        h = (1 - w) * previous['h'] + w * h
        px, py, pw, ph = previous['camera']
        cx, cy, cw, ch = camera
        camera = ((1 - w) * px + w * cx, (1 - w) * py + w * cy,
                  math.exp((1 - w) * math.log(pw) + w * math.log(cw)),
                  math.exp((1 - w) * math.log(ph) + w * math.log(ch)))
        display = previous['display'] if compatible(previous['display'], h) else 'points'
    expr = plan['expr']
    y, derivative = value_and_derivative(expr, a)
    q = a + h
    require(h == 0 or q != a, 'A nonzero interval must have distinct x coordinates.')
    next_y, next_derivative = value_and_derivative(expr, q) if h else (y, derivative)
    rise = next_y - y
    if h and abs(rise) < 1e-8 * max(1, abs(y), abs(next_y)):
        rise = small_rise(expr, a, h)
    slope = rise / h if h else derivative
    bounded(y, next_y, derivative, next_derivative, slope)
    reference = None
    if display == 'compare':
        target = beat if frame >= beat['settleFrame'] else plan['beats'][index - 1]
        ref = target['reference']
        if ref == a:
            display = 'points'
        else:
            reference = (ref, *value_and_derivative(expr, ref))
    return Frame(frame=frame, beat=index, cue=beat['cueFrame'], narrationScope=beat['narrationScope'],
                 display=display, viewport=camera,
                 p=(a, y), q=(q, next_y), h=h, lineKind='secant' if h else 'tangent',
                 slope=slope, reference=reference, caption=beat.get('caption') if frame >= beat['cueFrame'] else None)


def validate(raw):
    fields(raw, ('version', 'title', 'durationSeconds', 'graph', 'beats'))
    integer(raw['version'], 3, 3)
    title = line(raw['title'], 72)
    duration = integer(raw['durationSeconds'], 90, 120)
    graph = raw['graph']
    fields(graph, ('domain', 'variable', 'functionName', 'xLabel', 'yLabel', 'expression'), ('slopeUnit',))
    start, end = map(coordinate, array(graph['domain'], 2, 2))
    require(start < end, 'Graph domain must increase.')
    variable, function = name(graph['variable']), name(graph['functionName'])
    x_label, y_label = line(graph['xLabel'], 28), line(graph['yLabel'], 28)
    unit = line(graph['slopeUnit'], 14) if 'slopeUnit' in graph else None
    expr = graph_ast(graph['expression'])
    if expr[0] == 'piece':
        _, point, before, after = expr
        require(start < point < end, 'Piecewise breakpoint must lie inside the domain.')
        first, second = value_and_derivative(before, point), value_and_derivative(after, point)
        require(all(math.isclose(a, b, rel_tol=1e-8, abs_tol=1e-8) for a, b in zip(first, second)),
                'Piecewise value and first derivative must match at the breakpoint.')
        bounded(*first, *second)
    samples = []
    for i in range(601):
        x = start + (end - start) * i / 600
        y, slope = value_and_derivative(expr, x)
        bounded(y, slope)
        samples.append((x, y))
    if expr[0] == 'piece':
        x = expr[1]
        samples.append((x, value_and_derivative(expr, x)[0]))
        samples.sort()
    beats = []
    for index, beat in enumerate(array(raw['beats'], 5, 8)):
        fields(beat, ('startFrame', 'settleFrame', 'cueFrame', 'a', 'h', 'camera', 'display', 'narration'),
               ('reference', 'caption', 'narrationScope'))
        first, settle, cue = (integer(beat[key], 0, duration * FPS - 1) for key in ('startFrame', 'settleFrame', 'cueFrame'))
        previous = beats[-1] if beats else None
        require(first == settle == 0 if previous is None else previous['startFrame'] < first and
                previous['cueFrame'] + 9 < first and previous['settleFrame'] < first,
                'Beat frames must increase and leave room for the preceding beat.')
        scope = beat.get('narrationScope', 'settled')
        require(scope in ('settled', 'process'), 'Unknown narration scope.')
        a, h = coordinate(beat['a']), coordinate(beat['h'])
        require(start <= a <= end and start <= a + h <= end, 'Points must be within the graph domain.')
        require(h == 0 or abs(h) >= 0.0001, 'A nonzero authored h must have magnitude at least 0.0001.')
        require(index == 0 or beats[-1]['h'] * h >= 0, 'Consecutive nonzero h values cannot change sign.')
        display = beat['display']
        require(display in DISPLAYS and compatible(display, h), 'Display is incompatible with the signed interval.')
        camera = viewport(beat['camera'])
        if scope == 'process':
            moves = previous is not None and (camera != previous['camera'] or
                (previous['display'] != 'function' and (a != previous['a'] or h != previous['h'])))
            require(moves and first < cue <= settle - 12 and settle <= first + 300,
                    'Process narration requires visible motion and a cue before settling.')
        else:
            require(first <= settle <= first + 150 and settle + 12 <= cue,
                    'Settled narration requires a cue at least 12 frames after settling.')
        refs = [a, a + h]
        entry = dict(startFrame=first, settleFrame=settle, cueFrame=cue, a=a, h=h, camera=camera,
                     display=display, narration=line(beat['narration'], 340), narrationScope=scope)
        require(('reference' in beat) == (display == 'compare'), 'Only comparison beats take a reference.')
        if 'reference' in beat:
            ref = coordinate(beat['reference'])
            require(start <= ref <= end and ref != a, 'Comparison reference must be distinct and within the graph domain.')
            entry['reference'] = ref
            refs.append(ref)
        if 'caption' in beat:
            entry['caption'] = line(beat['caption'], 105)
        cx, cy, w, height = camera
        for point in refs:
            y, slope = value_and_derivative(expr, point)
            bounded(y, slope)
            require(abs(point - cx) <= w / 2 + 1e-10 and abs(y - cy) <= height / 2 + 1e-10,
                    'Target viewport must contain its points and reference.')
        beats.append(entry)
    require(beats[-1]['cueFrame'] + 9 < duration * FPS, 'Last cue needs room before the end of the video.')
    plan = dict(title=title, duration=duration, variable=variable, function=function, x_label=x_label,
                y_label=y_label, unit=unit, expr=expr, domain=(start, end), samples=samples, beats=beats,
                starts=[beat['startFrame'] for beat in beats])
    for frame in range(duration * FPS):
        state = compile_frame(plan, frame)
        bounded(*state['p'], *state['q'], state['slope'], *(state['reference'] or ()))
    return plan


if __name__ == '__main__':
    try:
        load(sys.argv[1], validate, MAX_PLAN)
        print(json.dumps({'valid': True}))
    except PlanError as error:
        print(json.dumps({'valid': False, 'message': str(error)}))
