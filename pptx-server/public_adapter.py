"""public_adapter — 공개 SlideDeck → 내부 pages(엔진 입력) 변환.

JS packages/slide-contract/adapters.js 의 deckToInternalPages 미러.
엔진(build_pptx)이 읽는 요소 키를 그대로 복원한다.
"""


def _public_el_to_internal(pel: dict) -> dict:
    out = {
        'type': pel.get('type'),
        'x': pel.get('x'), 'y': pel.get('y'),
        'width': pel.get('width'), 'height': pel.get('height'),
        'rotation': pel.get('rotation') or 0,
        'zIndex': pel.get('z') or 0,
        'styles': pel.get('style') or {},
    }
    if pel.get('type') == 'text':
        t = pel.get('text') or {}
        html = t.get('html')
        out['content'] = html if html is not None else (t.get('plain') or '')
        out['isRich'] = html is not None
    elif pel.get('type') == 'table':
        out['content'] = ''
        out['isRich'] = False
        if pel.get('table') is not None:
            out['table'] = pel['table']
    else:
        out['content'] = pel.get('src') or ''
        out['isRich'] = False
    for k in ('points', 'link'):
        if pel.get(k) is not None:
            out[k] = pel[k]
    if pel.get('merged'):
        out['merged'] = True
    if pel.get('locked'):
        out['locked'] = True
    if pel.get('groupId') is not None:
        out['groupId'] = pel['groupId']
    return out


def public_deck_to_internal(deck: dict):
    """공개 SlideDeck → (pages 맵, default_canvas_size, fonts).
    페이지 키는 순서 기준 재생성("0-0","1-0"…) — 엔진은 순서만 사용.
    """
    default_cs = deck.get('canvasSize') or {'w': 1280, 'h': 720}
    pages = {}
    for i, p in enumerate(deck.get('pages') or []):
        pages[f'{i}-0'] = {
            'elements': [_public_el_to_internal(e) for e in (p.get('elements') or [])],
            'canvasSize': p.get('canvasSize') or default_cs,
            'fontImports': [],
        }
    return pages, default_cs, deck.get('fonts') or []


def is_public_deck(data: dict) -> bool:
    """요청 본문이 공개 SlideDeck인지 판별 (legacy internal payload와 구분)."""
    if not isinstance(data, dict):
        return False
    # 명시적 envelope
    if isinstance(data.get('deck'), dict):
        return True
    # raw deck: schemaVersion 있거나 pages가 배열
    return 'schemaVersion' in data or isinstance(data.get('pages'), list)
