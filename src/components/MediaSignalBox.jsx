import { useRef } from 'react'
import { useMediaEndSignal } from '../core/useMediaEndSignal'

/** useMediaEndSignal을 쓰는 div — 타입별로 일찍 반환하는 렌더러(FlatElementRenderer)에서 훅 규칙을 지키려고 둔다. */
export default function MediaSignalBox({ elementId, signal, maxPlaySec, style, children }) {
  const ref = useRef(null)
  useMediaEndSignal(ref, elementId, { signal, maxPlaySec })
  return <div ref={ref} style={style}>{children}</div>
}
