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
  const url = `${window.location.pathname}?audience=${encodeURIComponent(sessionId)}`
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
