/**
 * SelectionManager
 * 선택된 요소 ID를 관리하고 DOM에 하이라이트 속성을 토글한다.
 */

export class SelectionManager {
  constructor() {
    this._selected = null
    this._listeners = new Set()
    this._rootEl = null
  }

  /**
   * @param {HTMLElement} rootEl - SlideCanvas의 루트 DOM
   */
  attach(rootEl) {
    this._rootEl = rootEl
  }

  detach() {
    this._clearHighlight()
    this._rootEl = null
  }

  /** @returns {string|null} */
  get selected() {
    return this._selected
  }

  /**
   * @param {string|null} id
   */
  select(id) {
    if (this._selected === id) return
    this._clearHighlight()
    this._selected = id
    if (id && this._rootEl) {
      const el = this._rootEl.querySelector(`[data-editor-id="${id}"]`)
      if (el) el.setAttribute('data-editor-selected', 'true')
    }
    this._notify()
  }

  deselect() {
    this.select(null)
  }

  /**
   * @param {(id: string|null) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _clearHighlight() {
    if (this._selected && this._rootEl) {
      const el = this._rootEl.querySelector(`[data-editor-id="${this._selected}"]`)
      if (el) el.removeAttribute('data-editor-selected')
    }
  }

  _notify() {
    for (const fn of this._listeners) fn(this._selected)
  }
}
