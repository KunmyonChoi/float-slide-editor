import { useState, useRef } from 'react'
import { useFlatStore } from '../store/flatStore'
import { resolveConnectors } from '../core/ConnectorRouting'

/**
 * DebugElementsPanel — 디버그 모드에서 현재 페이지의 요소 목록 + z순서를 보여주는 플로팅 창.
 * 헤더 드래그로 이동, 행 클릭 = 강제 선택, ✕ = 삭제.
 * 그룹/데이터 무결성 점검: 단독 멤버 그룹(꼬인 그룹)·중복 id 탐지 + 정리.
 */
function typeLabel(el) {
  if (el.shapeType) return el.shapeType // connector/line/polyline/polygon
  return el.type
}

function snippet(el) {
  if (el.type === 'image') return 'image'
  if (el.type === 'video') return 'video'
  if (el.type === 'table') return 'table'
  const c = (el.content || '').replace(/<[^>]+>/g, '').trim()
  return c ? (c.length > 18 ? c.slice(0, 18) + '…' : c) : '∅'
}

export default function DebugElementsPanel() {
  const flatElements = useFlatStore(s => s.flatElements)
  const selectedFlatIds = useFlatStore(s => s.selectedFlatIds)
  const canvasSize = useFlatStore(s => s.canvasSize)
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState(null) // null = 기본(좌하단)
  const containerRef = useRef(null)
  const dragRef = useRef(null)

  // z 큰 것(앞)부터. 커넥터는 유도 기하로 실제 bbox 표시.
  const els = resolveConnectors(flatElements).slice().sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))

  // 그룹별 색상(묶인 요소를 한눈에 — 한 요소 선택 시 그룹 전체가 같이 선택됨)
  const groupColors = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c']
  const groupIds = [...new Set(els.map(e => e.groupId).filter(Boolean))]
  const groupColor = (gid) => groupColors[groupIds.indexOf(gid) % groupColors.length]

  // ── 무결성 점검 ──
  const groupCount = {}
  for (const e of els) if (e.groupId) groupCount[e.groupId] = (groupCount[e.groupId] || 0) + 1
  const idCount = {}
  for (const e of els) idCount[e.id] = (idCount[e.id] || 0) + 1
  const isSingletonGroup = (el) => el.groupId && groupCount[el.groupId] < 2 // 멤버 1개뿐 = 꼬인 그룹
  const isDupId = (el) => idCount[el.id] > 1
  const singletonIds = els.filter(isSingletonGroup).map(e => e.id)
  const dupIdCount = Object.values(idCount).filter(n => n > 1).length
  const hasIssues = singletonIds.length > 0 || dupIdCount > 0

  const fixSingletons = () => {
    if (singletonIds.length) useFlatStore.getState().batchUpdateFlatElements(singletonIds, { groupId: null })
  }

  const isBg = (el) => !!(el.isBackground || el.sourceId === '__bg')
  const isFullCanvas = (el) => Math.abs(el.width - canvasSize.w) < 2 && Math.abs(el.height - canvasSize.h) < 2
    && Math.abs(el.x) < 2 && Math.abs(el.y) < 2

  // 헤더 드래그로 이동
  const onDragStart = (e) => {
    const r = containerRef.current?.getBoundingClientRect()
    if (!r) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top }
    const onMove = (me) => {
      const d = dragRef.current
      if (!d) return
      const left = Math.max(0, Math.min(window.innerWidth - 80, d.left + (me.clientX - d.sx)))
      const top = Math.max(0, Math.min(window.innerHeight - 30, d.top + (me.clientY - d.sy)))
      setPos({ left, top })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={containerRef}
      data-export-ignore="true"
      style={{
        position: 'fixed', zIndex: 12000,
        ...(pos ? { left: pos.left, top: pos.top } : { left: 12, bottom: 12 }),
        width: 280, maxHeight: '60vh', display: 'flex', flexDirection: 'column',
        background: 'rgba(15,23,42,0.94)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)', color: '#cbd5e1',
        fontSize: 11, fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div
        onMouseDown={onDragStart}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', cursor: 'move', userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>🐞 요소 {els.length}개 (z순)</span>
        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c) }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
        >{collapsed ? '▸' : '▾'}</button>
      </div>
      {!collapsed && (
        <>
          {/* 무결성 경고 + 정리 */}
          {hasIssues && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              padding: '5px 10px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
              <span>⚠ 꼬인 그룹 {singletonIds.length}{dupIdCount ? ` · 중복 id ${dupIdCount}` : ''}</span>
              {singletonIds.length > 0 && (
                <button
                  onClick={fixSingletons}
                  style={{ background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.4)', color: '#fde68a', borderRadius: 6, padding: '1px 6px', cursor: 'pointer', fontSize: 10 }}
                >단독그룹 정리</button>
              )}
            </div>
          )}
          <div style={{ overflow: 'auto' }}>
            {els.length === 0 && <div style={{ padding: 10, color: '#64748b' }}>요소 없음</div>}
            {els.map((el, i) => {
              const selected = selectedFlatIds.includes(el.id)
              const singleton = isSingletonGroup(el)
              const dup = isDupId(el)
              return (
                <div
                  key={el.id + '#' + i}
                  onClick={() => useFlatStore.getState().setSelectedFlat(el.id)}
                  title={`${el.id}  z=${el.zIndex}  ${Math.round(el.x)},${Math.round(el.y)} ${Math.round(el.width)}×${Math.round(el.height)}${el.groupId ? `  group=${el.groupId}` : ''}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: selected ? 'rgba(99,102,241,0.25)' : (singleton || dup ? 'rgba(251,191,36,0.08)' : 'transparent'),
                  }}
                >
                  <span style={{ color: '#64748b', minWidth: 28, textAlign: 'right' }}>{el.zIndex}</span>
                  <span style={{ color: '#a5b4fc', minWidth: 64 }}>{typeLabel(el)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet(el)}</span>
                  {dup && <span style={{ color: '#f87171' }} title="중복된 id — 데이터 꼬임">id!</span>}
                  {el.groupId && (
                    <span title={singleton
                      ? `그룹 ${el.groupId} — 멤버가 이 요소 하나뿐(꼬인 그룹)`
                      : `그룹 ${el.groupId} — 선택 시 그룹 전체 함께 선택`}
                      style={{ color: singleton ? '#fbbf24' : groupColor(el.groupId), fontWeight: 700 }}>
                      {singleton ? '⛓⚠' : '⛓'}
                    </span>
                  )}
                  {isBg(el) && <span style={{ color: '#34d399' }}>BG</span>}
                  {!isBg(el) && isFullCanvas(el) && <span style={{ color: '#fbbf24' }} title="전체화면이지만 배경 플래그 없음">FULL</span>}
                  {el.locked && <span style={{ color: '#f87171' }}>🔒</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); useFlatStore.getState().removeFlatElement(el.id) }}
                    title="삭제"
                    style={{ color: '#f87171', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 12 }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
