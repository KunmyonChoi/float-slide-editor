/**
 * InsertionPlaceholders
 * 선택된 요소 주변 4방향에 삽입 위치를 나타내는 "+" 버튼을 iframe DOM에 표시한다.
 *
 * 부모 컨테이너의 레이아웃 방향을 감지하여:
 *   - flow 방향 (상하 또는 좌우): 실선 인디케이터 → 형제 삽입
 *   - cross-axis 방향: 점선 인디케이터 → 자동 래핑 후 삽입
 */

const PLACEHOLDER_CLASS = '__fe-insert-ph'
const PLACEHOLDER_STYLE_ID = '__fe-insert-ph-style'

/**
 * 부모 요소의 레이아웃 방향을 감지한다.
 * @returns {'horizontal' | 'vertical'}
 */
export function detectLayoutDirection(parentEl, win) {
  if (!parentEl || !win) return 'vertical'
  const cs = win.getComputedStyle(parentEl)
  const display = cs.display

  if (display === 'flex' || display === 'inline-flex') {
    const dir = cs.flexDirection
    if (dir === 'row' || dir === 'row-reverse') return 'horizontal'
    return 'vertical'
  }

  if (display === 'grid' || display === 'inline-grid') {
    const flow = cs.gridAutoFlow
    if (flow?.startsWith('column')) return 'horizontal'
    return 'vertical'
  }

  return 'vertical'
}

/**
 * iframe document에 플레이스홀더 스타일을 주입한다.
 */
function ensureStyle(doc) {
  if (doc.getElementById(PLACEHOLDER_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = PLACEHOLDER_STYLE_ID
  style.textContent = `
    .${PLACEHOLDER_CLASS} {
      position: absolute;
      z-index: 99998;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, transform 0.15s;
      pointer-events: all;
    }
    .${PLACEHOLDER_CLASS}.--visible {
      opacity: 1;
    }
    .${PLACEHOLDER_CLASS} .--btn {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(99,102,241,0.15);
      border: 1.5px solid rgba(99,102,241,0.5);
      color: #6366f1;
      font-size: 14px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
      user-select: none;
    }
    .${PLACEHOLDER_CLASS}:hover .--btn {
      background: rgba(99,102,241,0.35);
      transform: scale(1.15);
      box-shadow: 0 0 12px rgba(99,102,241,0.4);
    }
    .${PLACEHOLDER_CLASS} .--line {
      position: absolute;
      background: rgba(99,102,241,0.3);
      border-radius: 1px;
      pointer-events: none;
    }
    .${PLACEHOLDER_CLASS}.--h .--line {
      width: 1.5px;
      top: 0; bottom: 0;
      left: 50%;
      transform: translateX(-50%);
    }
    .${PLACEHOLDER_CLASS}.--v .--line {
      height: 1.5px;
      left: 0; right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    /* cross-axis 스타일: 점선 + 다른 색조 */
    .${PLACEHOLDER_CLASS}.--cross .--btn {
      border-style: dashed;
      background: rgba(168,85,247,0.12);
      border-color: rgba(168,85,247,0.5);
      color: #a855f7;
    }
    .${PLACEHOLDER_CLASS}.--cross:hover .--btn {
      background: rgba(168,85,247,0.3);
      box-shadow: 0 0 12px rgba(168,85,247,0.4);
    }
    .${PLACEHOLDER_CLASS}.--cross .--line {
      background: rgba(168,85,247,0.25);
    }
  `
  doc.head.appendChild(style)
}

/**
 * 플레이스홀더 요소를 생성한다.
 * @param {'flow'|'cross'} axis
 */
function createPlaceholder(doc, parentId, index, direction, axis) {
  const el = doc.createElement('div')
  const dirClass = direction === 'horizontal' ? '--h' : '--v'
  const axisClass = axis === 'cross' ? ' --cross' : ''
  el.className = `${PLACEHOLDER_CLASS} ${dirClass}${axisClass}`
  el.setAttribute('data-insert-parent', parentId || '')
  el.setAttribute('data-insert-index', String(index))
  el.setAttribute('data-insert-axis', axis)

  const line = doc.createElement('div')
  line.className = '--line'
  el.appendChild(line)

  const btn = doc.createElement('div')
  btn.className = '--btn'
  btn.textContent = '+'
  el.appendChild(btn)

  return el
}

/**
 * 플레이스홀더 위치를 계산하여 스타일에 적용한다.
 */
function positionPlaceholder(ph, rect, scrollY, direction, placement) {
  const GAP = 4

  if (direction === 'vertical') {
    ph.style.left = rect.left + 'px'
    ph.style.width = rect.width + 'px'
    ph.style.height = '22px'

    if (placement === 'before') {
      ph.style.top = (rect.top + scrollY - 11 - GAP) + 'px'
    } else {
      ph.style.top = (rect.bottom + scrollY - 11 + GAP) + 'px'
    }
  } else {
    ph.style.top = (rect.top + scrollY) + 'px'
    ph.style.height = rect.height + 'px'
    ph.style.width = '22px'

    if (placement === 'before') {
      ph.style.left = (rect.left - 11 - GAP) + 'px'
    } else {
      ph.style.left = (rect.right - 11 + GAP) + 'px'
    }
  }
}

export class InsertionPlaceholders {
  constructor() {
    this._placeholders = []
  }

  /**
   * 선택된 요소 주변 4방향에 삽입 플레이스홀더를 표시한다.
   * - flow 방향: 실선 인디케이터 (형제 삽입)
   * - cross-axis 방향: 점선 인디케이터 (래핑 후 삽입)
   */
  update(iframeDoc, selectedId) {
    this.clear(iframeDoc)
    if (!iframeDoc || !selectedId) return

    const el = iframeDoc.querySelector(`[data-editor-id="${selectedId}"]`)
    if (!el || !el.parentElement) return

    const win = iframeDoc.defaultView
    if (!win) return

    ensureStyle(iframeDoc)

    const parent = el.parentElement
    const parentId = parent.getAttribute?.('data-editor-id') || null
    const siblings = [...parent.children].filter(
      c => !c.classList?.contains(PLACEHOLDER_CLASS)
    )
    const idx = siblings.indexOf(el)
    if (idx < 0) return

    const flowDir = detectLayoutDirection(parent, win)
    const crossDir = flowDir === 'vertical' ? 'horizontal' : 'vertical'
    const scrollY = win.scrollY || 0
    const rect = el.getBoundingClientRect()

    // ── flow 방향: before / after ──
    const phFlowBefore = createPlaceholder(iframeDoc, parentId, idx, flowDir, 'flow')
    positionPlaceholder(phFlowBefore, rect, scrollY, flowDir, 'before')
    iframeDoc.body.appendChild(phFlowBefore)
    this._placeholders.push(phFlowBefore)

    const phFlowAfter = createPlaceholder(iframeDoc, parentId, idx + 1, flowDir, 'flow')
    positionPlaceholder(phFlowAfter, rect, scrollY, flowDir, 'after')
    iframeDoc.body.appendChild(phFlowAfter)
    this._placeholders.push(phFlowAfter)

    // ── cross-axis 방향: before / after (래핑 필요) ──
    // cross-axis before = 래핑 후 왼쪽/위에 삽입 (index 0)
    const phCrossBefore = createPlaceholder(iframeDoc, parentId, idx, crossDir, 'cross')
    phCrossBefore.setAttribute('data-wrap-target', selectedId)
    phCrossBefore.setAttribute('data-wrap-side', 'before')
    positionPlaceholder(phCrossBefore, rect, scrollY, crossDir, 'before')
    iframeDoc.body.appendChild(phCrossBefore)
    this._placeholders.push(phCrossBefore)

    // cross-axis after = 래핑 후 오른쪽/아래에 삽입 (index 1)
    const phCrossAfter = createPlaceholder(iframeDoc, parentId, idx, crossDir, 'cross')
    phCrossAfter.setAttribute('data-wrap-target', selectedId)
    phCrossAfter.setAttribute('data-wrap-side', 'after')
    positionPlaceholder(phCrossAfter, rect, scrollY, crossDir, 'after')
    iframeDoc.body.appendChild(phCrossAfter)
    this._placeholders.push(phCrossAfter)

    // ── 컨테이너인 경우 "inside" 플레이스홀더 ──
    const editorType = el.getAttribute('data-editor-type')
    if (editorType === 'container') {
      const innerDirection = detectLayoutDirection(el, win)
      const phInside = createPlaceholder(iframeDoc, selectedId, el.children.length, innerDirection, 'flow')
      const innerRect = el.getBoundingClientRect()

      if (innerDirection === 'vertical') {
        phInside.className = `${PLACEHOLDER_CLASS} --v`
        phInside.style.left = innerRect.left + 8 + 'px'
        phInside.style.width = (innerRect.width - 16) + 'px'
        phInside.style.height = '22px'
        phInside.style.top = (innerRect.bottom + scrollY - 26) + 'px'
      } else {
        phInside.className = `${PLACEHOLDER_CLASS} --h`
        phInside.style.top = (innerRect.top + scrollY + 8) + 'px'
        phInside.style.height = (innerRect.height - 16) + 'px'
        phInside.style.width = '22px'
        phInside.style.left = (innerRect.right - 26) + 'px'
      }

      phInside.setAttribute('data-insert-parent', selectedId)
      phInside.setAttribute('data-insert-index', String(el.children.length))
      phInside.setAttribute('data-insert-axis', 'flow')
      iframeDoc.body.appendChild(phInside)
      this._placeholders.push(phInside)
    }

    requestAnimationFrame(() => {
      this._placeholders.forEach(p => p.classList.add('--visible'))
    })
  }

  clear(iframeDoc) {
    for (const ph of this._placeholders) {
      ph.remove()
    }
    this._placeholders = []

    if (iframeDoc) {
      iframeDoc.querySelectorAll(`.${PLACEHOLDER_CLASS}`).forEach(el => el.remove())
    }
  }
}

export { PLACEHOLDER_CLASS }
