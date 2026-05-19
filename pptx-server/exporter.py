"""JSON slide data -> python-pptx PPTX bytes"""
import base64
import io
import math
import re
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn

from gradient import parse_gradient, css_color_to_rgb, css_color_to_rgba, css_color_to_hex
from text_runs import html_to_text_runs

PX_TO_INCH = 1 / 96
PX_TO_EMU = 914400 / 96  # 9525


def build_pptx(pages: dict, default_canvas_size: dict) -> bytes:
    prs = Presentation()

    first_page = next(iter(pages.values()), None)
    cs = (first_page or {}).get('canvasSize', default_canvas_size) or default_canvas_size
    slide_w = cs['w'] * PX_TO_EMU
    slide_h = cs['h'] * PX_TO_EMU
    prs.slide_width = int(slide_w)
    prs.slide_height = int(slide_h)

    sorted_keys = sorted(pages.keys(), key=_page_sort_key)

    for key in sorted_keys:
        page = pages[key]
        page_cs = page.get('canvasSize') or cs
        layout = prs.slide_layouts[6]  # blank layout
        slide = prs.slides.add_slide(layout)
        elements = sorted(page.get('elements', []), key=lambda e: e.get('zIndex', 0))

        for el in elements:
            try:
                _add_element(slide, el, page_cs)
            except Exception as e:
                print(f'PPT export: element {el.get("id")} skipped: {e}')

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _page_sort_key(key: str):
    parts = key.split('-')
    return tuple(int(p) for p in parts)


def _px(v):
    return int(v * PX_TO_EMU)


def _add_element(slide, el: dict, cs: dict):
    x = _px(el.get('x', 0))
    y = _px(el.get('y', 0))
    w = _px(el.get('width', 0))
    h = _px(el.get('height', 0))
    rotation = el.get('rotation', 0)
    s = el.get('styles', {})
    el_type = el.get('type', '')

    if el_type == 'text':
        # 원본 크기를 그대로 유지 — normAutofit이 넘치는 텍스트를 자동 축소
        _add_text(slide, el, x, y, w, h, rotation)
    elif el_type == 'image':
        _add_image(slide, el, x, y, w, h, rotation)
    elif el_type == 'shape':
        _add_shape(slide, el, x, y, w, h, rotation, cs)
    elif el_type == 'svg':
        _add_svg(slide, el, x, y, w, h, rotation)
    elif el_type == 'video':
        _add_video_placeholder(slide, el, x, y, w, h, rotation)


def _add_text(slide, el: dict, x, y, w, h, rotation):
    s = el.get('styles', {})
    content = el.get('content', '')

    # gradient text detection
    is_gradient_text = (
        s.get('webkitBackgroundClip') == 'text' or s.get('backgroundClip') == 'text'
    ) and s.get('backgroundImage', 'none') != 'none'

    effective_color = s.get('color', '')
    if is_gradient_text:
        grad = parse_gradient(s.get('backgroundImage', ''))
        if grad['stops']:
            effective_color = grad['stops'][0]['color']
    if s.get('webkitTextFillColor') in ('transparent', 'rgba(0, 0, 0, 0)'):
        if not is_gradient_text:
            effective_color = s.get('color', '')

    txbox = slide.shapes.add_textbox(x, y, w, h)
    if rotation:
        txbox.rotation = rotation

    tf = txbox.text_frame
    tf.word_wrap = True

    # Detect circular container (for forced centering)
    br = s.get('borderRadius', '0px')
    is_circle = _is_ellipse(br, w, h) if br and br not in ('0px', '') else False

    # vertical alignment
    has_bg = s.get('backgroundColor', '') not in ('', 'rgba(0, 0, 0, 0)', 'transparent')
    if is_circle:
        # 원형 컨테이너: 항상 수평/수직 중앙 정렬
        _set_anchor(txbox, 'middle')
    elif el.get('merged') or has_bg:
        ai = s.get('alignItems', 'center') if s.get('isFlex') else 'center'
        if ai == 'center':
            _set_anchor(txbox, 'middle')
        elif ai == 'flex-end':
            _set_anchor(txbox, 'bottom')
    else:
        _set_anchor(txbox, 'top')

    # margin (internal padding) - default to 0
    _set_margins(txbox, s.get('padding', '0px'))

    # auto-fit: shrink text to fit if overflow (normAutofit)
    body_props = tf._txBody.find(qn('a:bodyPr'))
    if body_props is not None:
        # Remove default spAutoFit (shape resizes to text)
        for auto_tag in ('a:spAutoFit', 'a:noAutofit', 'a:normAutofit'):
            existing = body_props.find(qn(auto_tag))
            if existing is not None:
                body_props.remove(existing)
        # normAutofit: shrinks font to fit when text overflows, keeps original size when it fits
        norm_auto = body_props.makeelement(qn('a:normAutofit'), {'fontScale': '100000', 'lnSpcReduction': '0'})
        body_props.append(norm_auto)

    # background fill
    bg_result = _parse_solid_fill(s)
    bg_image = s.get('backgroundImage', 'none')
    has_bg_gradient = bg_image != 'none' and not is_gradient_text

    if bg_result:
        bg_rgb, bg_alpha = bg_result
        txbox.fill.solid()
        txbox.fill.fore_color.rgb = bg_rgb
        if bg_alpha < 1.0:
            _set_fill_transparency(txbox, int(bg_alpha * 100000))
    elif has_bg_gradient:
        grad = parse_gradient(bg_image)
        if grad['type'] != 'none' and len(grad['stops']) >= 2:
            _apply_gradient_fill_to_shape(txbox, grad)
        else:
            txbox.fill.background()
    else:
        txbox.fill.background()

    # border (uniform)
    _apply_border(txbox, s)
    # partial borders (1-2 sides) as separate line shapes
    _add_partial_borders(slide, s, x, y, w, h)

    # borderRadius (TextBox도 roundRect 적용)
    br = s.get('borderRadius', '0px')
    if br and br not in ('0px', ''):
        if _is_ellipse(br, w, h):
            sp_pr = txbox._element.spPr
            prst_geom = sp_pr.find(qn('a:prstGeom'))
            if prst_geom is not None:
                prst_geom.set('prst', 'ellipse')
        else:
            _apply_round_corners(txbox, br)

    # opacity
    _apply_opacity(txbox, s)

    # build text runs
    base_styles = {**s, 'color': effective_color}
    if el.get('isRich') and content:
        runs_data = html_to_text_runs(content, base_styles)
    else:
        opts = {}
        if effective_color:
            opts['color'] = css_color_to_hex(effective_color)
        fs = s.get('fontSize')
        if fs:
            opts['fontSize'] = round(float(str(fs).replace('px', '')) * 0.75)
        ff = s.get('fontFamily')
        if ff:
            opts['fontFace'] = ff.split(',')[0].strip().strip("'\"")
        fw = s.get('fontWeight', '')
        if fw == 'bold' or (fw.isdigit() and int(fw) >= 700):
            opts['bold'] = True
        if s.get('fontStyle') == 'italic':
            opts['italic'] = True
        runs_data = [{'text': content, 'opts': opts}]

    # text alignment
    if is_circle:
        align = PP_ALIGN.CENTER
    elif s.get('isFlex') and s.get('justifyContent') == 'center':
        align = PP_ALIGN.CENTER
    else:
        align_map = {'center': PP_ALIGN.CENTER, 'right': PP_ALIGN.RIGHT, 'left': PP_ALIGN.LEFT}
        align = align_map.get(s.get('textAlign', ''), PP_ALIGN.LEFT)

    # line spacing
    line_spacing = None
    lh = s.get('lineHeight')
    if lh:
        try:
            lh_val = float(lh)
            fs_val = float(str(s.get('fontSize', '16')).replace('px', ''))
            line_spacing = Pt(round(lh_val * fs_val * 0.75))
        except (ValueError, TypeError):
            pass

    _populate_text_frame(tf, runs_data, align, line_spacing)


def _populate_text_frame(tf, runs_data: list, align, line_spacing):
    # split runs by newlines into paragraphs
    paragraphs = [[]]
    for run in runs_data:
        text = run['text']
        if '\n' in text:
            parts = text.split('\n')
            for i, part in enumerate(parts):
                if i > 0:
                    paragraphs.append([])
                if part:
                    paragraphs[-1].append({'text': part, 'opts': run['opts']})
        else:
            paragraphs[-1].append(run)

    for pi, para_runs in enumerate(paragraphs):
        if pi == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.alignment = align
        if line_spacing:
            p.line_spacing = line_spacing

        if not para_runs:
            continue

        for ri, run_data in enumerate(para_runs):
            if pi == 0 and ri == 0:
                r = p.runs[0] if p.runs else p.add_run()
            else:
                r = p.add_run()
            r.text = run_data['text']
            opts = run_data['opts']
            if opts.get('bold'):
                r.font.bold = True
            if opts.get('italic'):
                r.font.italic = True
            if opts.get('underline'):
                r.font.underline = True
            color_hex = opts.get('color')
            if color_hex:
                r.font.color.rgb = RGBColor.from_string(color_hex)
            font_size = opts.get('fontSize')
            if font_size:
                r.font.size = Pt(font_size)
            font_face = opts.get('fontFace')
            if font_face:
                r.font.name = font_face
            # letter-spacing → OOXML spc (in 1/100 pt)
            letter_spacing = opts.get('letterSpacing')
            if letter_spacing is not None:
                rPr = r._r.get_or_add_rPr()
                rPr.set('spc', str(int(letter_spacing * 100)))


def _add_image(slide, el: dict, x, y, w, h, rotation):
    content = el.get('content', '')
    s = el.get('styles', {})

    if content.startswith('data:'):
        m = re.match(r'data:[^;]+;base64,(.+)', content)
        if not m:
            return
        img_bytes = base64.b64decode(m.group(1))
    else:
        return  # external URLs not supported server-side

    img_stream = io.BytesIO(img_bytes)
    pic = slide.shapes.add_picture(img_stream, x, y, w, h)
    if rotation:
        pic.rotation = rotation


def _add_shape(slide, el: dict, x, y, w, h, rotation, cs: dict):
    s = el.get('styles', {})

    bg_image = s.get('backgroundImage', 'none')
    has_gradient = bg_image != 'none'
    # Skip subtle decorative radial gradients (low-alpha fades to transparent)
    if has_gradient and _is_subtle_gradient(bg_image):
        has_gradient = False
    fill_result = _parse_solid_fill(s)
    border_data = _parse_border_data(s)
    partial_borders = _parse_partial_borders(s)
    shadow_data = s.get('boxShadow', '')

    has_any_border = border_data or (partial_borders and not border_data)
    if not has_gradient and not fill_result and not has_any_border and shadow_data in ('', 'none'):
        return

    shape = slide.shapes.add_shape(1, x, y, w, h)  # MSO_SHAPE.RECTANGLE = 1
    if rotation:
        shape.rotation = rotation

    # border radius
    br = s.get('borderRadius', '0px')
    if _is_ellipse(br, w, h):
        sp_pr = shape._element.spPr
        prst_geom = sp_pr.find(qn('a:prstGeom'))
        if prst_geom is not None:
            prst_geom.set('prst', 'ellipse')
    elif br and br != '0px':
        _apply_round_corners(shape, br)

    # fill
    if has_gradient:
        grad = parse_gradient(s.get('backgroundImage', ''))
        if grad['type'] != 'none' and len(grad['stops']) >= 2:
            _apply_gradient_fill_to_shape(shape, grad)
        elif fill_result:
            fill_rgb, fill_alpha = fill_result
            shape.fill.solid()
            shape.fill.fore_color.rgb = fill_rgb
            if fill_alpha < 1.0:
                _set_fill_transparency(shape, int(fill_alpha * 100000))
        else:
            shape.fill.background()
    elif fill_result:
        fill_rgb, fill_alpha = fill_result
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill_rgb
        if fill_alpha < 1.0:
            _set_fill_transparency(shape, int(fill_alpha * 100000))
    else:
        shape.fill.background()

    # border (uniform)
    _apply_border(shape, s)
    # partial borders (1-2 sides) as separate line shapes
    _add_partial_borders(slide, s, x, y, w, h)

    # opacity
    _apply_opacity(shape, s)


def _add_svg(slide, el: dict, x, y, w, h, rotation):
    content = el.get('content', '')
    if not content:
        return
    # Convert SVG to PNG via cairosvg, then insert as image
    try:
        import cairosvg
        svg_bytes = content.encode('utf-8')
        # Calculate output size in pixels for good quality
        w_px = max(int(w / PX_TO_EMU * 2), 64)  # 2x for retina quality
        h_px = max(int(h / PX_TO_EMU * 2), 64)
        png_bytes = cairosvg.svg2png(bytestring=svg_bytes, output_width=w_px, output_height=h_px)
        img_stream = io.BytesIO(png_bytes)
        pic = slide.shapes.add_picture(img_stream, x, y, w, h)
        if rotation:
            pic.rotation = rotation
    except Exception as e:
        print(f'SVG export failed: {e}')
        # Fallback: try direct SVG insert
        try:
            img_stream = io.BytesIO(content.encode('utf-8'))
            pic = slide.shapes.add_picture(img_stream, x, y, w, h)
            if rotation:
                pic.rotation = rotation
        except Exception:
            pass


def _add_video_placeholder(slide, el: dict, x, y, w, h, rotation):
    txbox = slide.shapes.add_textbox(x, y, w, h)
    if rotation:
        txbox.rotation = rotation
    txbox.fill.solid()
    txbox.fill.fore_color.rgb = RGBColor(0x1E, 0x29, 0x3B)
    tf = txbox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = f'\u25b6 video\n{el.get("content", "")}'
    r.font.size = Pt(10)
    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)


# ── Helpers ──

def _is_subtle_gradient(bg_image: str) -> bool:
    """Skip decorative radial gradients with very low alpha (glows, subtle overlays)."""
    if not bg_image or bg_image == 'none':
        return False
    if not bg_image.startswith('radial-gradient'):
        return False
    # Must fade to transparent
    if ' 0)' not in bg_image:
        return False
    # Extract all rgba alpha values
    alphas = re.findall(r'rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)', bg_image)
    if not alphas:
        return False
    max_alpha = max(float(a) for a in alphas)
    return max_alpha < 0.25


def _is_ellipse(border_radius: str, w_emu: int, h_emu: int) -> bool:
    """Detect if borderRadius creates a true circle/ellipse shape.
    Only returns True for roughly square shapes (aspect ratio < 1.5:1)
    where radius >= 45% of the min dimension.
    Wide rounded rectangles (pills/capsules) should use roundRect instead."""
    if not border_radius:
        return False
    br = border_radius.strip()

    # Check aspect ratio first: only square-ish shapes can be ellipses
    # Wide/tall rectangles with borderRadius:50% are pills, not ellipses
    w_px = w_emu / PX_TO_EMU if w_emu else 0
    h_px = h_emu / PX_TO_EMU if h_emu else 0
    if w_px < 1 or h_px < 1:
        return False
    aspect = max(w_px, h_px) / min(w_px, h_px)
    if aspect > 1.5:
        return False  # too elongated → pill shape, use roundRect

    if br in ('50%', '9999px'):
        return True

    # Parse all radius values
    parts = br.split()
    px_values = []
    for p in parts:
        try:
            px_values.append(float(p.replace('px', '').replace('%', '')))
        except (ValueError, TypeError):
            continue
    if not px_values:
        return False
    min_radius_px = min(px_values)
    min_dim_px = min(w_px, h_px)
    # If radius >= ~45% of min dimension, treat as ellipse
    return min_dim_px > 0 and min_radius_px >= min_dim_px * 0.45

def _parse_solid_fill(s: dict):
    """Returns (RGBColor, alpha) or None. alpha < 0.05 → transparent."""
    bg = s.get('backgroundColor', '')
    if bg and bg not in ('rgba(0, 0, 0, 0)', 'transparent'):
        rgba = css_color_to_rgba(bg)
        if rgba:
            r, g, b, a = rgba
            if a < 0.05:
                return None
            return RGBColor(r, g, b), a
    return None


def _parse_border_one(border_str: str) -> dict | None:
    m = re.match(r'([\d.]+)px\s+\w+\s+(.+)', border_str)
    if not m:
        return None
    color_str = m.group(2).strip()
    rgba = css_color_to_rgba(color_str)
    if rgba and rgba[3] < 0.05:
        return None
    return {
        'pt': float(m.group(1)),
        'color': css_color_to_hex(color_str) or '000000',
        'alpha': rgba[3] if rgba else 1.0,
    }


def _parse_border_data(s: dict) -> dict | None:
    """Returns uniform border data for shape.line, or None."""
    side_results = {}
    for key in ('borderTop', 'borderRight', 'borderBottom', 'borderLeft'):
        v = s.get(key, '')
        if v and not v.startswith('0px'):
            parsed = _parse_border_one(v)
            if parsed:
                side_results[key] = parsed

    if side_results:
        if len(side_results) >= 3:
            best = max(side_results.values(), key=lambda x: x['pt'])
            return best
        else:
            # 1-2 sides: can't use uniform shape border → handled by _add_partial_borders
            return None

    border_str = s.get('border', '')
    if not border_str or border_str.startswith('0px') or border_str == 'none':
        return None
    return _parse_border_one(border_str)


def _parse_partial_borders(s: dict) -> dict:
    """Returns {side_name: border_data} for sides that have visible borders."""
    side_results = {}
    for key in ('borderTop', 'borderRight', 'borderBottom', 'borderLeft'):
        v = s.get(key, '')
        if v and not v.startswith('0px'):
            parsed = _parse_border_one(v)
            if parsed:
                side_results[key] = parsed
    return side_results


def _apply_gradient_fill_to_shape(shape, grad: dict):
    """Apply CSS gradient to a shape via direct spPr XML manipulation."""
    sp_pr = shape._element.spPr

    # Remove any existing fill elements
    for tag in ('a:solidFill', 'a:noFill', 'a:gradFill', 'a:pattFill'):
        existing = sp_pr.find(qn(tag))
        if existing is not None:
            sp_pr.remove(existing)

    grad_fill = sp_pr.makeelement(qn('a:gradFill'), {})
    gs_lst = grad_fill.makeelement(qn('a:gsLst'), {})

    for stop in grad['stops']:
        gs = gs_lst.makeelement(qn('a:gs'), {'pos': str(int(stop['position'] * 1000))})
        rgb = css_color_to_rgb(stop['color'])
        if rgb:
            srgb_clr = gs.makeelement(qn('a:srgbClr'), {'val': f'{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}'})
            gs.append(srgb_clr)
            gs_lst.append(gs)

    grad_fill.append(gs_lst)

    if grad['type'] == 'linear':
        ooxml_angle = int(((grad['angle'] + 270) % 360) * 60000)
        lin = grad_fill.makeelement(qn('a:lin'), {'ang': str(ooxml_angle), 'scaled': '0'})
        grad_fill.append(lin)

    # Insert after prstGeom
    prst_geom = sp_pr.find(qn('a:prstGeom'))
    if prst_geom is not None:
        prst_geom.addnext(grad_fill)
    else:
        sp_pr.append(grad_fill)


def _set_fill_transparency(shape, opacity_pct):
    """Set fill opacity via XML. opacity_pct: 100000=fully opaque, 0=fully transparent."""
    sp_pr = shape._element.spPr
    solid_fill = sp_pr.find(qn('a:solidFill'))
    if solid_fill is not None:
        srgb = solid_fill.find(qn('a:srgbClr'))
        if srgb is not None:
            for existing in srgb.findall(qn('a:alpha')):
                srgb.remove(existing)
            alpha_el = srgb.makeelement(qn('a:alpha'), {'val': str(opacity_pct)})
            srgb.append(alpha_el)


def _apply_border(shape, s: dict):
    border_data = _parse_border_data(s)
    if border_data:
        ln = shape.line
        ln.width = Pt(border_data['pt'])
        rgb = css_color_to_rgb(f'#{border_data["color"]}')
        if rgb:
            ln.color.rgb = RGBColor(*rgb)
        alpha = border_data.get('alpha', 1.0)
        if alpha < 1.0:
            ln_elem = shape._element.spPr.find(qn('a:ln'))
            if ln_elem is not None:
                solid = ln_elem.find(qn('a:solidFill'))
                if solid is not None:
                    srgb = solid.find(qn('a:srgbClr'))
                    if srgb is not None:
                        alpha_el = srgb.makeelement(qn('a:alpha'), {'val': str(int(alpha * 100000))})
                        srgb.append(alpha_el)
    else:
        shape.line.fill.background()


def _add_partial_borders(slide, s: dict, x, y, w, h):
    """Add individual line shapes for sides that have borders (1-2 sides only)."""
    partial = _parse_partial_borders(s)
    uniform = _parse_border_data(s)
    if uniform or not partial:
        return  # uniform border already handled by _apply_border, or no borders

    for side, data in partial.items():
        pt_emu = int(data['pt'] * 12700)  # pt to EMU
        rgb = css_color_to_rgb(f'#{data["color"]}')
        if not rgb:
            continue

        # Calculate line endpoints based on side
        if side == 'borderTop':
            x1, y1, x2, y2 = x, y, x + w, y
        elif side == 'borderBottom':
            x1, y1, x2, y2 = x, y + h, x + w, y + h
        elif side == 'borderLeft':
            x1, y1, x2, y2 = x, y, x, y + h
        elif side == 'borderRight':
            x1, y1, x2, y2 = x + w, y, x + w, y + h
        else:
            continue

        connector = slide.shapes.add_connector(1, x1, y1, x2, y2)  # MSO_CONNECTOR.STRAIGHT = 1
        connector.line.width = pt_emu
        connector.line.color.rgb = RGBColor(*rgb)

        alpha = data.get('alpha', 1.0)
        if alpha < 1.0:
            ln_elem = connector._element.find(qn('a:ln'))
            if ln_elem is None:
                sp_pr = connector._element.spPr
                if sp_pr is not None:
                    ln_elem = sp_pr.find(qn('a:ln'))
            if ln_elem is not None:
                solid = ln_elem.find(qn('a:solidFill'))
                if solid is not None:
                    srgb = solid.find(qn('a:srgbClr'))
                    if srgb is not None:
                        alpha_el = srgb.makeelement(qn('a:alpha'), {'val': str(int(alpha * 100000))})
                        srgb.append(alpha_el)


def _apply_opacity(shape, s: dict):
    opacity = s.get('opacity', '1')
    if opacity and opacity != '1':
        try:
            val = float(opacity)
            if val < 1:
                # Set transparency via XML (not directly supported in python-pptx API)
                sp = shape._element
                sp_pr = sp.find(qn('p:spPr'))
                if sp_pr is None:
                    sp_pr = sp.find(qn('xdr:spPr'))
                # Opacity not trivially supported - skip for now
        except (ValueError, TypeError):
            pass


def _apply_round_corners(shape, border_radius: str):
    try:
        # Parse multi-value borderRadius: "8px 8px 0px 0px" or single "8px"
        parts = border_radius.strip().split()
        px_values = []
        for part in parts:
            clean = part.replace('px', '').replace('%', '').replace(',', '')
            try:
                px_values.append(float(clean))
            except ValueError:
                continue

        if not px_values:
            return

        # Use max corner radius for roundRect (OOXML only supports uniform rounding)
        px = max(px_values)
        if px < 1:
            return

        is_percent = '%' in border_radius
        if is_percent:
            min_dim = min(shape.width, shape.height)
            emu = int(min_dim * px / 100)
        else:
            emu = int(px * PX_TO_EMU)

        sp_pr = shape._element.spPr
        prst_geom = sp_pr.find(qn('a:prstGeom'))
        if prst_geom is not None:
            prst_geom.set('prst', 'roundRect')
            av_lst = prst_geom.find(qn('a:avLst'))
            if av_lst is None:
                av_lst = prst_geom.makeelement(qn('a:avLst'), {})
                prst_geom.append(av_lst)
            else:
                for child in list(av_lst):
                    av_lst.remove(child)
            min_dim = min(shape.width, shape.height)
            if min_dim > 0:
                adj_val = min(int((emu / min_dim) * 50000), 50000)
                gd = av_lst.makeelement(qn('a:gd'), {'name': 'adj', 'fmla': f'val {adj_val}'})
                av_lst.append(gd)
    except (ValueError, TypeError):
        pass


def _set_anchor(txbox, anchor: str):
    body_props = txbox.text_frame._txBody.find(qn('a:bodyPr'))
    if body_props is not None:
        mapping = {'top': 't', 'middle': 'ctr', 'bottom': 'b'}
        body_props.set('anchor', mapping.get(anchor, 't'))


def _set_margins(txbox, padding: str):
    body_props = txbox.text_frame._txBody.find(qn('a:bodyPr'))
    if body_props is None:
        return

    parts = padding.split()
    px_values = []
    for p in parts:
        try:
            px_values.append(float(p.replace('px', '')))
        except ValueError:
            px_values.append(0)

    if len(px_values) == 1:
        t = r = b = l = px_values[0]
    elif len(px_values) == 2:
        t = b = px_values[0]
        r = l = px_values[1]
    elif len(px_values) == 3:
        t, r, b = px_values[0], px_values[1], px_values[2]
        l = r
    elif len(px_values) >= 4:
        t, r, b, l = px_values[0], px_values[1], px_values[2], px_values[3]
    else:
        t = r = b = l = 0

    body_props.set('lIns', str(int(l * PX_TO_EMU)))
    body_props.set('rIns', str(int(r * PX_TO_EMU)))
    body_props.set('tIns', str(int(t * PX_TO_EMU)))
    body_props.set('bIns', str(int(b * PX_TO_EMU)))
