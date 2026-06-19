"""CSS gradient parser — mirrors GradientParser.js"""
import math
import re
from typing import List, Tuple

_NAMED_COLORS = {
    'white': (255, 255, 255), 'black': (0, 0, 0), 'red': (255, 0, 0),
    'green': (0, 128, 0), 'blue': (0, 0, 255), 'gray': (128, 128, 128),
    'grey': (128, 128, 128), 'silver': (192, 192, 192), 'yellow': (255, 255, 0),
    'orange': (255, 165, 0),
}


def _oklab_to_srgb(L: float, a: float, b: float) -> Tuple[int, int, int]:
    """OKLab → sRGB(0~255)."""
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def enc(x: float) -> int:
        x = max(0.0, min(1.0, x))
        x = 1.055 * (x ** (1 / 2.4)) - 0.055 if x > 0.0031308 else 12.92 * x
        return max(0, min(255, round(x * 255)))

    return enc(r), enc(g), enc(bl)


def _parse_ok(color: str):
    """oklch()/oklab() → (r,g,b,alpha) | None. Tailwind v4 등 modern 색공간."""
    m = re.match(r'(oklch|oklab)\(\s*([^)]+)\)', color, re.I)
    if not m:
        return None
    func = m.group(1).lower()
    body, _, alpha_s = m.group(2).partition('/')
    toks = body.replace(',', ' ').split()
    if len(toks) < 3:
        return None

    def num(t):  # %는 비율(0..1), deg/단위 제거
        t = t.strip().lower()
        if t.endswith('%'):
            return float(t[:-1]) / 100.0
        return float(re.sub(r'[a-z]+$', '', t))

    try:
        L = num(toks[0])
        if func == 'oklch':
            C = num(toks[1])
            H = num(toks[2])
            a = C * math.cos(math.radians(H))
            b = C * math.sin(math.radians(H))
        else:
            a = num(toks[1])
            b = num(toks[2])
        r, g, bl = _oklab_to_srgb(L, a, b)
        alpha = num(alpha_s) if alpha_s.strip() else 1.0
        return r, g, bl, alpha
    except (ValueError, IndexError):
        return None


def parse_gradient(css: str) -> dict:
    if not css or css == 'none':
        return {'type': 'none', 'angle': 180, 'stops': []}

    m = re.match(r'^linear-gradient\((.+)\)$', css)
    if m:
        return _parse_linear(m.group(1))

    m = re.match(r'^radial-gradient\((.+)\)$', css)
    if m:
        return _parse_radial(m.group(1))

    return {'type': 'none', 'angle': 180, 'stops': []}


def _parse_linear(inner: str) -> dict:
    angle = 180
    stops_str = inner

    m = re.match(r'^([\d.]+)deg\s*,\s*', inner)
    if m:
        angle = float(m.group(1))
        stops_str = inner[m.end():]
    else:
        m = re.match(r'^to\s+([\w\s]+)\s*,\s*', inner)
        if m:
            angle = _direction_to_angle(m.group(1).strip())
            stops_str = inner[m.end():]

    return {'type': 'linear', 'angle': angle, 'stops': _parse_stops(stops_str)}


def _parse_radial(inner: str) -> dict:
    stops_str = inner
    m = re.match(r'^(?:circle|ellipse)?\s*(?:at\s+[\w\s%]+)?\s*,\s*', inner)
    if m:
        stops_str = inner[m.end():]
    return {'type': 'radial', 'angle': 0, 'stops': _parse_stops(stops_str)}


def _split_stops(s: str) -> List[str]:
    parts = []
    depth = 0
    current = ''
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(current)
            current = ''
        else:
            current += ch
    if current.strip():
        parts.append(current)
    return parts


def _parse_stops(s: str) -> List[dict]:
    stops = []
    parts = _split_stops(s)
    for part in parts:
        trimmed = part.strip()
        if not trimmed:
            continue
        m = re.search(r'\s+([\d.]+)%\s*$', trimmed)
        if m:
            color = trimmed[:m.start()].strip()
            stops.append({'color': color, 'position': float(m.group(1))})
        else:
            stops.append({'color': trimmed, 'position': -1})

    if stops:
        if stops[0]['position'] == -1:
            stops[0]['position'] = 0
        if len(stops) > 1 and stops[-1]['position'] == -1:
            stops[-1]['position'] = 100
        for i in range(1, len(stops) - 1):
            if stops[i]['position'] == -1:
                prev = stops[i - 1]['position']
                nxt = 100
                for j in range(i + 1, len(stops)):
                    if stops[j]['position'] != -1:
                        nxt = stops[j]['position']
                        break
                stops[i]['position'] = prev + (nxt - prev) / (len(stops) - i)
    return stops


def _direction_to_angle(d: str) -> float:
    mapping = {
        'top': 0, 'right': 90, 'bottom': 180, 'left': 270,
        'top right': 45, 'right top': 45,
        'bottom right': 135, 'right bottom': 135,
        'bottom left': 225, 'left bottom': 225,
        'top left': 315, 'left top': 315,
    }
    return mapping.get(d, 180)


def css_color_to_rgba(color: str) -> Tuple[int, int, int, float] | None:
    if not color:
        return None
    color = color.strip()
    if color.startswith('#'):
        h = color[1:]
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        if len(h) == 8:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255
        if len(h) >= 6:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0
    m = re.match(r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)', color)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3)), float(m.group(4))
    m = re.match(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', color)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3)), 1.0
    # OKLCH/OKLab (Tailwind v4 등 modern 색공간) — 미지원 시 색이 기본값으로 잘못 변환됨
    if color[:4].lower() in ('oklc', 'okla'):
        ok = _parse_ok(color)
        if ok:
            return ok
    low = color.lower()
    if low == 'transparent':
        return 0, 0, 0, 0.0
    if low in _NAMED_COLORS:
        r, g, b = _NAMED_COLORS[low]
        return r, g, b, 1.0
    return None


def css_color_to_rgb(color: str) -> Tuple[int, int, int] | None:
    rgba = css_color_to_rgba(color)
    if rgba:
        return rgba[0], rgba[1], rgba[2]
    return None


def css_color_to_hex(color: str) -> str | None:
    rgb = css_color_to_rgb(color)
    if rgb:
        return f'{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'
    return None
