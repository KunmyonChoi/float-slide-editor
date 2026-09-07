import { useState, useEffect, useRef, useCallback } from 'react'
import { openChannel, ALIVE_TIMEOUT_MS } from './presenterChannel'
import { openAudienceWindow } from './screenPlacement'

/**
 * useAudienceLink — 발표자 창 쪽에서 청중 창을 붙들고 있는 훅.
 *
 * 발표자 창이 상태의 주인이므로 여기서 하는 일은 세 가지뿐이다.
 *  1) 청중 창이 hello를 보내오면 덱 전체와 현재 상태를 넘겨준다(= 늦게 붙어도 즉시 따라온다).
 *  2) 상태가 바뀔 때마다 스냅샷을 보낸다.
 *  3) 생존 신호가 끊기면 연결 끊김으로 표시한다 — 발표 자체는 계속된다.
 *
 * @param {string} sessionId
 * @param {() => object} getDeck  청중 창에 넘길 전체 페이지 맵(구조화 복제 가능해야 함)
 * @param {() => object} getState 현재 상태 스냅샷
 */
export function useAudienceLink({ sessionId, getDeck, getState }) {
  const [connected, setConnected] = useState(false)
  const chRef = useRef(null)
  const lastAliveRef = useRef(0)
  // 최신 getter를 ref로 — 채널 핸들러가 매번 재등록되지 않게 (갱신은 커밋 후에)
  const getDeckRef = useRef(getDeck)
  const getStateRef = useRef(getState)
  useEffect(() => { getDeckRef.current = getDeck; getStateRef.current = getState })

  useEffect(() => {
    if (!sessionId) return
    const ch = openChannel(sessionId)
    chRef.current = ch

    const markAlive = () => {
      lastAliveRef.current = Date.now()
      setConnected(true)
    }

    // 청중 창이 새로 붙었다(첫 진입이든 "다시 열기"든) → 덱과 현재 상태를 통째로 넘긴다
    const offHello = ch.on('hello', () => {
      markAlive()
      ch.post('deck', { pages: getDeckRef.current() })
      ch.post('state', { state: getStateRef.current() })
    })
    const offAlive = ch.on('alive', markAlive)
    const offBye = ch.on('bye', () => {
      lastAliveRef.current = 0
      setConnected(false)
    })

    // 생존 신호 감시 — 케이블이 빠지거나 창이 강제 종료되면 bye가 오지 않는다
    const watch = setInterval(() => {
      if (lastAliveRef.current && Date.now() - lastAliveRef.current > ALIVE_TIMEOUT_MS) {
        setConnected(false)
      }
    }, 1000)

    return () => {
      clearInterval(watch)
      offHello(); offAlive(); offBye()
      // 여기서 'end'를 보내지 않는다 — StrictMode의 이중 마운트나 단순 리마운트에서
      // 청중 창이 발표가 끝난 줄 알고 닫혀버린다. 종료 통보는 exitPresentation이 한 번만 한다.
      ch.close()
      chRef.current = null
    }
  }, [sessionId])

  /** 지금 상태를 청중 창에 보낸다 */
  const push = useCallback(() => {
    chRef.current?.post('state', { state: getStateRef.current() })
  }, [])

  /**
   * 청중 창을 (다시) 연다. 팝업 차단 회피를 위해 반드시 사용자 제스처 안에서 호출할 것.
   * @returns {boolean} 팝업이 열렸는지
   */
  const reopen = useCallback((screen) => {
    const w = openAudienceWindow({ sessionId, screen })
    // 창이 뜨면 저쪽에서 hello를 보내온다 — 여기서 connected를 미리 켜지 않는다.
    return !!w
  }, [sessionId])

  return { connected, push, reopen }
}
