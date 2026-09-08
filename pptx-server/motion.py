"""motion — 슬라이드 전환·요소 등장 애니메이션·나레이션 자동재생을 PPTX에 싣는다.

JS 경로(src/core/PptMotion.js)의 미러. 같은 덱을 어느 경로로 내보내도 재생이 같아야
하므로 효과 매핑·단계 구성·텀(AUDIO_TERM)을 그대로 맞춘다.

python-pptx는 이 영역을 다루지 않으므로 lxml로 슬라이드 XML에 직접 붙인다.
"""
import base64
import re

from pptx.oxml.ns import qn, _nsmap
from pptx.opc.packuri import PackURI
from pptx.opc.package import Part
from lxml import etree

# 발표 모드(usePresentationEngine.AUDIO_TERM)와 같은 단계 간 텀(ms).
AUDIO_TERM = 300
DEFAULT_DUR = 500

# Genitor 효과 → PowerPoint 나타내기/끝내기 프리셋 (presetID, presetClass, filter)
_EFFECTS = {
    'fadeIn':    (10, 'entr', lambda d: 'fade'),
    'fadeOut':   (10, 'exit', lambda d: 'fade'),
    'slideIn':   (22, 'entr', lambda d: 'wipe(%s)' % (d or 'up')),
    'slideOut':  (22, 'exit', lambda d: 'wipe(%s)' % (d or 'up')),
    'scaleIn':   (23, 'entr', lambda d: 'zoom(in)'),
    'scaleOut':  (23, 'exit', lambda d: 'zoom(out)'),
    # pop은 확대 등장의 과장판 — 파워포인트엔 대응이 없어 zoom으로 보낸다.
    'pop':       (23, 'entr', lambda d: 'zoom(in)'),
}

_DIR_ATTR = {'left': 'l', 'right': 'r', 'up': 'u', 'down': 'd'}

_RT_AUDIO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio'
_RT_MEDIA = 'http://schemas.microsoft.com/office/2007/relationships/media'
_RT_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

# 오디오 도형에 필요한 미리보기 이미지(1x1 투명 PNG) — PowerPoint가 blipFill을 요구한다.
_POSTER_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
)

_NS_DECL = ' '.join('xmlns:%s="%s"' % (k, _nsmap[k]) for k in ('a', 'p', 'r'))


def _frag(xml: str):
    """네임스페이스 선언을 붙여 조각을 파싱한다."""
    return etree.fromstring('<root %s>%s</root>' % (_NS_DECL, xml))


def _speed(ms):
    if not ms or ms <= 300:
        return 'fast'
    return 'med' if ms <= 600 else 'slow'


def transition_xml(transition: dict) -> str:
    """페이지 전환 → <p:transition> 문자열. 없으면 ''."""
    if not transition:
        return ''
    t = transition.get('type')
    if not t or t == 'none':
        return ''
    if t == 'fade':
        inner = '<p:fade/>'
    elif t == 'slide':
        inner = '<p:push dir="%s"/>' % _DIR_ATTR.get(transition.get('dir'), 'l')
    elif t == 'zoom':
        inner = '<p:zoom dir="in"/>'
    else:
        return ''
    return '<p:transition spd="%s">%s</p:transition>' % (_speed(transition.get('durationMs')), inner)


def compute_steps(elements):
    """slideAnimation.computeSteps 미러 — 클릭 단계 그룹핑 + auto 분리.

    returns (step_count, step_of, offset_of, auto_offsets, order)
    """
    animated = [e for e in (elements or [])
                if e.get('anim') and e['anim'].get('effect') and e['anim']['effect'] != 'none']
    animated.sort(key=lambda e: e['anim'].get('seq') or 0)
    by_id = {e.get('id'): e for e in animated}

    step_of, offset_of, auto_offsets = {}, {}, {}
    step_count = 0
    for e in animated:
        tr = e['anim'].get('trigger') or {'mode': 'click'}
        eid = e.get('id')
        if tr.get('mode') == 'auto':
            auto_offsets[eid] = e['anim'].get('delayMs') or 0
            continue
        ref = tr.get('ref')
        ref = ref if (ref in by_id and step_of.get(ref) is not None) else None
        if tr.get('mode') == 'with' and ref:
            step_of[eid] = step_of[ref]
            offset_of[eid] = offset_of[ref]
        elif tr.get('mode') == 'after' and ref:
            step_of[eid] = step_of[ref]
            offset_of[eid] = offset_of[ref] + (by_id[ref]['anim'].get('durationMs') or DEFAULT_DUR) \
                + (e['anim'].get('delayMs') or 0)
        else:
            step_of[eid] = step_count
            offset_of[eid] = e['anim'].get('delayMs') or 0
            step_count += 1
    return step_count, step_of, offset_of, auto_offsets, [e.get('id') for e in animated]


class _Ids:
    """슬라이드 안에서 겹치지 않는 cTn id 발급기(1·2는 tmRoot·mainSeq가 쓴다)."""

    def __init__(self, seed=2):
        self._n = seed

    def next(self):
        self._n += 1
        return self._n


def _effect_par(spid, anim, delay, node_type, ids) -> str:
    preset = _EFFECTS.get(anim.get('effect'))
    if not preset:
        return ''
    preset_id, cls, filter_of = preset
    dur = max(1, anim.get('durationMs') or DEFAULT_DUR)
    is_exit = cls == 'exit'

    def set_node(val):
        return (
            '<p:set><p:cBhvr>'
            '<p:cTn id="%d" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
            '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
            '</p:cBhvr><p:to><p:strVal val="%s"/></p:to></p:set>' % (ids.next(), spid, val)
        )

    effect_node = (
        '<p:animEffect transition="%s" filter="%s"><p:cBhvr>'
        '<p:cTn id="%d" dur="%d"/>'
        '<p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
        '</p:cBhvr></p:animEffect>'
        % ('out' if is_exit else 'in', filter_of(anim.get('dir')), ids.next(), dur, spid)
    )
    body = (effect_node + set_node('hidden')) if is_exit else (set_node('visible') + effect_node)
    return (
        '<p:par><p:cTn id="%d" presetID="%d" presetClass="%s" presetSubtype="0"'
        ' fill="hold" grpId="0" nodeType="%s">'
        '<p:stCondLst><p:cond delay="%d"/></p:stCondLst>'
        '<p:childTnLst>%s</p:childTnLst></p:cTn></p:par>'
        % (ids.next(), preset_id, cls, node_type, max(0, round(delay)), body)
    )


def _step_par(effects, auto_start, group_delay, ids) -> str:
    if not effects:
        return ''
    inner = ''
    for i, (spid, anim, delay) in enumerate(effects):
        node_type = ('afterEffect' if auto_start else 'clickEffect') if i == 0 else 'withEffect'
        inner += _effect_par(spid, anim, delay, node_type, ids)
    return (
        '<p:par><p:cTn id="%d" fill="hold">'
        '<p:stCondLst><p:cond delay="%s"/></p:stCondLst>'
        '<p:childTnLst><p:par>'
        '<p:cTn id="%d" fill="hold"><p:stCondLst><p:cond delay="%d"/></p:stCondLst>'
        '<p:childTnLst>%s</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
        % (ids.next(), '0' if auto_start else 'indefinite', ids.next(),
           max(0, round(group_delay)), inner)
    )


def _audio_node(spid, volume, ids) -> str:
    """슬라이드가 뜨는 즉시 재생. 발표 중에는 스피커 아이콘을 숨긴다."""
    vol = int(round(min(1.0, max(0.0, volume if volume is not None else 1.0)) * 100000))
    return (
        '<p:audio><p:cMediaNode vol="%d" showWhenStopped="0">'
        '<p:cTn id="%d" fill="hold" display="0">'
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst>'
        '<p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>'
        '</p:cTn><p:tgtEl><p:spTgt spid="%d"/></p:tgtEl>'
        '</p:cMediaNode></p:audio>' % (vol, ids.next(), spid)
    )


def timing_xml(elements, spids_of, audio=None, auto_chain=False, id_seed=2) -> str:
    """요소 anim(+나레이션) → <p:timing> 문자열. 실을 게 없으면 ''.

    spids_of: 요소 id → 도형 id 리스트(요소 하나가 도형 여럿을 낳을 수 있다)
    audio: {'spid': int, 'volume': float} | None
    auto_chain: 클릭 단계를 '이전 효과 다음에'로 — 나레이션 있는 장에서 쓴다.
    """
    usable = [e for e in (elements or [])
              if e.get('anim') and _EFFECTS.get(e['anim'].get('effect')) and spids_of.get(e.get('id'))]
    if not usable and not audio:
        return ''

    step_count, step_of, offset_of, auto_offsets, order = compute_steps(usable)
    by_id = {e.get('id'): e for e in usable}
    ids = _Ids(id_seed)

    def expand(eid, delay):
        return [(spid, by_id[eid]['anim'], delay) for spid in spids_of[eid]]

    steps = []
    if auto_offsets:
        auto_ids = sorted(auto_offsets, key=lambda i: by_id[i]['anim'].get('seq') or 0)
        effects = []
        for eid in auto_ids:
            effects += expand(eid, auto_offsets[eid])
        steps.append((True, 0, effects))
    for s in range(step_count):
        step_ids = [i for i in order if step_of.get(i) == s]
        if not step_ids:
            continue
        effects = []
        for eid in step_ids:
            effects += expand(eid, offset_of.get(eid) or 0)
        steps.append((auto_chain, AUDIO_TERM if auto_chain else 0, effects))

    if not steps and not audio:
        return ''

    body = ''.join(_step_par(effects, auto_start, delay, ids) for auto_start, delay, effects in steps)
    seq = ''
    if steps:
        seq = (
            '<p:seq concurrent="1" nextAc="seek">'
            '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>%s</p:childTnLst></p:cTn>'
            '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            '</p:seq>' % body
        )
    audio_x = _audio_node(audio['spid'], audio.get('volume'), ids) if audio else ''
    bld_spids = []
    for e in usable:
        for spid in spids_of[e.get('id')]:
            if spid not in bld_spids:
                bld_spids.append(spid)
    bld = ''.join('<p:bldP spid="%d" grpId="0" animBg="1"/>' % s for s in bld_spids)

    return (
        '<p:timing><p:tnLst><p:par>'
        '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
        '%s%s'
        '</p:childTnLst></p:cTn></p:par></p:tnLst>'
        '%s</p:timing>' % (seq, audio_x, ('<p:bldLst>%s</p:bldLst>' % bld) if bld else '')
    )


def _next_shape_id(slide) -> int:
    used = [int(m) for m in re.findall(r'<p:cNvPr id="(\d+)"',
                                       etree.tostring(slide._element, encoding='unicode'))]
    return (max(used) if used else 1) + 1


def _data_url_bytes(src: str):
    """data URL → (bytes, ext, mime). 아니면 None."""
    m = re.match(r'data:([^;]+);base64,(.+)', src or '', re.S)
    if not m:
        return None
    mime = m.group(1) or 'audio/mpeg'
    ext = 'wav' if 'wav' in mime else ('m4a' if ('mp4' in mime or 'm4a' in mime) else 'mp3')
    return base64.b64decode(m.group(2)), ext, mime


def _get_part(package, partname: str):
    """패키지에 이미 있는 파트를 partname으로 찾는다(없으면 None)."""
    try:
        for part in package.iter_parts():
            if str(part.partname) == partname:
                return part
    except Exception:
        pass
    return None


def add_narration(slide, prs, page_index: int, audio: dict):
    """나레이션 오디오를 슬라이드에 심는다(우하단 구석, 발표 중 숨김).

    returns {'spid': int, 'volume': float} | None
    """
    parsed = _data_url_bytes((audio or {}).get('src'))
    if not parsed:
        return None
    blob, ext, mime = parsed
    package = slide.part.package

    media_part = Part(PackURI('/ppt/media/narration%d.%s' % (page_index + 1, ext)), mime, package, blob)
    r_audio = slide.part.relate_to(media_part, _RT_AUDIO)
    r_media = slide.part.relate_to(media_part, _RT_MEDIA)

    # 포스터는 장마다 새로 만들지 않는다 — 같은 partname을 두 번 넣으면 zip에 중복 항목이 생긴다.
    poster = _get_part(package, '/ppt/media/narration-poster.png')
    if poster is None:
        poster = Part(PackURI('/ppt/media/narration-poster.png'), 'image/png', package, _POSTER_PNG)
    r_poster = slide.part.relate_to(poster, _RT_IMAGE)

    spid = _next_shape_id(slide)
    size = 274320  # 0.3in
    # 화면 밖(오른쪽 가장자리 바로 바깥) — 슬라이드 안에 두면 PDF 저장 시 미디어
    # 자리표시자가 찍힌다. 밖에 둬도 재생에는 지장이 없다.
    x = int(prs.slide_width)
    y = max(0, int(prs.slide_height) // 2)
    pic = (
        '<p:pic><p:nvPicPr>'
        '<p:cNvPr id="%d" name="narration%d.%s"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>'
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
        '<p:nvPr><a:audioFile r:link="%s"/><p:extLst>'
        '<p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">'
        '<p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="%s"/>'
        '</p:ext></p:extLst></p:nvPr>'
        '</p:nvPicPr>'
        '<p:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        '</p:pic>' % (spid, page_index + 1, ext, r_audio, r_media, r_poster, x, y, size, size)
    )
    spTree = slide._element.find(qn('p:cSld')).find(qn('p:spTree'))
    for node in _frag(pic):
        spTree.append(node)
    return {'spid': spid, 'volume': (audio or {}).get('volume', 1)}


def apply_slide_motion(slide, page: dict, spids_of: dict, audio_target=None):
    """전환·등장·나레이션 타이밍을 슬라이드에 붙인다(스키마상 p:sld의 마지막 자식).

    영상 임베드(add_movie) 때문에 python-pptx가 이미 만든 p:timing이 있으면
    거기에 합친다 — 한 슬라이드에 timing이 둘이면 안 되고, cTn id도 겹치면 안 된다.
    """
    sld = slide._element
    existing = sld.find(qn('p:timing'))
    seed = 2
    if existing is not None:
        used = [int(m) for m in re.findall(r'id="(\d+)"',
                                          etree.tostring(existing, encoding='unicode'))]
        seed = max(used) if used else 2

    transition = transition_xml(page.get('transition'))
    # 나레이션이 실린 장은 앱 발표 모드처럼 클릭 없이 이어서 흐르게 한다.
    timing = timing_xml(page.get('elements'), spids_of, audio_target,
                        auto_chain=bool(audio_target), id_seed=seed)
    if not transition and not timing:
        return

    if transition:
        for node in _frag(transition):
            if existing is not None:
                existing.addprevious(node)
            else:
                sld.append(node)
    if not timing:
        return
    new_timing = _frag(timing)[0]
    if existing is None:
        sld.append(new_timing)
        return
    # 기존 tmRoot의 childTnLst에 우리 노드(seq·audio)를 이어 붙인다.
    src = new_timing.find('.//' + qn('p:childTnLst'))
    dst = existing.find('.//' + qn('p:childTnLst'))
    if src is not None and dst is not None:
        for node in list(src):
            dst.append(node)
    src_bld = new_timing.find(qn('p:bldLst'))
    if src_bld is not None:
        dst_bld = existing.find(qn('p:bldLst'))
        if dst_bld is None:
            existing.append(src_bld)
        else:
            for node in list(src_bld):
                dst_bld.append(node)
