import { create } from 'zustand'
import { extractFlatElements } from '../core/FlatExtractor'
import { HistoryStack } from '../core/HistoryStack'

const _history = new HistoryStack()
const _pageCache = {}   // { [pageKey]: { elements, canvasSize, fontImports, history } }
let _currentPageKey = null
let _pendingEditCommit = null  // 편집 중 unmount 전 커밋용 콜백

export const useFlatStore = create((set, get) => ({
  /** FlatElement 배열 */
  flatElements: [],
  /** 선택된 flat 요소 ID */
  selectedFlatId: null,
  /** 인라인 편집 중인 flat 요소 ID */
  editingFlatId: null,
  /** 뷰 모드: 'html' | 'flat' | 'split' */
  viewMode: 'html',
  /** 캔버스 크기 */
  canvasSize: { w: 1280, h: 800 },
  /** 폰트 임포트 CSS (원본 문서에서 추출) */
  fontImports: [],
  /** 추출 시 사용한 iframeRef 캐시 (페이지 변경 시 재추출용) */
  _iframeRef: null,

  canUndo: false,
  canRedo: false,

  /** 편집 중 커밋 콜백 등록/해제 (FlatInlineEditor에서 사용) */
  _setPendingEditCommit(fn) {
    _pendingEditCommit = fn
  },

  /** 현재 페이지 상태를 캐시에 저장 (내부용) */
  _saveCurrentPage() {
    // 편집 중이면 먼저 커밋 (DOM 콘텐츠 → store 반영)
    if (_pendingEditCommit) {
      _pendingEditCommit()
      _pendingEditCommit = null
    }
    if (!_currentPageKey || get().flatElements.length === 0) return
    _pageCache[_currentPageKey] = {
      elements: get().flatElements,
      canvasSize: get().canvasSize,
      fontImports: get().fontImports,
      history: _history.getState(),
    }
  },

  /** 캐시에서 페이지 복원 (내부용). 성공 시 true */
  _restoreFromCache(pageKey) {
    const cached = _pageCache[pageKey]
    if (!cached) return false
    _history.setState(cached.history)
    _currentPageKey = pageKey
    set({
      flatElements: cached.elements,
      canvasSize: cached.canvasSize,
      fontImports: cached.fontImports,
      selectedFlatId: null,
      editingFlatId: null,
      canUndo: _history.canUndo,
      canRedo: _history.canRedo,
    })
    return true
  },

  /** iframe DOM에서 flat 요소를 추출 */
  extractFromIframe(iframeRef, pageKey) {
    // 현재 페이지 캐시 저장
    get()._saveCurrentPage()

    // 캐시 확인
    if (pageKey && get()._restoreFromCache(pageKey)) {
      set({ _iframeRef: iframeRef })
      return
    }

    // 캐시 미스 → 새로 추출
    const { elements, canvasSize, fontImports } = extractFlatElements(iframeRef)
    _history.clear()
    _currentPageKey = pageKey || null
    set({
      flatElements: elements,
      canvasSize,
      fontImports: fontImports || [],
      selectedFlatId: null,
      editingFlatId: null,
      _iframeRef: iframeRef,
      canUndo: false,
      canRedo: false,
    })
  },

  /** 페이지 변경 시 재추출 (split/flat 모드에서 호출) */
  reExtract(pageKey) {
    const ref = get()._iframeRef
    if (!ref) return

    // 현재 페이지 캐시 저장
    get()._saveCurrentPage()

    // 캐시 확인
    if (pageKey && get()._restoreFromCache(pageKey)) return

    // 캐시 미스 → DOM 렌더 대기 후 추출
    setTimeout(() => {
      const { elements, canvasSize, fontImports } = extractFlatElements(ref)
      _history.clear()
      _currentPageKey = pageKey || null
      set({
        flatElements: elements,
        canvasSize,
        fontImports: fontImports || [],
        selectedFlatId: null,
        editingFlatId: null,
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

  /** 인라인 텍스트 편집 시작/종료 */
  setEditingFlat(id) {
    set({ editingFlatId: id })
  },

  /** 인라인 편집 완료 — content/isRich 업데이트 후 편집 모드 종료 */
  commitTextEdit(id, newContent, isRich) {
    get().updateFlatElement(id, { content: newContent, isRich })
    set({ editingFlatId: null })
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

  /** 히스토리 초기화 */
  clearHistory() {
    _history.clear()
    set({ canUndo: false, canRedo: false })
  },

  /** 페이지 캐시 전체 초기화 (새 HTML 로드 시) */
  clearPageCache() {
    for (const key in _pageCache) delete _pageCache[key]
    _currentPageKey = null
  },
}))
