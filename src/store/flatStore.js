import { create } from 'zustand'
import { extractFlatElementsFromIframe, nextFlatId } from '../core/FlatExtractor'
import { HistoryStack } from '../core/HistoryStack'
import { isBackgroundElement } from '../core/SnapEngine'

// 배경 레이어 판정 — SnapEngine의 canonical 헬퍼 재노출(명시 플래그 + 전체캔버스 휴리스틱)
export { isBackgroundElement as isBackgroundLayer }

const _history = new HistoryStack()
const _pageCache = {}   // { [pageKey]: { elements, canvasSize, fontImports, history } }
let _currentPageKey = null


/**
 * 재생성 시 페이지 캐시 재구성 (순수) — 원래 순서를 유지하며 html-backed 페이지는
 * 새로 추출한 데이터로 교체하고, flat-only 페이지(htmlSlideIndex=null)는 그대로 보존한다.
 * @param {Array<{htmlSlideIndex:number|null, entry:object}>} orderedSnapshot 원래 순서의 페이지들
 * @param {Object} freshHtml { [slideIdx]: entry } 새로 추출한 HTML 페이지들
 * @returns {Object} 새 _pageCache 맵
 */
export function buildRegeneratedCache(orderedSnapshot, freshHtml) {
  const cache = {}
  let idx = 0
  const usedHtml = new Set()
  for (const snap of orderedSnapshot) {
    if (snap.htmlSlideIndex != null) {
      const fresh = freshHtml[snap.htmlSlideIndex]
      if (!fresh) continue // HTML 슬라이드가 사라짐 → 스킵
      cache[`${idx}-0`] = { ...fresh, htmlSlideIndex: snap.htmlSlideIndex }
      usedHtml.add(snap.htmlSlideIndex)
    } else {
      cache[`${idx}-0`] = snap.entry // flat-only 페이지 보존
    }
    idx++
  }
  // 스냅샷에 없던 새 HTML 슬라이드는 끝에 추가
  Object.keys(freshHtml).map(Number).sort((a, b) => a - b).forEach(si => {
    if (!usedHtml.has(si)) {
      cache[`${idx}-0`] = { ...freshHtml[si], htmlSlideIndex: si }
      idx++
    }
  })
  return cache
}

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
  /** 현재 페이지가 HTML 원본 슬라이드를 가지는지 (split 모드 표시용) */
  currentPageHtmlBacked: true,

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
  /** 도킹 속성 패널 접힘 여부 */
  panelCollapsed: false,
  /** 디버그 모드 — 품질/변환검증/Phase 라벨/html·split 뷰 등 진단 UI 노출 */
  debugMode: false,

  setCroppingFlat(id) { set({ croppingFlatId: id }) },

  /** 디버그 모드 토글 — 끄면 진단 뷰(html/split)에서 flat으로 복귀 */
  setDebugMode(v) {
    const on = !!v
    const patch = { debugMode: on }
    if (!on && get().viewMode !== 'flat') patch.viewMode = 'flat'
    set(patch)
  },

  setPanelMode(mode) { set({ panelMode: mode }) },
  setFloatingPos(pos) { set({ floatingPos: pos }) },
  togglePanelCollapsed() { set(s => ({ panelCollapsed: !s.panelCollapsed })) },

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
    const existed = _pageCache[_currentPageKey]
    // HTML 소스 슬라이드 인덱스: 기존 항목이 있으면 그 값 유지(flat-only의 null 포함),
    // 없으면(첫 저장) 키에서 파생. 키는 첫 변환 시 슬라이드 인덱스를 인코딩.
    const htmlSlideIndex = existed ? existed.htmlSlideIndex
      : (Number.isNaN(parseInt(String(_currentPageKey).split('-')[0])) ? null : parseInt(String(_currentPageKey).split('-')[0]))
    _pageCache[_currentPageKey] = {
      elements: get().flatElements,
      canvasSize: get().canvasSize,
      fontImports: get().fontImports,
      history: _history.getState(),
      htmlSlideIndex,
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
      currentPageHtmlBacked: cached.htmlSlideIndex != null,
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
    const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(iframeRef)
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
      currentPageHtmlBacked: true, // iframe에서 갓 추출 = HTML 백킹
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
    const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref)
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

  /**
   * 재생성 버튼 — HTML 슬라이드 전체를 처음부터 끝까지 다시 flat 변환.
   * (최초 로딩 시와 동일: 캐시 초기화 → 현재 페이지 재추출 → 나머지 페이지 프리로드)
   */
  async regenerateAllPages() {
    const ref = get()._iframeRef
    if (!ref?.current) { await get().forceReExtractAll(); return }

    // 1) 현재 순서 + 각 페이지의 소스/데이터 스냅샷 (flat-only 보존용)
    get()._saveCurrentPage()
    const orderedSnapshot = _getSortedPageKeys().map(k => ({
      htmlSlideIndex: _pageCache[k].htmlSlideIndex,
      entry: _pageCache[k],
    }))

    // 2) HTML 슬라이드 재추출 (진행률 표시)
    const editorStore = (await import('./editorStore')).useEditorStore
    const { totalPages, currentPage } = editorStore.getState()
    set({ _preloading: true, preloadProgress: { current: 0, total: totalPages } })
    const freshHtml = {}
    try {
      for (let i = 0; i < totalPages; i++) {
        ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: i }, '*')
        await new Promise(r => setTimeout(r, 400))
        try {
          const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref)
          freshHtml[i] = { elements, canvasSize, fontImports: fontImports || [], history: { stack: [], pointer: -1 } }
        } catch (e) {
          console.warn(`Regen page ${i} failed:`, e.message)
        }
        set({ preloadProgress: { current: i + 1, total: totalPages } })
      }
      // 원래 보던 페이지로 iframe 복원
      ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: currentPage }, '*')
      await new Promise(r => setTimeout(r, 300))
    } finally {
      set({ _preloading: false, preloadProgress: null })
    }

    // 3) 원래 순서대로 재구성 — html-backed는 새 데이터로, flat-only는 보존
    const newCache = buildRegeneratedCache(orderedSnapshot, freshHtml)
    for (const key in _pageCache) delete _pageCache[key]
    Object.assign(_pageCache, newCache)

    // 4) 첫 페이지 복원
    const firstKey = _getSortedPageKeys()[0]
    _currentPageKey = firstKey || null
    if (firstKey) get()._restoreFromCache(firstKey)
    get()._syncPageInfo()
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
      const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref)
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
      const { extractFlatElementsFromIframe } = await import('../core/FlatExtractor')

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
          const result = extractFlatElementsFromIframe(iframeRef)
          _pageCache[pageKey] = {
            elements: result.elements,
            canvasSize: result.canvasSize,
            fontImports: result.fontImports || [],
            history: { stack: [], pointer: -1 },
            htmlSlideIndex: i, // HTML 슬라이드 i에서 추출됨
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
      htmlSlideIndex: null, // flat-only 페이지: HTML 원본 없음
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
    const key = keys[pageIndex]
    get()._restoreFromCache(key)
    // split 모드: iframe을 이 페이지의 '실제 HTML 슬라이드 인덱스'로 이동.
    // flat-only 페이지(htmlSlideIndex=null)는 대응 슬라이드가 없으므로 iframe을 건드리지 않는다
    // (엉뚱한 슬라이드 표시 방지). 인덱스 어긋남도 이 저장값으로 해소.
    if (get().viewMode === 'split') {
      const htmlIdx = _pageCache[key]?.htmlSlideIndex
      if (htmlIdx != null) {
        const ref = get()._iframeRef
        ref?.current?.contentWindow?.postMessage({ type: 'fe:navigate', page: htmlIdx }, '*')
      }
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

  /** 선택된 요소들을 하나의 그룹으로 묶기 (Ctrl+G) */
  groupSelected() {
    const ids = get().selectedFlatIds
    if (ids.length < 2) return
    const gid = 'grp-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11))
    get().batchUpdateFlatElements(ids, { groupId: gid })
  },

  /** 선택에 포함된 그룹들을 해제 (Ctrl+Shift+G) */
  ungroupSelected() {
    const els = get().flatElements
    const sel = new Set(get().selectedFlatIds)
    const gids = new Set(els.filter(e => sel.has(e.id) && e.groupId).map(e => e.groupId))
    if (gids.size === 0) return
    const memberIds = els.filter(e => e.groupId && gids.has(e.groupId)).map(e => e.id)
    get().batchUpdateFlatElements(memberIds, { groupId: null })
  },

  /** 그룹 인식 선택 — 그룹 요소를 선택하면 그룹 전체 선택. additive=Shift 토글 */
  selectFlatGroupAware(id, additive) {
    const els = get().flatElements
    const el = els.find(e => e.id === id)
    if (!el) return
    const members = el.groupId ? els.filter(e => e.groupId === el.groupId).map(e => e.id) : [id]
    if (additive) {
      const cur = new Set(get().selectedFlatIds)
      const allIn = members.every(m => cur.has(m))
      if (allIn) members.forEach(m => cur.delete(m))
      else members.forEach(m => cur.add(m))
      set({ selectedFlatIds: [...cur] })
    } else {
      set({ selectedFlatIds: members })
    }
  },

  /** 주어진 id들을 그룹 단위로 확장(마키 선택이 그룹 일부만 잡았을 때 전체 포함) */
  expandSelectionToGroups(ids) {
    const els = get().flatElements
    const gids = new Set(els.filter(e => ids.includes(e.id) && e.groupId).map(e => e.groupId))
    if (gids.size === 0) return ids
    const set2 = new Set(ids)
    els.forEach(e => { if (e.groupId && gids.has(e.groupId)) set2.add(e.id) })
    return [...set2]
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
    // 그룹ID 재매핑 — 복제본끼리 새 그룹을 이루되 원본 그룹과는 분리
    const groupMap = {}
    const newEls = clipboard.map(e => {
      const clone = {
        ...structuredClone(e),
        id: nextFlatId(),
        sourceId: null,
        x: e.x + 20,
        y: e.y + 20,
      }
      if (clone.groupId) {
        if (!groupMap[clone.groupId]) {
          groupMap[clone.groupId] = 'grp-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11))
        }
        clone.groupId = groupMap[clone.groupId]
      }
      return clone
    })
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

  /** 여러 요소를 한 번에 추가 (단일 undo 단위) — 레이아웃 삽입 등 */
  addFlatElements(elements) {
    if (!elements || elements.length === 0) return
    const els = get().flatElements
    _history.push({ type: 'addMany', elements: elements.map(e => structuredClone(e)) })
    set({
      flatElements: [...els, ...elements],
      canUndo: _history.canUndo, canRedo: _history.canRedo,
    })
  },

  /** 레이아웃 변환 — removeIds를 제거하고 addElements를 추가 (단일 undo 단위) */
  applyLayoutElements(removeIds, addElements) {
    const els = get().flatElements
    const removeSet = new Set(removeIds || [])
    const removed = els.filter(e => removeSet.has(e.id)).map(e => structuredClone(e))
    if (removed.length === 0 && (!addElements || addElements.length === 0)) return
    _history.push({
      type: 'replaceMany',
      removed,
      added: (addElements || []).map(e => structuredClone(e)),
    })
    set({
      flatElements: [...els.filter(e => !removeSet.has(e.id)), ...(addElements || [])],
      selectedFlatIds: [],
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
    if (!el || el.isBackground) return // 배경은 맨 뒤 고정
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
    if (!el || el.isBackground) return // 배경은 맨 뒤 고정
    const sorted = [...els].sort((a, b) => b.zIndex - a.zIndex)
    // 배경은 건너뜀 — 콘텐츠가 배경 아래로 내려가지 않게
    const below = sorted.find(e => e.zIndex < el.zIndex && !e.isBackground)
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
    if (!el || el.isBackground) return // 배경은 맨 뒤 고정
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
    if (!el || el.isBackground) return // 배경은 맨 뒤 고정
    // 배경 위로만 내려감 — 콘텐츠가 배경 아래로 숨지 않게 클램프
    const bgs = els.filter(e => e.isBackground)
    const bgCeiling = bgs.length ? Math.max(...bgs.map(e => e.zIndex)) : -Infinity
    const nonBgMin = Math.min(...els.filter(e => !e.isBackground).map(e => e.zIndex))
    if (el.zIndex === nonBgMin) return // 이미 콘텐츠 최하위(배경 바로 위)면 변경 없음
    let target = nonBgMin - 1
    if (target <= bgCeiling) target = bgCeiling + 1 // 배경보다 아래로는 안 감
    if (el.zIndex === target) return
    _history.push({ type: 'zorder', changes: [
      { id: el.id, oldZ: el.zIndex, newZ: target },
    ]})
    const updated = els.map(e =>
      e.id === el.id ? { ...e, zIndex: target } : e
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
    } else if (cmd.type === 'addMany') {
      const ids = new Set(cmd.elements.map(e => e.id))
      set({ flatElements: els.filter(e => !ids.has(e.id)) })
    } else if (cmd.type === 'replaceMany') {
      // undo: added 제거 → removed 복원
      const addedIds = new Set(cmd.added.map(e => e.id))
      set({ flatElements: [...els.filter(e => !addedIds.has(e.id)), ...cmd.removed], selectedFlatIds: [] })
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
    } else if (cmd.type === 'addMany') {
      set({ flatElements: [...els, ...cmd.elements] })
    } else if (cmd.type === 'replaceMany') {
      // redo: removed 제거 → added 추가
      const removedIds = new Set(cmd.removed.map(e => e.id))
      set({ flatElements: [...els.filter(e => !removedIds.has(e.id)), ...cmd.added], selectedFlatIds: [] })
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
        htmlSlideIndex: cached.htmlSlideIndex,
      }
    }
    // 현재 페이지가 캐시에 없는 경우 (단일 페이지)
    if (_currentPageKey && !pages[_currentPageKey]) {
      pages[_currentPageKey] = {
        elements: get().flatElements,
        canvasSize: get().canvasSize,
        fontImports: get().fontImports,
        htmlSlideIndex: get().currentPageHtmlBacked ? parseInt(String(_currentPageKey).split('-')[0]) : null,
      }
    }
    return { pages, currentPageKey: _currentPageKey }
  },

  /** 전체 페이지 데이터 반환 (미방문 페이지는 iframe 순회하여 추출) */
  async getAllPagesAsync() {
    get()._saveCurrentPage()

    const editorStore = (await import('./editorStore')).useEditorStore
    const { totalPages, currentPage, isReveal, iframeRef } = editorStore.getState()
    const { extractFlatElementsFromIframe } = await import('../core/FlatExtractor')

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
        const result = extractFlatElementsFromIframe(iframeRef)
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
      // 프로젝트에 저장된 htmlSlideIndex 사용, 없으면(구버전) 키에서 파생
      const derived = parseInt(String(key).split('-')[0])
      const hsi = pagesData[key].htmlSlideIndex !== undefined
        ? pagesData[key].htmlSlideIndex
        : (Number.isNaN(derived) ? null : derived)
      _pageCache[key] = {
        elements: pagesData[key].elements,
        canvasSize: pagesData[key].canvasSize,
        fontImports: pagesData[key].fontImports || [],
        history: { stack: [], pointer: -1 },
        htmlSlideIndex: hsi,
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
        currentPageHtmlBacked: page.htmlSlideIndex != null,
      })
    }
  },
}))
