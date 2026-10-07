import { useEffect } from 'react'
import { reportMediaEnded, reportMediaFailed } from './mediaAdvance'
import { registerAudioClock } from './audioClock'

// 자동 재생이 시작됐는지 확인하기까지 기다리는 시간(ms). 자동재생이 차단되면 브라우저는 오류
// 없이 멈춰 있기만 하므로, 이 시간 뒤에도 시작 전이면 직접 play()를 불러 보고 실패를 알린다.
export const MEDIA_START_CHECK_MS = 2000
const MEDIA_START_MAX_TRIES = 5

// 최대 재생 시간(playMaxSec)에 닿기 전 소리를 줄여 가는 길이(초)
export const MAX_PLAY_FADE_SEC = 2

/**
 * 최대 재생 시간 직전의 볼륨 배율(0~1). 제한이 없으면 1.
 * 페이드 길이보다 짧은 제한이면 처음부터 비례해 줄인다.
 */
export function maxPlayGain(t, maxSec) {
  if (!(maxSec > 0)) return 1
  const fade = Math.min(MAX_PLAY_FADE_SEC, maxSec)
  return Math.max(0, Math.min(1, (maxSec - t) / fade))
}

/**
 * 컨테이너 안의 <video>/<audio>에 발표 재생 규칙을 건다.
 *  - signal: 끝남·실패를 엔진에 알린다(끝까지 재생 후 다음, advanceOnEnd)
 *  - maxPlaySec: 그 시간에서 페이드아웃하고 멈춘다(멈추면 '끝남'으로 친다)
 * 재생 위치는 audioClock에 올려 두어 엔진이 남은 시간을 계산할 수 있게 한다.
 * 미디어 이벤트(ended/error/timeupdate)는 버블링되지 않지만 캡처 단계는 조상을 지나가므로,
 * 래퍼에 캡처 리스너 하나로 일반·크로마키·매트 플레이어를 모두 덮는다.
 */
export function useMediaEndSignal(containerRef, elementId, { signal = false, maxPlaySec = 0 } = {}) {
  useEffect(() => {
    const root = containerRef.current
    if (!root || !elementId || (!signal && !(maxPlaySec > 0))) return
    const isMedia = (t) => t instanceof HTMLMediaElement
    let done = false
    let cancelled = false
    let unregister = () => {}
    const finish = () => {
      if (done) return
      done = true
      if (signal) reportMediaEnded(elementId)
    }
    const onEnded = (e) => { if (isMedia(e.target)) finish() }
    const onError = (e) => { if (isMedia(e.target) && signal && !done) { done = true; reportMediaFailed(elementId) } }
    const onPlay = (e) => {
      if (!isMedia(e.target)) return
      unregister()
      unregister = registerAudioClock(elementId, e.target)
    }
    const onTime = (e) => {
      const m = e.target
      if (!isMedia(m) || !(maxPlaySec > 0) || done) return
      m.volume = maxPlayGain(m.currentTime, maxPlaySec)
      if (m.currentTime >= maxPlaySec) { m.pause(); finish() }
    }
    root.addEventListener('ended', onEnded, true)
    root.addEventListener('error', onError, true)
    root.addEventListener('play', onPlay, true)
    root.addEventListener('timeupdate', onTime, true)

    // idb 영상은 blob URL을 푸는 동안 <video>가 아직 없다 — 몇 번 더 보고 나서야 실패로 친다.
    let tries = 0, check = 0
    const probe = () => {
      if (!signal || done) return
      const m = root.querySelector('video, audio')
      if (!m) {
        if (++tries < MEDIA_START_MAX_TRIES) check = setTimeout(probe, MEDIA_START_CHECK_MS)
        else { done = true; reportMediaFailed(elementId) }
        return
      }
      if (m.paused && !m.ended && m.currentTime === 0) {
        m.play()?.catch?.((e) => {
          if (cancelled || done || e?.name === 'AbortError') return // 정리 중 끊긴 재생은 실패가 아니다
          done = true
          reportMediaFailed(elementId)
        })
      }
    }
    if (signal) check = setTimeout(probe, MEDIA_START_CHECK_MS)
    return () => {
      cancelled = true
      clearTimeout(check)
      unregister()
      root.removeEventListener('ended', onEnded, true)
      root.removeEventListener('error', onError, true)
      root.removeEventListener('play', onPlay, true)
      root.removeEventListener('timeupdate', onTime, true)
    }
  }, [containerRef, elementId, signal, maxPlaySec])
}
