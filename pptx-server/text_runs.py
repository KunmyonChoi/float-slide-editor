"""HTML to python-pptx text runs converter — mirrors HtmlToTextRuns.js"""
from html.parser import HTMLParser
from pptx.util import Pt
from gradient import css_color_to_hex

BLOCK_TAGS = {'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'}
INLINE_TAGS = {'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'span', 'a'}


class _RunCollector(HTMLParser):
    def __init__(self, base_styles: dict):
        super().__init__()
        self.runs = []
        self.base = base_styles
        self._stack = [{}]

    def _ctx(self):
        merged = {}
        for frame in self._stack:
            merged.update(frame)
        return merged

    def handle_starttag(self, tag, attrs):
        ctx = {}
        if tag in ('b', 'strong'):
            ctx['bold'] = True
        if tag in ('i', 'em'):
            ctx['italic'] = True
        if tag == 'u':
            ctx['underline'] = True
        if tag in ('s', 'del', 'strike'):
            ctx['strike'] = True

        style = dict(attrs).get('style', '')
        if style:
            color = _extract_style(style, 'color')
            if color:
                ctx['color'] = color
            fs = _extract_style(style, 'font-size')
            if fs:
                ctx['fontSize'] = fs
            ff = _extract_style(style, 'font-family')
            if ff:
                ctx['fontFamily'] = ff
            fw = _extract_style(style, 'font-weight')
            if fw in ('bold', '700', '800', '900'):
                ctx['bold'] = True
            fst = _extract_style(style, 'font-style')
            if fst == 'italic':
                ctx['italic'] = True
            ls = _extract_style(style, 'letter-spacing')
            if ls:
                ctx['letterSpacing'] = ls

        if tag == 'br':
            self.runs.append({'text': '\n', 'opts': self._ctx()})
            return

        if tag in BLOCK_TAGS:
            if self.runs and self.runs[-1]['text'] != '\n':
                self.runs.append({'text': '\n', 'opts': self._ctx()})

        self._stack.append(ctx)

    def handle_endtag(self, tag):
        if tag == 'br':
            return
        if tag in BLOCK_TAGS:
            if self.runs and self.runs[-1]['text'] != '\n':
                self.runs.append({'text': '\n', 'opts': self._ctx()})
        if len(self._stack) > 1:
            self._stack.pop()

    def handle_data(self, data):
        if data:
            self.runs.append({'text': data, 'opts': self._ctx()})


def _extract_style(style: str, prop: str) -> str | None:
    import re
    m = re.search(rf'(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)', style, re.I)
    return m.group(1).strip() if m else None


def _px_to_pt(size) -> float | None:
    if isinstance(size, (int, float)):
        return round(size * 0.75)
    try:
        return round(float(size.replace('px', '')) * 0.75)
    except (ValueError, AttributeError):
        return None


def _clean_font(ff: str) -> str | None:
    if not ff:
        return None
    return ff.split(',')[0].strip().strip("'\"")


def html_to_text_runs(html: str, base_styles: dict) -> list:
    if not html:
        return [{'text': '', 'opts': {}}]

    collector = _RunCollector(base_styles)
    collector.feed(html)

    if not collector.runs:
        return [{'text': '', 'opts': {}}]

    result = []
    for run in collector.runs:
        opts = {}
        ctx = run['opts']

        effective_weight = base_styles.get('_effectiveWeight', 400)
        if ctx.get('bold') or effective_weight >= 700:
            opts['bold'] = True
        if ctx.get('italic') or base_styles.get('fontStyle') == 'italic':
            opts['italic'] = True
        if ctx.get('underline'):
            opts['underline'] = True
        if ctx.get('strike'):
            opts['strike'] = True

        color = ctx.get('color') or base_styles.get('color')
        if color:
            opts['color'] = css_color_to_hex(color)

        font_size = ctx.get('fontSize') or base_styles.get('fontSize')
        if font_size:
            opts['fontSize'] = _px_to_pt(font_size)

        font_family = ctx.get('fontFamily') or base_styles.get('fontFamily')
        if font_family:
            opts['fontFace'] = _clean_font(font_family)

        # Pass effective weight for font name mapping in exporter
        opts['_weight'] = effective_weight

        letter_spacing = ctx.get('letterSpacing') or base_styles.get('letterSpacing')
        if letter_spacing:
            ls_val = _px_to_pt(letter_spacing)
            if ls_val is not None:
                opts['letterSpacing'] = ls_val

        result.append({'text': run['text'], 'opts': opts})

    return result
