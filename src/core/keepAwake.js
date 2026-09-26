import { useEffect, useSyncExternalStore } from 'react'

/**
 * keepAwake — "지금 화면이 꺼지면 곤란한 일"이 돌고 있는지 세는 아주 작은 등록부.
 *
 * 영상 생성·립싱크처럼 몇 분씩 걸리는 작업을 걸어 두고 기다리는 동안 모바일은 화면을 끈다.
 * 화면이 꺼져도 작업 자체는 돌지만(fetch는 계속된다) 진행 상황을 볼 수 없고, 결과가 도착해
 * 적용되는 순간을 놓친다. 발표와 같은 이유로 화면을 붙들어야 한다.
 *
 * 잡는 곳이 여럿이라(AI 작업 큐·노트 음성·PPT 변환) 각자 Wake Lock을 요청하는 대신,
 * 여기서 세어 두고 App 한 곳에서만 실제 잠금을 잡는다. 작업 중에 패널이 닫히거나 컴포넌트가
 * 사라져도 다른 작업이 남아 있으면 화면은 계속 붙들린다.
 */

let holders = 0
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

/** 작업 시작 — 반환된 함수를 반드시 호출해 놓아준다(finally / effect 정리). */
export function acquireKeepAwake() {
  holders++
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    holders = Math.max(0, holders - 1)
    emit()
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 붙들고 있는 작업이 하나라도 있는가 — App이 이걸 보고 잠금을 잡는다. */
export function useKeepAwakeActive() {
  return useSyncExternalStore(subscribe, () => holders > 0, () => false)
}

/** 컴포넌트가 가진 '작업 중' 상태를 등록부에 연결한다. */
export function useKeepAwake(active) {
  useEffect(() => {
    if (!active) return
    return acquireKeepAwake()
  }, [active])
}

/** 테스트용 — 등록부를 비운다. */
export function _resetKeepAwake() {
  holders = 0
  emit()
}
