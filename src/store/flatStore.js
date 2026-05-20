import { create } from 'zustand'
import { extractFlatElements, nextFlatId } from '../core/FlatExtractor'
import { HistoryStack } from '../core/HistoryStack'

const _history = new HistoryStack()
const _pageCache = {}   // { [pageKey]: { elements, canvasSize, fontImports, history } }
let _currentPageKey = null

/** 캐시 키를 페이지 순서로 정렬하여 반환 */
function _getSortedPageKeys() {
  return Object.keys(_pageCache).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })
}
let _pendingEditCommit = null  // 편집 중 unmount 전 커밋용 콜백

export const useFlatStore = create((set, get) => ({
  /** FlatElement 배열 */
  flatElements: [],
  /** 선택된 flat 요소 ID 배열 (다중 선택) */
  selectedFlatIds: [],
  /** 인라인 편집 중인 flat 요소 ID */
  editingFlatId: null,
  /** 뷰 모드: 'html' | 'flat' | 'split' */
  viewMode: 'flat',
  /** 캔버스 크기 */
  canvasSize: { w: 1280, h: 800 },
  /** 폰트 임포트 CSS (원본 문서에서 추출) */
  fontImports: [],
  /** 추출 시 사용한 iframeRef 캐시 (페이지 변경 시 재추출용) */
  _iframeRef: null,
  /** 프리로드 진행 상태: { current: N, total: N } | null */
  preloadProgress: null,
  /** flat 모드 페이지 수 (캐시 기준) */
  flatPageCount: 0,
  /** flat 모드 현재 페이지 인덱스 (0-based) */
  flatCurrentPage: 0,

  canUndo: false,
  canRedo: false,
  /** 복사/붙여넣기용 클립보드 */
  clipboard: null,
  /** 스타일 복사용 클립보드 */
  styleClipboard: null,
  /** 그리기 모드: null | 'line' | 'polyline' | 'polygon' */
  drawMode: null,
  /** 마키 드래그 직후 배경 click 무시용 플래그 */
  _skipBgClick: false,

  /** 이미지 크롭 모드 중인 flat 요소 ID */
  croppingFlatId: null,

  /** 속성 패널 모드: 'docked' | 'floating' */
  panelMode: 'docked',
  /** 플로팅 패널 위치 기억 */
  floatingPos: { x: null, y: 80 },

  setCroppingFlat(id) { set({ croppingFlatId: id }) },

  setPanelMode(mode) { set({ panelMode: mode }) },
  setFloatingPos(pos) { set({ floatingPos: pos }) },

  /** 편집 중 커밋 콜백 등록/해제 (FlatInlineEditor에서 사용) */
  _setPendingEditCommit(fn) {
    _pendingEditCommit = fn
  },

  /** 페이지 카운트/인덱스 갱신 (내부용) */
  _syncPageInfo() {
    const keys = _getSortedPageKeys()
    const idx = _currentPageKey ? keys.indexOf(_currentPageKey) : 0
    set({ flatPageCount: keys.length, flatCurrentPage: Math.max(idx, 0) })
  },

  /** 현재 페이지 상태를 캐시에 저장 (내부용) */
  _saveCurrentPage() {
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
    get()._syncPageInfo()
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
      selectedFlatIds: [],
      editingFlatId: null,
      canUndo: _history.canUndo,
      canRedo: _history.canRedo,
    })
    get()._syncPageInfo()
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
      selectedFlatIds: [],
      editingFlatId: null,
      _iframeRef: iframeRef,
      canUndo: false,
      canRedo: false,
    })
    get()._syncPageInfo()
  },

  /** 현재 페이지 강제 재추출 (캐시 무시, iframe 페이지 동기화) */
  async forceReExtract() {
    const ref = get()._iframeRef
    if (!ref?.current) return

    // flat 모드에서는 iframe 페이지가 동기화 안 되어 있을 수 있으므로, 현재 페이지로 이동
    const pageIdx = _currentPageKey ? parseInt(_currentPageKey.split('-')[0]) : 0
    ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: pageIdx }, '*')
    await new Promise(r => setTimeout(r, 400))

    if (_currentPageKey) delete _pageCache[_currentPageKey]
    const { elements, canvasSize, fontImports } = extractFlatElements(ref)
    _history.clear()
    set({
      flatElements: elements,
      canvasSize,
      fontImports: fontImports || [],
      selectedFlatIds: [],
      editingFlatId: null,
      canUndo: false,
      canRedo: false,
    })
    get()._syncPageInfo()
  },

  /** 해상도 변경 시 모든 캐시 초기화 + 강제 재추출 */
  forceReExtractAll() {
    for (const key in _pageCache) delete _pageCache[key]
    get().forceReExtract()
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
        selectedFlatIds: [],
        editingFlatId: null,
        canUndo: false,
        canRedo: false,
      })
    }, 150)
  },

  setViewMode(mode) {
    set({ viewMode: mode })
  },

  setDrawMode(mode) {
    set({ drawMode: mode, selectedFlatIds: [], editingFlatId: null })
  },

  /** 모든 페이지를 백그라운드로 미리 flat 변환 (로딩 시 자동 호출) */
  async preloadAllPages() {
    if (get()._preloading) return
    set({ _preloading: true })

    try {
      const editorStore = (await import('./editorStore')).useEditorStore
      const { totalPages, currentPage, iframeRef } = editorStore.getState()
      const { extractFlatElements } = await import('../core/FlatExtractor')

      if (!iframeRef?.current || totalPages <= 1) {
        set({ _preloading: false, preloadProgress: null })
        return
      }

      get()._saveCurrentPage()
      const origPage = currentPage
      let done = Object.keys(_pageCache).length

      set({ preloadProgress: { current: done, total: totalPages } })

      for (let i = 0; i < totalPages; i++) {
        const pageKey = `${i}-0`
        if (_pageCache[pageKey]) continue

        iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: i }, '*')
        await new Promise(r => setTimeout(r, 400))

        try {
          const result = extractFlatElements(iframeRef)
          _pageCache[pageKey] = {
            elements: result.elements,
            canvasSize: result.canvasSize,
            fontImports: result.fontImports || [],
            history: { stack: [], pointer: -1 },
          }
        } catch (e) {
          console.warn(`Preload page ${pageKey} failed:`, e.message)
        }

        done++
        set({ preloadProgress: { current: done, total: totalPages } })
      }

      // 원래 페이지로 복원
      iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: origPage }, '*')
      await new Promise(r => setTimeout(r, 300))

      console.log(`Preload: ${totalPages} pages cached`)
      get()._syncPageInfo()
    } catch (e) {
      console.warn('Preload failed:', e.message)
    } finally {
      set({ _preloading: false, preloadProgress: null })
    }
  },

  // ── Flat 모드 페이지 관리 ──

  /** 현재 페이지 뒤에 빈 페이지 추가 */
  addPage() {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    const currentIdx = _currentPageKey ? keys.indexOf(_currentPageKey) : keys.length - 1
    const insertAt = currentIdx + 1 // 현재 페이지 바로 뒤

    // 삽입 위치 이후의 페이지 키를 뒤로 밀기
    const reindexed = {}
    for (let i = 0; i < keys.length; i++) {
      const newIdx = i < insertAt ? i : i + 1
      reindexed[`${newIdx}-0`] = _pageCache[keys[i]]
    }
    // 기존 캐시 교체
    for (const key in _pageCache) delete _pageCache[key]
    for (const key in reindexed) _pageCache[key] = reindexed[key]

    // 새 페이지 생성
    const newKey = `${insertAt}-0`
    const cs = get().canvasSize
    _pageCache[newKey] = {
      elements: [],
      canvasSize: { ...cs },
      fontImports: [],
      history: { stack: [], pointer: -1 },
    }

    // 새 페이지로 이동
    _currentPageKey = newKey
    get()._restoreFromCache(newKey)
    get()._syncPageInfo()
  },

  /** 현재 페이지 삭제 (최소 1페이지 유지) */
  deletePage() {
    const keys = _getSortedPageKeys()
    if (keys.length <= 1) return // 마지막 페이지는 삭제 불가

    const idx = keys.indexOf(_currentPageKey)
    delete _pageCache[_currentPageKey]

    // 삭제 후 키 재정렬 (0-0, 1-0, 2-0, ...)
    const remaining = _getSortedPageKeys()
    const reindexed = {}
    remaining.forEach((oldKey, i) => {
      const newKey = `${i}-0`
      reindexed[newKey] = _pageCache[oldKey]
      delete _pageCache[oldKey]
    })
    for (const k in reindexed) _pageCache[k] = reindexed[k]

    // 인접 페이지로 이동
    const newKeys = _getSortedPageKeys()
    const targetKey = newKeys[Math.min(idx, newKeys.length - 1)]
    get()._restoreFromCache(targetKey)
    get()._syncPageInfo()
  },

  /** 현재 페이지 순서 이동 (delta: -1=앞으로, +1=뒤로) */
  movePageOrder(delta) {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    const idx = _currentPageKey ? keys.indexOf(_currentPageKey) : -1
    if (idx < 0) return
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= keys.length) return

    // 인접 페이지와 swap
    const entries = keys.map(k => _pageCache[k])
    const tmp = entries[idx]
    entries[idx] = entries[newIdx]
    entries[newIdx] = tmp

    // 캐시 재구성
    for (const k in _pageCache) delete _pageCache[k]
    entries.forEach((entry, i) => { _pageCache[`${i}-0`] = entry })

    // 이동된 위치로 전환
    _currentPageKey = `${newIdx}-0`
    get()._restoreFromCache(_currentPageKey)
    get()._syncPageInfo()
  },

  /** flat 모드 내 페이지 이동 + split 모드에서 iframe 동기화 */
  goToFlatPage(pageIndex) {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    if (pageIndex < 0 || pageIndex >= keys.length) return
    get()._restoreFromCache(keys[pageIndex])
    // split 모드: iframe도 같은 페이지로 이동
    if (get().viewMode === 'split') {
      const ref = get()._iframeRef
      ref?.current?.contentWindow?.postMessage({ type: 'fe:navigate', page: pageIndex }, '*')
    }
  },

  /** flat 모드 페이지 delta 이동 */
  navigateFlatPage(delta) {
    const keys = _getSortedPageKeys()
    const idx = keys.indexOf(_currentPageKey)
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= keys.length) return
    get().goToFlatPage(newIdx)
  },

  setSelectedFlat(id) {
    set({ selectedFlatIds: id ? [id] : [] })
  },

  /** Shift+클릭용 — 토글 선택 */
  toggleSelectFlat(id) {
    const ids = get().selectedFlatIds
    if (ids.includes(id)) {
      set({ selectedFlatIds: ids.filter(i => i !== id) })
    } else {
      set({ selectedFlatIds: [...ids, id] })
    }
  },

  /** 마키 선택 결과 일괄 설정 */
  setSelectedFlats(ids) {
    set({ selectedFlatIds: ids })
  },

  /** 전체 선택 (Ctrl+A) */
  selectAllFlats() {
    const ids = get().flatElements.map(e => e.id)
    set({ selectedFlatIds: ids })
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
    const ids = get().selectedFlatIds
    if (ids.includes(id)) updates.selectedFlatIds = ids.filter(i => i !== id)
    if (get().editingFlatId === id) updates.editingFlatId = null
    set(updates)
  },

  /** 선택된 요소 전체 삭제 (다중 삭제) */
  removeSelectedElements() {
    const { selectedFlatIds, flatElements } = get()
    if (selectedFlatIds.length === 0) return
    if (selectedFlatIds.length === 1) {
      get().removeFlatElement(selectedFlatIds[0])
      return
    }
    const entries = []
    let updated = [...flatElements]
    for (const id of selectedFlatIds) {
      const idx = updated.findIndex(e => e.id === id)
      if (idx === -1) continue
      entries.push({ element: { ...updated[idx] }, index: idx })
      updated = updated.filter(e => e.id !== id)
    }
    if (entries.length === 0) return
    _history.push({ type: 'batch_remove', entries })
    set({ flatElements: updated, selectedFlatIds: [], canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** 선택된 요소 복사 (클립보드에 저장) — 다중 지원 */
  copyElement() {
    const { selectedFlatIds, flatElements } = get()
    const copied = flatElements.filter(e => selectedFlatIds.includes(e.id))
    if (copied.length > 0) set({ clipboard: structuredClone(copied) })
  },

  /** 선택된 요소 잘라내기 (복사 + 삭제) — 다중 지원 */
  cutElement() {
    get().copyElement()
    get().removeSelectedElements()
  },

  /** 선택된 요소의 스타일 복사 (Ctrl+Shift+C) */
  copyStyle() {
    const { selectedFlatIds, flatElements } = get()
    if (selectedFlatIds.length !== 1) return
    const el = flatElements.find(e => e.id === selectedFlatIds[0])
    if (!el) return
    set({ styleClipboard: structuredClone(el.styles) })
  },

  /** 선택된 요소에 스타일 붙여넣기 (Ctrl+Shift+V) */
  pasteStyle() {
    const { styleClipboard, selectedFlatIds } = get()
    if (!styleClipboard || selectedFlatIds.length === 0) return
    get().batchUpdateFlatElements(selectedFlatIds, { styles: { ...styleClipboard } })
  },

  /** 클립보드에서 붙여넣기 — 다중 지원 */
  pasteElement() {
    const { clipboard, flatElements } = get()
    if (!clipboard || clipboard.length === 0) return
    const newEls = clipboard.map(e => ({
      ...structuredClone(e),
      id: nextFlatId(),
      sourceId: null,
      x: e.x + 20,
      y: e.y + 20,
    }))
    if (newEls.length === 1) {
      get().addFlatElement(newEls[0])
    } else {
      const entries = newEls.map(e => ({ element: structuredClone(e) }))
      _history.push({ type: 'batch_add', entries })
      set({ flatElements: [...flatElements, ...newEls], canUndo: _history.canUndo, canRedo: _history.canRedo })
    }
    set({ selectedFlatIds: newEls.map(e => e.id) })
  },

  /** 선택된 요소 복제 */
  duplicateElement() {
    get().copyElement()
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

  /** 여러 요소에 동일 changes 적용 + batch 히스토리 */
  batchUpdateFlatElements(ids, changes) {
    const els = get().flatElements
    const entries = []
    const updated = [...els]
    for (const id of ids) {
      const idx = updated.findIndex(e => e.id === id)
      if (idx === -1) continue
      const old = updated[idx]
      let merged = { ...changes }
      if (merged.styles && old.styles) {
        merged = { ...merged, styles: { ...old.styles, ...merged.styles } }
      }
      const oldValues = {}
      for (const key of Object.keys(merged)) oldValues[key] = old[key]
      entries.push({ id, oldValues, newValues: { ...merged } })
      updated[idx] = { ...old, ...merged }
    }
    if (entries.length === 0) return
    _history.push({ type: 'batch', entries })
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** 여러 요소 개별 changes 적용 + batch 히스토리 (그룹 리사이즈 등) */
  batchUpdateFlatElementsIndividual(changesMap) {
    // changesMap: [{ id, changes }]
    const els = get().flatElements
    const entries = []
    const updated = [...els]
    for (const { id, changes } of changesMap) {
      const idx = updated.findIndex(e => e.id === id)
      if (idx === -1) continue
      const old = updated[idx]
      let merged = { ...changes }
      if (merged.styles && old.styles) {
        merged = { ...merged, styles: { ...old.styles, ...merged.styles } }
      }
      const oldValues = {}
      for (const key of Object.keys(merged)) oldValues[key] = old[key]
      entries.push({ id, oldValues, newValues: { ...merged } })
      updated[idx] = { ...old, ...merged }
    }
    if (entries.length === 0) return
    _history.push({ type: 'batch', entries })
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** 여러 요소 미리보기 (히스토리 없음) — 그룹 드래그용 */
  batchPreviewFlatElements(changesMap) {
    // changesMap: [{ id, changes }]
    const els = get().flatElements
    const updated = [...els]
    for (const { id, changes } of changesMap) {
      const idx = updated.findIndex(e => e.id === id)
      if (idx === -1) continue
      const old = updated[idx]
      let merged = { ...changes }
      if (merged.styles && old.styles) {
        merged = { ...merged, styles: { ...old.styles, ...merged.styles } }
      }
      updated[idx] = { ...old, ...merged }
    }
    set({ flatElements: updated })
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
    } else if (cmd.type === 'batch') {
      const updated = [...els]
      for (const entry of cmd.entries) {
        const idx = updated.findIndex(e => e.id === entry.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], ...entry.oldValues }
      }
      set({ flatElements: updated })
    } else if (cmd.type === 'batch_remove') {
      const updated = [...els]
      for (const entry of [...cmd.entries].reverse()) {
        updated.splice(entry.index, 0, entry.element)
      }
      set({ flatElements: updated })
    } else if (cmd.type === 'batch_add') {
      let updated = els
      for (const entry of cmd.entries) {
        updated = updated.filter(e => e.id !== entry.element.id)
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
    } else if (cmd.type === 'batch') {
      const updated = [...els]
      for (const entry of cmd.entries) {
        const idx = updated.findIndex(e => e.id === entry.id)
        if (idx !== -1) updated[idx] = { ...updated[idx], ...entry.newValues }
      }
      set({ flatElements: updated })
    } else if (cmd.type === 'batch_remove') {
      let updated = els
      for (const entry of cmd.entries) {
        updated = updated.filter(e => e.id !== entry.element.id)
      }
      set({ flatElements: updated })
    } else if (cmd.type === 'batch_add') {
      const updated = [...els]
      for (const entry of cmd.entries) {
        updated.push(entry.element)
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
    _history.clear()
    set({
      flatElements: [],
      selectedFlatIds: [],
      editingFlatId: null,
      flatPageCount: 0,
      flatCurrentPage: 0,
      preloadProgress: null,
      _preloading: false,
      _iframeRef: null,
      canUndo: false,
      canRedo: false,
    })
  },

  /** 캔버스 DOM ref (이미지 내보내기용) */
  _canvasRef: null,
  setCanvasRef(ref) { set({ _canvasRef: ref }) },

  /** 모든 페이지 데이터 반환 (내보내기용) — history 제외, 캐시에 있는 것만 */
  getAllPages() {
    get()._saveCurrentPage()
    const pages = {}
    for (const key in _pageCache) {
      const cached = _pageCache[key]
      pages[key] = {
        elements: cached.elements,
        canvasSize: cached.canvasSize,
        fontImports: cached.fontImports,
      }
    }
    // 현재 페이지가 캐시에 없는 경우 (단일 페이지)
    if (_currentPageKey && !pages[_currentPageKey]) {
      pages[_currentPageKey] = {
        elements: get().flatElements,
        canvasSize: get().canvasSize,
        fontImports: get().fontImports,
      }
    }
    return { pages, currentPageKey: _currentPageKey }
  },

  /** 전체 페이지 데이터 반환 (미방문 페이지는 iframe 순회하여 추출) */
  async getAllPagesAsync() {
    get()._saveCurrentPage()

    const editorStore = (await import('./editorStore')).useEditorStore
    const { totalPages, currentPage, isReveal, iframeRef } = editorStore.getState()
    const { extractFlatElements } = await import('../core/FlatExtractor')

    // 캐시에 모든 페이지가 있으면 빠르게 반환
    const cachedKeys = Object.keys(_pageCache)
    if (cachedKeys.length >= totalPages) {
      return get().getAllPages()
    }

    // iframe이 없으면 캐시만 반환
    if (!iframeRef?.current) {
      return get().getAllPages()
    }

    const origPage = currentPage
    const pages = {}

    // 현재 캐시 내용 먼저 복사
    for (const key in _pageCache) {
      pages[key] = {
        elements: _pageCache[key].elements,
        canvasSize: _pageCache[key].canvasSize,
        fontImports: _pageCache[key].fontImports,
      }
    }

    // 미방문 페이지 추출 — 직접 page 번호로 점프 (delta가 아닌 절대 인덱스)
    for (let i = 0; i < totalPages; i++) {
      const pageKey = `${i}-0`
      if (pages[pageKey]) continue

      // 해당 페이지로 직접 이동
      iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: i }, '*')
      // 페이지 전환 + DOM 렌더링 대기
      await new Promise(r => setTimeout(r, 350))

      // 추출
      try {
        const result = extractFlatElements(iframeRef)
        pages[pageKey] = {
          elements: result.elements,
          canvasSize: result.canvasSize,
          fontImports: result.fontImports || [],
        }
      } catch (e) {
        console.warn(`Page ${pageKey} extraction failed:`, e.message)
      }
    }

    // 원래 페이지로 복원
    iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: origPage }, '*')
    await new Promise(r => setTimeout(r, 350))

    // 현재 페이지가 누락된 경우
    if (_currentPageKey && !pages[_currentPageKey]) {
      pages[_currentPageKey] = {
        elements: get().flatElements,
        canvasSize: get().canvasSize,
        fontImports: get().fontImports,
      }
    }

    return { pages, currentPageKey: _currentPageKey }
  },

  /** 모든 페이지 데이터 로드 (프로젝트 열기용) */
  loadAllPages(pagesData, currentPageKey) {
    // 캐시 초기화
    for (const key in _pageCache) delete _pageCache[key]
    _history.clear()

    // 모든 페이지를 캐시에 저장
    for (const key in pagesData) {
      _pageCache[key] = {
        elements: pagesData[key].elements,
        canvasSize: pagesData[key].canvasSize,
        fontImports: pagesData[key].fontImports || [],
        history: { stack: [], pointer: -1 },
      }
    }

    // 현재 페이지 복원
    const targetKey = currentPageKey && _pageCache[currentPageKey] ? currentPageKey : Object.keys(pagesData)[0]
    _currentPageKey = targetKey
    const page = _pageCache[targetKey]
    if (page) {
      set({
        flatElements: page.elements,
        canvasSize: page.canvasSize,
        fontImports: page.fontImports,
        selectedFlatIds: [],
        editingFlatId: null,
        canUndo: false,
        canRedo: false,
      })
    }
  },
}))
