import { useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'

/**
 * ConnectorInlineToolbar — 커넥터를 단일 선택했을 때 뜨는 빠른 편집 미니툴바.
 * 시작/끝 화살표 토글, 방향 뒤집기, 실선/점선. (색·굵기 등 상세는 속성 패널)
 * 캔버스 줌과 무관하게 읽기 좋게 document.body 포털 + 화면 좌표로 배치.
 */
const ARROW_CYCLE = ['none', 'triangle', 'circle', 'diamond']
const ARROW_ICON = { none: '─', triangle: '▶', circle: '●', diamond: '◆' }
const cycle = (v) => ARROW_CYCLE[(ARROW_CYCLE.indexOf(v) + 1) % ARROW_CYCLE.length]

export default function ConnectorInlineToolbar({ element, scale, canvasRef }) {
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [])

  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      cx: cr.left + (element.x + element.width / 2) * scale,
      top: cr.top + element.y * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.cx === next.cx && prev.top === next.top) return prev
      return next
    })
  }, [canvasRef, element.id, element.x, element.y, element.width, scale, tick])

  if (!rect) return null

  const update = (changes) => useFlatStore.getState().updateFlatElement(element.id, changes)
  const startArrow = element.startArrow || 'none'
  const endArrow = element.endArrow || 'none'
  const dashed = !!(element.styles?.strokeDasharray)
  const curved = element.routing === 'curved'

  const btn = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)', color: '#cbd5e1', fontSize: 12,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }
  const lab = { color: '#64748b', fontSize: 10 }

  return createPortal(
    <div
      data-export-ignore="true"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: rect.cx, top: rect.top - 46, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 10,
        background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        zIndex: 10050,
      }}
    >
      <button style={btn} title="시작 화살표 바꾸기" onClick={() => update({ startArrow: cycle(startArrow) })}>
        <span style={lab}>시작</span>{ARROW_ICON[startArrow]}
      </button>
      <button style={btn} title="방향 뒤집기" onClick={() => useFlatStore.getState().reverseConnector(element.id)}>⇄</button>
      <button style={btn} title="끝 화살표 바꾸기" onClick={() => update({ endArrow: cycle(endArrow) })}>
        <span style={lab}>끝</span>{ARROW_ICON[endArrow]}
      </button>
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)' }} />
      <button style={btn} title={dashed ? '실선으로' : '점선으로'} onClick={() => update({ styles: { strokeDasharray: dashed ? '' : '6 4' } })}>
        {dashed ? '┈' : '──'}
      </button>
      <button style={curved ? { ...btn, background: 'rgba(99,102,241,0.25)', color: '#c7d2fe' } : btn}
        title={curved ? '직선으로' : '곡선으로'} onClick={() => update({ routing: curved ? 'straight' : 'curved' })}>
        {curved ? '⌒' : '⟋'}
      </button>
    </div>,
    document.body
  )
}
