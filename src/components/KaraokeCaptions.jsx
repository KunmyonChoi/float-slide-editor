import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { groupWordsIntoCues, cueIndexForTime, activeWordIndex } from '../core/karaoke'
import { fitsBelow, CAPTION_GAP } from '../core/captionPlacement'

/**
 * KaraokeCaptions — 발표 중 노트 음성 재생 위치에 맞춰 단어를 하나씩 하이라이트하는 자막 오버레이.
 * audioEl.currentTime을 requestAnimationFrame으로 폴링한다(<audio> timeupdate는 초 단위로만
 * 발생해 가라오케처럼 부드러운 단어 전환에는 너무 성기다).
 *
 * 슬라이드 캔버스 좌표계(canvasSize) 안에 배치되는 것을 전제로 폰트 크기를 캔버스 픽셀 단위로
 * 고정한다 — 상위 컨테이너의 CSS transform: scale()이 화면 배율을 자동으로 맞춰준다.
 *
 * @param {number} spaceBelow 슬라이드 아래 레터박스 여백(캔버스 단위). 자막이 들어갈 만큼
 *                            넓으면 슬라이드를 덮지 않고 그 아래에 내려놓는다.
 *                            `core/captionPlacement.js` 참고.
 */
export default function KaraokeCaptions({ audioEl, words, spaceBelow = 0 }) {
  const cues = useMemo(() => groupWordsIntoCues(words), [words])
  const [time, setTime] = useState(0)
  const rafRef = useRef(null)
  const roRef = useRef(null)
  const [measuredH, setMeasuredH] = useState(0)

  // 자막 높이는 레이아웃이 정하는 값이라 렌더 중에는 알 수 없다 — 큐가 바뀔 때뿐 아니라
  // 웹폰트가 늦게 로드돼 줄 수가 달라질 때도 변한다. 그래서 한 번 재고 마는 대신 관찰한다.
  // 박스 폭은 배치와 무관하게 늘 같아서(아래 style의 left/right/maxWidth 고정) 잰 높이가
  // 배치 결정에 되먹임되지 않는다 — 위아래를 오가며 진동할 일이 없다.
  const attachBox = useCallback((node) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!node) return
    setMeasuredH(node.offsetHeight || 0)
    if (typeof ResizeObserver === 'undefined') return // jsdom 등 레이아웃이 없는 환경
    const ro = new ResizeObserver(() => setMeasuredH(node.offsetHeight || 0))
    ro.observe(node)
    roRef.current = ro
  }, [])

  useEffect(() => () => roRef.current?.disconnect(), [])

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

  const cueIdx = cues.length ? cueIndexForTime(cues, time) : -1
  const cue = cueIdx >= 0 ? cues[cueIdx] : null
  if (!cue) return null
  const activeIdx = activeWordIndex(words, time)
  const below = fitsBelow(spaceBelow, measuredH)

  return (
    <div
      ref={attachBox}
      data-testid="karaoke-captions"
      data-placement={below ? 'below' : 'overlay'}
      style={{
        // 중앙정렬을 left:50%+translateX(-50%)로 하면, 절대위치 박스의 가용폭(shrink-to-fit
        // 계산에 쓰이는 공간)이 "캔버스 폭 − left"로 절반이 돼버려(right가 없어서) maxWidth를
        // 아무리 키워도 실제로는 캔버스 절반에서 줄바꿈됐다(width:fit-content로 바꿔도 동일—
        // 크로미움이 fit-content에도 같은 가용폭 계산을 적용). left/right를 0으로 맞추고
        // margin:auto로 중앙정렬하면 가용폭이 캔버스 전체가 되어 maxWidth까지 온전히 쓴다.
        position: 'absolute', left: 0, right: 0, margin: '0 auto',
        // 아래 여백에 놓을 때는 캔버스 바깥(top:100%)으로 내린다. 상위 박스에 overflow가
        // 걸려있지 않아 그대로 레터박스 위에 그려진다.
        ...(below
          ? { top: '100%', marginTop: CAPTION_GAP }
          : { bottom: '6%' }),
        width: 'fit-content', maxWidth: '94%', padding: '10px 22px', borderRadius: 10,
        // 검은 여백 위에서는 대비를 위한 패널이 필요 없다 — 떠 있는 상자처럼 보이기만 한다.
        ...(below
          ? { background: 'transparent' }
          : { background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(6px)' }),
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
