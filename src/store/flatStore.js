import { create } from 'zustand'
import { extractFlatElements } from '../core/FlatExtractor'
import { HistoryStack } from '../core/HistoryStack'

const _history = new HistoryStack()

export const useFlatStore = create((set, get) => ({
  /** FlatElement 배열 */
  flatElements: [],
  /** 선택된 flat 요소 ID */
  selectedFlatId: null,
  /** 뷰 모드: 'html' | 'flat' | 'split' */
  viewMode: 'html',
  /** 캔버스 크기 */
  canvasSize: { w: 1280, h: 800 },
  /** 추출 시 사용한 iframeRef 캐시 (페이지 변경 시 재추출용) */
  _iframeRef: null,

  canUndo: false,
  canRedo: false,

  /** iframe DOM에서 flat 요소를 추출 */
  extractFromIframe(iframeRef) {
    const { elements, canvasSize } = extractFlatElements(iframeRef)
    _history.clear()
    set({
      flatElements: elements,
      canvasSize,
      selectedFlatId: null,
      _iframeRef: iframeRef,
      canUndo: false,
      canRedo: false,
    })
  },

  /** 페이지 변경 시 재추출 (split/flat 모드에서 호출) */
  reExtract() {
    const ref = get()._iframeRef
    if (!ref) return
    // 약간의 딜레이: DOM 전환 후 렌더 대기
    setTimeout(() => {
      const { elements, canvasSize } = extractFlatElements(ref)
      _history.clear()
      set({
        flatElements: elements,
        canvasSize,
        selectedFlatId: null,
        canUndo: false,
        canRedo: false,
      })
    }, 150)
  },

  setViewMode(mode) {
    set({ viewMode: mode })
  },

  setSelectedFlat(id) {
    set({ selectedFlatId: id })
  },

  /** flat 요소 부분 업데이트 (히스토리에 기록) */
  updateFlatElement(id, changes) {
    const els = get().flatElements
    const idx = els.findIndex(e => e.id === id)
    if (idx === -1) return

    const old = els[idx]
    const oldValues = {}
    for (const key of Object.keys(changes)) {
      oldValues[key] = old[key]
    }

    _history.push({ type: 'update', id, oldValues, newValues: { ...changes } })

    const updated = [...els]
    updated[idx] = { ...old, ...changes }
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** 실시간 미리보기 (히스토리 없음) */
  previewFlatElement(id, changes) {
    const els = get().flatElements
    const idx = els.findIndex(e => e.id === id)
    if (idx === -1) return

    const updated = [...els]
    updated[idx] = { ...updated[idx], ...changes }
    set({ flatElements: updated })
  },

  /** flat 요소 삭제 */
  removeFlatElement(id) {
    const els = get().flatElements
    const idx = els.findIndex(e => e.id === id)
    if (idx === -1) return

    const removed = els[idx]
    _history.push({ type: 'remove', element: removed, index: idx })

    const updated = els.filter(e => e.id !== id)
    const updates = { flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo }
    if (get().selectedFlatId === id) updates.selectedFlatId = null
    set(updates)
  },

  undo() {
    const cmd = _history.undo()
    if (!cmd) return
    const els = get().flatElements

    if (cmd.type === 'update') {
      const idx = els.findIndex(e => e.id === cmd.id)
      if (idx === -1) return
      const updated = [...els]
      updated[idx] = { ...updated[idx], ...cmd.oldValues }
      set({ flatElements: updated })
    } else if (cmd.type === 'remove') {
      const updated = [...els]
      updated.splice(cmd.index, 0, cmd.element)
      set({ flatElements: updated })
    }

    set({ canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  redo() {
    const cmd = _history.redo()
    if (!cmd) return
    const els = get().flatElements

    if (cmd.type === 'update') {
      const idx = els.findIndex(e => e.id === cmd.id)
      if (idx === -1) return
      const updated = [...els]
      updated[idx] = { ...updated[idx], ...cmd.newValues }
      set({ flatElements: updated })
    } else if (cmd.type === 'remove') {
      const updated = els.filter(e => e.id !== cmd.element.id)
      set({ flatElements: updated })
    }

    set({ canUndo: _history.canUndo, canRedo: _history.canRedo })
  },
}))
