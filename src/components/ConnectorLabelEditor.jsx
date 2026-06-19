import { useState, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { connectorLabelMid } from '../core/PolyShapeUtils'

/**
 * ConnectorLabelEditor — 커넥터 더블클릭 시 곡선/직선 중점에 뜨는 라벨 인라인 입력.
 * 캔버스 콘텐츠 좌표계(요소와 동일)에 절대배치. Enter/blur 커밋, Esc 취소.
 * @param {object} element resolveConnectors로 기하(x/y/points/routing)가 채워진 커넥터
 */
export default function ConnectorLabelEditor({ element }) {
  const [value, setValue] = useState(element.content || '')
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (el) { el.focus(); el.select() }
  }, [])

  const commit = () => {
    const next = value.trim()
    if (next !== (element.content || '')) {
      useFlatStore.getState().updateFlatElement(element.id, { content: next })
    }
    useFlatStore.getState().setEditingFlat(null)
  }
  const cancel = () => useFlatStore.getState().setEditingFlat(null)

  // 렌더 칩과 동일하게 element.curve(제어점)로 중점 계산 — 직선이면 curve=null로 현의 중점
  const curve = element.routing === 'curved' && !element.closed && element.points?.length === 2
    ? element.curve : null
  const mid = connectorLabelMid(element.points || [], curve)
  const s = element.styles || {}

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        else if (e.key === 'Escape') { e.preventDefault(); cancel() }
      }}
      placeholder="라벨"
      style={{
        position: 'absolute',
        left: element.x + mid.x,
        top: element.y + mid.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 10001,
        minWidth: 40, width: `${Math.max(4, value.length + 2)}ch`,
        textAlign: 'center',
        padding: '1px 6px', borderRadius: 5,
        border: '1px solid #6366f1', outline: 'none',
        background: '#fff', color: s.stroke || '#1e293b',
        fontSize: s.fontSize || '13px', fontFamily: s.fontFamily || 'sans-serif',
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
      }}
    />
  )
}
