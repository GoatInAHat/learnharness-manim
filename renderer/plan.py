"""Shared bounds, fixed arithmetic, and the JSON input boundary."""

import json
import math
import re
import unicodedata
from pathlib import Path


class PlanError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PlanError(message)


def fields(value, needed, optional=()):
    require(isinstance(value, dict) and set(needed) <= value.keys() <= set(needed) | set(optional),
            'Unexpected or missing lesson fields.')


def number(value, low, high):
    require(type(value) in (int, float) and low <= value <= high, 'Number is outside its allowed range.')
    return float(value)


def line(value, limit):
    require(isinstance(value, str) and 0 < len(value) <= limit and value.strip()
            and not re.search(r'</?[a-z!]', value, re.IGNORECASE | re.ASCII)
            and all(unicodedata.category(c) not in {'Cc', 'Cf', 'Cs'} for c in value),
            'Labels, captions and narration must be bounded plain text.')
    return value


def array(value, low, high):
    require(isinstance(value, list) and low <= len(value) <= high, 'List length is outside its allowed range.')
    return value


def sigmoid(x):
    e = math.exp(-abs(x))
    return 1 / (1 + e) if x >= 0 else e / (1 + e)


def value_and_derivative(node, x):
    op, *args = node
    if op == 'num':
        return args[0], 0.0
    if op == 'var':
        return x, 1.0
    if op == 'piece':
        at, before, after = args
        if x < at:
            return value_and_derivative(before, x)
        right = value_and_derivative(after, x)
        if x == at:
            left = value_and_derivative(before, x)
            require(right == left and all(map(math.isfinite, right)),
                    'Piecewise value and first derivative must match at the breakpoint.')
        return right
    left, dl = value_and_derivative(args[0], x)
    if op == 'smooth':
        factor = args[1]
        exponent = factor * (left - 0.5)
        first = sigmoid(-factor / 2)
        scale = 1 - 2 * first
        tail = sigmoid(-abs(exponent))
        normalized = left if left in (0, 1) else (sigmoid(exponent) - first) / scale
        return normalized, factor * (tail * (1 - tail)) * dl / scale
    if op == 'pow':
        exponent = args[1]
        return left ** exponent, exponent * left ** (exponent - 1) * dl
    right, dr = value_and_derivative(args[1], x)
    if op == 'add':
        return left + right, dl + dr
    if op == 'sub':
        return left - right, dl - dr
    if op == 'mul':
        return left * right, dl * right + left * dr
    raise PlanError('Unknown compiled arithmetic operator.')


def small_rise(node, a, h):
    """Use the same finite-difference identities as the shared RAEA compiler."""
    if h == 0:
        return 0.0
    b = a + h
    op, *args = node
    if op == 'num':
        return 0.0
    if op == 'var':
        return h
    if op == 'piece':
        at, before, after = args
        first, second = (before, after) if a < at else (after, before)
        to_join = at - a
        if (a < at and h <= to_join) or (a >= at and h >= to_join):
            return small_rise(first, a, h)
        # Preserve the signed run when a + h has rounded near the join.
        return small_rise(first, a, to_join) + small_rise(second, at, h - to_join)
    rise = small_rise(args[0], a, h)
    if op == 'add':
        return rise + small_rise(args[1], a, h)
    if op == 'sub':
        return rise - small_rise(args[1], a, h)
    if op == 'mul':
        return (rise * value_and_derivative(args[1], a)[0]
                + value_and_derivative(args[0], b)[0] * small_rise(args[1], a, h))
    left = value_and_derivative(args[0], a)[0]
    if op == 'pow':
        right = value_and_derivative(args[0], b)[0]
        exponent = args[1]
        return rise * sum(left ** i * right ** (exponent - 1 - i) for i in range(exponent))
    if op == 'smooth':
        k = args[1]
        z, dz = k * (left - 0.5), k * rise
        difference = (sigmoid(z) * sigmoid(-z - dz) * math.expm1(dz) if abs(dz) < 0.5
                      else sigmoid(z + dz) - sigmoid(z))
        return difference / (1 - 2 * sigmoid(-k / 2))
    raise PlanError('Unknown compiled arithmetic operator.')


def load(path, validate, limit):
    def unique(pairs):
        result = dict(pairs)
        require(len(result) == len(pairs), 'Lesson JSON contains a repeated key.')
        return result

    try:
        with Path(path).open('rb') as source:
            data = source.read(limit + 1)
        require(0 < len(data) <= limit, 'Lesson JSON is empty or too large.')
        return validate(json.loads(data.decode('utf-8'), object_pairs_hook=unique))
    except (ArithmeticError, RecursionError, UnicodeError, json.JSONDecodeError) as error:
        raise PlanError('Invalid JSON or undefined curve arithmetic.') from error
