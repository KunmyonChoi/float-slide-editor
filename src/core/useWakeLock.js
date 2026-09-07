import { useEffect } from 'react'

/**
 * useWakeLock — 발표하는 동안 화면이 어두워지거나 잠기지 않게 붙든다.
 *
 * 발표 중에는 화면을 건드릴 일이 없다. 말하는 동안 슬라이드를 그대로 두므로 모바일의
 * 자동 밝기 조절과 절전이 몇십 초 만에 화면을 어둡게 만들고, 이어서 잠근다. 청중이
 * 보고 있는 화면에서 이런 일이 일어나면 안 된다.
 *
 * Screen Wake Lock은 문서가 보이는 동안에만 유지된다. 탭이 가려지면 브라우저가 잠금을
 * 스스로 풀어버리고, 다시 보이더라도 되살아나지 않는다 — 그래서 visibilitychange에서
 * 다시 잡는다. (듀얼 모니터 발표에서 청중 창과 발표자 창을 오갈 때 실제로 일어난다.)
 *
 * 지원하지 않는 브라우저(iOS 16.4 미만 등)나 사용자가 절전 모드라 거부당한 경우에는
 * 조용히 아무것도 하지 않는다. 발표는 그대로 되고 화면만 평소처럼 어두워질 뿐이므로,
 * 이걸로 발표를 막거나 경고를 띄울 이유가 없다.
 *
 * @param {boolean} active 잠금을 유지할지 — 발표 중이면 true
 */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active) return
    const wakeLock = navigator.wakeLock
    if (!wakeLock?.request) return // 미지원

    let cancelled = false
    let sentinel = null

    const acquire = async () => {
      // 보이지 않는 동안에는 요청해도 거부된다 — 다시 보일 때 잡는다.
      if (cancelled || sentinel || document.visibilityState !== 'visible') return
      try {
        const got = await wakeLock.request('screen')
        if (cancelled) { got.release?.().catch(() => {}); return }
        sentinel = got
        // 브라우저가 스스로 풀면(탭 가려짐·배터리 절약) 참조를 비워 다음 기회에 다시 잡게 한다
        got.addEventListener?.('release', () => {
          if (sentinel === got) sentinel = null
        })
      } catch { /* 거부됨 — 발표는 계속된다 */ }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const held = sentinel
      sentinel = null
      held?.release?.().catch(() => {})
    }
  }, [active])
}
