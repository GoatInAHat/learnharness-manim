"""Shared bounds, fixed arithmetic, and the JSON input boundary."""

import json
import math
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
    require(isinstance(value, str) and 0 < len(value) <= limit and all(c.isprintable() for c in value),
            'A label or caption is empty, too long, or contains a control character.')
    return value


def array(value, low, high):
    require(isinstance(value, list) and low <= len(value) <= high, 'List length is outside its allowed range.')
    return value


def value_and_derivative(node, x):
    op, *args = node
    if op == 'num':
        return args[0], 0.0
    if op == 'var':
        return x, 1.0
    if op == 'piece':
        (end, before), = args[0]
        return value_and_derivative(before if x < end else args[1], x)
    left, dl = value_and_derivative(args[0], x)
    if op == 'smooth':
        factor = args[1]
        exponent = factor * (left - 0.5)
        if exponent >= 0:
            sigmoid = 1 / (1 + math.exp(-exponent))
        else:
            e = math.exp(exponent)
            sigmoid = e / (1 + e)
        first = 1 / (1 + math.exp(factor / 2))
        scale = 1 - 2 * first
        return (sigmoid - first) / scale, factor * sigmoid * (1 - sigmoid) * dl / scale
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


def slope_at(node, x, h):
    y, derivative = value_and_derivative(node, x)
    if h == 0:
        return 'tangent', y, y, derivative
    next_y = value_and_derivative(node, x + h)[0]
    return 'secant', y, next_y, (next_y - y) / h


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
