import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getAudioClock } from '../core/audioClock'
import { activeLyricIndex, centerTranslate, DEFAULT_LYRIC_OFFSET } from '../core/lyricSync'

/**
 * LyricScroller — 발표 중 오디오에 맞춰 가사가 텍스트 박스 영역 안에서 위로 흐르고,
 * 지금 부르는 줄이 박스 가운데에서 강조된다. 텍스트 박스의 글꼴·크기·정렬·색을 그대로 쓴다.
 *
 * 재생 시각은 audioClock(오디오 요소가 재생 중 등록)에서 매 프레임 읽는다. 오디오가 아직 시작 전이면
 * 첫 줄을 가운데에 두고 기다린다. 박스 밖으로 넘치는 줄은 잘린다(overflow hidden).
 */
export default function LyricScroller({ sync, textStyle }) {
  const { lines = [], audioId, offset = DEFAULT_LYRIC_OFFSET, highlightColor } = sync
  const boxRef = useRef(null)
  const lineRefs = useRef([])
  const [active, setActive] = useState(-1)
  const [shift, setShift] = useState(0)

  // 매 프레임 재생 시각 → 현재 줄(바뀔 때만 리렌더)
  useEffect(() => {
    let raf = 0
    let last = -2
    const tick = () => {
      const audio = getAudioClock(audioId)
      const i = audio ? activeLyricIndex(lines, audio.currentTime, offset) : -1
      if (i !== last) { last = i; setActive(i) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, audioId, offset])

  // 현재 줄이 가운데 오도록 목록 위치 계산(줄 높이는 줄바꿈에 따라 달라 실제로 잰다)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const tops = lineRefs.current.map(el => el?.offsetTop || 0)
    const heights = lineRefs.current.map(el => el?.offsetHeight || 0)
    setShift(centerTranslate(box.clientHeight, tops, heights, active))
  }, [active, lines])

  const color = textStyle.color || '#000'
  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0,
        transform: `translateY(${shift}px)`,
        transition: 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'transform',
      }}>
        {lines.map((l, i) => {
          const on = i === active
          return (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el }}
              style={{
                textAlign: textStyle.textAlign || 'center',
                whiteSpace: 'pre-wrap',
                padding: '0.15em 0',
                color: on ? (highlightColor || color) : color,
                opacity: on ? 1 : (active === -1 && i === 0 ? 0.6 : 0.32),
                fontWeight: on ? 700 : undefined,
                transform: on ? 'scale(1.06)' : 'scale(1)',
                transformOrigin: textStyle.textAlign === 'left' ? 'left center' : textStyle.textAlign === 'right' ? 'right center' : 'center',
                transition: 'opacity 300ms ease, transform 300ms ease, color 300ms ease',
              }}
            >{l.text}</div>
          )
        })}
      </div>
    </div>
  )
}
