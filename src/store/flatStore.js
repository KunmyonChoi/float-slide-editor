import { create } from 'zustand'
import { extractFlatElements, nextFlatId } from '../core/FlatExtractor'
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
  /** 복사/붙여넣기용 클립보드 */
  clipboard: null,
  /** 속성 패널 모드: 'docked' | 'floating' */
  panelMode: 'docked',
  /** 플로팅 패널 위치 기억 */
  floatingPos: { x: null, y: 80 },

  setPanelMode(mode) { set({ panelMode: mode }) },
  setFloatingPos(pos) { set({ floatingPos: pos }) },

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
    // styles 중첩 머지 — 개별 스타일 키만 변경해도 나머지 보존
    if (changes.styles && old.styles) {
      changes = { ...changes, styles: { ...old.styles, ...changes.styles } }
    }
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

    if (changes.styles && els[idx].styles) {
      changes = { ...changes, styles: { ...els[idx].styles, ...changes.styles } }
    }
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

  /** 요소 복사 (클립보드에 저장) */
  copyElement(id) {
    const el = get().flatElements.find(e => e.id === id)
    if (el) set({ clipboard: structuredClone(el) })
  },

  /** 요소 잘라내기 (복사 + 삭제) */
  cutElement(id) {
    get().copyElement(id)
    get().removeFlatElement(id)
  },

  /** 클립보드에서 붙여넣기 */
  pasteElement() {
    const { clipboard } = get()
    if (!clipboard) return
    const newEl = {
      ...structuredClone(clipboard),
      id: nextFlatId(),
      sourceId: null,
      x: clipboard.x + 20,
      y: clipboard.y + 20,
    }
    get().addFlatElement(newEl)
    set({ selectedFlatId: newEl.id })
  },

  /** 요소 복제 (copy + paste) */
  duplicateElement(id) {
    get().copyElement(id)
    get().pasteElement()
  },

  /** 요소 추가 (히스토리 기록) */
  addFlatElement(element) {
    const els = get().flatElements
    _history.push({ type: 'add', element: structuredClone(element) })
    set({
      flatElements: [...els, element],
      canUndo: _history.canUndo, canRedo: _history.canRedo,
    })
  },

  /** z-순서: 한 단계 앞으로 */
  bringForward(id) {
    const els = get().flatElements
    const el = els.find(e => e.id === id)
    if (!el) return
    const sorted = [...els].sort((a, b) => a.zIndex - b.zIndex)
    const above = sorted.find(e => e.zIndex > el.zIndex)
    if (!above) return
    _history.push({ type: 'zorder', changes: [
      { id: el.id, oldZ: el.zIndex, newZ: above.zIndex },
      { id: above.id, oldZ: above.zIndex, newZ: el.zIndex },
    ]})
    const updated = els.map(e => {
      if (e.id === el.id) return { ...e, zIndex: above.zIndex }
      if (e.id === above.id) return { ...e, zIndex: el.zIndex }
      return e
    })
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** z-순서: 한 단계 뒤로 */
  sendBackward(id) {
    const els = get().flatElements
    const el = els.find(e => e.id === id)
    if (!el) return
    const sorted = [...els].sort((a, b) => b.zIndex - a.zIndex)
    const below = sorted.find(e => e.zIndex < el.zIndex)
    if (!below) return
    _history.push({ type: 'zorder', changes: [
      { id: el.id, oldZ: el.zIndex, newZ: below.zIndex },
      { id: below.id, oldZ: below.zIndex, newZ: el.zIndex },
    ]})
    const updated = els.map(e => {
      if (e.id === el.id) return { ...e, zIndex: below.zIndex }
      if (e.id === below.id) return { ...e, zIndex: el.zIndex }
      return e
    })
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** z-순서: 맨 앞으로 */
  bringToFront(id) {
    const els = get().flatElements
    const el = els.find(e => e.id === id)
    if (!el) return
    const maxZ = Math.max(...els.map(e => e.zIndex))
    if (el.zIndex >= maxZ) return
    _history.push({ type: 'zorder', changes: [
      { id: el.id, oldZ: el.zIndex, newZ: maxZ + 1 },
    ]})
    const updated = els.map(e =>
      e.id === el.id ? { ...e, zIndex: maxZ + 1 } : e
    )
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** z-순서: 맨 뒤로 */
  sendToBack(id) {
    const els = get().flatElements
    const el = els.find(e => e.id === id)
    if (!el) return
    const minZ = Math.min(...els.map(e => e.zIndex))
    if (el.zIndex <= minZ) return
    _history.push({ type: 'zorder', changes: [
      { id: el.id, oldZ: el.zIndex, newZ: minZ - 1 },
    ]})
    const updated = els.map(e =>
      e.id === el.id ? { ...e, zIndex: minZ - 1 } : e
    )
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
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
    } else if (cmd.type === 'add') {
      set({ flatElements: els.filter(e => e.id !== cmd.element.id) })
    } else if (cmd.type === 'zorder') {
      const updated = [...els]
      for (const c of cmd.changes) {
        const idx = updated.findIndex(e => e.id === c.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], zIndex: c.oldZ }
      }
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
      set({ flatElements: els.filter(e => e.id !== cmd.element.id) })
    } else if (cmd.type === 'add') {
      set({ flatElements: [...els, cmd.element] })
    } else if (cmd.type === 'zorder') {
      const updated = [...els]
      for (const c of cmd.changes) {
        const idx = updated.findIndex(e => e.id === c.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], zIndex: c.newZ }
      }
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
