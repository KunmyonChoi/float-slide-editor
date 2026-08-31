import { create } from 'zustand'
import { extractFlatElementsFromIframe, nextFlatId, bumpFlatCounterTo } from '../core/FlatExtractor'
import { SLIDE_LAYOUTS } from '../core/slideLayouts'
import { HistoryStack } from '../core/HistoryStack'
import { isBackgroundElement } from '../core/SnapEngine'
import { DEFAULT_THEME_ID, getTheme, themeBackgroundStyles, themeRoleStyles } from '../core/themes'
import { highlightCode } from '../core/codeHighlight'
import { renderMarkdown } from '../core/markdown'
import { applyAutoFit } from '../core/autoFit'
import { awsIconDataUrl, ICON_LABEL, GROUP_BY_KIND } from '../core/awsIcons'

// 배경 레이어 판정 — SnapEngine의 canonical 헬퍼 재노출(명시 플래그/__bg 기반)
export { isBackgroundElement as isBackgroundLayer }

// 요소 리스트의 최대 flat-N 번호.
function _maxFlatIdInList(els) {
  let m = 0
  for (const e of (els || [])) { const n = parseInt((e.id || '').replace(/^flat-/, '')); if (n > m) m = n }
  return m
}

// 전역 최대 flat-N — 라이브 요소 + 캐시된 모든 페이지를 통틀어 계산.
// ⚠️ 충돌 방지의 단일 기준. 현재 페이지만 보면(과거 _maxExistingFlatId) 멀티페이지 덱에서
// 다른 페이지의 더 큰 ID를 놓쳐 카운터가 역행 → 드롭/삽입 시 같은 id가 발급돼
// "두 요소가 함께 선택·이동되는(그룹처럼 보이는)" 버그가 재발한다. 항상 전 페이지를 본다.
function _globalMaxFlatId(liveEls) {
  let m = _maxFlatIdInList(liveEls)
  for (const k in _pageCache) {
    const cm = _maxFlatIdInList(_pageCache[k]?.elements)
    if (cm > m) m = cm
  }
  return m
}

// 새 그룹 id — 'grp-' 접두사 + UUID(미지원 환경은 난수 폴백). 그룹 묶기/요소 삽입 공용.
function newGroupId() {
  return 'grp-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11))
}

// 사용자정의 테마 기본값 — 기본 테마(화이트)를 복제한 가변 토큰
export function makeDefaultCustomTheme() {
  const base = getTheme(DEFAULT_THEME_ID)
  const cloneRole = (r) => ({ ...r })
  return {
    id: 'custom', name: '사용자정의',
    bg: { ...base.bg },
    roles: {
      title: cloneRole(base.roles.title), body: cloneRole(base.roles.body),
      muted: cloneRole(base.roles.muted), default: cloneRole(base.roles.default),
    },
    swatch: [...(base.swatch || ['#ffffff', '#1e293b'])],
  }
}

const _history = new HistoryStack()
const _pageCache = {}   // { [pageKey]: { elements, canvasSize, fontImports, history } }
let _currentPageKey = null
let _clipboardPageKey = null // 복사 시점의 페이지 — 붙여넣기 위치(오프셋 여부) 판단용


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
      usedHtml.add(String(snap.htmlSlideIndex))
    } else {
      cache[`${idx}-0`] = snap.entry // flat-only 페이지 보존
    }
    idx++
  }
  // 스냅샷에 없던 새 HTML 슬라이드는 끝에 추가 (route id "h-v" 순서로)
  Object.keys(freshHtml).sort(compareRouteIds).forEach(rid => {
    if (!usedHtml.has(String(rid))) {
      cache[`${idx}-0`] = { ...freshHtml[rid], htmlSlideIndex: rid }
      idx++
    }
  })
  return cache
}

/**
 * htmlSlideIndex / 페이지 키를 reveal 경로 {h, v}로 파싱.
 * "h-v" 문자열 또는 레거시 정수 h(=> v:0) 모두 지원.
 */
export function parseRouteId(id) {
  if (id == null) return null
  const parts = String(id).split('-')
  const h = parseInt(parts[0], 10)
  if (Number.isNaN(h)) return null
  const v = parts.length > 1 ? parseInt(parts[1], 10) : 0
  return { h, v: Number.isNaN(v) ? 0 : v }
}

function compareRouteIds(a, b) {
  const ra = parseRouteId(a) || { h: 0, v: 0 }
  const rb = parseRouteId(b) || { h: 0, v: 0 }
  return ra.h - rb.h || ra.v - rb.v
}

/**
 * reveal 구조(revealVCounts)로 (h,v) 전체 경로 목록을 만든다.
 * 수직이 있으면 H×V를 좌우 선형 순서(h, 그 안의 v)로 펼치고,
 * 정보가 없으면(reveal 아님/미보고) totalPages 기준 수평만 반환(기존 동작).
 * @returns {Array<{h:number, v:number, id:string}>}
 */
// 추출 전 iframe의 웹폰트 로딩 대기 — 폴백 폰트 메트릭으로 박스가 캡처돼
// 렌더 시 텍스트가 박스를 넘치는(썸네일/캔버스 오버플로) 문제 방지. 타임아웃 가드.
async function _awaitIframeFonts(ref, timeoutMs = 2500) {
  try {
    const fonts = ref?.current?.contentDocument?.fonts
    if (!fonts?.ready) return
    await Promise.race([fonts.ready, new Promise(r => setTimeout(r, timeoutMs))])
  } catch { /* 접근 불가 무시 */ }
}

export function buildRevealRoutes(editorState) {
  const vCounts = editorState && editorState.revealVCounts
  if (Array.isArray(vCounts) && vCounts.length) {
    const routes = []
    for (let h = 0; h < vCounts.length; h++) {
      const vc = Math.max(1, vCounts[h] || 1)
      for (let v = 0; v < vc; v++) routes.push({ h, v, id: `${h}-${v}` })
    }
    return routes
  }
  const total = (editorState && editorState.totalPages) || 1
  return Array.from({ length: total }, (_, h) => ({ h, v: 0, id: `${h}-0` }))
}

/** 캐시 키를 페이지 순서로 정렬하여 반환 */
function _getSortedPageKeys() {
  return Object.keys(_pageCache).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })
}

// 해상도 변경 시 함께 스케일해야 텍스트 줄바꿈/레이아웃이 보존되는 px 기반 스타일.
const SCALE_STYLE_KEYS = [
  'fontSize', 'lineHeight', 'letterSpacing',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderRadius',
  'border', 'borderWidth', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'gap', 'columnGap', 'rowGap',
]

/** 문자열 내 모든 Npx 값을 k배 (단위 없는 값/색상은 영향 없음). */
function scaleCssPx(value, k) {
  return String(value).replace(/(-?\d*\.?\d+)px/g, (_, n) => (Math.round(parseFloat(n) * k * 100) / 100) + 'px')
}

/** 요소들을 oldCs→newCs 비율로 비례 스케일(해상도 변경용). 좌표/크기/points + px 스타일. */
function scaleFlatElements(elements, oldCs, newCs) {
  if (!oldCs?.w || !oldCs?.h) return elements
  const sx = newCs.w / oldCs.w
  const sy = newCs.h / oldCs.h
  const sf = (sx + sy) / 2 // 글꼴/패딩 등: 가로·세로 평균
  const r = (v) => Math.round(v * 100) / 100
  return elements.map(el => {
    const out = { ...el, x: r(el.x * sx), y: r(el.y * sy), width: r(el.width * sx), height: r(el.height * sy) }
    if (Array.isArray(el.points)) out.points = el.points.map(p => ({ ...p, x: r(p.x * sx), y: r(p.y * sy) }))
    if (el.styles) {
      const st = { ...el.styles }
      for (const key of SCALE_STYLE_KEYS) if (st[key] != null) st[key] = scaleCssPx(st[key], sf)
      out.styles = st
    }
    if (el.table?.cells) {
      out.table = {
        ...el.table,
        cells: el.table.cells.map(row => row.map(c => (c.fontSize ? { ...c, fontSize: scaleCssPx(c.fontSize, sf) } : c))),
      }
    }
    return out
  })
}
let _pendingEditCommit = null  // 편집 중 unmount 전 커밋용 콜백
// flat 주도 페이지 이동(goToFlatPage)이 iframe에 보낸 fe:navigate의 에코(fe:pageChange→reExtract)를
// 무시하기 위한 기대 페이지 인덱스. 이미 캐시 복원을 마쳤으므로 재추출/재복원이 불필요·유해.
// reveal.js 등은 한 번의 네비게이션에 pageChange를 여러 번 쏘므로, 일정 시간 창 동안 억제한다.
let _expectIframePage = null
let _deletedPageStash = null  // 실행취소 토스트용: 마지막 삭제 페이지 {index, entry}
let _pendingStarterLayout = null  // 새 프로젝트: 첫 빈 페이지 추출 후 적용할 시작 레이아웃 id

/** 시작 레이아웃 요소 빌드(부분 → 완성 FlatElement) */
function _buildStarterLayout(layoutId, cs) {
  const layout = SLIDE_LAYOUTS.find(l => l.id === layoutId)
  if (!layout) return []
  return layout.build(cs).map((s, i) => ({
    sourceId: null, rotation: 0, merged: false, isRich: false,
    ...s, id: nextFlatId(), zIndex: i + 1,
  }))
}

/** 테마 배경을 가진 잠긴 전체-캔버스 배경 레이어 요소 생성 (theme 객체 직접 사용) */
function _buildThemeBgElement(theme, cs) {
  return {
    id: nextFlatId(), sourceId: '__bg', type: 'shape', content: '', isRich: false, merged: false,
    isBackground: true,
    x: 0, y: 0, width: cs.w, height: cs.h, zIndex: 0, locked: true,
    styles: {
      backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', borderRadius: '0px',
      border: '0px none', boxShadow: 'none', opacity: '1', ...themeBackgroundStyles(theme),
    },
  }
}

/** 텍스트 요소 배열에 테마 역할색을 입힘(layoutRole 보유분만) */
function _applyThemeRoles(elements, theme) {
  return elements.map(el => {
    if (el.type === 'text' && el.layoutRole) {
      const rs = themeRoleStyles(theme, el.layoutRole)
      if (rs) return { ...el, styles: { ...el.styles, color: rs.color, fontWeight: rs.fontWeight, textShadow: rs.textShadow } }
    }
    return el
  })
}

/** 한 페이지의 요소 배열에 테마 적용(배경 보장/교체 + 역할 텍스트색) — 순수 함수 */
function _applyThemeToElements(elements, theme, cs) {
  const bgStyles = themeBackgroundStyles(theme)
  let out = (elements || []).map(e => ({ ...e, styles: { ...e.styles } }))
  const bgIdx = out.findIndex(e => isBackgroundElement(e, cs))
  if (bgIdx >= 0) out[bgIdx].styles = { ...out[bgIdx].styles, ...bgStyles }
  else out = [_buildThemeBgElement(theme, cs), ...out]
  return _applyThemeRoles(out, theme)
}
let _expectIframeTimer = null
function _expectIframeNav(idx) {
  _expectIframePage = idx
  if (_expectIframeTimer) clearTimeout(_expectIframeTimer)
  _expectIframeTimer = setTimeout(() => { _expectIframePage = null; _expectIframeTimer = null }, 600)
}
function _clearExpectIframeNav() {
  _expectIframePage = null
  if (_expectIframeTimer) { clearTimeout(_expectIframeTimer); _expectIframeTimer = null }
}

export const useFlatStore = create((set, get) => ({
  /** FlatElement 배열 */
  flatElements: [],
  /** 선택된 flat 요소 ID 배열 (다중 선택) */
  selectedFlatIds: [],
  /** 인라인 편집 중인 flat 요소 ID */
  editingFlatId: null,
  /** 현재 테마 id (신규 요소/슬라이드 기본값 + 테마 적용용) */
  themeId: DEFAULT_THEME_ID,
  /** 사용자정의 테마 — import 덱에서 스포이드로 채운 토큰(가변). themeId==='custom'일 때 사용 */
  customTheme: makeDefaultCustomTheme(),
  /** 뷰 모드: 'html' | 'flat' | 'split' */
  viewMode: 'flat',
  /** 캔버스 크기 */
  canvasSize: { w: 1920, h: 1080 },
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
  /** 현재 프로젝트 파일명/핸들 — 열기·저장 시 기억해 같은 파일에 재저장(Ctrl+S) */
  projectFileName: null,
  /** HTML 로드/드롭 출처 파일명(내보내기 기본 파일명 도출용) */
  htmlSourceName: null,
  projectFileHandle: null,
  /** 스타일 복사용 클립보드 */
  styleClipboard: null,
  /** 그리기 모드: null | 'line' | 'polyline' | 'polygon' */
  drawMode: null,
  /** 다이어그램 모드: 켜면 도형 호버 시 연결점 표시 + 커넥터 생성 가능(이동/선택은 그대로) */
  diagramMode: false,
  /** 다중 선택 모드(모바일 전용): 켜면 요소 탭이 선택 토글(추가/해제)로 동작, 빈 곳 탭은 선택 유지 */
  multiSelect: false,
  setMultiSelect(v) { set({ multiSelect: !!v }) },
  toggleMultiSelect() { set({ multiSelect: !get().multiSelect }) },
  /** 새 커넥터 기본 스타일 — 마지막 사용 설정을 기억해 다음 커넥터에 적용 */
  connectorDefaults: {
    startArrow: 'none', endArrow: 'triangle',
    stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '',
    routing: 'straight', // 'straight' | 'curved' — 마지막 사용 라우팅 기억
  },
  /** 커넥터 생성 드래그 진행 상태: null | { sourceId, startPt:{x,y}, curPt:{x,y}, targetId } */
  connectorDraft: null,
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
  /** 좌측 슬라이드 목록 패널 접힘 여부 (기본 접힘) */
  slideListCollapsed: true,
  /** 현재 페이지 발표자 노트(페이지별 저장) */
  pageNotes: '',
  /** 현재 페이지 슬라이드 전환(페이지별 저장). null=없음, { type:'fade'|'slide'|'zoom', durationMs } */
  pageTransition: null,
  /** 속성창 '애니메이션' 탭 활성 여부 — 켜지면 캔버스에 순서 배지 표시 */
  animPanelOpen: false,
  setAnimPanelOpen(v) { set({ animPanelOpen: !!v }) },
  /** 가로세로 비율 고정(리사이즈 시) — 켜면 핸들 드래그가 비율 유지(단일·그룹 공통).
      Shift는 일시 반전(켜진 상태서 Shift=자유, 꺼진 상태서 Shift=고정). 모바일엔 Shift가 없어 토글 필수. */
  lockAspect: false,
  setLockAspect(v) { set({ lockAspect: !!v }) },
  toggleLockAspect() { set(s => ({ lockAspect: !s.lockAspect })) },
  /** 에디터 애니메이션 미리보기 — null 또는 { revealed, playingStep }. tick은 재생 트리거. */
  animPreview: null,
  animPreviewTick: 0,
  playAnimPreview() { set(s => ({ animPreview: { revealed: 0, playingStep: -1 }, animPreviewTick: s.animPreviewTick + 1 })) },
  _setAnimPreview(v) { set({ animPreview: v }) },
  /** 발표자 노트 영역 접힘 여부 (기본 접힘) */
  notesCollapsed: true,
  /** 노트 단축키로 열 때 텍스트영역에 자동 포커스 요청(일시 플래그) */
  notesAutofocus: false,
  /** 현재 페이지 노트 TTS 음성 idb 참조(없으면 null) */
  pageNotesAudio: null,
  /** 음성 생성 시점의 노트 해시 — 현재 노트와 다르면 '재생성 필요'(스테일) */
  pageNotesAudioHash: '',
  /** 노트 음성 발표 재생 볼륨(0~1, 기본 1). 0이어도 재생은 유지돼 자동진행은 동작.
   *  립싱크 AI 휴먼처럼 영상이 소리를 낼 때 0으로 두면 에코 없이 영상-입 완벽 동기. */
  pageNotesAudioVolume: 1,
  /** 현재 페이지 노트 음성의 STT 자막(가라오케 캡션) — 생성 당시의 음성 참조(forRef, "idb://key")를
   *  함께 저장해, 음성이 교체되면(notesAudio ≠ forRef) 소비하는 쪽에서 스테일로 판단할 수 있게 한다.
   *  null=없음. { words, text, language?, duration?, forRef } */
  pageNotesCaptions: null,
  /** 페이지 삭제 실행취소 토스트 상태: null | { seq, index } */
  pageDeleteNotice: null,
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
  toggleSlideListCollapsed() { set(s => ({ slideListCollapsed: !s.slideListCollapsed })) },
  toggleNotesCollapsed() { set(s => ({ notesCollapsed: !s.notesCollapsed })) },
  /** 단축키(\)용 노트 토글 — 열릴 때는 텍스트영역 자동 포커스 요청 */
  toggleNotesShortcut() {
    set(s => {
      const opening = s.notesCollapsed
      return { notesCollapsed: !s.notesCollapsed, notesAutofocus: opening }
    })
  },
  /** 현재 페이지 발표자 노트 설정 (캐시에도 즉시 반영) */
  /** 현재 페이지 슬라이드 전환 설정(없으면 null). 페이지별 저장 + 직렬화 라운드트립 */
  setPageTransition(t) {
    if (_currentPageKey && _pageCache[_currentPageKey]) _pageCache[_currentPageKey].transition = t
    set({ pageTransition: t })
  },

  setPageNotes(text) {
    if (_currentPageKey && _pageCache[_currentPageKey]) _pageCache[_currentPageKey].notes = text
    set({ pageNotes: text })
  },

  /** 현재 페이지 노트 음성(idb 참조 + 생성 시 노트 해시) 설정.
   *  음성이 바뀌면(새로 생성/업로드/녹음/삭제) 기존 자막은 더 이상 이 음성의 것이 아니므로 함께 지운다
   *  — "자막은 음성이 교체되기 전까지만 유지"가 되도록. */
  setPageNotesAudio(ref, hash) {
    if (_currentPageKey && _pageCache[_currentPageKey]) {
      _pageCache[_currentPageKey].notesAudio = ref
      _pageCache[_currentPageKey].notesAudioHash = hash
      _pageCache[_currentPageKey].notesCaptions = null
    }
    set({ pageNotesAudio: ref, pageNotesAudioHash: hash, pageNotesCaptions: null })
  },

  /**
   * 현재(또는 지정한) 페이지의 STT 자막 설정 — transcribeSpeech() 결과 + forRef(생성 당시 notesAudio)를
   * 함께 저장한다. pageKey 미지정=현재 페이지.
   *
   * 발표 모드는 편집기에서 한 번도 방문(캐시)하지 않은 페이지에도 자막을 생성할 수 있다(백그라운드
   * 프리페치가 전체 덱을 훑기 때문). 그런 페이지는 아직 _pageCache에 항목이 없어 자막을 저장할 곳이
   * 없으므로, hydrateFrom(getAllPagesAsync가 만든 완전한 페이지 스냅샷)이 주어지면 그걸로 캐시
   * 항목을 먼저 만든 뒤(기존 항목이 있으면 건드리지 않음) 자막을 저장한다 — 그래야 발표만 하고 편집기를
   * 거치지 않은 페이지의 자막도 프로젝트 저장·공유 링크에 실제로 남는다.
   */
  setPageNotesCaptions(captions, pageKey, hydrateFrom) {
    const key = pageKey || _currentPageKey
    if (key && !_pageCache[key] && hydrateFrom) {
      _pageCache[key] = {
        elements: hydrateFrom.elements || [],
        canvasSize: hydrateFrom.canvasSize,
        fontImports: hydrateFrom.fontImports || [],
        history: { stack: [], pointer: -1 },
        htmlSlideIndex: hydrateFrom.htmlSlideIndex ?? null,
        notes: hydrateFrom.notes || '',
        notesAudio: hydrateFrom.notesAudio || null,
        notesAudioHash: hydrateFrom.notesAudioHash || '',
        notesAudioVolume: hydrateFrom.notesAudioVolume ?? 1,
        transition: hydrateFrom.transition || null,
      }
    }
    if (key && _pageCache[key]) _pageCache[key].notesCaptions = captions
    if (!pageKey || pageKey === _currentPageKey) set({ pageNotesCaptions: captions })
  },

  /** 노트 음성 볼륨 설정(0~1). pageKey 미지정=현재 페이지. 다른 페이지면 캐시만 갱신
   *  (립싱크 결과 적용이 대상 페이지에 직접 0을 세팅하는 데 사용). */
  setPageNotesAudioVolume(v, pageKey) {
    const vol = Math.max(0, Math.min(1, Number(v)))
    const key = pageKey || _currentPageKey
    if (key && _pageCache[key]) _pageCache[key].notesAudioVolume = vol
    if (!pageKey || pageKey === _currentPageKey) set({ pageNotesAudioVolume: vol })
  },

  /**
   * 여러 페이지 노트 음성 일괄 적용 (전체 생성용).
   * @param {Object} audioByKey { [pageKey]: { ref, hash } }
   */
  applyAudioToPages(audioByKey) {
    for (const key in audioByKey) {
      if (_pageCache[key]) {
        _pageCache[key].notesAudio = audioByKey[key].ref
        _pageCache[key].notesAudioHash = audioByKey[key].hash
        _pageCache[key].notesCaptions = null // 음성이 일괄 교체됐으니 기존 자막(있었다면)은 무효
      }
    }
    if (_currentPageKey && _pageCache[_currentPageKey]) {
      set({
        pageNotesAudio: _pageCache[_currentPageKey].notesAudio || null,
        pageNotesAudioHash: _pageCache[_currentPageKey].notesAudioHash || '',
        pageNotesCaptions: _pageCache[_currentPageKey].notesCaptions || null,
      })
    }
  },

  /**
   * 여러 페이지 노트 일괄 적용 (AI 전체 생성용).
   * @param {Object} pages getAllPagesAsync 결과(미캐시 페이지 캐시 생성용)
   * @param {Object} notesByKey { [pageKey]: notesText }
   */
  applyNotesToPages(pages, notesByKey) {
    get()._saveCurrentPage() // 현재 편집/노트 보존
    for (const key in notesByKey) {
      if (_pageCache[key]) {
        _pageCache[key].notes = notesByKey[key]
      } else if (pages && pages[key]) {
        const p = pages[key]
        _pageCache[key] = {
          elements: p.elements,
          canvasSize: p.canvasSize,
          fontImports: p.fontImports || [],
          history: { stack: [], pointer: -1 },
          htmlSlideIndex: p.htmlSlideIndex ?? null,
          notes: notesByKey[key],
        }
      }
    }
    if (_currentPageKey && _pageCache[_currentPageKey]) {
      set({ pageNotes: _pageCache[_currentPageKey].notes || '' })
    }
    get()._syncPageInfo()
  },

  /**
   * 슬라이드 목록용 페이지 열거 — 읽기 전용(부작용 없음, _saveCurrentPage 호출 금지).
   * 현재 페이지는 라이브 상태, 그 외는 _pageCache에서 읽는다.
   * @returns {Array<{ key, index, isCurrent, elements, canvasSize, htmlSlideIndex }>}
   */
  /** 모든 페이지(+현재)의 fontImports 합집합 — 썸네일/발표가 어느 페이지든 동일 폰트로
   *  렌더되도록(현재 페이지에 묶이지 않게) 전체 폰트를 한 번에 주입하기 위함. */
  getAllFontImports() {
    const set = new Set()
    for (const k in _pageCache) for (const f of (_pageCache[k].fontImports || [])) set.add(f)
    for (const f of (get().fontImports || [])) set.add(f)
    return [...set]
  },

  getFlatPageList() {
    const keys = _getSortedPageKeys()
    const curKey = _currentPageKey
    const liveEls = get().flatElements
    const liveCs = get().canvasSize
    return keys.map((key, i) => {
      const isCurrent = key === curKey
      const entry = _pageCache[key]
      return {
        key,
        index: i,
        isCurrent,
        elements: isCurrent ? liveEls : (entry?.elements || []),
        canvasSize: isCurrent ? liveCs : (entry?.canvasSize || liveCs),
        htmlSlideIndex: entry ? entry.htmlSlideIndex : (isCurrent ? null : undefined),
      }
    })
  },

  /** 페이지를 fromIdx에서 toIdx로 이동(임의 위치). 현재 페이지 식별 보존. */
  reorderPage(fromIdx, toIdx) {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    if (fromIdx < 0 || fromIdx >= keys.length || toIdx < 0 || toIdx >= keys.length || fromIdx === toIdx) return
    const curEntry = _currentPageKey ? _pageCache[_currentPageKey] : null
    const entries = keys.map(k => _pageCache[k])
    const [moved] = entries.splice(fromIdx, 1)
    entries.splice(toIdx, 0, moved)
    // 캐시 재구성 (순차 키)
    for (const k in _pageCache) delete _pageCache[k]
    entries.forEach((entry, i) => { _pageCache[`${i}-0`] = entry })
    // 현재 페이지가 가리키던 엔트리의 새 인덱스로 _currentPageKey 갱신
    if (curEntry) {
      const newIdx = entries.indexOf(curEntry)
      if (newIdx >= 0) _currentPageKey = `${newIdx}-0`
    }
    // 내용은 그대로(상태 유지) — 인덱스만 동기화
    get()._syncPageInfo()
  },

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
    if (!_currentPageKey) return
    // 노트/노트음성은 요소가 비어 있어도 기존 캐시 항목에 보존
    if (_pageCache[_currentPageKey]) {
      _pageCache[_currentPageKey].notes = get().pageNotes
      _pageCache[_currentPageKey].notesAudio = get().pageNotesAudio
      _pageCache[_currentPageKey].notesAudioHash = get().pageNotesAudioHash
      _pageCache[_currentPageKey].notesAudioVolume = get().pageNotesAudioVolume
      _pageCache[_currentPageKey].notesCaptions = get().pageNotesCaptions
      _pageCache[_currentPageKey].transition = get().pageTransition
    }
    if (get().flatElements.length === 0) return
    const existed = _pageCache[_currentPageKey]
    // HTML 소스 슬라이드 인덱스: 기존 항목이 있으면 그 값 유지(flat-only의 null 포함),
    // 없으면(첫 저장) 키에서 파생. 키는 첫 변환 시 슬라이드 인덱스를 인코딩.
    const htmlSlideIndex = existed ? existed.htmlSlideIndex
      : (parseRouteId(_currentPageKey) ? _currentPageKey : null)
    _pageCache[_currentPageKey] = {
      elements: get().flatElements,
      canvasSize: get().canvasSize,
      fontImports: get().fontImports,
      history: _history.getState(),
      htmlSlideIndex,
      notes: get().pageNotes,
      notesAudio: get().pageNotesAudio,
      notesAudioHash: get().pageNotesAudioHash,
      notesAudioVolume: get().pageNotesAudioVolume,
      notesCaptions: get().pageNotesCaptions,
      transition: get().pageTransition,
    }
    get()._syncPageInfo()
  },

  /** 캐시에서 페이지 복원 (내부용). 성공 시 true */
  _restoreFromCache(pageKey) {
    const cached = _pageCache[pageKey]
    if (!cached) return false
    // 캐시 복귀는 재추출이 없으므로 카운터가 그대로다. 다른 페이지에 더 큰 ID가 있으면
    // 이 페이지에서 드롭/삽입 시 충돌하므로, 복귀 시점에 전역 최대로 카운터를 올려 둔다.
    bumpFlatCounterTo(_globalMaxFlatId(cached.elements))
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
      pageNotes: cached.notes || '',
      pageNotesAudio: cached.notesAudio || null,
      pageNotesAudioHash: cached.notesAudioHash || '',
      pageNotesAudioVolume: cached.notesAudioVolume ?? 1,
      pageNotesCaptions: cached.notesCaptions || null,
      pageTransition: cached.transition || null,
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
    const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(iframeRef, _globalMaxFlatId(get().flatElements))
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
      pageNotes: '', pageNotesAudio: null, pageNotesAudioHash: '', pageNotesAudioVolume: 1, // 갓 추출 = 노트/음성 없음
    })
    get()._syncPageInfo()

    // 새 프로젝트: 빈 페이지면 시작 레이아웃(제목 슬라이드) 적용
    if (_pendingStarterLayout && elements.length === 0) {
      const starter = _buildStarterLayout(_pendingStarterLayout, get().canvasSize)
      _pendingStarterLayout = null
      if (starter.length) {
        set({ flatElements: starter, currentPageHtmlBacked: false })
        get()._saveCurrentPage()
        // flat-only로 표시 → 재생성 시 보존
        if (_pageCache[_currentPageKey]) _pageCache[_currentPageKey].htmlSlideIndex = null
      }
    }
  },

  /** 새 프로젝트 시작 시, 첫 빈 페이지 추출 후 적용할 시작 레이아웃 예약 */
  setPendingStarterLayout(layoutId) { _pendingStarterLayout = layoutId },

  /** iframe 없이 1페이지(시작 레이아웃) flat 프로젝트 생성 — 최초 빈 실행 시 사용 */
  startScratchProject(layoutId = 'title') {
    const cs = { w: 1920, h: 1080 }
    const theme = get()._currentTheme()
    const layoutEls = _applyThemeRoles(_buildStarterLayout(layoutId, cs), theme)
    const elements = [_buildThemeBgElement(theme, cs), ...layoutEls] // 테마 배경 + 테마색 텍스트
    for (const key in _pageCache) delete _pageCache[key] // 기존 캐시 비우고 단일 페이지로
    get().loadAllPages({ '0-0': { elements, canvasSize: cs, fontImports: [], htmlSlideIndex: null } }, '0-0')
    get()._syncPageInfo()
  },

  /** 현재 페이지 강제 재추출 (캐시 무시, iframe 페이지 동기화) */
  async forceReExtract() {
    const ref = get()._iframeRef
    if (!ref?.current) return

    // flat 모드에서는 iframe 페이지가 동기화 안 되어 있을 수 있으므로, 현재 (h,v)로 이동
    const r = parseRouteId(_currentPageKey) || { h: 0, v: 0 }
    ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: r.h, v: r.v }, '*')
    await new Promise(r => setTimeout(r, 400))

    if (_currentPageKey) delete _pageCache[_currentPageKey]
    const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref, _globalMaxFlatId(get().flatElements))
    _history.clear()
    set({
      flatElements: elements,
      canvasSize,
      fontImports: fontImports || [],
      selectedFlatIds: [],
      editingFlatId: null,
      canUndo: false,
      canRedo: false,
      pageNotes: '', pageNotesAudio: null, pageNotesAudioHash: '', pageNotesAudioVolume: 1,
    })
    get()._syncPageInfo()
  },

  /** 해상도 변경 시 모든 캐시 초기화 + 강제 재추출 */
  forceReExtractAll() {
    for (const key in _pageCache) delete _pageCache[key]
    get().forceReExtract()
  },

  /**
   * 해상도 변경 — 모든 페이지의 flat 내용을 새 크기에 비례 스케일(통합 동작).
   * HTML/처음부터 구분 없이 동일하게 처리하며 모든 페이지를 보존한다. iframe 불필요.
   */
  setResolution(newSize) {
    if (!newSize?.w || !newSize?.h) return
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    for (const key of keys) {
      const entry = _pageCache[key]
      if (!entry) continue
      const oldCs = entry.canvasSize || newSize
      entry.elements = scaleFlatElements(entry.elements, oldCs, newSize)
      entry.canvasSize = { ...newSize }
    }
    // 현재 페이지 라이브 상태 갱신
    if (_currentPageKey && _pageCache[_currentPageKey]) {
      const cur = _pageCache[_currentPageKey]
      set({ flatElements: cur.elements, canvasSize: cur.canvasSize, selectedFlatIds: [] })
    } else {
      // 캐시에 현재 페이지가 없으면(단일 페이지) 라이브 요소를 직접 스케일
      const oldCs = get().canvasSize || newSize
      set({ flatElements: scaleFlatElements(get().flatElements, oldCs, newSize), canvasSize: { ...newSize }, selectedFlatIds: [] })
    }
    get()._syncPageInfo()
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
    const es = editorStore.getState()
    const { currentPage, revealV } = es
    const routes = buildRevealRoutes(es)
    const origH = currentPage, origV = revealV || 0
    set({ _preloading: true, preloadProgress: { current: 0, total: routes.length } })
    const canonicalCs = es.isReveal && get().canvasSize?.w ? { ...get().canvasSize } : null
    const freshHtml = {}
    try {
      await _awaitIframeFonts(ref) // 웹폰트 로드 후 재추출(오버플로 방지)
      for (let ri = 0; ri < routes.length; ri++) {
        const route = routes[ri]
        ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: route.h, v: route.v }, '*')
        await new Promise(r => setTimeout(r, 400))
        try {
          const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref, _globalMaxFlatId(get().flatElements))
          freshHtml[route.id] = { elements, canvasSize: canonicalCs || canvasSize, fontImports: fontImports || [], history: { stack: [], pointer: -1 } }
        } catch (e) {
          console.warn(`Regen page ${route.id} failed:`, e.message)
        }
        set({ preloadProgress: { current: ri + 1, total: routes.length } })
      }
      // 원래 보던 페이지로 iframe 복원
      ref.current.contentWindow?.postMessage({ type: 'fe:navigate', page: origH, v: origV }, '*')
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

    // flat 주도 이동이 보낸 fe:navigate의 에코면 무시 — 이미 goToFlatPage가 캐시 복원함.
    // (페이지 중간 삽입으로 flat↔HTML 인덱스가 어긋난 뒤 엉뚱한 재추출/재복원 방지)
    // 한 번의 네비게이션에 에코가 여러 번 와도 시간 창 동안 모두 무시(타이머가 해제).
    if (_expectIframePage != null && String(pageKey) === String(_expectIframePage)) return

    // 현재 페이지 캐시 저장
    get()._saveCurrentPage()

    // 캐시 확인
    if (pageKey && get()._restoreFromCache(pageKey)) return

    // 캐시 미스 → DOM 렌더 대기 후 추출
    setTimeout(() => {
      const { elements, canvasSize, fontImports } = extractFlatElementsFromIframe(ref, _globalMaxFlatId(get().flatElements))
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
        pageNotes: '', pageNotesAudio: null, pageNotesAudioHash: '', pageNotesAudioVolume: 1,
      })
    }, 150)
  },

  setViewMode(mode) {
    set({ viewMode: mode })
  },

  setDrawMode(mode) {
    set({ drawMode: mode, selectedFlatIds: [], editingFlatId: null, diagramMode: false })
  },

  /** 다이어그램 모드 토글 — drawMode와 상호배타 */
  setDiagramMode(on) {
    set({ diagramMode: !!on, drawMode: null, editingFlatId: null })
  },

  /** 새 커넥터 기본 스타일 갱신(마지막 사용 기억) */
  setConnectorDefaults(partial) {
    set({ connectorDefaults: { ...get().connectorDefaults, ...partial } })
  },

  /**
   * 커넥터 생성 — connection({start,end} 각각 {elementId} 또는 {point}).
   * 기하(x/y/width/height/points)는 렌더 시 resolveConnectors가 유도하므로
   * 여기선 자리만 채운다(저장/선택용 캐시). connectorDefaults로 스타일 적용.
   */
  addConnector(connection) {
    const d = get().connectorDefaults
    const els = get().flatElements
    const maxZ = els.length > 0 ? Math.max(...els.map(e => e.zIndex)) : 0
    const el = {
      id: nextFlatId(), sourceId: null,
      type: 'shape', shapeType: 'connector',
      connection,
      routing: d.routing || 'straight',
      closed: false,
      content: '', isRich: false, merged: false,
      x: 0, y: 0, width: 0, height: 0, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      zIndex: maxZ + 1,
      startArrow: d.startArrow, endArrow: d.endArrow,
      styles: {
        stroke: d.stroke, strokeWidth: d.strokeWidth, strokeDasharray: d.strokeDasharray,
        fill: 'none', opacity: '1', backgroundColor: 'rgba(0,0,0,0)',
      },
    }
    get().addFlatElement(el)
    set({ selectedFlatIds: [el.id] })
    return el.id
  },

  /** 커넥터 생성 드래그 시작(소스 도형에서). startAnchor={fx,fy} 있으면 고정 연결점에서 시작 */
  beginConnectorFrom(sourceId, startPt, startAnchor = null) {
    set({ connectorDraft: { sourceId, startPt, curPt: startPt, targetId: null, startAnchor, targetAnchor: null } })
  },
  /** 드래그 중 갱신(커서 위치 + 부착 후보 + 대상 연결점) */
  updateConnectorDraft(curPt, targetId, targetAnchor = null) {
    const d = get().connectorDraft
    if (!d) return
    set({ connectorDraft: { ...d, curPt, targetId: targetId ?? null, targetAnchor: targetAnchor || null } })
  },
  cancelConnectorDraft() {
    if (get().connectorDraft) set({ connectorDraft: null })
  },
  /** 드래그 종료 → 커넥터 생성. 연결점 드롭=고정, 몸체 드롭=플로팅, 빈 공간/자기자신=취소. */
  commitConnectorDraft() {
    const d = get().connectorDraft
    if (!d) return null
    set({ connectorDraft: null })
    const { sourceId, targetId, startAnchor, targetAnchor } = d
    if (targetId && targetId !== sourceId) {
      const start = startAnchor
        ? { elementId: sourceId, fx: startAnchor.fx, fy: startAnchor.fy }
        : { elementId: sourceId }
      const end = targetAnchor
        ? { elementId: targetId, fx: targetAnchor.fx, fy: targetAnchor.fy }
        : { elementId: targetId }
      return get().addConnector({ start, end })
    }
    return null
  },

  /** 커넥터 방향 뒤집기 — 양끝 연결 + 화살표 스왑 */
  reverseConnector(id) {
    const el = get().flatElements.find(e => e.id === id)
    if (!el || el.shapeType !== 'connector' || !el.connection) return
    get().updateFlatElement(id, {
      connection: { start: el.connection.end, end: el.connection.start },
      startArrow: el.endArrow || 'none',
      endArrow: el.startArrow || 'none',
    })
  },

  /** 모든 페이지를 백그라운드로 미리 flat 변환 (로딩 시 자동 호출) */
  async preloadAllPages() {
    if (get()._preloading) return
    set({ _preloading: true })

    try {
      const editorStore = (await import('./editorStore')).useEditorStore
      const es = editorStore.getState()
      const { currentPage, revealV, iframeRef } = es
      const { extractFlatElementsFromIframe } = await import('../core/FlatExtractor')

      // (h,v) 전체 경로 — 수직 서브슬라이드까지 포함
      const routes = buildRevealRoutes(es)
      if (!iframeRef?.current || routes.length <= 1) {
        set({ _preloading: false, preloadProgress: null })
        // 단일 페이지 import 덱: 현재 페이지의 원격 자산도 자립형으로 내려받는다
        if (es.htmlImported) get().materializeRemoteAssets()
        return
      }

      get()._saveCurrentPage()
      await _awaitIframeFonts(iframeRef) // 웹폰트 로드 후 추출(오버플로 방지)
      // reveal(균일 해상도) 덱은 전 페이지가 같은 크기. 프리로드 중 reveal scale 감지
      // 타이밍으로 canvasSize가 좁게 잡히는 것을 방지하려, 현재 페이지(정착된 신뢰값)의
      // canvasSize로 통일한다.
      const canonicalCs = es.isReveal && get().canvasSize?.w ? { ...get().canvasSize } : null
      const origH = currentPage, origV = revealV || 0
      let done = Object.keys(_pageCache).length

      set({ preloadProgress: { current: done, total: routes.length } })

      for (const route of routes) {
        if (_pageCache[route.id]) continue

        iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: route.h, v: route.v }, '*')
        await new Promise(r => setTimeout(r, 400))

        try {
          const result = extractFlatElementsFromIframe(iframeRef, _globalMaxFlatId(get().flatElements))
          _pageCache[route.id] = {
            elements: result.elements,
            canvasSize: canonicalCs || result.canvasSize,
            fontImports: result.fontImports || [],
            history: { stack: [], pointer: -1 },
            htmlSlideIndex: route.id, // 출처 (h,v) 경로
          }
        } catch (e) {
          console.warn(`Preload page ${route.id} failed:`, e.message)
        }

        done++
        set({ preloadProgress: { current: done, total: routes.length } })
      }

      // 원래 페이지로 복원
      iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: origH, v: origV }, '*')
      await new Promise(r => setTimeout(r, 300))

      console.log(`Preload: ${routes.length} pages cached`)
      get()._syncPageInfo()
      // import된 덱이면 전 페이지의 원격(http) 이미지/영상 URL을 idb로 내려받아 자립화
      if (es.htmlImported) get().materializeRemoteAssets()
    } catch (e) {
      console.warn('Preload failed:', e.message)
    } finally {
      set({ _preloading: false, preloadProgress: null })
    }
  },

  /**
   * import된 덱의 원격(http/https) 이미지·영상 URL을 내부 저장소(idb ref)로 내려받아
   * 덱을 자립형으로 만든다. 외부 자산(예: Higgsfield hosted URL)의 만료나
   * export 시 tainted-canvas(원격 CORS 미허용) 문제를 방지한다.
   * best-effort: fetch 실패(CORS 미허용·네트워크 오류) 시 해당 URL은 원격 그대로 둔다.
   * 추출기는 <img>/<video>의 src를 원격 URL 그대로 content에 담으므로(FlatExtractor),
   * flat 모델 계층에서 1회 변환한다.
   */
  async materializeRemoteAssets() {
    const isRemote = (c) => typeof c === 'string' && /^https?:\/\//i.test(c)
    const urls = new Set()
    const collect = (els) => {
      for (const e of els || []) {
        if ((e.type === 'image' || e.type === 'video') && isRemote(e.content)) urls.add(e.content)
      }
    }
    collect(get().flatElements)
    for (const k in _pageCache) collect(_pageCache[k]?.elements)
    if (!urls.size) return

    const { BlobStore } = await import('../core/BlobStore')
    const map = new Map() // 원격 URL → idb ref (URL당 1회만 fetch)
    await Promise.all([...urls].map(async (u) => {
      try {
        const res = await fetch(u, { mode: 'cors' })
        if (!res.ok) return
        const blob = await res.blob()
        if (!blob.size) return
        map.set(u, BlobStore.toRef(await BlobStore.put(blob)))
      } catch { /* CORS/네트워크 실패 → 원격 URL 유지(무해) */ }
    }))
    if (!map.size) return

    const rewrite = (els) => {
      let changed = false
      const next = els.map((e) => (map.has(e.content) ? (changed = true, { ...e, content: map.get(e.content) }) : e))
      return changed ? next : els
    }
    for (const k in _pageCache) {
      if (_pageCache[k]?.elements) _pageCache[k].elements = rewrite(_pageCache[k].elements)
    }
    const liveNext = rewrite(get().flatElements)
    if (liveNext !== get().flatElements) set({ flatElements: liveNext })
  },

  // ── Flat 모드 페이지 관리 ──

  /** 현재 페이지 뒤에 빈 페이지 추가 */
  addPage(layoutId = null) {
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
    const theme = get()._currentTheme()
    // 배경: 현재 슬라이드에 배경 레이어(이미지 포함)가 있으면 그대로 복제, 없으면 테마 배경
    const curBgLayers = get().flatElements
      .filter(e => isBackgroundElement(e, cs))
      .sort((a, b) => a.zIndex - b.zIndex)
    const bgEls = curBgLayers.length
      ? curBgLayers.map(b => ({ ...structuredClone(b), id: nextFlatId() }))
      : [_buildThemeBgElement(theme, cs)]
    const elements = [
      ...bgEls,
      ...(layoutId ? _applyThemeRoles(_buildStarterLayout(layoutId, cs), theme) : []),
    ]
    _pageCache[newKey] = {
      elements,
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

  /** 현재 페이지를 복제해 바로 뒤에 삽입 (요소는 새 id로 복제) */
  duplicatePage() {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    const currentIdx = _currentPageKey ? keys.indexOf(_currentPageKey) : keys.length - 1
    if (currentIdx < 0) return
    const src = _pageCache[_currentPageKey]
    if (!src) return
    const insertAt = currentIdx + 1

    const reindexed = {}
    for (let i = 0; i < keys.length; i++) {
      const newIdx = i < insertAt ? i : i + 1
      reindexed[`${newIdx}-0`] = _pageCache[keys[i]]
    }
    for (const key in _pageCache) delete _pageCache[key]
    for (const key in reindexed) _pageCache[key] = reindexed[key]

    _pageCache[`${insertAt}-0`] = {
      elements: src.elements.map(e => ({ ...structuredClone(e), id: nextFlatId() })),
      canvasSize: { ...src.canvasSize },
      fontImports: [...(src.fontImports || [])],
      history: { stack: [], pointer: -1 },
      htmlSlideIndex: null, // 복제본은 flat-only
      // 노트/음성/볼륨/전환도 복제(누락 시 복제본의 나레이션·립싱크 짝 유실).
      // 자막도 함께 복제 — 음성 ref(notesAudio)를 그대로 공유하므로 forRef가 여전히 유효하다.
      notes: src.notes || '',
      notesAudio: src.notesAudio || null,
      notesAudioHash: src.notesAudioHash || '',
      notesAudioVolume: src.notesAudioVolume ?? 1,
      notesCaptions: src.notesCaptions || null,
      transition: src.transition || null,
    }

    _currentPageKey = `${insertAt}-0`
    get()._restoreFromCache(`${insertAt}-0`)
    get()._syncPageInfo()
  },

  /** 현재 페이지 삭제 (최소 1페이지 유지) */
  deletePage() {
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    if (keys.length <= 1) return // 마지막 페이지는 삭제 불가

    const idx = keys.indexOf(_currentPageKey)
    // 복구용 스태시 (실행취소 토스트)
    _deletedPageStash = { index: idx, entry: structuredClone(_pageCache[_currentPageKey]) }
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
    set({ pageDeleteNotice: _deletedPageStash ? { seq: (get().pageDeleteNotice?.seq || 0) + 1, index: idx } : null })
  },

  /** 마지막으로 삭제한 페이지 복원 (실행취소 토스트) */
  restoreDeletedPage() {
    const stash = _deletedPageStash
    if (!stash) return
    _deletedPageStash = null
    get()._saveCurrentPage()
    const keys = _getSortedPageKeys()
    const at = Math.max(0, Math.min(stash.index, keys.length))
    // at 이상 키를 한 칸 뒤로 밀고 그 자리에 복원
    const reindexed = {}
    keys.forEach((k, i) => { reindexed[`${i < at ? i : i + 1}-0`] = _pageCache[k] })
    for (const k in _pageCache) delete _pageCache[k]
    for (const k in reindexed) _pageCache[k] = reindexed[k]
    _pageCache[`${at}-0`] = stash.entry
    _currentPageKey = `${at}-0`
    get()._restoreFromCache(`${at}-0`)
    get()._syncPageInfo()
    set({ pageDeleteNotice: null })
  },

  dismissPageDeleteNotice() {
    _deletedPageStash = null
    set({ pageDeleteNotice: null })
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
    if (get().multiSelect) set({ multiSelect: false }) // 페이지 전환 시 다중 선택 모드 초기화
    // split 모드: iframe을 이 페이지의 '실제 HTML 슬라이드 인덱스'로 이동.
    // flat-only 페이지(htmlSlideIndex=null)는 대응 슬라이드가 없으므로 iframe을 건드리지 않는다
    // (엉뚱한 슬라이드 표시 방지). 인덱스 어긋남도 이 저장값으로 해소.
    if (get().viewMode === 'split') {
      const routeId = _pageCache[key]?.htmlSlideIndex
      const route = parseRouteId(routeId)
      if (route) {
        // 이 네비게이션으로 돌아올 fe:pageChange 에코(들)는 reExtract에서 무시
        _expectIframeNav(`${route.h}-${route.v}`)
        const ref = get()._iframeRef
        ref?.current?.contentWindow?.postMessage({ type: 'fe:navigate', page: route.h, v: route.v }, '*')
      } else {
        _clearExpectIframeNav()
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

  /** pageKey로 이동(작업 트레이 '보기'용). 이미 그 페이지면 no-op. 성공 시 true. */
  goToFlatPageByKey(pageKey) {
    if (!pageKey) return false
    if (pageKey === _currentPageKey) return true
    const idx = _getSortedPageKeys().indexOf(pageKey)
    if (idx < 0) return false
    get().goToFlatPage(idx)
    return true
  },

  setSelectedFlat(id) {
    if (get().editingFlatId && get().editingFlatId !== id) get()._commitActiveEdit()
    set({ selectedFlatIds: id ? [id] : [] })
  },

  /** Shift+클릭용 — 토글 선택 */
  toggleSelectFlat(id) {
    if (get().editingFlatId && get().editingFlatId !== id) get()._commitActiveEdit()
    const ids = get().selectedFlatIds
    if (ids.includes(id)) {
      set({ selectedFlatIds: ids.filter(i => i !== id) })
    } else {
      set({ selectedFlatIds: [...ids, id] })
    }
  },

  /** 마키 선택 결과 일괄 설정 */
  setSelectedFlats(ids) {
    const ed = get().editingFlatId
    if (ed && !ids.includes(ed)) get()._commitActiveEdit()
    set({ selectedFlatIds: ids })
  },

  /** 전체 선택 (Ctrl+A) */
  selectAllFlats() {
    // 배경 레이어(__bg/isBackground)는 전체 선택에서 제외 — 콘텐츠 요소만 선택
    const ids = get().flatElements.filter(e => !isBackgroundElement(e)).map(e => e.id)
    set({ selectedFlatIds: ids })
  },

  /** 선택된 요소들을 하나의 그룹으로 묶기 (Ctrl+G) */
  groupSelected() {
    const ids = get().selectedFlatIds
    if (ids.length < 2) return
    const gid = newGroupId()
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
    if (get().editingFlatId && get().editingFlatId !== id) get()._commitActiveEdit()
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

  /**
   * 진행 중인 인라인 편집을 즉시 커밋하고 편집 모드 종료.
   * 다른 요소 mousedown의 preventDefault가 contentEditable의 blur(=커밋)를 막아
   * 편집 중 요소가 남은 채 새 요소가 선택되는(둘 다 선택된 것처럼 보이는) 문제 방지.
   */
  _commitActiveEdit() {
    if (_pendingEditCommit) { _pendingEditCommit(); _pendingEditCommit = null }
    if (get().editingFlatId) set({ editingFlatId: null })
  },

  /** 테마 선택 — id 저장 후 현재 페이지에 적용 (배경 + 역할 텍스트 서식) */
  setTheme(id) {
    set({ themeId: id })
    get().applyThemeToCurrentPage()
  },

  /** 테마 id만 설정(적용 없음) — 프로젝트 로드 시 복원용 */
  setThemeId(id) {
    if (id) set({ themeId: id })
  },

  /** 현재 활성 테마 객체 — 사용자정의면 store의 customTheme, 아니면 프리셋 */
  _currentTheme() {
    return get().themeId === 'custom' ? get().customTheme : getTheme(get().themeId)
  },

  /** 사용자정의 테마 토큰 갱신 (스포이드 채취 등). patch = { bg } | { role, style:{color,...} } */
  updateCustomTheme(patch) {
    const ct = get().customTheme || makeDefaultCustomTheme()
    const next = { ...ct, roles: { ...ct.roles } }
    if (patch.bg) {
      next.bg = patch.bg
      next.swatch = [patch.bg.type === 'gradient' ? (patch.bg.value.match(/#[0-9a-f]{3,8}/i)?.[0] || '#888') : patch.bg.value, next.swatch?.[1] || '#1e293b']
    }
    if (patch.role && patch.style) {
      next.roles[patch.role] = { ...next.roles[patch.role], ...patch.style }
      if (patch.role === 'title') next.swatch = [next.swatch?.[0] || '#ffffff', patch.style.color || next.swatch?.[1]]
    }
    set({ customTheme: next })
  },

  /** 프로젝트 로드 시 사용자정의 테마 복원 */
  setCustomTheme(ct) {
    if (ct && ct.roles) set({ customTheme: ct })
  },

  /** 신규 텍스트 요소의 기본 서식(현재 테마 default 역할) */
  getThemeTextDefault() {
    const d = get()._currentTheme()?.roles?.default
    return d || { color: '#334155', fontWeight: '400', textShadow: 'none' }
  },

  /**
   * 현재 테마를 현재 페이지에 적용.
   *  - 배경 레이어가 있으면 배경 스타일 교체, 없으면 맨 아래에 생성
   *  - layoutRole 있는 텍스트만 color/fontWeight/textShadow 교체(수동 색 보존)
   */
  applyThemeToCurrentPage() {
    const theme = get()._currentTheme()
    const cs = get().canvasSize
    const els = get().flatElements
    const bgStyles = themeBackgroundStyles(theme)

    const changes = []
    const bgEl = els.find(e => isBackgroundElement(e, cs))
    if (bgEl) {
      changes.push({ id: bgEl.id, changes: { styles: bgStyles } })
    } else {
      const minZ = els.length ? Math.min(...els.map(e => e.zIndex)) : 1
      get().addFlatElement({
        id: nextFlatId(), sourceId: '__bg', type: 'shape', content: '', isRich: false, merged: false,
        isBackground: true,
        x: 0, y: 0, width: cs.w, height: cs.h, zIndex: minZ - 1, locked: true,
        styles: {
          backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', borderRadius: '0px',
          border: '0px none', boxShadow: 'none', opacity: '1', ...bgStyles,
        },
      })
    }
    for (const e of els) {
      if (e.type !== 'text' || !e.layoutRole) continue
      const rs = themeRoleStyles(theme, e.layoutRole)
      if (!rs) continue
      changes.push({ id: e.id, changes: { styles: { color: rs.color, fontWeight: rs.fontWeight, textShadow: rs.textShadow } } })
    }
    if (changes.length) get().batchUpdateFlatElementsIndividual(changes)
  },

  /** 현재 테마를 모든 슬라이드에 일괄 적용 (배경 + 역할 텍스트). 벌크 작업이라 페이지별 히스토리는 없음 */
  applyThemeToDeck() {
    const theme = get()._currentTheme()
    get()._saveCurrentPage()
    for (const key in _pageCache) {
      const page = _pageCache[key]
      page.elements = _applyThemeToElements(page.elements, theme, page.canvasSize || get().canvasSize)
    }
    if (_currentPageKey) get()._restoreFromCache(_currentPageKey)
    get()._syncPageInfo()
  },

  /** 인라인 텍스트 편집 시작/종료 */
  setEditingFlat(id) {
    if (get().editingFlatId && get().editingFlatId !== id) get()._commitActiveEdit()
    set({ editingFlatId: id })
  },

  /** 인라인 편집 완료 — content/isRich 업데이트 후 편집 모드 종료 */
  commitTextEdit(id, newContent, isRich) {
    get().updateFlatElement(id, { content: newContent, isRich })
    set({ editingFlatId: null })
    get().reflowAutoFit() // 오토핏 컨테이너 안 텍스트면 높이 재계산(없으면 no-op)
  },

  /** 코드 모드 요소 편집 커밋 — 원본(raw) 저장 + 하이라이트 + 오토핏 reflow */
  commitCodeEdit(id, rawCode) {
    const el = get().flatElements.find(e => e.id === id)
    const reqLang = el?.lang || 'auto'
    const { html, lang } = highlightCode(rawCode, reqLang)
    get().updateFlatElement(id, { code: rawCode, content: html, isRich: true, lang: reqLang === 'auto' ? lang : reqLang })
    set({ editingFlatId: null })
    get().reflowAutoFit()
  },

  /** 마크다운 요소 편집 커밋 — 원본(md) 저장 + 렌더(새니타이즈) + 오토핏 reflow */
  commitMarkdownEdit(id, rawMd) {
    const html = renderMarkdown(rawMd)
    get().updateFlatElement(id, { md: rawMd, content: html, isRich: true })
    set({ editingFlatId: null })
    get().reflowAutoFit()
  },

  /** 오토핏 reflow — 컨테이너가 콘텐츠를 감싸도록 geometry 재계산(히스토리 없는 레이아웃 보정).
   * measured: 편집 중 실제 측정 높이 { [contentId]: px } (없으면 추정) */
  reflowAutoFit(measured) {
    const cur = get().flatElements
    const next = applyAutoFit(cur, measured)
    if (next !== cur) set({ flatElements: next })
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

    // 커넥터의 화살표/선스타일을 바꾸면 다음 커넥터 기본값으로 기억(마지막 사용 기억)
    if (updated[idx].shapeType === 'connector') {
      // 한쪽 끝 화살표만 바꾸는 '의도적 선택'일 때만 기억. 양쪽 동시 변경(방향 뒤집기 등)은
      // 기본값으로 굳히면 안 됨(다음 새 커넥터가 시작쪽 화살표로 잘못 생성됨).
      const touchesArrow = ('startArrow' in changes) !== ('endArrow' in changes)
      const s = changes.styles || {}
      const touchesLine = 'stroke' in s || 'strokeWidth' in s || 'strokeDasharray' in s
      const touchesRouting = 'routing' in changes
      if (touchesArrow || touchesLine || touchesRouting) {
        const c = updated[idx]
        get().setConnectorDefaults({
          startArrow: c.startArrow ?? 'none',
          endArrow: c.endArrow ?? 'none',
          stroke: c.styles?.stroke ?? '#1e293b',
          strokeWidth: c.styles?.strokeWidth ?? '2',
          strokeDasharray: c.styles?.strokeDasharray ?? '',
          routing: c.routing ?? 'straight',
        })
      }
    }
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
    get()._removeByIdSet([id])
  },

  /** 선택된 요소 전체 삭제 (다중 삭제) */
  removeSelectedElements() {
    const { selectedFlatIds } = get()
    if (selectedFlatIds.length === 0) return
    get()._removeByIdSet(selectedFlatIds)
  },

  /**
   * 주어진 id들(+그것을 참조하는 커넥터)을 한 번의 히스토리로 삭제.
   * 연결 도형을 지우면 커넥터도 함께 삭제된다(동반 삭제).
   */
  _removeByIdSet(baseIds) {
    const flatElements = get().flatElements
    const idSet = new Set(baseIds)
    // 참조 커넥터 동반 삭제
    for (const el of flatElements) {
      if (el.shapeType === 'connector' && el.connection) {
        const s = el.connection.start?.elementId
        const t = el.connection.end?.elementId
        if ((s && idSet.has(s)) || (t && idSet.has(t))) idSet.add(el.id)
      }
    }
    // 문서 순서대로 entries 구성(점진 삭제 인덱스 — batch_remove undo와 일치)
    const entries = []
    let updated = [...flatElements]
    for (const el of flatElements) {
      if (!idSet.has(el.id)) continue
      const idx = updated.findIndex(e => e.id === el.id)
      if (idx === -1) continue
      entries.push({ element: { ...updated[idx] }, index: idx })
      updated = updated.filter(e => e.id !== el.id)
    }
    if (entries.length === 0) return
    if (entries.length === 1) {
      _history.push({ type: 'remove', element: entries[0].element, index: entries[0].index })
    } else {
      _history.push({ type: 'batch_remove', entries })
    }
    const updates = {
      flatElements: updated,
      selectedFlatIds: get().selectedFlatIds.filter(i => !idSet.has(i)),
      canUndo: _history.canUndo, canRedo: _history.canRedo,
    }
    if (idSet.has(get().editingFlatId)) updates.editingFlatId = null
    set(updates)
  },

  /** 선택된 요소 복사 (클립보드에 저장) — 다중 지원 */
  copyElement() {
    const { selectedFlatIds, flatElements } = get()
    const copied = flatElements.filter(e => selectedFlatIds.includes(e.id))
    if (copied.length > 0) {
      set({ clipboard: structuredClone(copied) })
      _clipboardPageKey = _currentPageKey // 복사한 페이지 기억
    }
  },

  /** 현재 프로젝트 파일(핸들/이름) 기억 — 열기·저장 시 호출. null이면 초기화. */
  /** 현재 덱의 출처 파일명(HTML 로드/드롭 시). 내보내기·저장 기본 파일명 도출에 사용 */
  setHtmlSourceName(name) { set({ htmlSourceName: name || null }) },

  /** 내보내기/저장 공통 기본 파일명(확장자 제거). 프로젝트명 우선, 없으면 HTML 출처명 */
  getExportBaseName() {
    const st = get()
    const strip = (n) => (n ? n.replace(/\.(flatproj|html?|json)$/i, '').trim() : '')
    return strip(st.projectFileName) || strip(st.htmlSourceName) || ''
  },

  setProjectFile(handle, name) {
    set({ projectFileHandle: handle || null, projectFileName: name || null })
  },

  /**
   * 프로젝트 저장. 기억된 파일 핸들이 있으면 같은 파일에 덮어쓰고(=Ctrl+S),
   * 없거나 saveAs=true면 저장 팝업으로 새 파일을 만든 뒤 그 파일을 기억한다.
   * @param {{ saveAs?: boolean }} [opts]
   * @returns {Promise<boolean>} 저장 성공 여부
   */
  async saveProject({ saveAs = false } = {}) {
    const st = get()
    const { serializeProject } = await import('../core/ProjectSerializer.js')
    const { saveBlob } = await import('../core/FilePicker.js')
    const blob = await serializeProject(get())
    const handle = (!saveAs && st.projectFileHandle) ? st.projectFileHandle : null
    const used = await saveBlob(blob, {
      suggestedName: (get().getExportBaseName() || 'project') + '.flatproj',
      description: 'Genitor 프로젝트',
      accept: { 'application/zip': ['.flatproj'] }, // .flatproj는 ZIP — 콘텐츠 타입 일치
      handle,
    })
    if (used) {
      set({ projectFileHandle: used, projectFileName: used.name || st.projectFileName })
      try {
        const { addRecent } = await import('../core/RecentProjects.js')
        await addRecent(used, used.name || st.projectFileName)
      } catch { /* 최근목록 실패는 무시 */ }
    }
    return !!used
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
    // 같은 페이지에 붙여넣으면 빗겨나게(+20), 다른 페이지면 같은 위치에.
    const off = (_currentPageKey === _clipboardPageKey) ? 20 : 0
    // 그룹ID 재매핑 — 복제본끼리 새 그룹을 이루되 원본 그룹과는 분리
    const groupMap = {}
    const newEls = clipboard.map(e => {
      const clone = {
        ...structuredClone(e),
        id: nextFlatId(),
        sourceId: null,
        x: e.x + off,
        y: e.y + off,
      }
      if (clone.groupId) {
        if (!groupMap[clone.groupId]) {
          groupMap[clone.groupId] = newGroupId()
        }
        clone.groupId = groupMap[clone.groupId]
      }
      return clone
    })
    // 배경 클론은 대상 페이지의 기존 배경들보다 '앞'에 — 안 그러면 그 페이지의 흰 배경 등에 가려 안 보인다.
    let bgTop = null
    for (const clone of newEls) {
      if (!isBackgroundElement(clone)) continue
      if (bgTop === null) {
        const bgZs = flatElements.filter(e => isBackgroundElement(e)).map(e => e.zIndex)
        bgTop = bgZs.length ? Math.max(...bgZs) : (flatElements.length ? Math.min(...flatElements.map(e => e.zIndex)) - 1 : 0)
      }
      clone.zIndex = ++bgTop
    }
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

  /** 현재 페이지 키 — 비동기 AI 작업이 결과 적용 대상을 (현재 선택과 무관하게) 바인딩하는 데 사용. */
  getCurrentPageKey() { return _currentPageKey },

  /**
   * 대상 요소에 변경 적용 — 현재 페이지면 라이브(updateFlatElement, 히스토리),
   * 다른(캐시된) 페이지면 그 페이지 캐시 요소를 직접 갱신.
   * 비동기 AI 작업 결과를 '현재 선택/페이지와 무관하게' 대상에 반영하기 위함.
   * @returns {boolean} 대상을 찾아 적용했으면 true
   */
  applyToElementOnPage(pageKey, id, changes) {
    if (!pageKey || pageKey === _currentPageKey) {
      if (!get().flatElements.some(e => e.id === id)) return false
      get().updateFlatElement(id, changes)
      return true
    }
    const cached = _pageCache[pageKey]
    if (!cached || !Array.isArray(cached.elements)) return false
    const idx = cached.elements.findIndex(e => e.id === id)
    if (idx === -1) return false
    const old = cached.elements[idx]
    // styles는 중첩 머지(updateFlatElement와 동일 규칙)
    const merged = (changes.styles && old.styles)
      ? { ...changes, styles: { ...old.styles, ...changes.styles } }
      : changes
    const next = [...cached.elements]
    next[idx] = { ...old, ...merged }
    cached.elements = next
    return true
  },

  /** 대상 페이지에 요소 추가 — 현재 페이지면 라이브(addFlatElement), 아니면 캐시에 직접 추가.
   * @returns {boolean} 추가했으면 true (대상 페이지가 없으면 false) */
  addElementToPage(pageKey, element) {
    if (!pageKey || pageKey === _currentPageKey) {
      get().addFlatElement(element)
      return true
    }
    const cached = _pageCache[pageKey]
    if (!cached) return false
    cached.elements = [...(cached.elements || []), element]
    return true
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

  /**
   * AWS 아이콘 삽입 (다이어그램 모드) — 아이콘 이미지 + 서비스명 라벨을 한 그룹으로 추가.
   * dropX/dropY 미지정 시 캔버스 중앙. 단일 undo, 둘 다 선택 상태로.
   */
  insertAwsIcon(iconId, dropX, dropY) {
    const dataUrl = awsIconDataUrl(iconId)
    if (!dataUrl) return
    const cs = get().canvasSize
    const els = get().flatElements
    const maxZ = els.length > 0 ? Math.max(...els.map(e => e.zIndex)) : 0
    const SIZE = 56, LABEL_W = 110, LABEL_H = 22, GAP = 2
    const cx = dropX != null ? dropX : cs.w / 2
    const cy = dropY != null ? dropY : cs.h / 2
    let ix = Math.round(cx - SIZE / 2)
    let iy = Math.round(cy - SIZE / 2)
    ix = Math.max(0, Math.min(ix, cs.w - SIZE))
    iy = Math.max(0, Math.min(iy, cs.h - SIZE - LABEL_H - GAP))
    const gid = newGroupId()
    const iconEl = {
      id: nextFlatId(), sourceId: null, type: 'image', groupId: gid,
      content: dataUrl, isRich: false, merged: false,
      x: ix, y: iy, width: SIZE, height: SIZE, zIndex: maxZ + 1,
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none',
        borderRadius: '0px', border: '0px none', boxShadow: 'none',
        opacity: '1', objectFit: 'contain',
      },
    }
    // 라벨 x는 (클램프된) 아이콘 중심 기준 — 가장자리 드롭에서도 아이콘 아래 정렬·캔버스 내 유지
    const labelX = Math.max(0, Math.min(Math.round(ix + SIZE / 2 - LABEL_W / 2), cs.w - LABEL_W))
    const labelEl = {
      id: nextFlatId(), sourceId: null, type: 'text', groupId: gid,
      content: ICON_LABEL[iconId] || iconId, isRich: false, merged: false,
      x: labelX, y: iy + SIZE + GAP, width: LABEL_W, height: LABEL_H, zIndex: maxZ + 2,
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', color: '#232F3E',
        fontSize: '11px', fontFamily: 'sans-serif', fontWeight: '600',
        lineHeight: '1.3', textAlign: 'center', padding: '2px',
        borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1',
      },
    }
    get().addFlatElements([iconEl, labelEl])
    get().setSelectedFlats([iconEl.id, labelEl.id])
  },

  /**
   * AWS 그룹 컨테이너 삽입 — 색 입힌 점선/실선 경계 박스 + 좌상단 라벨을 한 그룹으로 추가.
   * 투명 채움이라 안에 둔 요소가 비친다. 나중에 드롭한 아이콘이 위에 쌓이도록 일반 z로 추가.
   */
  insertAwsGroup(kind, dropX, dropY) {
    const def = GROUP_BY_KIND[kind]
    if (!def) return
    const cs = get().canvasSize
    const els = get().flatElements
    const maxZ = els.length > 0 ? Math.max(...els.map(e => e.zIndex)) : 0
    const W = Math.min(340, cs.w * 0.5), H = Math.min(240, cs.h * 0.5)
    const cx = dropX != null ? dropX : cs.w / 2
    const cy = dropY != null ? dropY : cs.h / 2
    let x = Math.round(cx - W / 2), y = Math.round(cy - H / 2)
    x = Math.max(0, Math.min(x, cs.w - W))
    y = Math.max(0, Math.min(y, cs.h - H))
    const gid = newGroupId()
    const rectEl = {
      id: nextFlatId(), sourceId: null, type: 'shape', groupId: gid,
      content: '', isRich: false, merged: false,
      x, y, width: Math.round(W), height: Math.round(H), zIndex: maxZ + 1,
      styles: {
        backgroundColor: 'rgba(0,0,0,0)',
        border: `2px ${def.dashed ? 'dashed' : 'solid'} ${def.color}`,
        borderRadius: '8px', boxShadow: 'none', opacity: '1',
      },
    }
    const labelEl = {
      id: nextFlatId(), sourceId: null, type: 'text', groupId: gid,
      content: def.label, isRich: false, merged: false,
      x: x + 8, y: y + 6, width: Math.round(W) - 16, height: 22, zIndex: maxZ + 2,
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', color: def.color,
        fontSize: '12px', fontFamily: 'sans-serif', fontWeight: '700',
        lineHeight: '1.3', textAlign: 'left', padding: '0px',
        borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1',
      },
    }
    get().addFlatElements([rectEl, labelEl])
    get().setSelectedFlats([rectEl.id, labelEl.id])
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

  /**
   * "피사체 뒤 텍스트" 3층 구성: 원본(배경) + 타이틀 텍스트(중간) + 전경 컷아웃(최상위).
   * cutoutContent = 전경 알파 PNG 참조(idb:// 권장, data URL도 가능). 배경+컷아웃만 한 그룹으로 묶고
   * (타이틀은 독립 → 자유 배치) applyLayoutElements로 단일 undo. 적용 후 타이틀 선택.
   * @returns {string|null} 생성된 타이틀 텍스트 요소 id
   */
  applyTextBehindSubject(imageId, cutoutContent, opts = {}) {
    const els = get().flatElements
    const orig = els.find(e => e.id === imageId)
    if (!orig || !cutoutContent) return null
    const maxZ = els.length ? Math.max(...els.map(e => e.zIndex)) : 0
    const gid = newGroupId()

    // 타이틀: 이미지 박스 중앙, 큰 글자(레퍼런스 느낌). 텍스트 < 컷아웃이라 피사체 뒤로 가려짐.
    // 그룹에 넣지 않음 → 사용자가 자유롭게 드래그해 원하는 위치에 배치(z-순서가 가림 효과 유지).
    const fontPx = Math.max(40, Math.round(orig.height * 0.32))
    const textEl = {
      id: nextFlatId(), sourceId: null, type: 'text',
      content: opts.titleText || 'TITLE', isRich: false, merged: false,
      x: orig.x, y: Math.round(orig.y + orig.height / 2 - fontPx * 0.7),
      width: orig.width, height: Math.round(fontPx * 1.4),
      zIndex: maxZ + 1,
      styles: {
        fontSize: fontPx + 'px', fontWeight: '800', color: 'rgba(255,255,255,0.92)',
        textAlign: 'center', lineHeight: '1', letterSpacing: '0.02em',
        fontFamily: orig.styles?.fontFamily || 'inherit',
      },
    }
    // 전경 컷아웃: 원본과 동일 박스 + 동일 채움 전략(objectFit/objectPosition)으로 정확히 겹침.
    // 컷아웃은 원본 해상도로 분리돼 고유 종횡비가 같으므로, 같은 objectFit이면 그룹 리사이즈에도
    // 원본과 똑같이 변형돼 인물·배경이 어긋나지 않는다.
    const cutoutStyles = {}
    if (orig.styles?.objectFit) cutoutStyles.objectFit = orig.styles.objectFit
    if (orig.styles?.objectPosition) cutoutStyles.objectPosition = orig.styles.objectPosition
    const cutoutEl = {
      id: nextFlatId(), sourceId: null, type: 'image',
      content: cutoutContent, isRich: false, merged: false,
      x: orig.x, y: orig.y, width: orig.width, height: orig.height,
      zIndex: maxZ + 2, groupId: gid,
      clickThrough: true, // 클릭이 아래 타이틀로 통과(컷아웃은 배경과 그룹으로 함께 조작)
      styles: cutoutStyles,
    }
    // 원본도 그룹에 포함(함께 이동) — 제거 후 groupId 부여본으로 재추가하여 단일 undo.
    get().applyLayoutElements([imageId], [{ ...orig, groupId: gid }, textEl, cutoutEl])
    set({ selectedFlatIds: [textEl.id] }) // 타이틀 선택 → 더블클릭해 'TITLE' 교체
    return textEl.id
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

  /** 배경끼리 순서 변경 — dir +1: 앞으로(위), -1: 뒤로(아래). 인접 배경과 zIndex 스왑. */
  /** 배경 레이어 순서를 통째로 지정. orderedIds = 뒤→앞(z 오름차순) 순서의 배경 id 배열.
   *  기존 배경 z 값 집합은 그대로 두고, 어떤 요소가 어느 z를 갖는지만 재배치한다
   *  (배경이 항상 일반 콘텐츠보다 뒤에 깔리는 불변식 유지). undo/redo 지원. */
  setBackgroundOrder(orderedIds) {
    const els = get().flatElements
    const bgs = els.filter(e => isBackgroundElement(e))
    if (bgs.length < 2) return
    const idSet = new Set(bgs.map(e => e.id))
    // orderedIds가 배경 id 전체를 정확히 한 번씩 포함하는지 검증(부분/중복/외부 id 방지)
    if (orderedIds.length !== bgs.length || new Set(orderedIds).size !== bgs.length
        || !orderedIds.every(id => idSet.has(id))) return
    const zsAsc = bgs.map(e => e.zIndex).sort((a, b) => a - b)
    const newZ = {}
    orderedIds.forEach((id, i) => { newZ[id] = zsAsc[i] })
    const changes = bgs
      .filter(e => newZ[e.id] !== e.zIndex)
      .map(e => ({ id: e.id, oldZ: e.zIndex, newZ: newZ[e.id] }))
    if (!changes.length) return
    _history.push({ type: 'zorder', changes })
    const updated = els.map(e => (newZ[e.id] != null ? { ...e, zIndex: newZ[e.id] } : e))
    set({ flatElements: updated, canUndo: _history.canUndo, canRedo: _history.canRedo })
  },

  /** 배경 → 일반 요소로 복원. _restore가 있으면 원래 위치/크기로, 없으면 중앙 배치. */
  restoreBackgroundToNormal(id) {
    const { flatElements, canvasSize } = get()
    const el = flatElements.find(e => e.id === id)
    if (!el || !isBackgroundElement(el)) return
    const r = el._restore || {}
    const w = r.width ?? el.width, h = r.height ?? el.height
    get().updateFlatElement(id, {
      isBackground: false, sourceId: null, locked: false,
      x: r.x ?? Math.round((canvasSize.w - w) / 2),
      y: r.y ?? Math.round((canvasSize.h - h) / 2),
      width: w, height: h,
      zIndex: r.zIndex ?? el.zIndex,
      _restore: undefined,
      styles: { ...(el.styles || {}), objectFit: r.objectFit ?? 'contain' },
    })
    set({ selectedFlatIds: [id] })
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
        notes: cached.notes || '',
        notesAudio: cached.notesAudio || null,
        notesAudioHash: cached.notesAudioHash || '',
        notesAudioVolume: cached.notesAudioVolume ?? 1,
        notesCaptions: cached.notesCaptions || null,
        transition: cached.transition || null,
      }
    }
    // 현재 페이지가 캐시에 없는 경우 (단일 페이지)
    if (_currentPageKey && !pages[_currentPageKey]) {
      pages[_currentPageKey] = {
        elements: get().flatElements,
        canvasSize: get().canvasSize,
        fontImports: get().fontImports,
        htmlSlideIndex: get().currentPageHtmlBacked ? _currentPageKey : null,
        notes: get().pageNotes || '',
        notesAudio: get().pageNotesAudio || null,
        notesAudioHash: get().pageNotesAudioHash || '',
        notesAudioVolume: get().pageNotesAudioVolume ?? 1,
        notesCaptions: get().pageNotesCaptions || null,
        transition: get().pageTransition || null,
      }
    }
    return { pages, currentPageKey: _currentPageKey }
  },

  /** 전체 페이지 데이터 반환 (미방문 페이지는 iframe 순회하여 추출) */
  async getAllPagesAsync() {
    get()._saveCurrentPage()

    const editorStore = (await import('./editorStore')).useEditorStore
    const es = editorStore.getState()
    const { currentPage, revealV, iframeRef } = es
    const { extractFlatElementsFromIframe } = await import('../core/FlatExtractor')

    // (h,v) 전체 경로 — 수직 서브슬라이드까지 포함
    const routes = buildRevealRoutes(es)

    // 캐시에 모든 페이지가 있으면 빠르게 반환
    const cachedKeys = Object.keys(_pageCache)
    if (cachedKeys.length >= routes.length) {
      return get().getAllPages()
    }

    // iframe이 없으면 캐시만 반환
    if (!iframeRef?.current) {
      return get().getAllPages()
    }

    const origH = currentPage, origV = revealV || 0
    await _awaitIframeFonts(iframeRef) // 웹폰트 로드 후 추출(오버플로 방지)
    const canonicalCs = es.isReveal && get().canvasSize?.w ? { ...get().canvasSize } : null
    const pages = {}

    // 현재 캐시 내용 먼저 복사
    for (const key in _pageCache) {
      pages[key] = {
        elements: _pageCache[key].elements,
        canvasSize: _pageCache[key].canvasSize,
        fontImports: _pageCache[key].fontImports,
        htmlSlideIndex: _pageCache[key].htmlSlideIndex,
        notes: _pageCache[key].notes || '',
        notesAudio: _pageCache[key].notesAudio || null,
        notesAudioHash: _pageCache[key].notesAudioHash || '',
        notesAudioVolume: _pageCache[key].notesAudioVolume ?? 1,
        notesCaptions: _pageCache[key].notesCaptions || null,
        transition: _pageCache[key].transition || null,
      }
    }

    // 미방문 페이지 추출 — (h,v)로 직접 점프
    for (const route of routes) {
      if (pages[route.id]) continue

      iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: route.h, v: route.v }, '*')
      // 페이지 전환 + DOM 렌더링 대기
      await new Promise(r => setTimeout(r, 350))

      // 추출
      try {
        const result = extractFlatElementsFromIframe(iframeRef, _globalMaxFlatId(get().flatElements))
        pages[route.id] = {
          elements: result.elements,
          canvasSize: canonicalCs || result.canvasSize,
          fontImports: result.fontImports || [],
          htmlSlideIndex: route.id,
        }
      } catch (e) {
        console.warn(`Page ${route.id} extraction failed:`, e.message)
      }
    }

    // 원래 페이지로 복원
    iframeRef.current.contentWindow.postMessage({ type: 'fe:navigate', page: origH, v: origV }, '*')
    await new Promise(r => setTimeout(r, 350))

    // 현재 페이지가 누락된 경우 — 노트/음성/볼륨/전환도 함께(누락 시 발표·저장에서 유실)
    if (_currentPageKey && !pages[_currentPageKey]) {
      pages[_currentPageKey] = {
        elements: get().flatElements,
        canvasSize: get().canvasSize,
        fontImports: get().fontImports,
        htmlSlideIndex: get().currentPageHtmlBacked ? _currentPageKey : null,
        notes: get().pageNotes || '',
        notesAudio: get().pageNotesAudio || null,
        notesAudioHash: get().pageNotesAudioHash || '',
        notesAudioVolume: get().pageNotesAudioVolume ?? 1,
        notesCaptions: get().pageNotesCaptions || null,
        transition: get().pageTransition || null,
      }
    }

    return { pages, currentPageKey: _currentPageKey }
  },

  /** 모든 페이지 데이터 로드 (프로젝트 열기용) */
  loadAllPages(pagesData, currentPageKey) {
    // 캐시 초기화
    for (const key in _pageCache) delete _pageCache[key]
    _history.clear()

    // ID 카운터 동기화 — 로드된 최대 flat-N 이후로 새 ID를 발급해 충돌 방지
    // (충돌 시 같은 id 요소가 함께 선택돼 그룹처럼 보이는 버그 발생)
    let _maxFlatId = 0
    for (const key in pagesData) {
      for (const el of (pagesData[key].elements || [])) {
        const m = /^flat-(\d+)$/.exec(el.id || '')
        if (m) { const n = +m[1]; if (n > _maxFlatId) _maxFlatId = n }
      }
    }
    bumpFlatCounterTo(_maxFlatId)

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
        notes: pagesData[key].notes || '',
        notesAudio: pagesData[key].notesAudio || null,
        notesAudioHash: pagesData[key].notesAudioHash || '',
        notesAudioVolume: pagesData[key].notesAudioVolume ?? 1,
        // 구버전 프로젝트 파일(자막 기능 이전)에는 이 필드가 없다 — 없으면 null(정상, 재생성 필요).
        notesCaptions: pagesData[key].notesCaptions || null,
        transition: pagesData[key].transition || null,
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
        pageNotes: page.notes || '',
        pageNotesAudio: page.notesAudio || null,
        pageNotesAudioHash: page.notesAudioHash || '',
        pageNotesAudioVolume: page.notesAudioVolume ?? 1,
        pageNotesCaptions: page.notesCaptions || null,
        pageTransition: page.transition || null,
      })
    }
    // 페이지 카운트/인덱스 동기화 — 누락 시 PageBar가 로드 직후 전체 페이지 수를
    // 1로 표시하고, 페이지 이동을 해야(_syncPageInfo 호출) 정상 갯수가 보였음.
    get()._syncPageInfo()
  },
}))
