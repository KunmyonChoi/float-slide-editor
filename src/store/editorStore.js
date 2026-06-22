import { create } from 'zustand'
import { prepareHtmlForEditor, nextId, classifyTag } from '../core/ElementRegistry'
import { HistoryStack } from '../core/HistoryStack'
import { resolveAlignment, readCurrentAlignment } from '../core/AlignmentResolver'
import { isBundlerHtml, unpackBundlerHtml } from '../core/BundlerUnpacker'

const _history = new HistoryStack()

/**
 * 폰트/아이콘 스타일시트인지 판별.
 * reset/reveal/theme 등 레이아웃·전역 CSS는 메인 문서에 주입하면 앱 UI(Tailwind)를
 * 덮어쓰므로 제외하고, 글리프 렌더에 필요한 폰트/아이콘 CSS만 허용한다.
 */
function _isFontStylesheet(href) {
  return /fonts?\.googleapis\.com|fonts?\.gstatic\.com|pretendard|font-?awesome|material(icons|-symbols)|\bwebfont|\.woff2?(\?|$)|[/.]fonts?[/.]/i.test(href)
}

/**
 * 로드된 덱 HTML에서 <link rel="stylesheet"> 중 **폰트/아이콘 CSS만** 추출해
 * 현재 document.head 에 (href 기준 중복 제거 후) 주입한다.
 * flat presenter는 iframe이 아닌 메인 React 트리에 렌더되므로 동일 폰트가 로드돼야
 * 글리프가 그려진다. 레이아웃/리셋/테마 CSS는 앱 UI를 깨뜨리므로 주입하지 않는다.
 */
function _injectDeckStylesheets(fullHtml) {
  if (typeof document === 'undefined' || !fullHtml) return
  // 이전 덱에서 주입한 스타일시트/폰트 제거(임포트 간 누적·잔존 방지)
  for (const old of document.head.querySelectorAll('link[data-fe-deck-css], link[data-flat-font], style[data-flat-font]')) old.remove()
  let doc
  try {
    doc = new DOMParser().parseFromString(fullHtml, 'text/html')
  } catch {
    return /* 파싱 실패 무시 */
  }
  const links = doc.querySelectorAll('link[rel~="stylesheet"][href]')
  for (const l of links) {
    const href = l.getAttribute('href')
    if (!href) continue
    if (!_isFontStylesheet(href)) {
      // 비폰트(reset/reveal/theme 등) 덱 CSS는 주입하지 않을 뿐 아니라, 어떤 경로로든
      // 메인 문서에 이미 들어와 있으면 제거한다. (Tailwind v4는 모든 스타일이 @layer라
      // unlayered 덱 CSS가 앱 UI를 덮어써 레이아웃이 무너지는 것을 방지)
      let abs = href
      try { abs = new URL(href, location.href).href } catch { /* 상대경로 무시 */ }
      for (const el of document.head.querySelectorAll('link[rel~="stylesheet"][href]')) {
        if (el.dataset.flatFont) continue // 우리가 넣은 폰트는 보존
        if (el.href === abs || el.getAttribute('href') === href) el.remove()
      }
      continue
    }
    // 폰트/아이콘 CSS만 주입
    const existing = document.head.querySelector(`link[data-fe-deck-css="${cssEscape(href)}"]`)
    if (existing) continue
    const el = document.createElement('link')
    el.rel = 'stylesheet'
    el.href = href
    el.setAttribute('data-fe-deck-css', href)
    const cross = l.getAttribute('crossorigin')
    if (cross) el.crossOrigin = cross
    document.head.appendChild(el)
  }
}

function cssEscape(s) {
  // 간단한 attribute selector 이스케이프 (따옴표/백슬래시만 처리)
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export const useEditorStore = create((set, get) => ({
  /** iframe에 주입할 완성된 HTML (srcdoc) */
  slideHtml: '',
  /** 요소 메타데이터 맵 */
  elements: new Map(),
  /** 선택된 요소 ID */
  selectedId: null,
  /** iframe ref (SlideCanvas가 등록) */
  iframeRef: null,
  /** 'edit' | 'present' */
  mode: 'edit',
  /** 현재 슬라이드 페이지 (0-based) */
  currentPage: 0,
  /** 전체 페이지 수 */
  totalPages: 1,

  /** reveal.js 확장 네비게이션 상태 */
  isReveal: false,
  revealH: 0,
  revealV: 0,
  revealTotalH: 0,
  revealTotalV: 0,
  /** 수평 슬라이드별 수직 개수 배열(없으면 null) — flat 변환 시 (h,v) 경로 산출용 */
  revealVCounts: null,
  canLeft: false,
  canRight: false,
  canUp: false,
  canDown: false,

  /** 삽입 플레이스홀더 클릭 시 대기 중인 삽입 정보 */
  pendingInsert: null,

  /**
   * 캔버스 크기 오버라이드.
   * null = 슬라이드 로드 시 자동 감지 사용
   * { w, h } = 사용자가 고정한 크기
   */
  canvasSize: null,

  /** Undo/Redo 상태 (파생) */
  canUndo: false,
  canRedo: false,

  /**
   * 실제 HTML 슬라이드를 외부에서 가져왔는지 여부.
   * 가져오기/드롭/샘플 = true, 새 프로젝트(빈 덱)/스크래치 = false.
   * 'Flat 전체 재생성'은 원본 HTML이 있을 때만 의미가 있으므로 이 플래그로 게이팅한다.
   */
  htmlImported: false,

  loadHtml(fullHtml, { imported = false } = {}) {
    // standalone 번들 포맷이면 먼저 풀어(에셋 인라인) 실제 덱 HTML을 얻는다.
    // 풀기는 비동기(gzip 해제)이므로 번들일 때만 async 경로로 분기하고, 일반 HTML은
    // 기존처럼 동기로 처리한다(테스트/호출부 호환 유지).
    if (isBundlerHtml(fullHtml)) {
      unpackBundlerHtml(fullHtml)
        .then((unpacked) => get()._applyLoadedHtml(unpacked || fullHtml, imported))
        .catch((e) => {
          console.warn('[loadHtml] 번들 풀기 실패, 원본으로 로드:', e?.message)
          get()._applyLoadedHtml(fullHtml, imported)
        })
      return
    }
    get()._applyLoadedHtml(fullHtml, imported)
  },

  /** loadHtml의 동기 본체 — prepare + 상태 설정 */
  _applyLoadedHtml(fullHtml, imported) {
    const { html, elements } = prepareHtmlForEditor(fullHtml)
    // 덱이 의존하는 외부 stylesheet(<link rel="stylesheet">)를 메인 문서에도 주입.
    // flat presenter는 iframe이 아닌 메인 React 트리에 렌더되므로
    // Font Awesome 등 CDN 폰트가 동일하게 로드되어야 글리프가 그려진다.
    _injectDeckStylesheets(fullHtml)
    _history.clear()
    // 사용자가 로드 전에 선택해둔 캔버스 크기는 그대로 유지한다.
    // 자동 감지로 되돌리려면 캔버스 선택기에서 "자동 감지"를 직접 선택.
    // 이전 덱의 페이지/reveal 구조 상태를 리셋 — 새 iframe이 구조를 보고하기 전
    // 프리로드가 스테일 totalPages/revealVCounts(예: 23)를 읽어 엉뚱한 페이지 수를
    // 변환하는 레이스를 방지한다.
    set({
      slideHtml: html, elements, selectedId: null, canUndo: false, canRedo: false,
      htmlImported: imported,
      currentPage: 0, totalPages: 1,
      isReveal: false, revealH: 0, revealV: 0, revealTotalH: 0, revealTotalV: 0, revealVCounts: null,
      canLeft: false, canRight: false, canUp: false, canDown: false,
    })
  },

  /**
   * 덱 상태를 스크래치(빈 시작점)로 리셋 — 새 프로젝트용.
   * 앱 최초 실행(새로고침) 시 startScratchProject가 동작하는 초기 상태를 그대로 재현한다.
   * slideHtml을 비워 flat 스크래치로 두고, reveal/페이지 구조와 임포트 플래그를 초기화한다.
   */
  resetDeck() {
    _history.clear()
    set({
      slideHtml: '', elements: [], selectedId: null, canUndo: false, canRedo: false,
      htmlImported: false,
      currentPage: 0, totalPages: 1,
      isReveal: false, revealH: 0, revealV: 0, revealTotalH: 0, revealTotalV: 0, revealVCounts: null,
      canLeft: false, canRight: false, canUp: false, canDown: false,
    })
  },

  /** @param {{ w: number, h: number } | null} size */
  setCanvasSize(size) {
    set({ canvasSize: size })
  },

  /** 외부 HTML 임포트 플래그 직접 설정 (예: flat 프로젝트 열기 시 false) */
  setHtmlImported(v) {
    set({ htmlImported: !!v })
  },

  /** 삽입 플레이스홀더 클릭 → 대기 삽입 정보 설정 */
  setPendingInsert(info) {
    set({ pendingInsert: info })
  },

  clearPendingInsert() {
    set({ pendingInsert: null })
  },

  setIframeRef(ref) {
    set({ iframeRef: ref })
  },

  setSelected(id) {
    set({ selectedId: id })
    get().iframeRef?.current?.contentWindow?.postMessage({ type: 'fe:highlight', id }, '*')
  },

  /** 페이지 변경 알림 수신 (iframe → parent) */
  _onPageChange(data) {
    const update = { currentPage: data.page, totalPages: data.total }
    if (data.reveal) {
      update.isReveal = true
      update.revealH = data.h ?? 0
      update.revealV = data.v ?? 0
      update.revealTotalH = data.totalH ?? data.total
      update.revealTotalV = data.totalV ?? 0
      update.revealVCounts = Array.isArray(data.vCounts) ? data.vCounts : null
      update.canLeft = !!data.canLeft
      update.canRight = !!data.canRight
      update.canUp = !!data.canUp
      update.canDown = !!data.canDown
    } else {
      update.isReveal = false
    }
    set(update)
  },

  /** iframe에 페이지 이동 명령 전송 (선형) */
  navigatePage(delta) {
    get().iframeRef?.current?.contentWindow?.postMessage({ type: 'fe:navigate', delta }, '*')
  },

  /** iframe에 방향 네비게이션 전송 (reveal.js 4방향) */
  navigateDirection(direction) {
    get().iframeRef?.current?.contentWindow?.postMessage({ type: 'fe:navigate', direction }, '*')
  },

  getElement(id) {
    return get().elements.get(id)
  },

  /** 발표 시작 슬라이드 인덱스 (F5=0 처음부터, Shift+F5=현재 페이지) */
  presentStartIndex: 0,

  /** 발표 모드 진입 — 브라우저 전체화면 + CSS 전체화면 + 에이전트 비활성 */
  enterPresentation(opts = {}) {
    const { iframeRef } = get()
    set({ selectedId: null, mode: 'present', presentStartIndex: opts.startIndex || 0 })
    iframeRef?.current?.contentWindow?.postMessage({ type: 'fe:setMode', mode: 'present' }, '*')
    iframeRef?.current?.contentWindow?.focus()
    // 사용자 제스처(발표 버튼/F5) 컨텍스트에서 동기 호출 → 실제 브라우저 전체화면
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    } catch { /* 미지원/거부 무시 */ }
  },

  /** 편집 모드 복귀 */
  exitPresentation() {
    const { iframeRef } = get()
    set({ mode: 'edit' })
    iframeRef?.current?.contentWindow?.postMessage({ type: 'fe:setMode', mode: 'edit' }, '*')
    try {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    } catch { /* 무시 */ }
    // 발표 진입 때 iframe.contentWindow로 옮긴 키보드 포커스를 상위 창으로 복귀.
    // 안 하면 종료 직후 페이지 이동 단축키가 (숨은) iframe에 먹혀 동작하지 않는다.
    try {
      iframeRef?.current?.blur?.()
      window.focus()
    } catch { /* 무시 */ }
  },

  // ── DOM 읽기 헬퍼 (Phase 3) ────────────────────────────────

  /** iframe DOM에서 요소를 찾는 헬퍼 */
  _findEl(id) {
    const doc = get().iframeRef?.current?.contentDocument
    if (!doc) return null
    return doc.querySelector(`[data-editor-id="${id}"]`)
  },

  readText(id) {
    const el = get()._findEl(id)
    return el ? el.textContent : ''
  },

  readStyle(id, prop) {
    const el = get()._findEl(id)
    return el ? (el.style[prop] || '') : ''
  },

  readAttribute(id, attr) {
    const el = get()._findEl(id)
    return el ? (el.getAttribute(attr) || '') : ''
  },

  /**
   * 요소의 현재 정렬 상태를 부모 컨텍스트 기반으로 읽는다.
   * @returns {{ h: 'start'|'center'|'end'|null, v: 'start'|'center'|'end'|null }}
   */
  readAlignment(id) {
    const el = get()._findEl(id)
    if (!el || !el.parentElement) return { h: null, v: null }
    const win = get().iframeRef?.current?.contentDocument?.defaultView
    if (!win) return { h: null, v: null }
    const parentCS = win.getComputedStyle(el.parentElement)
    return readCurrentAlignment(parentCS, el.style)
  },

  /**
   * 의도 기반 정렬을 적용한다.
   * 부모 레이아웃을 감지하고 적절한 CSS 속성을 변경한다.
   * @param {string} id
   * @param {'h'|'v'} axis
   * @param {'start'|'center'|'end'} value
   */
  applyAlignment(id, axis, value) {
    const el = get()._findEl(id)
    if (!el || !el.parentElement) return
    const win = get().iframeRef?.current?.contentDocument?.defaultView
    if (!win) return
    const parentCS = win.getComputedStyle(el.parentElement)
    const changes = resolveAlignment(parentCS, axis, value)
    for (const { prop, value: val } of changes) {
      get().applyStyle(id, prop, val)
    }
  },

  /**
   * 정렬 미리보기 (히스토리 기록 없음).
   */
  previewAlignment(id, axis, value) {
    const el = get()._findEl(id)
    if (!el || !el.parentElement) return
    const win = get().iframeRef?.current?.contentDocument?.defaultView
    if (!win) return
    const parentCS = win.getComputedStyle(el.parentElement)
    const changes = resolveAlignment(parentCS, axis, value)
    for (const { prop, value: val } of changes) {
      get().previewStyle(id, prop, val)
    }
  },

  // ── 실시간 미리보기 (히스토리 기록 없음) ──────────────────

  /**
   * preview 사용 시 원래 값 추적용.
   * _previewOrigins[key] 에 preview 시작 전 원본 값 저장.
   * apply 시 이 값을 oldValue로 사용.
   */
  _previewOrigins: {},

  previewText(id, value) {
    const el = get()._findEl(id)
    if (!el) return
    const origins = get()._previewOrigins
    if (origins[id] === undefined) origins[id] = el.textContent
    el.textContent = value
  },

  previewAttribute(id, attr, value) {
    const el = get()._findEl(id)
    if (!el) return
    const key = `${id}::${attr}`
    const origins = get()._previewOrigins
    if (origins[key] === undefined) origins[key] = el.getAttribute(attr) || ''
    el.setAttribute(attr, value)
  },

  previewStyle(id, prop, value) {
    const el = get()._findEl(id)
    if (!el) return
    const key = `${id}::style::${prop}`
    const origins = get()._previewOrigins
    if (origins[key] === undefined) origins[key] = el.style[prop] || ''
    el.style[prop] = value
  },

  // ── 뮤테이션 & Undo/Redo (Phase 2) ───────────────────────

  _syncHistoryState() {
    set({ canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  applyText(id, value) {
    const el = get()._findEl(id)
    if (!el) return
    const origins = get()._previewOrigins
    const oldValue = origins[id] !== undefined ? origins[id] : el.textContent
    // 동일 값이면 히스토리에 기록하지 않음
    if (oldValue === value) {
      delete origins[id]
      return
    }
    _history.push({ type: 'setText', id, oldValue, newValue: value })
    el.textContent = value
    delete origins[id]
    get()._syncHistoryState()
  },

  applyStyle(id, prop, value) {
    const el = get()._findEl(id)
    if (!el) return
    const key = `${id}::style::${prop}`
    const origins = get()._previewOrigins
    const oldValue = origins[key] !== undefined ? origins[key] : (el.style[prop] || '')
    if (oldValue === value) {
      delete origins[key]
      return
    }
    _history.push({ type: 'setStyle', id, prop, oldValue, newValue: value })
    el.style[prop] = value
    delete origins[key]
    get()._syncHistoryState()
  },

  applyAttribute(id, attr, value) {
    const el = get()._findEl(id)
    if (!el) return
    const key = `${id}::${attr}`
    const origins = get()._previewOrigins
    const oldValue = origins[key] !== undefined ? origins[key] : (el.getAttribute(attr) || '')
    if (oldValue === value) {
      delete origins[key]
      return
    }
    _history.push({ type: 'setAttribute', id, attr, oldValue, newValue: value })
    el.setAttribute(attr, value)
    delete origins[key]
    get()._syncHistoryState()
  },

  undo() {
    const cmd = _history.undo()
    if (!cmd) return
    get()._execStructural(cmd, 'undo')
    get()._syncHistoryState()
  },

  redo() {
    const cmd = _history.redo()
    if (!cmd) return
    get()._execStructural(cmd, 'redo')
    get()._syncHistoryState()
  },

  /** 커맨드 실행 (undo/redo 공통) */
  _execStructural(cmd, dir) {
    const doc = get().iframeRef?.current?.contentDocument
    if (!doc) return

    if (cmd.type === 'setText') {
      const el = get()._findEl(cmd.id)
      if (el) el.textContent = dir === 'undo' ? cmd.oldValue : cmd.newValue
    } else if (cmd.type === 'setStyle') {
      const el = get()._findEl(cmd.id)
      if (el) el.style[cmd.prop] = dir === 'undo' ? cmd.oldValue : cmd.newValue
    } else if (cmd.type === 'setAttribute') {
      const el = get()._findEl(cmd.id)
      if (el) el.setAttribute(cmd.attr, dir === 'undo' ? cmd.oldValue : cmd.newValue)
    } else if (cmd.type === 'insertEl') {
      if (dir === 'undo') {
        // 삽입 취소 → 제거
        const el = get()._findEl(cmd.id)
        if (el) el.remove()
        const elMap = new Map(get().elements)
        elMap.delete(cmd.id)
        set({ elements: elMap })
      } else {
        // 삽입 재실행
        get()._reinsertFromHtml(cmd.parentId, cmd.index, cmd.html, cmd.id, cmd.meta)
      }
    } else if (cmd.type === 'removeEl') {
      if (dir === 'undo') {
        // 삭제 취소 → 복원
        get()._reinsertFromHtml(cmd.parentId, cmd.index, cmd.html, cmd.id, cmd.meta)
      } else {
        // 삭제 재실행
        const el = get()._findEl(cmd.id)
        if (el) el.remove()
        const elMap = new Map(get().elements)
        elMap.delete(cmd.id)
        set({ elements: elMap })
      }
    } else if (cmd.type === 'moveEl') {
      // 이동 취소/재실행 — 반대 방향으로 swap
      const swapDir = dir === 'undo' ? -cmd.direction : cmd.direction
      get()._swapSibling(cmd.id, swapDir)
    } else if (cmd.type === 'wrapInsert') {
      if (dir === 'undo') {
        // 래핑 취소: 래퍼 제거, 원본 요소를 원래 위치로 복원
        const wrapper = get()._findEl(cmd.wrapperId)
        const target = get()._findEl(cmd.targetId)
        const newEl = get()._findEl(cmd.newId)
        if (wrapper && wrapper.parentElement) {
          const origParent = wrapper.parentElement
          const wrapperIdx = [...origParent.children].indexOf(wrapper)
          // 원본 요소를 래퍼 밖으로 꺼냄 (원래 HTML로 복원)
          if (target) {
            target.style.flex = ''
            origParent.insertBefore(target, wrapper)
          }
          // 새 요소와 래퍼 제거
          if (newEl) newEl.remove()
          wrapper.remove()
        }
        const elMap = new Map(get().elements)
        elMap.delete(cmd.wrapperId)
        elMap.delete(cmd.newId)
        set({ elements: elMap })
      } else {
        // 래핑 재실행
        const target = get()._findEl(cmd.targetId)
        if (!target || !target.parentElement) return
        const origParent = target.parentElement

        const wrapper = doc.createElement('div')
        wrapper.setAttribute('data-editor-id', cmd.wrapperId)
        wrapper.setAttribute('data-editor-type', 'container')
        wrapper.setAttribute('style',
          `display:flex; flex-direction:${cmd.wrapDirection}; gap:16px; align-items:stretch;`
        )
        origParent.insertBefore(wrapper, target)
        target.style.flex = '1'
        wrapper.appendChild(target)

        // 새 요소 재생성
        const temp = doc.createElement('div')
        // wrapperHtml에서 새 요소 추출 대신 직접 생성
        const newEl = doc.createElement(cmd.newMeta.tag)
        newEl.setAttribute('data-editor-id', cmd.newId)
        newEl.setAttribute('data-editor-type', cmd.newMeta.type)
        newEl.style.flex = '1'
        if (cmd.side === 'before') {
          wrapper.insertBefore(newEl, target)
        } else {
          wrapper.appendChild(newEl)
        }

        const elMap = new Map(get().elements)
        elMap.set(cmd.wrapperId, cmd.wrapperMeta)
        elMap.set(cmd.newId, cmd.newMeta)
        set({ elements: elMap, selectedId: cmd.newId })
      }
    }
  },

  /** HTML 문자열로부터 요소를 부모의 특정 인덱스에 재삽입 */
  _reinsertFromHtml(parentId, index, html, id, meta) {
    const doc = get().iframeRef?.current?.contentDocument
    if (!doc) return
    const parent = parentId ? doc.querySelector(`[data-editor-id="${parentId}"]`) : doc.body
    if (!parent) return
    const temp = doc.createElement('div')
    temp.innerHTML = html
    const el = temp.firstElementChild
    if (!el) return
    const ref = parent.children[index] || null
    parent.insertBefore(el, ref)
    const elMap = new Map(get().elements)
    elMap.set(id, meta)
    set({ elements: elMap })
  },

  /** 형제 내에서 요소를 direction 만큼 swap */
  _swapSibling(id, direction) {
    const el = get()._findEl(id)
    if (!el || !el.parentElement) return false
    const parent = el.parentElement
    const siblings = [...parent.children]
    const idx = siblings.indexOf(el)
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= siblings.length) return false
    if (direction < 0) {
      parent.insertBefore(el, siblings[targetIdx])
    } else {
      parent.insertBefore(el, siblings[targetIdx].nextSibling)
    }
    return true
  },

  // ── Phase 6: 구조 편집 ──────────────────────────────────

  /**
   * @param {string|null} parentId - 부모 요소 ID (null → body)
   * @param {string} tag - 태그명
   * @param {object} attrs - 속성 (textContent, src, alt, style 등)
   * @param {number} [insertIndex] - 삽입 위치 인덱스 (생략 시 끝에 추가)
   */
  insertElement(parentId, tag, attrs = {}, insertIndex) {
    const doc = get().iframeRef?.current?.contentDocument
    if (!doc) return null
    const parent = parentId ? doc.querySelector(`[data-editor-id="${parentId}"]`) : doc.body
    if (!parent) return null

    const id = nextId()
    const type = classifyTag(tag) || 'text'
    const el = doc.createElement(tag)
    el.setAttribute('data-editor-id', id)
    el.setAttribute('data-editor-type', type)
    if (attrs.textContent) el.textContent = attrs.textContent
    if (attrs.src) el.setAttribute('src', attrs.src)
    if (attrs.alt) el.setAttribute('alt', attrs.alt)
    if (attrs.style) el.setAttribute('style', attrs.style)

    // 위치 지정 삽입
    if (insertIndex !== undefined && insertIndex < parent.children.length) {
      parent.insertBefore(el, parent.children[insertIndex])
    } else {
      parent.appendChild(el)
    }
    const index = [...parent.children].indexOf(el)

    const meta = { id, tag, type }
    const elMap = new Map(get().elements)
    elMap.set(id, meta)
    set({ elements: elMap, selectedId: id })

    _history.push({ type: 'insertEl', id, parentId, index, html: el.outerHTML, meta })
    get()._syncHistoryState()
    return id
  },

  removeElement(id) {
    const el = get()._findEl(id)
    if (!el || !el.parentElement) return
    const parent = el.parentElement
    const parentId = parent.getAttribute?.('data-editor-id') || null
    const index = [...parent.children].indexOf(el)
    const html = el.outerHTML
    const meta = get().elements.get(id)

    el.remove()
    const elMap = new Map(get().elements)
    elMap.delete(id)
    const updates = { elements: elMap }
    if (get().selectedId === id) updates.selectedId = null
    set(updates)

    _history.push({ type: 'removeEl', id, parentId, index, html, meta })
    get()._syncHistoryState()
  },

  /**
   * cross-axis 삽입: 선택된 요소를 flex 래퍼로 감싸고 새 요소를 삽입한다.
   *
   * 동작:
   * 1. 원본 요소의 부모와 위치를 기억
   * 2. flex-row (vertical 부모) 또는 flex-column (horizontal 부모) 래퍼 div 생성
   * 3. 원본 요소를 래퍼 안으로 이동
   * 4. 새 요소를 래퍼의 before/after 위치에 삽입
   * 5. 래퍼를 원본 위치에 삽입
   *
   * Undo 시 한 번에 되돌림 (compound command).
   *
   * @param {string} targetId — 래핑할 대상 요소의 data-editor-id
   * @param {'before'|'after'} side — 새 요소를 대상의 어느 쪽에 삽입할지
   * @param {string} tag — 새 요소 태그명
   * @param {object} attrs — 새 요소 속성
   */
  wrapAndInsert(targetId, side, tag, attrs = {}) {
    const doc = get().iframeRef?.current?.contentDocument
    if (!doc) return null
    const targetEl = get()._findEl(targetId)
    if (!targetEl || !targetEl.parentElement) return null

    const origParent = targetEl.parentElement
    const origParentId = origParent.getAttribute?.('data-editor-id') || null
    const origIndex = [...origParent.children].indexOf(targetEl)
    const origHtml = targetEl.outerHTML

    // 부모 레이아웃 감지 → cross-axis 래퍼 방향 결정
    const win = doc.defaultView
    let wrapDirection = 'row'
    if (win) {
      const cs = win.getComputedStyle(origParent)
      const display = cs.display
      if ((display === 'flex' || display === 'inline-flex') &&
          (cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse')) {
        wrapDirection = 'column'
      }
    }

    // 래퍼 div 생성
    const wrapperId = nextId()
    const wrapper = doc.createElement('div')
    wrapper.setAttribute('data-editor-id', wrapperId)
    wrapper.setAttribute('data-editor-type', 'container')
    wrapper.setAttribute('style',
      `display:flex; flex-direction:${wrapDirection}; gap:16px; align-items:stretch;`
    )

    // 원본 위치에 래퍼 삽입
    origParent.insertBefore(wrapper, targetEl)

    // 원본 요소를 래퍼 안으로 이동
    // flex 아이템이 균등하게 공간을 차지하도록 flex:1 부여
    targetEl.style.flex = '1'
    wrapper.appendChild(targetEl)

    // 새 요소 생성
    const newId = nextId()
    const newType = classifyTag(tag) || 'text'
    const newEl = doc.createElement(tag)
    newEl.setAttribute('data-editor-id', newId)
    newEl.setAttribute('data-editor-type', newType)
    newEl.style.flex = '1'
    if (attrs.textContent) newEl.textContent = attrs.textContent
    if (attrs.src) newEl.setAttribute('src', attrs.src)
    if (attrs.alt) newEl.setAttribute('alt', attrs.alt)
    if (attrs.style) {
      // 기존 attrs.style에 flex:1 추가
      newEl.setAttribute('style', attrs.style + '; flex:1;')
    }

    // side에 따라 새 요소 삽입
    if (side === 'before') {
      wrapper.insertBefore(newEl, targetEl)
    } else {
      wrapper.appendChild(newEl)
    }

    // elements 맵 업데이트
    const elMap = new Map(get().elements)
    const wrapperMeta = { id: wrapperId, tag: 'div', type: 'container' }
    const newMeta = { id: newId, tag, type: newType }
    elMap.set(wrapperId, wrapperMeta)
    elMap.set(newId, newMeta)
    set({ elements: elMap, selectedId: newId })

    // compound undo command
    _history.push({
      type: 'wrapInsert',
      // undo에 필요한 정보
      targetId,
      origParentId,
      origIndex,
      origTargetHtml: origHtml,
      targetMeta: get().elements.get(targetId),
      // 래퍼 정보
      wrapperId,
      wrapperMeta,
      wrapperHtml: wrapper.outerHTML,
      // 새 요소 정보
      newId,
      newMeta,
      side,
      wrapDirection,
    })
    get()._syncHistoryState()
    return newId
  },

  moveElement(id, direction) {
    const moved = get()._swapSibling(id, direction)
    if (!moved) return
    _history.push({ type: 'moveEl', id, direction })
    get()._syncHistoryState()
  },

  clearHistory() {
    _history.clear()
    set({ canUndo: false, canRedo: false })
  },

  /** 선택된 요소의 조상 체인 반환 (root → leaf 순서) */
  getAncestorChain(id) {
    const chain = []
    let el = get()._findEl(id)
    if (!el) return chain
    // 현재 요소 제외, 부모부터 올라감
    el = el.parentElement
    while (el && el !== el.ownerDocument.body) {
      const eid = el.getAttribute('data-editor-id')
      if (eid) {
        const tag = el.tagName.toLowerCase()
        const type = el.getAttribute('data-editor-type') || 'container'
        chain.unshift({ id: eid, tag, type })
      }
      el = el.parentElement
    }
    return chain
  },

  /** 선택된 요소의 직계 자식 중 data-editor-id가 있는 것만 반환 */
  getChildren(id) {
    const el = get()._findEl(id)
    if (!el) return []
    return [...el.children]
      .filter(c => c.hasAttribute('data-editor-id'))
      .map(c => ({
        id: c.getAttribute('data-editor-id'),
        tag: c.tagName.toLowerCase(),
        type: c.getAttribute('data-editor-type') || 'container',
      }))
  },
}))
