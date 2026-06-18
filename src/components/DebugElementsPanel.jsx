import { useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { resolveConnectors } from '../core/ConnectorRouting'

/**
 * DebugElementsPanel — 디버그 모드에서 현재 페이지의 요소 목록 + z순서를 보여주는 플로팅 창.
 * 행 클릭 = 강제 선택(캔버스에서 선택 안 되는 요소도 선택 가능), del = 삭제.
 * '선택도 안 되고 배경 목록에도 없는' 떠도는 요소를 찾아 정리하는 용도.
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

  // z 큰 것(앞)부터. 커넥터는 유도 기하로 실제 bbox 표시.
  const els = resolveConnectors(flatElements).slice().sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))

  // 그룹별 색상(묶인 요소를 한눈에 — 한 요소 선택 시 그룹 전체가 같이 선택됨)
  const groupColors = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c']
  const groupIds = [...new Set(els.map(e => e.groupId).filter(Boolean))]
  const groupColor = (gid) => groupColors[groupIds.indexOf(gid) % groupColors.length]

  const isBg = (el) => !!(el.isBackground || el.sourceId === '__bg')
  const isFullCanvas = (el) => Math.abs(el.width - canvasSize.w) < 2 && Math.abs(el.height - canvasSize.h) < 2
    && Math.abs(el.x) < 2 && Math.abs(el.y) < 2

  return (
    <div
      data-export-ignore="true"
      style={{
        position: 'fixed', left: 12, bottom: 12, zIndex: 12000,
        width: 280, maxHeight: '60vh', display: 'flex', flexDirection: 'column',
        background: 'rgba(15,23,42,0.94)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)', color: '#cbd5e1',
        fontSize: 11, fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', cursor: 'pointer', borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>🐞 요소 {els.length}개 (z순)</span>
        <span style={{ color: '#64748b' }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ overflow: 'auto' }}>
          {els.length === 0 && <div style={{ padding: 10, color: '#64748b' }}>요소 없음</div>}
          {els.map(el => {
            const selected = selectedFlatIds.includes(el.id)
            return (
              <div
                key={el.id}
                onClick={() => useFlatStore.getState().setSelectedFlat(el.id)}
                title={`${el.id}  z=${el.zIndex}  ${Math.round(el.x)},${Math.round(el.y)} ${Math.round(el.width)}×${Math.round(el.height)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                  cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: selected ? 'rgba(99,102,241,0.25)' : 'transparent',
                }}
              >
                <span style={{ color: '#64748b', minWidth: 28, textAlign: 'right' }}>{el.zIndex}</span>
                <span style={{ color: '#a5b4fc', minWidth: 64 }}>{typeLabel(el)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet(el)}</span>
                {el.groupId && (
                  <span title={`그룹 ${el.groupId} — 선택 시 그룹 전체가 함께 선택됨`}
                    style={{ color: groupColor(el.groupId), fontWeight: 700 }}>⛓</span>
                )}
                {isBg(el) && <span style={{ color: '#34d399' }}>BG</span>}
                {!isBg(el) && isFullCanvas(el) && <span style={{ color: '#fbbf24' }} title="전체화면이지만 배경 플래그 없음">FULL</span>}
                {el.locked && <span style={{ color: '#f87171' }}>🔒</span>}
                <button
                  onClick={(e) => { e.stopPropagation(); useFlatStore.getState().removeFlatElement(el.id) }}
                  title="삭제"
                  style={{
                    color: '#f87171', background: 'transparent', border: 'none',
                    cursor: 'pointer', padding: '0 2px', fontSize: 12,
                  }}
                >✕</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
