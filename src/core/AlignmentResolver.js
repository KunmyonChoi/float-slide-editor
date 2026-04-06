/**
 * AlignmentResolver
 *
 * 사용자의 "가로 정렬" / "세로 정렬" 의도를 부모 레이아웃 컨텍스트에 맞는
 * CSS 속성 변경 목록으로 변환한다.
 *
 * 매핑 규칙:
 *   flex-row   부모 → 가로 = main-axis (margin auto), 세로 = cross-axis (alignSelf)
 *   flex-column 부모 → 가로 = cross-axis (alignSelf), 세로 = main-axis (margin auto)
 *   grid       부모 → 가로 = justifySelf, 세로 = alignSelf
 *   block      부모 → 가로 = margin auto, 세로 = (부모를 flex로 전환 필요 → 생략)
 */

/**
 * @param {CSSStyleDeclaration} parentCS — getComputedStyle(parent)
 * @param {'h'|'v'} axis — 'h' = 가로, 'v' = 세로
 * @param {'start'|'center'|'end'} value
 * @returns {Array<{ prop: string, value: string }>} 적용할 스타일 변경 목록
 */
export function resolveAlignment(parentCS, axis, value) {
  const display = parentCS.display
  const flexDir = parentCS.flexDirection

  const isFlex = display === 'flex' || display === 'inline-flex'
  const isGrid = display === 'grid' || display === 'inline-grid'
  const isRow = flexDir === 'row' || flexDir === 'row-reverse'

  if (isGrid) {
    return axis === 'h'
      ? [{ prop: 'justifySelf', value: gridVal(value) }]
      : [{ prop: 'alignSelf', value: gridVal(value) }]
  }

  if (isFlex) {
    const isMainAxis = (axis === 'h' && isRow) || (axis === 'v' && !isRow)

    if (!isMainAxis) {
      // cross-axis → alignSelf
      return [{ prop: 'alignSelf', value: flexVal(value) }]
    }
    // main-axis → margin auto 패턴
    return axis === 'h' ? marginH(value) : marginV(value)
  }

  // block / inline-block 등
  if (axis === 'h') {
    return marginH(value)
  }

  // 세로 정렬은 block 컨텍스트에서 margin auto로 불가 → 빈 배열
  return []
}

/**
 * 부모 레이아웃 정보와 현재 요소 스타일로부터 현재 정렬 상태를 읽는다.
 * @returns {{ h: 'start'|'center'|'end'|null, v: 'start'|'center'|'end'|null }}
 */
export function readCurrentAlignment(parentCS, elStyle) {
  const display = parentCS.display
  const flexDir = parentCS.flexDirection

  const isFlex = display === 'flex' || display === 'inline-flex'
  const isGrid = display === 'grid' || display === 'inline-grid'
  const isRow = flexDir === 'row' || flexDir === 'row-reverse'

  let h = null
  let v = null

  if (isGrid) {
    h = fromGridVal(elStyle.justifySelf)
    v = fromGridVal(elStyle.alignSelf)
  } else if (isFlex) {
    if (isRow) {
      h = fromMarginH(elStyle)
      v = fromFlexVal(elStyle.alignSelf)
    } else {
      h = fromFlexVal(elStyle.alignSelf)
      v = fromMarginV(elStyle)
    }
  } else {
    h = fromMarginH(elStyle)
  }

  return { h, v }
}

// ── 내부 변환 헬퍼 ──────────────────────────────────────────

function flexVal(v) {
  if (v === 'start') return 'flex-start'
  if (v === 'end')   return 'flex-end'
  return v // 'center'
}

function gridVal(v) {
  return v // 'start' | 'center' | 'end'
}

function marginH(value) {
  switch (value) {
    case 'start':  return [{ prop: 'marginLeft', value: '' },     { prop: 'marginRight', value: 'auto' }]
    case 'center': return [{ prop: 'marginLeft', value: 'auto' }, { prop: 'marginRight', value: 'auto' }]
    case 'end':    return [{ prop: 'marginLeft', value: 'auto' }, { prop: 'marginRight', value: '' }]
    default: return []
  }
}

function marginV(value) {
  switch (value) {
    case 'start':  return [{ prop: 'marginTop', value: '' },     { prop: 'marginBottom', value: 'auto' }]
    case 'center': return [{ prop: 'marginTop', value: 'auto' }, { prop: 'marginBottom', value: 'auto' }]
    case 'end':    return [{ prop: 'marginTop', value: 'auto' }, { prop: 'marginBottom', value: '' }]
    default: return []
  }
}

function fromFlexVal(v) {
  if (!v || v === 'auto' || v === 'stretch') return null
  if (v === 'flex-start' || v === 'start') return 'start'
  if (v === 'flex-end' || v === 'end') return 'end'
  if (v === 'center') return 'center'
  return null
}

function fromGridVal(v) {
  if (!v || v === 'auto' || v === 'stretch') return null
  if (v === 'start') return 'start'
  if (v === 'end') return 'end'
  if (v === 'center') return 'center'
  return null
}

function fromMarginH(style) {
  const ml = style.marginLeft
  const mr = style.marginRight
  if (ml === 'auto' && mr === 'auto') return 'center'
  if (ml === 'auto' && mr !== 'auto') return 'end'
  if (ml !== 'auto' && mr === 'auto') return 'start'
  return null
}

function fromMarginV(style) {
  const mt = style.marginTop
  const mb = style.marginBottom
  if (mt === 'auto' && mb === 'auto') return 'center'
  if (mt === 'auto' && mb !== 'auto') return 'end'
  if (mt !== 'auto' && mb === 'auto') return 'start'
  return null
}
