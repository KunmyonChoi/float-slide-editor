import { useEffect, useMemo, useRef, useState } from 'react'
import { groupWordsIntoCues, cueIndexForTime, activeWordIndex } from '../core/karaoke'

/**
 * KaraokeCaptions — 발표 중 노트 음성 재생 위치에 맞춰 단어를 하나씩 하이라이트하는 자막 오버레이.
 * audioEl.currentTime을 requestAnimationFrame으로 폴링한다(<audio> timeupdate는 초 단위로만
 * 발생해 가라오케처럼 부드러운 단어 전환에는 너무 성기다).
 *
 * 슬라이드 캔버스 좌표계(canvasSize) 안에 배치되는 것을 전제로 폰트 크기를 캔버스 픽셀 단위로
 * 고정한다 — 상위 컨테이너의 CSS transform: scale()이 화면 배율을 자동으로 맞춰준다.
 */
export default function KaraokeCaptions({ audioEl, words }) {
  const cues = useMemo(() => groupWordsIntoCues(words), [words])
  const [time, setTime] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!audioEl || !cues.length) return
    let alive = true
    const tick = () => {
      if (!alive) return
      setTime(audioEl.currentTime || 0)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { alive = false; if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [audioEl, cues.length])

  if (!cues.length) return null
  const cueIdx = cueIndexForTime(cues, time)
  const cue = cueIdx >= 0 ? cues[cueIdx] : null
  if (!cue) return null
  const activeIdx = activeWordIndex(words, time)

  return (
    <div
      data-testid="karaoke-captions"
      style={{
        // 중앙정렬을 left:50%+translateX(-50%)로 하면, 절대위치 박스의 가용폭(shrink-to-fit
        // 계산에 쓰이는 공간)이 "캔버스 폭 − left"로 절반이 돼버려(right가 없어서) maxWidth를
        // 아무리 키워도 실제로는 캔버스 절반에서 줄바꿈됐다(width:fit-content로 바꿔도 동일—
        // 크로미움이 fit-content에도 같은 가용폭 계산을 적용). left/right를 0으로 맞추고
        // margin:auto로 중앙정렬하면 가용폭이 캔버스 전체가 되어 maxWidth까지 온전히 쓴다.
        position: 'absolute', left: 0, right: 0, bottom: '6%', margin: '0 auto',
        width: 'fit-content', maxWidth: '94%', padding: '10px 22px', borderRadius: 10,
        background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(6px)',
        color: '#fff', fontSize: 30, lineHeight: 1.5,
        textAlign: 'center', zIndex: 1005, pointerEvents: 'none',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}
    >
      {cue.words.map((w, i) => {
        const globalIdx = cue.startIndex + i
        const isActive = globalIdx === activeIdx
        const isPast = activeIdx >= 0 && globalIdx < activeIdx
        return (
          <span
            key={globalIdx}
            style={{
              marginRight: 6,
              color: isActive ? '#facc15' : isPast ? '#f1f5f9' : 'rgba(226,232,240,0.55)',
              fontWeight: isActive ? 700 : 400,
              transition: 'color 0.12s',
            }}
          >{w.word}</span>
        )
      })}
    </div>
  )
}
