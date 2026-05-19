"""Font download, WOFF2→TTF conversion, and PPTX font embedding.

Flow:
1. Frontend sends font descriptors (URLs, family, weight) with export request
2. resolve_fonts() downloads font files, converts WOFF2→TTF
3. embed_fonts_in_pptx() injects TTF binaries into the PPTX package
4. build_font_name_map() provides (family, weight) → PPT typeface mapping
"""
import io
import re
import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import requests
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter

from pptx.oxml.ns import qn
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI


# ── Constants ──

WEIGHT_SUBFAMILY = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light',
    400: 'Regular', 500: 'Medium', 600: 'SemiBold',
    700: 'Bold', 800: 'ExtraBold', 900: 'Black',
}

GOOGLE_FONTS_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)

FONT_CACHE_DIR = Path('/tmp/float-editor-font-cache')
MAX_TOTAL_FONT_BYTES = 50 * 1024 * 1024  # 50 MB limit
DOWNLOAD_TIMEOUT = 10  # seconds per font


@dataclass
class FontRecord:
    family: str
    weight: int
    style: str  # 'normal' or 'italic'
    ttf_data: bytes = field(repr=False)
    subfamily: str = ''
    is_variable: bool = False
    rId: str = ''  # set during embedding

    def __post_init__(self):
        if not self.subfamily:
            self.subfamily = _weight_to_subfamily(self.weight, self.style)


# ── Memory cache ──
_font_cache: dict[str, bytes] = {}


# ── Public API ──

def resolve_fonts(font_descriptors: list, pages: dict = None) -> list[FontRecord]:
    """Download and convert all font descriptors into FontRecords with TTF data.
    If pages is provided, subset fonts to only include characters actually used."""
    records = []
    total_bytes = 0

    # Collect all text used per font family (for subsetting)
    font_texts = _collect_font_texts(pages) if pages else {}

    # Phase 1: Expand Google Fonts @import URLs into individual @font-face entries
    expanded = []
    for desc in font_descriptors:
        if desc.get('type') == 'google-import':
            expanded.extend(_resolve_google_import(desc['url']))
        elif desc.get('type') == 'font-face':
            expanded.append(desc)

    # Phase 2: Download and convert each font
    seen = set()  # (family, weight, style) dedup
    for desc in expanded:
        family = desc.get('family', '')
        weight = int(desc.get('weight', 400))
        style = desc.get('style', 'normal')
        url = desc.get('url', '')
        full_font_data = desc.get('_full_font_data')

        if (not url and not full_font_data) or not family:
            continue

        key = (family, weight, style)
        if key in seen:
            continue
        seen.add(key)

        try:
            if full_font_data:
                # Full variable font already provided
                ttf_data = _to_ttf(full_font_data)
            else:
                ttf_data = _download_and_convert(url)

            if not ttf_data:
                continue

            # Check if variable font → instantiate to specific weight
            is_var = _is_variable_font(ttf_data)
            if is_var:
                static_data = _instantiate_variable(ttf_data, weight)
                if static_data:
                    ttf_data = static_data
                    # Update font name records to reflect correct weight
                    ttf_data = _update_font_names(ttf_data, family, weight, style)

            # Subset to only include characters used in the slides
            used_text = font_texts.get(family, '')
            if used_text and len(ttf_data) > 100000:
                subset_data = _subset_font(ttf_data, used_text)
                if subset_data:
                    print(f'Font embed: {family} w{weight} subset {len(ttf_data)}→{len(subset_data)} bytes')
                    ttf_data = subset_data

            total_bytes += len(ttf_data)
            if total_bytes > MAX_TOTAL_FONT_BYTES:
                print(f'Font embed: total size limit reached, skipping remaining')
                break

            records.append(FontRecord(
                family=family, weight=weight, style=style,
                ttf_data=ttf_data, is_variable=is_var,
            ))
        except Exception as e:
            print(f'Font embed: failed to process {family} w{weight}: {e}')

    return records


def build_font_name_map(records: list[FontRecord]) -> dict:
    """Build a mapping of (fontFamily, weight) → PPT typeface name.

    Standard weights (400, 700) use the base family name.
    Non-standard weights use "Family Subfamily" (e.g., "Noto Sans KR Light").
    """
    name_map = {}
    for rec in records:
        if rec.weight in (400,) and rec.style == 'normal':
            name_map[(rec.family, rec.weight)] = rec.family
        elif rec.weight in (700,) and rec.style == 'normal':
            name_map[(rec.family, rec.weight)] = rec.family
        else:
            # Non-standard weight → separate typeface with subfamily
            name_map[(rec.family, rec.weight)] = f'{rec.family} {rec.subfamily}'
    return name_map


def embed_fonts_in_pptx(prs, records: list[FontRecord]) -> dict:
    """Embed font TTF files into the PPTX and return the font name map.

    Returns: dict mapping (family, weight) → pptx typeface name
    """
    if not records:
        return {}

    name_map = build_font_name_map(records)

    # Group records by their PPT typeface name
    # For standard weights: group under base family (regular=400, bold=700)
    # For non-standard weights: each becomes its own typeface entry
    typeface_groups = {}  # typeface_name -> [FontRecord]
    for rec in records:
        typeface = name_map.get((rec.family, rec.weight), rec.family)
        if typeface not in typeface_groups:
            typeface_groups[typeface] = []
        typeface_groups[typeface].append(rec)

    # Get presentation element for XML manipulation
    pres_el = prs._element

    # Create or find embeddedFontLst
    emb_lst = pres_el.find(qn('p:embeddedFontLst'))
    if emb_lst is None:
        emb_lst = pres_el.makeelement(qn('p:embeddedFontLst'), {})
        _insert_emb_font_lst(pres_el, emb_lst)

    font_idx = 0
    for typeface, recs in typeface_groups.items():
        emb_font = emb_lst.makeelement(qn('p:embeddedFont'), {})

        # Extract font metadata from first record's TTF
        sample = recs[0]
        panose, pitch_family = _extract_font_metadata(sample.ttf_data)

        font_el = emb_font.makeelement(qn('p:font'), {
            'typeface': typeface,
            'pitchFamily': str(pitch_family),
            'charset': '0',
        })
        if panose:
            font_el.set('panose', panose)
        emb_font.append(font_el)

        # Add each variant
        for rec in recs:
            font_idx += 1
            part_name = PackURI(f'/ppt/fonts/font{font_idx}.fntdata')
            font_part = Part(
                part_name,
                'application/x-fontdata',
                prs.part.package,
                rec.ttf_data,
            )
            rel_type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font'
            rId = prs.part.relate_to(font_part, rel_type)
            rec.rId = rId

            variant_tag = _variant_tag(rec.weight, rec.style, typeface, rec.family)
            ns_r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
            variant_el = emb_font.makeelement(qn(variant_tag), {
                qn('r:id'): rId,
            })
            emb_font.append(variant_el)

        emb_lst.append(emb_font)

    return name_map


# ── Internal helpers ──

def _resolve_google_import(css_url: str) -> list[dict]:
    """Fetch Google Fonts CSS and resolve into font-face descriptors.
    Detects unicode-range subsetting and downloads full variable fonts from GitHub instead."""
    try:
        resp = requests.get(css_url, headers={'User-Agent': GOOGLE_FONTS_UA}, timeout=DOWNLOAD_TIMEOUT)
        resp.raise_for_status()
        css_text = resp.text
    except Exception as e:
        print(f'Font embed: failed to fetch Google Fonts CSS: {e}')
        return []

    # Parse @font-face blocks
    blocks = []
    for block in re.finditer(r'@font-face\s*\{([^}]+)\}', css_text, re.S):
        body = block.group(1)
        family = _css_prop(body, 'font-family')
        weight_str = _css_prop(body, 'font-weight')
        style = _css_prop(body, 'font-style') or 'normal'
        src = _css_prop(body, 'src')
        has_unicode_range = 'unicode-range' in body.lower()

        if not family or not src:
            continue
        family = family.strip("'\"")
        weight = _parse_weight(weight_str)
        url_m = re.search(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", src)
        if url_m:
            blocks.append({
                'family': family, 'weight': weight, 'style': style,
                'url': url_m.group(1), 'has_unicode_range': has_unicode_range,
            })

    if not blocks:
        return []

    # Group by family to detect subsetting
    families = {}
    for b in blocks:
        fkey = (b['family'], b['weight'], b['style'])
        families.setdefault(fkey, []).append(b)

    results = []
    # Check for subsetting: if many blocks per (family, weight), it's subset delivery
    family_names = set(b['family'] for b in blocks)
    for family_name in family_names:
        family_blocks = [b for b in blocks if b['family'] == family_name]
        weights = sorted(set(b['weight'] for b in family_blocks))
        styles = sorted(set(b['style'] for b in family_blocks))
        blocks_per_variant = len(family_blocks) / max(len(weights) * len(styles), 1)

        if blocks_per_variant > 3 or family_blocks[0].get('has_unicode_range'):
            # Subset delivery → download full variable font from GitHub
            print(f'Font embed: {family_name} uses subset delivery ({int(blocks_per_variant)} blocks/variant), fetching full font')
            full_font_data = _download_google_full_font(family_name)
            if full_font_data:
                for w in weights:
                    for s in styles:
                        results.append({
                            'type': 'font-face', 'family': family_name,
                            'weight': w, 'style': s,
                            'url': f'__full_font__:{family_name}',
                            '_full_font_data': full_font_data,
                        })
            else:
                # Fallback: use first subset URL per weight (limited charset)
                print(f'Font embed: full font download failed, using first subset per weight')
                seen = set()
                for b in family_blocks:
                    key = (b['weight'], b['style'])
                    if key not in seen:
                        seen.add(key)
                        results.append({'type': 'font-face', **b})
        else:
            # Not subset → use URLs directly
            seen = set()
            for b in family_blocks:
                key = (b['weight'], b['style'])
                if key not in seen:
                    seen.add(key)
                    results.append({'type': 'font-face', **b})

    return results


# Google Fonts GitHub raw URLs for full variable fonts
_GOOGLE_FONTS_GITHUB = 'https://github.com/google/fonts/raw/main/ofl'


def _download_google_full_font(family_name: str) -> bytes | None:
    """Download the complete variable font file from Google Fonts GitHub repo."""
    # Convert family name to directory name: "Noto Sans KR" → "notosanskr"
    dir_name = family_name.lower().replace(' ', '')

    # Variable font filename pattern: FamilyName[axes].ttf
    # Common patterns: Name[wght].ttf, Name[ital,wght].ttf, Name[SOFT,WONK,opsz,wght].ttf
    # Try the most common patterns
    base = family_name.replace(' ', '')
    patterns = [
        f'{base}%5Bwght%5D.ttf',
        f'{base}%5Bwdth%2Cwght%5D.ttf',
        f'{base}%5Bital%2Cwght%5D.ttf',
        f'{base}%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf',
        f'{base}%5Bopsz%2Cwght%5D.ttf',
    ]

    for pattern in patterns:
        url = f'{_GOOGLE_FONTS_GITHUB}/{dir_name}/{pattern}'
        cache_key = hashlib.sha256(url.encode()).hexdigest()
        FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = FONT_CACHE_DIR / f'{cache_key}.ttf'

        if cache_path.exists():
            data = cache_path.read_bytes()
            if len(data) > 10000:
                print(f'Font embed: {family_name} full font from cache ({len(data)} bytes)')
                return data

        try:
            resp = requests.get(url, timeout=30, allow_redirects=True)
            if resp.status_code == 200 and len(resp.content) > 10000:
                data = resp.content
                try:
                    cache_path.write_bytes(data)
                except Exception:
                    pass
                print(f'Font embed: {family_name} full font downloaded ({len(data)} bytes)')
                return data
        except Exception:
            continue

    print(f'Font embed: {family_name} full font not found on GitHub')
    return None


def _css_prop(css_body: str, prop: str) -> str | None:
    m = re.search(rf'{re.escape(prop)}\s*:\s*([^;]+)', css_body, re.I)
    return m.group(1).strip() if m else None


def _parse_weight(w: str | None) -> int:
    if not w:
        return 400
    w = w.strip()
    if w == 'normal':
        return 400
    if w == 'bold':
        return 700
    try:
        return int(w)
    except ValueError:
        return 400


def _download_and_convert(url: str) -> bytes | None:
    """Download a font file and convert WOFF2 to TTF if needed."""
    cache_key = hashlib.sha256(url.encode()).hexdigest()

    # Memory cache
    if cache_key in _font_cache:
        return _font_cache[cache_key]

    # Disk cache
    FONT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = FONT_CACHE_DIR / f'{cache_key}.ttf'
    if cache_path.exists():
        data = cache_path.read_bytes()
        _font_cache[cache_key] = data
        return data

    try:
        resp = requests.get(url, timeout=DOWNLOAD_TIMEOUT)
        resp.raise_for_status()
        raw = resp.content
    except Exception as e:
        print(f'Font embed: download failed {url[:80]}: {e}')
        return None

    # Detect format and convert
    ttf_data = _to_ttf(raw)
    if ttf_data:
        _font_cache[cache_key] = ttf_data
        try:
            cache_path.write_bytes(ttf_data)
        except Exception:
            pass
    return ttf_data


def _to_ttf(data: bytes) -> bytes | None:
    """Convert font data to TTF format. Handles WOFF2, WOFF, and raw TTF/OTF."""
    if not data or len(data) < 4:
        return None

    magic = data[:4]
    try:
        font = TTFont(io.BytesIO(data))
        buf = io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        print(f'Font embed: conversion failed: {e}')
        return None


def _is_variable_font(ttf_data: bytes) -> bool:
    try:
        font = TTFont(io.BytesIO(ttf_data))
        return 'fvar' in font
    except Exception:
        return False


def _instantiate_variable(ttf_data: bytes, weight: int) -> bytes | None:
    """Pin a variable font's wght axis to a specific value and convert to static font."""
    try:
        import warnings
        font = TTFont(io.BytesIO(ttf_data))
        if 'fvar' not in font:
            return None

        # Step 1: Set the default location to the target weight
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            from fontTools.varLib.mutator import instantiateVariableFont
            instantiateVariableFont(font, {'wght': weight})

        # Step 2: Remove variable font tables to create a true static instance
        for table in ('fvar', 'gvar', 'STAT', 'HVAR', 'MVAR', 'VVAR', 'avar', 'cvar', 'DSIG'):
            if table in font:
                del font[table]

        buf = io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        print(f'Font embed: variable instantiation failed (wght={weight}): {e}')
        return None


def _collect_font_texts(pages: dict) -> dict[str, str]:
    """Collect all text content per font family from page data for subsetting."""
    font_texts = {}  # family -> set of chars
    if not pages:
        return font_texts

    for page in pages.values():
        for el in page.get('elements', []):
            content = el.get('content', '') or ''
            if not content:
                continue
            s = el.get('styles', {})
            ff = s.get('fontFamily', '')
            if ff:
                primary = ff.split(',')[0].strip().strip("'\"")
                if primary not in font_texts:
                    font_texts[primary] = set()
                # Strip HTML tags for text content
                import re as _re
                plain = _re.sub(r'<[^>]+>', '', content)
                font_texts[primary].update(plain)

    # Convert sets to strings + add essential characters (punctuation, digits, spaces)
    essential = set(' 0123456789.,;:!?-()[]{}"\'+/*@#$%&=<>~`|^_\\')
    result = {}
    for family, chars in font_texts.items():
        chars.update(essential)
        result[family] = ''.join(chars)
    return result


def _subset_font(ttf_data: bytes, text: str) -> bytes | None:
    """Subset a font to only include glyphs needed for the given text."""
    try:
        font = TTFont(io.BytesIO(ttf_data))
        subsetter = Subsetter()
        subsetter.populate(text=text)
        subsetter.subset(font)
        buf = io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        print(f'Font embed: subsetting failed: {e}')
        return None


def _update_font_names(ttf_data: bytes, family: str, weight: int, style: str) -> bytes:
    """Update font name table to reflect the correct family name and weight after instantiation.
    Variable fonts default to their min weight name (e.g., 'Thin'), this fixes it."""
    try:
        font = TTFont(io.BytesIO(ttf_data))
        name_table = font['name']
        subfamily = _weight_to_subfamily(weight, style)

        # Build proper names
        if weight == 400 and style == 'normal':
            full_name = family
            ps_name = family.replace(' ', '') + '-Regular'
            sub_name = 'Regular'
        elif weight == 700 and style == 'normal':
            full_name = f'{family} Bold'
            ps_name = family.replace(' ', '') + '-Bold'
            sub_name = 'Bold'
        elif weight == 400 and style == 'italic':
            full_name = f'{family} Italic'
            ps_name = family.replace(' ', '') + '-Italic'
            sub_name = 'Italic'
        elif weight == 700 and style == 'italic':
            full_name = f'{family} Bold Italic'
            ps_name = family.replace(' ', '') + '-BoldItalic'
            sub_name = 'Bold Italic'
        else:
            full_name = f'{family} {subfamily}'
            ps_name = family.replace(' ', '') + '-' + subfamily.replace(' ', '')
            sub_name = subfamily

        # Update name records for platformID=3 (Windows), encodingID=1, langID=0x409 (English)
        name_table.setName(family, 1, 3, 1, 0x409)       # Family name
        name_table.setName(sub_name, 2, 3, 1, 0x409)     # Subfamily name
        name_table.setName(full_name, 4, 3, 1, 0x409)    # Full name
        name_table.setName(ps_name, 6, 3, 1, 0x409)      # PostScript name

        # Also update OS/2 weight class
        if 'OS/2' in font:
            font['OS/2'].usWeightClass = weight

        buf = io.BytesIO()
        font.save(buf)
        return buf.getvalue()
    except Exception as e:
        print(f'Font embed: name update failed for {family} w{weight}: {e}')
        return ttf_data


def _extract_font_metadata(ttf_data: bytes) -> tuple[str, int]:
    """Extract panose string and pitchFamily from TTF OS/2 table.
    Returns (panose_hex, pitch_family_int)."""
    try:
        font = TTFont(io.BytesIO(ttf_data))
        os2 = font.get('OS/2')
        if os2 is None:
            return ('', 34)

        panose = os2.panose
        panose_hex = ''.join(f'{b:02X}' for b in [
            panose.bFamilyType, panose.bSerifStyle, panose.bWeight,
            panose.bProportion, panose.bContrast, panose.bStrokeVariation,
            panose.bArmStyle, panose.bLetterform, panose.bMidline, panose.bXHeight,
        ])

        # pitchFamily: bits 0-1 = pitch (0=default,1=fixed,2=variable)
        #              bits 4-5 = family (0=dontcare,1=roman,2=swiss,3=modern,4=script,5=decorative)
        is_fixed = os2.panose.bProportion == 9  # monospace
        family_class = (os2.sFamilyClass >> 8) & 0xFF
        pitch = 1 if is_fixed else 2
        fam = {1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 8: 3, 10: 4, 12: 5}.get(family_class, 0)
        pitch_family = pitch | (fam << 4)

        return (panose_hex, pitch_family)
    except Exception:
        return ('', 34)


def _variant_tag(weight: int, style: str, typeface: str, base_family: str) -> str:
    """Determine the OOXML variant tag for a font record.
    Non-standard weights registered as separate typefaces always use p:regular."""
    # If this is a non-standard weight with its own typeface, it's always "regular" for that typeface
    if typeface != base_family:
        if style == 'italic':
            return 'p:italic'
        return 'p:regular'

    is_bold = weight >= 700
    is_italic = style == 'italic'
    if is_bold and is_italic:
        return 'p:boldItalic'
    if is_bold:
        return 'p:bold'
    if is_italic:
        return 'p:italic'
    return 'p:regular'


def _weight_to_subfamily(weight: int, style: str) -> str:
    # Snap to nearest standard weight
    standard = sorted(WEIGHT_SUBFAMILY.keys())
    closest = min(standard, key=lambda w: abs(w - weight))
    name = WEIGHT_SUBFAMILY[closest]
    if style == 'italic':
        name += ' Italic'
    return name


def _insert_emb_font_lst(pres_el, emb_lst):
    """Insert <p:embeddedFontLst> in the correct schema position within <p:presentation>.
    Per ECMA-376: after smartTags, before custShowLst/photoAlbum/custDataLst/kinsoku..."""
    # Elements that should come AFTER embeddedFontLst
    after_tags = {
        'p:custShowLst', 'p:photoAlbum', 'p:custDataLst', 'p:kinsoku',
        'p:defaultTextStyle', 'p:modifyVerifier', 'p:extLst',
    }
    # Elements that should come BEFORE embeddedFontLst
    before_tags = {
        'p:sldMasterIdLst', 'p:notesMasterIdLst', 'p:handoutMasterIdLst',
        'p:sldIdLst', 'p:sldSz', 'p:notesSz', 'p:smartTags',
    }

    # Find the first child that should come after, and insert before it
    for child in pres_el:
        tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        full_tag = f'p:{tag}'
        if full_tag in after_tags:
            child.addprevious(emb_lst)
            return

    # If no "after" element found, append at end
    pres_el.append(emb_lst)
