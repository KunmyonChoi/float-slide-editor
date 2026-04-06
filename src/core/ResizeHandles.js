/**
 * ResizeHandles
 * 선택된 요소의 8방향에 리사이즈 핸들을 표시하고,
 * 드래그로 width/height를 실시간 조정한다.
 *
 * 핸들 위치 (요소 경계 위에 배치):
 *   nw ── n ── ne
 *   |          |
 *   w          e
 *   |          |
 *   sw ── s ── se
 */

const HANDLE_CLASS = '__fe-resize-handle'
const STYLE_ID = '__fe-resize-handle-style'

const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const CURSORS = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
}

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${HANDLE_CLASS} {
      position: absolute;
      z-index: 99999;
      width: 8px;
      height: 8px;
      background: #fff;
      border: 1.5px solid #6366f1;
      border-radius: 1px;
      pointer-events: all;
      opacity: 0;
      transition: opacity 0.12s, background 0.12s;
      box-sizing: border-box;
    }
    .${HANDLE_CLASS}.--visible { opacity: 1; }
    .${HANDLE_CLASS}:hover, .${HANDLE_CLASS}.--active {
      background: #6366f1;
    }
  `
  doc.head.appendChild(style)
}

/**
 * 핸들의 위치를 계산한다.
 * @returns {{ left: number, top: number }}
 */
function handlePosition(dir, rect, scrollY) {
  const S = 8 // handle size
  const H = S / 2
  const l = rect.left
  const t = rect.top + scrollY
  const r = rect.right
  const b = rect.bottom + scrollY
  const cx = (l + r) / 2
  const cy = (t + b) / 2

  switch (dir) {
    case 'nw': return { left: l - H, top: t - H }
    case 'n':  return { left: cx - H, top: t - H }
    case 'ne': return { left: r - H, top: t - H }
    case 'e':  return { left: r - H, top: cy - H }
    case 'se': return { left: r - H, top: b - H }
    case 's':  return { left: cx - H, top: b - H }
    case 'sw': return { left: l - H, top: b - H }
    case 'w':  return { left: l - H, top: cy - H }
  }
}

/**
 * 드래그 delta로부터 width/height 변화량을 계산한다.
 */
function calcSizeDelta(dir, dx, dy) {
  let dw = 0, dh = 0
  // 가로
  if (dir.includes('e')) dw = dx
  if (dir.includes('w')) dw = -dx
  // 세로
  if (dir.includes('s')) dh = dy
  if (dir.includes('n')) dh = -dy
  return { dw, dh }
}

export class ResizeHandles {
  constructor() {
    this._handles = []
    this._dragging = null
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)
  }

  /**
   * 선택된 요소 주변에 8개 핸들을 표시한다.
   * @param {Document} iframeDoc
   * @param {string} selectedId
   * @param {object} callbacks - { previewStyle, applyStyle }
   * @param {object} managers - { ipm } 삽입 플레이스홀더 매니저 (드래그 시 숨김용)
   */
  update(iframeDoc, selectedId, callbacks, managers) {
    this.clear(iframeDoc)
    if (!iframeDoc || !selectedId) return

    const el = iframeDoc.querySelector(`[data-editor-id="${selectedId}"]`)
    if (!el) return

    const win = iframeDoc.defaultView
    if (!win) return

    ensureStyle(iframeDoc)

    const rect = el.getBoundingClientRect()
    const scrollY = win.scrollY || 0

    for (const dir of DIRS) {
      const handle = iframeDoc.createElement('div')
      handle.className = HANDLE_CLASS
      handle.style.cursor = CURSORS[dir]
      handle.setAttribute('data-resize-dir', dir)

      const pos = handlePosition(dir, rect, scrollY)
      handle.style.left = pos.left + 'px'
      handle.style.top = pos.top + 'px'

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        handle.classList.add('--active')

        // 현재 크기 읽기 (computed 기준)
        const cs = win.getComputedStyle(el)
        const startW = parseFloat(cs.width) || rect.width
        const startH = parseFloat(cs.height) || rect.height

        this._dragging = {
          el,
          id: selectedId,
          dir,
          startX: e.clientX,
          startY: e.clientY,
          startW,
          startH,
          handle,
          callbacks,
          managers,
        }

        // 드래그 중 플레이스홀더 숨김
        if (managers?.ipm) managers.ipm.clear(iframeDoc)

        iframeDoc.addEventListener('mousemove', this._onMouseMove)
        iframeDoc.addEventListener('mouseup', this._onMouseUp)
      })

      iframeDoc.body.appendChild(handle)
      this._handles.push(handle)
    }

    requestAnimationFrame(() => {
      this._handles.forEach(h => h.classList.add('--visible'))
    })
  }

  _onMouseMove(e) {
    const d = this._dragging
    if (!d) return

    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const { dw, dh } = calcSizeDelta(d.dir, dx, dy)

    const newW = Math.max(20, d.startW + dw)
    const newH = Math.max(20, d.startH + dh)

    // 가로 변화가 있는 핸들
    if (d.dir.includes('e') || d.dir.includes('w')) {
      d.callbacks.previewStyle(d.id, 'width', Math.round(newW) + 'px')
      // flex 아이템이면 flex를 제거하여 명시적 width가 작동하도록
      if (d.el.style.flex) {
        d.callbacks.previewStyle(d.id, 'flex', '')
      }
    }
    // 세로 변화가 있는 핸들
    if (d.dir.includes('n') || d.dir.includes('s')) {
      d.callbacks.previewStyle(d.id, 'height', Math.round(newH) + 'px')
    }

    // 핸들 위치 실시간 업데이트
    this._repositionHandles(d.el)
  }

  _onMouseUp(e) {
    const d = this._dragging
    if (!d) return

    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const { dw, dh } = calcSizeDelta(d.dir, dx, dy)

    const newW = Math.max(20, d.startW + dw)
    const newH = Math.max(20, d.startH + dh)

    // 히스토리에 기록
    if (d.dir.includes('e') || d.dir.includes('w')) {
      if (d.el.style.flex) {
        d.callbacks.applyStyle(d.id, 'flex', '')
      }
      d.callbacks.applyStyle(d.id, 'width', Math.round(newW) + 'px')
    }
    if (d.dir.includes('n') || d.dir.includes('s')) {
      d.callbacks.applyStyle(d.id, 'height', Math.round(newH) + 'px')
    }

    d.handle.classList.remove('--active')

    const doc = d.el.ownerDocument
    doc.removeEventListener('mousemove', this._onMouseMove)
    doc.removeEventListener('mouseup', this._onMouseUp)

    // 핸들 위치 갱신
    this._repositionHandles(d.el)

    // 플레이스홀더 복원
    if (d.managers?.ipm) {
      d.managers.ipm.update(doc, d.id)
    }

    this._dragging = null
  }

  /** 드래그 중 핸들 위치를 현재 요소 크기에 맞게 갱신 */
  _repositionHandles(el) {
    const rect = el.getBoundingClientRect()
    const scrollY = el.ownerDocument.defaultView?.scrollY || 0
    for (const handle of this._handles) {
      const dir = handle.getAttribute('data-resize-dir')
      const pos = handlePosition(dir, rect, scrollY)
      handle.style.left = pos.left + 'px'
      handle.style.top = pos.top + 'px'
    }
  }

  clear(iframeDoc) {
    if (this._dragging) {
      const doc = this._dragging.el?.ownerDocument
      if (doc) {
        doc.removeEventListener('mousemove', this._onMouseMove)
        doc.removeEventListener('mouseup', this._onMouseUp)
      }
      this._dragging = null
    }
    for (const h of this._handles) h.remove()
    this._handles = []
    if (iframeDoc) {
      iframeDoc.querySelectorAll(`.${HANDLE_CLASS}`).forEach(el => el.remove())
    }
  }
}

export { HANDLE_CLASS }
