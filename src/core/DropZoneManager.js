/**
 * DropZoneManager
 * 드래그앤드롭 시 iframe 내부의 삽입 위치를 계산하고 인디케이터를 표시한다.
 *
 * 삽입 위치 판단 (Notion/Gutenberg 스타일):
 *   - 요소 상단 30% → 해당 요소 앞에 삽입 (before)
 *   - 요소 하단 30% → 해당 요소 뒤에 삽입 (after)
 *   - 요소 중앙 40% (컨테이너만) → 컨테이너 내부 끝에 삽입 (inside)
 *   - 컨테이너가 아닌 요소의 중앙 → after로 처리
 */

const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'body'])
const INDICATOR_ID = '__fe-drop-indicator'

export class DropZoneManager {
  constructor() {
    this._indicator = null
    this._lastResult = null
  }

  /**
   * 마우스 좌표(iframe viewport 기준)로 삽입 위치를 계산한다.
   * @param {Document} iframeDoc
   * @param {number} x - iframe 내부 좌표
   * @param {number} y - iframe 내부 좌표
   * @returns {{ parentId: string|null, index: number, position: 'before'|'after'|'inside', targetEl: Element } | null}
   */
  hitTest(iframeDoc, x, y) {
    if (!iframeDoc) return null

    const el = iframeDoc.elementFromPoint(x, y)
    if (!el) return null

    const editorEl = this._findEditorElement(el)
    if (!editorEl) {
      return { parentId: null, index: iframeDoc.body.children.length, position: 'inside', targetEl: iframeDoc.body }
    }

    return this.calcPosition(editorEl, y)
  }

  /**
   * 특정 에디터 요소와 y 좌표로 삽입 위치를 계산한다.
   * hitTest에서 내부적으로 호출되며, 테스트에서도 직접 사용 가능.
   * @param {Element} editorEl - data-editor-id를 가진 요소
   * @param {number} y - viewport y 좌표
   */
  calcPosition(editorEl, y) {
    const rect = editorEl.getBoundingClientRect()
    const relY = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
    const tag = editorEl.tagName.toLowerCase()
    const isContainer = CONTAINER_TAGS.has(tag)

    const editorId = editorEl.getAttribute('data-editor-id')
    const parent = editorEl.parentElement
    const parentId = parent?.getAttribute?.('data-editor-id') || null
    const siblingIndex = parent ? [...parent.children].indexOf(editorEl) : 0

    if (relY < 0.3) {
      return { parentId, index: siblingIndex, position: 'before', targetEl: editorEl }
    } else if (relY > 0.7) {
      return { parentId, index: siblingIndex + 1, position: 'after', targetEl: editorEl }
    } else if (isContainer) {
      return { parentId: editorId, index: editorEl.children.length, position: 'inside', targetEl: editorEl }
    } else {
      return { parentId, index: siblingIndex + 1, position: 'after', targetEl: editorEl }
    }
  }

  /**
   * 부모 좌표 → iframe 내부 좌표로 변환
   * @param {MouseEvent} e - 부모 윈도우의 마우스 이벤트
   * @param {HTMLIFrameElement} iframe
   * @param {number} scale - CSS transform scale 값
   * @returns {{ x: number, y: number }}
   */
  mapCoords(e, iframe, scale) {
    const iframeRect = iframe.getBoundingClientRect()
    return {
      x: (e.clientX - iframeRect.left) / scale,
      y: (e.clientY - iframeRect.top) / scale,
    }
  }

  /**
   * 삽입 인디케이터를 iframe에 표시한다.
   * @param {Document} iframeDoc
   * @param {object} hitResult - hitTest 반환값
   */
  showIndicator(iframeDoc, hitResult) {
    if (!hitResult || !iframeDoc) { this.hideIndicator(iframeDoc); return }

    let indicator = iframeDoc.getElementById(INDICATOR_ID)
    if (!indicator) {
      indicator = iframeDoc.createElement('div')
      indicator.id = INDICATOR_ID
      Object.assign(indicator.style, {
        position: 'absolute',
        left: '0', right: '0',
        height: '3px',
        background: '#6366f1',
        borderRadius: '2px',
        pointerEvents: 'none',
        zIndex: '99999',
        transition: 'top 0.1s, opacity 0.1s',
        boxShadow: '0 0 8px rgba(99,102,241,0.5)',
      })
      iframeDoc.body.appendChild(indicator)
    }

    const { targetEl, position } = hitResult
    const rect = targetEl.getBoundingClientRect()
    const scrollY = iframeDoc.defaultView?.scrollY || 0

    if (position === 'before') {
      indicator.style.top = (rect.top + scrollY - 2) + 'px'
      indicator.style.left = rect.left + 'px'
      indicator.style.width = rect.width + 'px'
      indicator.style.height = '3px'
      indicator.style.background = '#6366f1'
    } else if (position === 'after') {
      indicator.style.top = (rect.bottom + scrollY - 1) + 'px'
      indicator.style.left = rect.left + 'px'
      indicator.style.width = rect.width + 'px'
      indicator.style.height = '3px'
      indicator.style.background = '#6366f1'
    } else {
      // inside — 컨테이너 전체를 하이라이트
      indicator.style.top = (rect.top + scrollY) + 'px'
      indicator.style.left = rect.left + 'px'
      indicator.style.width = rect.width + 'px'
      indicator.style.height = rect.height + 'px'
      indicator.style.background = 'rgba(99,102,241,0.1)'
      indicator.style.border = '2px dashed #6366f1'
      indicator.style.borderRadius = '8px'
    }

    indicator.style.opacity = '1'
    indicator.style.display = 'block'
    this._lastResult = hitResult
  }

  /**
   * 인디케이터를 제거한다.
   */
  hideIndicator(iframeDoc) {
    if (!iframeDoc) return
    const indicator = iframeDoc.getElementById(INDICATOR_ID)
    if (indicator) indicator.remove()
    this._lastResult = null
  }

  get lastResult() { return this._lastResult }

  /**
   * el 또는 그 조상에서 data-editor-id를 가진 첫 요소를 찾는다.
   * 인디케이터와 __fe-* 요소는 건너뛴다.
   */
  _findEditorElement(el) {
    while (el && el !== el.ownerDocument?.documentElement) {
      if (el.id === INDICATOR_ID || el.id?.startsWith('__fe-') || el.classList?.contains('__fe-insert-ph') || el.classList?.contains('__fe-flex-handle') || el.classList?.contains('__fe-resize-handle')) {
        el = el.parentElement
        continue
      }
      if (el.getAttribute?.('data-editor-id')) return el
      el = el.parentElement
    }
    return null
  }
}

export const INDICATOR_ID_CONST = INDICATOR_ID
