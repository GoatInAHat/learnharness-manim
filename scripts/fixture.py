"""Create a public synthetic input for contract and PCM mux tests."""
import json
import math
import sys
import wave
from array import array
from pathlib import Path


def fixture(directory):
    directory.mkdir(parents=True, exist_ok=True)
    plan = {
        'version': 3, 'title': 'A quadratic example', 'durationSeconds': 90,
        'graph': {
            'domain': [-2, 2], 'variable': 'x', 'functionName': 'f',
            'xLabel': 'x', 'yLabel': 'f(x)',
            'expression': {'op': 'power', 'base': {'op': 'x'}, 'exponent': 2},
        },
        'beats': [],
    }
    for i, (display, a, h) in enumerate([
        ('function', 0.5, 1), ('secant', 0.5, 1), ('limit', 0.5, 0.01),
        ('tangent', 0.5, 0), ('compare', 0.5, 0),
    ]):
        start = i * 540
        beat = {
            'startFrame': start, 'settleFrame': start + (60 if i else 0), 'cueFrame': start + 75,
            'a': a, 'h': h, 'display': display, 'narration': 'Synthetic smoke test utterance.',
            'camera': {'x': 0.5 if i in (2, 3) else 0, 'y': 1.4,
                       'width': 3.8 if i in (2, 3) else 5, 'height': 3.8 if i in (2, 3) else 5},
        }
        if display == 'compare':
            beat['reference'] = -1
        if i == 2:
            beat['caption'] = 'The finite interval is still nonzero.'
        plan['beats'].append(beat)
    (directory / 'plan.json').write_text(json.dumps(plan), encoding='utf-8')
    rate = 16_000
    with wave.open(str(directory / 'narration.wav'), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        for second in range(plan['durationSeconds']):
            pulse = second % 18 == 3
            samples = array('h', (round(1200 * math.sin(2 * math.pi * 330 * i / rate)) if pulse else 0
                                  for i in range(rate)))
            if sys.byteorder == 'big':
                samples.byteswap()
            audio.writeframesraw(samples.tobytes())
    return plan


if __name__ == '__main__':
    fixture(Path(sys.argv[1]))
