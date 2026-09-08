/**
 * presenterChannel — 발표자 창 ↔ 청중 창 동기화 채널 (BroadcastChannel)
 *
 * 설계 원칙: 발표 상태(현재 슬라이드·빌드 단계·잉크·블랙아웃·나레이션 재생 위치)는
 * 발표자 창이 소유하고, 청중 창은 그것을 받아 그리기만 한다. 그래서
 *  - 청중 창이 닫히거나 케이블이 빠져도 발표는 멈추지 않고,
 *  - 다시 열면 최신 스냅샷을 받아 끊긴 지점부터 이어 그린다.
 * (청중 창에서 만들어지는 상태가 없으므로 병합/충돌 문제가 아예 생기지 않는다.)
 *
 * 메시지
 *   청중 → 발표자 : hello(덱 요청) · alive(생존 신호) · bye(창 닫힘)
 *   발표자 → 청중 : deck(전체 페이지) · state(상태 스냅샷) · end(발표 종료)
 *
 * BroadcastChannel은 보낸 창 자신에게는 전달되지 않으므로 에코를 걱정할 필요가 없다.
 */

const CHANNEL_PREFIX = 'genitor-present-'

/** 청중 창이 생존 신호를 보내는 주기 */
export const ALIVE_INTERVAL_MS = 1500
/** 이 시간 동안 생존 신호가 없으면 연결이 끊긴 것으로 본다(주기의 3배 — 탭 스로틀링 여유) */
export const ALIVE_TIMEOUT_MS = 5000

/** 발표 세션 식별자 — 채널 이름과 청중 창 URL(?audience=)에 함께 쓰인다. */
export function newSessionId() {
  return Math.random().toString(36).slice(2, 10)
}

/** URL의 `?audience=<sessionId>` — 있으면 이 창은 청중 창이다. */
export function audienceSessionFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('audience') || null
  } catch { return null }
}

/**
 * 세션 채널을 연다.
 * @param {string} sessionId
 * @returns {{post: (t: string, payload?: object) => void, on: (t: string, fn: (msg: object) => void) => () => void, close: () => void}}
 */
export function openChannel(sessionId) {
  const ch = new BroadcastChannel(CHANNEL_PREFIX + sessionId)
  // 타입별 핸들러 — 한 타입에 여러 구독을 허용(발표자 창은 alive를 여러 곳에서 본다)
  const handlers = new Map()

  ch.onmessage = (e) => {
    const msg = e.data
    if (!msg || typeof msg.t !== 'string') return
    const set = handlers.get(msg.t)
    if (!set) return
    for (const fn of set) {
      try { fn(msg) } catch (err) { console.warn('[present] 핸들러 오류', err) }
    }
  }

  return {
    post(t, payload) {
      // 덱에 구조화 복제가 안 되는 값(함수·DOM 노드)이 섞여 있으면 여기서 던진다.
      // 발표를 죽이지 않도록 삼키되, 원인을 찾을 수 있게 남긴다.
      try { ch.postMessage({ t, ...payload }) } catch (err) { console.warn('[present] 전송 실패', t, err) }
    },
    on(t, fn) {
      if (!handlers.has(t)) handlers.set(t, new Set())
      handlers.get(t).add(fn)
      return () => handlers.get(t)?.delete(fn)
    },
    close() {
      handlers.clear()
      try { ch.close() } catch { /* 이미 닫힘 */ }
    },
  }
}
