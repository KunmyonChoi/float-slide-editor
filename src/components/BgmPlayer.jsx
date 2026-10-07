import { useEffect, useRef } from 'react'
import { BlobStore } from '../core/BlobStore'

// BGM 전환·시작·끝의 페이드 길이(ms)와 나레이션 중 줄이는 배율
export const BGM_FADE_MS = 1000
export const BGM_DUCK_GAIN = 0.35

/**
 * BgmPlayer — 여러 장에 걸쳐 흐르는 배경 음악(오디오 요소의 bgmSpan).
 *
 * 슬라이드 안의 요소는 장이 바뀔 때마다 다시 마운트되므로 거기서 재생하면 음악이 끊긴다.
 * 그래서 발표 화면(FlatPresenter·SpeakerView) 쪽에 하나만 두고, 엔진이 고른 지금의 BGM
 * 요소(usePresentationEngine().bgm)를 받아 재생한다. 같은 요소면 그대로 이어서, 다른
 * 요소로 바뀌면 앞의 것을 줄이며 새것을 키우고, 없어지면 줄이며 멈춘다.
 * 나레이션이 흐르는 동안(duck)은 소리를 줄여 말이 묻히지 않게 한다.
 */
export default function BgmPlayer({ element, duck = false }) {
  const tracksRef = useRef(new Map()) // id → { audio, gain(0~1 현재), target, dying }
  const duckRef = useRef(duck)
  duckRef.current = duck
  const rafRef = useRef(0)

  // 볼륨 램프 — 각 트랙의 현재 배율을 목표로 프레임마다 옮긴다.
  const ensureRamp = () => {
    if (rafRef.current) return
    let last = performance.now()
    const step = (now) => {
      const dt = now - last
      last = now
      let active = false
      for (const [id, t] of tracksRef.current) {
        const goal = t.dying ? 0 : t.target * (duckRef.current ? BGM_DUCK_GAIN : 1)
        const delta = dt / BGM_FADE_MS
        t.gain = t.gain < goal ? Math.min(goal, t.gain + delta) : Math.max(goal, t.gain - delta)
        try { t.audio.volume = Math.max(0, Math.min(1, t.gain)) } catch { /* 무시 */ }
        if (t.dying && t.gain <= 0) {
          try { t.audio.pause() } catch { /* 무시 */ }
          t.audio.src = ''
          tracksRef.current.delete(id)
          continue
        }
        if (t.gain !== goal) active = true
      }
      // 덕킹은 나레이션 상태가 바뀔 때 다시 램프가 필요하므로, 트랙이 남아 있으면 계속 돈다.
      if (active || tracksRef.current.size) rafRef.current = requestAnimationFrame(step)
      else rafRef.current = 0
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const id = element?.id || null
  const content = element?.content || null
  const volume = Number.isFinite(element?.volume) ? Math.max(0, Math.min(1, element.volume)) : 1
  const muted = !!element?.muted
  const loop = element?.loop ?? true

  // 지금 BGM이 바뀌면 — 나머지는 줄이며 정리하고, 새것을 키운다.
  useEffect(() => {
    for (const [tid, t] of tracksRef.current) if (tid !== id) t.dying = true
    if (!id || !content) { ensureRamp(); return }
    const existing = tracksRef.current.get(id)
    if (existing) { existing.dying = false; existing.target = muted ? 0 : volume; ensureRamp(); return }

    let cancelled = false
    const start = (url) => {
      if (cancelled || !url) return
      const audio = new Audio()
      audio.src = url
      audio.loop = loop
      audio.volume = 0
      tracksRef.current.set(id, { audio, gain: 0, target: muted ? 0 : volume, dying: false })
      audio.play().catch(() => { /* 자동재생 차단 — 발표는 그대로 */ })
      ensureRamp()
    }
    if (BlobStore.isIdbRef(content)) BlobStore.getUrl(BlobStore.parseRef(content)).then(start).catch(() => {})
    else start(content)
    return () => { cancelled = true }
    // 볼륨·음소거·반복은 아래 이펙트가 이어서 반영한다 — 여기 넣으면 볼륨만 바꿔도 트랙을 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, content])

  // 같은 BGM의 볼륨·음소거·반복 변경 반영
  useEffect(() => {
    const t = id && tracksRef.current.get(id)
    if (!t) return
    t.target = muted ? 0 : volume
    t.audio.loop = loop
    ensureRamp()
  }, [id, volume, muted, loop])

  // 나레이션 시작·끝 → 덕킹 램프
  useEffect(() => { if (tracksRef.current.size) ensureRamp() }, [duck])

  // 발표 종료 — 전부 정지
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    for (const t of tracksRef.current.values()) {
      try { t.audio.pause() } catch { /* 무시 */ }
      t.audio.src = ''
    }
    tracksRef.current.clear()
  }, [])

  return null
}
