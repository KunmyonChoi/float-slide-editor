/**
 * FlexResizeHandle
 * flex 컨테이너의 자식 사이에 드래그 가능한 리사이즈 핸들을 표시한다.
 * 드래그하면 양쪽 요소의 flex 비율을 실시간으로 조정한다.
 */

const HANDLE_CLASS = '__fe-flex-handle'
const HANDLE_STYLE_ID = '__fe-flex-handle-style'

function ensureStyle(doc) {
  if (doc.getElementById(HANDLE_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = HANDLE_STYLE_ID
  style.textContent = `
    .${HANDLE_CLASS} {
      position: absolute;
      z-index: 99997;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: all;
    }
    .${HANDLE_CLASS}.--visible { opacity: 1; }
    .${HANDLE_CLASS}.--h {
      cursor: col-resize;
      width: 12px;
    }
    .${HANDLE_CLASS}.--v {
      cursor: row-resize;
      height: 12px;
    }
    .${HANDLE_CLASS} .--bar {
      border-radius: 2px;
      background: rgba(99,102,241,0.25);
      transition: background 0.15s;
    }
    .${HANDLE_CLASS}.--h .--bar {
      width: 3px;
      height: 100%;
      max-height: 48px;
    }
    .${HANDLE_CLASS}.--v .--bar {
      height: 3px;
      width: 100%;
      max-width: 48px;
    }
    .${HANDLE_CLASS}:hover .--bar,
    .${HANDLE_CLASS}.--active .--bar {
      background: rgba(99,102,241,0.7);
    }
  `
  doc.head.appendChild(style)
}

/**
 * 두 형제 사이의 flex 값을 파싱한다.
 * @returns {number} 현재 flex 값 (기본 1)
 */
function parseFlex(el) {
  const v = parseFloat(el.style.flex)
  return isNaN(v) || v <= 0 ? 1 : v
}

export class FlexResizeHandle {
  constructor() {
    this._handles = []
    this._dragging = null
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)
  }

  /**
   * 선택된 요소가 flex 컨테이너의 자식인 경우 형제 사이에 핸들을 표시한다.
   * @param {Document} iframeDoc
   * @param {string} selectedId
   * @param {object} callbacks - { previewStyle, applyStyle }
   */
  update(iframeDoc, selectedId, callbacks) {
    this.clear(iframeDoc)
    if (!iframeDoc || !selectedId) return

    const el = iframeDoc.querySelector(`[data-editor-id="${selectedId}"]`)
    if (!el || !el.parentElement) return

    const parent = el.parentElement
    const win = iframeDoc.defaultView
    if (!win) return

    const cs = win.getComputedStyle(parent)
    const display = cs.display
    if (display !== 'flex' && display !== 'inline-flex') return

    const dir = cs.flexDirection
    const isRow = dir === 'row' || dir === 'row-reverse'

    ensureStyle(iframeDoc)

    // 편집기 요소인 자식만 필터
    const children = [...parent.children].filter(
      c => c.getAttribute?.('data-editor-id') && !c.classList?.contains(HANDLE_CLASS)
    )
    if (children.length < 2) return

    const scrollY = win.scrollY || 0

    // 인접한 형제 쌍 사이에 핸들 생성
    for (let i = 0; i < children.length - 1; i++) {
      const left = children[i]
      const right = children[i + 1]
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()

      const handle = iframeDoc.createElement('div')
      handle.className = `${HANDLE_CLASS} --${isRow ? 'h' : 'v'}`

      const bar = iframeDoc.createElement('div')
      bar.className = '--bar'
      handle.appendChild(bar)

      if (isRow) {
        const midX = (leftRect.right + rightRect.left) / 2
        const top = Math.min(leftRect.top, rightRect.top)
        const bottom = Math.max(leftRect.bottom, rightRect.bottom)
        handle.style.left = (midX - 6) + 'px'
        handle.style.top = (top + scrollY) + 'px'
        handle.style.height = (bottom - top) + 'px'
      } else {
        const midY = (leftRect.bottom + rightRect.top) / 2
        const left2 = Math.min(leftRect.left, rightRect.left)
        const right2 = Math.max(leftRect.right, rightRect.right)
        handle.style.top = (midY + scrollY - 6) + 'px'
        handle.style.left = left2 + 'px'
        handle.style.width = (right2 - left2) + 'px'
      }

      // 드래그 시작
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        handle.classList.add('--active')
        this._dragging = {
          leftEl: left,
          rightEl: right,
          leftId: left.getAttribute('data-editor-id'),
          rightId: right.getAttribute('data-editor-id'),
          startX: e.clientX,
          startY: e.clientY,
          startLeftFlex: parseFlex(left),
          startRightFlex: parseFlex(right),
          isRow,
          parentSize: isRow
            ? parent.getBoundingClientRect().width
            : parent.getBoundingClientRect().height,
          callbacks,
          handle,
        }

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

    const delta = d.isRow
      ? (e.clientX - d.startX)
      : (e.clientY - d.startY)

    const totalFlex = d.startLeftFlex + d.startRightFlex
    const pxPerFlex = d.parentSize / totalFlex
    const flexDelta = pxPerFlex > 0 ? delta / pxPerFlex : 0

    const newLeft = Math.max(0.1, d.startLeftFlex + flexDelta)
    const newRight = Math.max(0.1, d.startRightFlex - flexDelta)

    // 소수점 2자리로 반올림
    const leftVal = Math.round(newLeft * 100) / 100
    const rightVal = Math.round(newRight * 100) / 100

    // 실시간 미리보기
    d.callbacks.previewStyle(d.leftId, 'flex', String(leftVal))
    d.callbacks.previewStyle(d.rightId, 'flex', String(rightVal))
  }

  _onMouseUp(e) {
    const d = this._dragging
    if (!d) return

    const delta = d.isRow
      ? (e.clientX - d.startX)
      : (e.clientY - d.startY)

    const totalFlex = d.startLeftFlex + d.startRightFlex
    const pxPerFlex = d.parentSize / totalFlex
    const flexDelta = pxPerFlex > 0 ? delta / pxPerFlex : 0

    const leftVal = String(Math.round(Math.max(0.1, d.startLeftFlex + flexDelta) * 100) / 100)
    const rightVal = String(Math.round(Math.max(0.1, d.startRightFlex - flexDelta) * 100) / 100)

    // 히스토리에 기록
    d.callbacks.applyStyle(d.leftId, 'flex', leftVal)
    d.callbacks.applyStyle(d.rightId, 'flex', rightVal)

    d.handle.classList.remove('--active')

    const doc = d.leftEl.ownerDocument
    doc.removeEventListener('mousemove', this._onMouseMove)
    doc.removeEventListener('mouseup', this._onMouseUp)
    this._dragging = null

    // 핸들 위치 재계산
    const selectedId = d.leftId
    this.update(doc, selectedId, d.callbacks)
  }

  clear(iframeDoc) {
    if (this._dragging) {
      const doc = this._dragging.leftEl?.ownerDocument
      if (doc) {
        doc.removeEventListener('mousemove', this._onMouseMove)
        doc.removeEventListener('mouseup', this._onMouseUp)
      }
      this._dragging = null
    }
    for (const h of this._handles) {
      h.remove()
    }
    this._handles = []
    if (iframeDoc) {
      iframeDoc.querySelectorAll(`.${HANDLE_CLASS}`).forEach(el => el.remove())
    }
  }
}

export { HANDLE_CLASS }
