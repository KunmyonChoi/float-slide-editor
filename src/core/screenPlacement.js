/**
 * screenPlacement — 청중 창을 어느 화면에 열지 결정하고 실제로 연다.
 *
 * Chrome의 Window Management(getScreenDetails)가 있으면 화면 목록과 좌표를 얻어
 * 확장 디스플레이에 바로 전체화면으로 연다. Safari·Firefox에는 이 API가 없고
 * Chrome에서도 사용자가 권한을 거부할 수 있으므로, 그때는 일반 창으로 열고
 * 사용자가 프로젝터 쪽으로 끌어다 놓는 "수동 배치"가 기본 경로가 된다 —
 * 이쪽이 예외가 아니라 정상 경로 중 하나라는 전제로 다룬다.
 */

/** getScreenDetails 지원 여부(= 자동 배치 가능 여부) */
export function screensSupported() {
  return typeof window !== 'undefined' && typeof window.getScreenDetails === 'function'
}

/**
 * 화면 배치 권한 상태를 프롬프트 없이 조회한다. granted | denied | prompt
 * (Permissions API에 window-management가 없는 브라우저에서는 'prompt'로 본다.)
 */
export async function permissionState() {
  try {
    const s = await navigator.permissions?.query({ name: 'window-management' })
    return s?.state || 'prompt'
  } catch { return 'prompt' }
}

/**
 * 연결된 화면 목록. getScreenDetails()는 권한 프롬프트를 띄울 수 있으므로
 * 반드시 사용자 제스처(발표 버튼) 안에서 호출해야 한다.
 * @returns {Promise<{supported: boolean, denied: boolean, screens: Array, currentIndex: number}>}
 */
export async function listScreens() {
  if (!screensSupported()) return { supported: false, denied: false, screens: [], currentIndex: -1 }
  try {
    const details = await window.getScreenDetails()
    const screens = details.screens.map((s, i) => ({
      index: i,
      label: s.label || `모니터 ${i + 1}`,
      left: s.availLeft, top: s.availTop,
      width: s.availWidth, height: s.availHeight,
      isPrimary: !!s.isPrimary,
      isInternal: !!s.isInternal,
      isCurrent: s === details.currentScreen,
    }))
    return {
      supported: true, denied: false, screens,
      currentIndex: Math.max(0, screens.findIndex(s => s.isCurrent)),
    }
  } catch {
    // 권한 거부 또는 조회 실패 — 지원은 하지만 배치 정보를 못 얻는 상태
    return { supported: true, denied: true, screens: [], currentIndex: -1 }
  }
}

/**
 * 청중 화면 기본 선택 — 발표자가 지금 보고 있는 화면이 아닌 것 중에서,
 * 외장 디스플레이(프로젝터)를 우선한다. 고를 게 없으면 null(= 단일 화면).
 */
export function pickAudienceScreen(screens, currentIndex) {
  const others = screens.filter(s => s.index !== currentIndex)
  if (others.length === 0) return null
  return others.find(s => !s.isInternal) || others[0]
}

/**
 * 청중 창을 연다.
 * @param {{sessionId: string, screen: object|null}} opts
 * @returns {Window|null} 팝업이 차단되면 null
 */
export function openAudienceWindow({ sessionId, screen }) {
  // 어느 화면으로 갈지 라벨을 함께 실어 보낸다 — 청중 창이 스스로 그 화면에 전체화면을
  // 요청할 수 있게(window.open의 fullscreen 힌트가 무시되는 경우의 두 번째 시도).
  const params = new URLSearchParams({ audience: sessionId })
  if (screen?.label) params.set('screen', screen.label)
  const url = `${window.location.pathname}?${params}`
  // 창 이름을 세션에 고정 — "다시 열기"가 새 창을 늘리지 않고 같은 창을 되살린다.
  const name = `genitor-audience-${sessionId}`

  const feats = ['popup=1']
  if (screen) {
    feats.push(`left=${screen.left}`, `top=${screen.top}`, `width=${screen.width}`, `height=${screen.height}`)
    // 화면 배치 권한이 있으면 Chrome이 이 힌트로 곧바로 전체화면으로 띄운다.
    // 권한이 없으면 무시될 뿐이라 실패로 취급하지 않는다(청중 창 안에서 다시 시도).
    feats.push('fullscreen=yes')
  } else {
    feats.push('width=1280', 'height=720')
  }

  try {
    return window.open(url, name, feats.join(',')) || null
  } catch {
    return null
  }
}

// ── 기억해둔 배치 ────────────────────────────────────────────
// 발표 때마다 화면을 고르라고 묻는 것은 성가시다. 한 번 고르면 기억했다가 같은 환경에서는
// 곧바로 시작한다. 화면에는 안정된 식별자가 없으므로 라벨("DELL U2720Q")로 기억하고,
// 다음 발표에서 같은 라벨이 보이지 않으면(모니터를 바꿨다) 다시 묻는다.

const REMEMBER_KEY = 'present-audience-placement'

/**
 * 배치 결정 — 다이얼로그가 돌려주는 값이자 기억되는 값.
 *  screen     선택한 화면에 청중 창을 전체화면으로 (label 필요)
 *  manual     좌표 없이 일반 창으로 — 사용자가 프로젝터로 끌어다 놓는다
 *  rehearsal  청중 창 없이 발표자 창만 (혼자 연습)
 *  slidesOnly 발표자 보기를 쓰지 않고 이번만 슬라이드만 전체화면
 */
export const PLACEMENT = {
  screen: 'screen', manual: 'manual', rehearsal: 'rehearsal', slidesOnly: 'slidesOnly',
}

export function readRememberedPlacement() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && PLACEMENT[p.mode] ? p : null
  } catch { return null }
}

export function rememberPlacement(placement) {
  try {
    // 화면 선택은 라벨만 남긴다 — 좌표는 다음 연결에서 달라진다.
    const stored = placement.mode === PLACEMENT.screen
      ? { mode: placement.mode, label: placement.screen?.label || '' }
      : { mode: placement.mode }
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(stored))
  } catch { /* 저장 불가 무시 */ }
}

export function clearRememberedPlacement() {
  try { localStorage.removeItem(REMEMBER_KEY) } catch { /* 무시 */ }
}

/**
 * 기억해둔 배치를 지금 환경에 맞춰 되살린다. 되살릴 수 없으면 null(→ 다시 묻는다).
 * @param {object|null} remembered readRememberedPlacement() 결과
 * @param {{supported: boolean, denied: boolean, screens: Array, currentIndex: number}} env listScreens() 결과
 */
export function resolveRememberedPlacement(remembered, env) {
  if (!remembered) return null
  if (remembered.mode !== PLACEMENT.screen) return { mode: remembered.mode, screen: null }
  // 기억한 화면이 지금도 붙어 있는지 — 라벨이 같고, 발표자가 보고 있는 화면이 아니어야 한다
  const found = env.screens.find(s => s.label === remembered.label && s.index !== env.currentIndex)
  return found ? { mode: PLACEMENT.screen, screen: found } : null
}

/** 발표 옵션 메뉴에 보여줄 한 줄 설명 */
export function describePlacement(remembered) {
  if (!remembered) return null
  switch (remembered.mode) {
    case PLACEMENT.screen: return `청중 화면: ${remembered.label || '기억된 모니터'}`
    case PLACEMENT.manual: return '청중 창을 일반 창으로 열기'
    case PLACEMENT.rehearsal: return '리허설 — 청중 창 없이'
    case PLACEMENT.slidesOnly: return '슬라이드만 전체화면'
    default: return null
  }
}

/**
 * 청중 창이 스스로 전체화면으로 들어간다.
 *
 * window.open의 `fullscreen` 힌트는 화면 배치 권한이 있을 때만 먹고, 그마저 플랫폼에
 * 따라 무시된다. 그래서 창 안에서 한 번 더 시도한다 — 창을 연 클릭의 사용자 활성화가
 * 새 창에 잠시 상속되므로, 마운트 직후라면 대개 통과한다.
 *
 * 권한이 있으면 목표 화면을 지정해서 요청한다(requestFullscreen({ screen })) — 창이
 * 엉뚱한 화면에 열렸더라도 청중 화면으로 옮겨가며 전체화면이 된다.
 *
 * @param {string|null} screenLabel URL로 전달받은 목표 화면 라벨
 * @returns {Promise<boolean>} 전체화면이 됐는지
 */
export async function enterFullscreenOnScreen(screenLabel) {
  const el = document.documentElement
  if (!el.requestFullscreen) return false

  let options
  if (screenLabel && screensSupported()) {
    try {
      const details = await window.getScreenDetails()
      const target = details.screens.find(s => (s.label || '') === screenLabel)
      if (target) options = { screen: target }
    } catch { /* 권한 없음 — 화면 지정 없이 그냥 전체화면 */ }
  }

  try {
    await el.requestFullscreen(options)
    return true
  } catch {
    // 사용자 활성화가 없거나 거부됨 — 창 안내(클릭/F11)로 넘긴다
    return false
  }
}
