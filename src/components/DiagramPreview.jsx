/**
 * DiagramPreview — buildDiagramElements 결과(카드 text + 화살표 shape + 선택 배경)를
 * 고정 너비 박스에 축소해 그려주는 경량 미리보기. variant 썸네일/선택·before-after에 사용.
 * 실제 캔버스에 추가될 요소와 동일 좌표를 스케일만 해서 보여준다.
 */
const px = v => parseFloat(v) || 0

export default function DiagramPreview({ elements, bbox, width = 320, onClick, selected = false }) {
  const scale = width / (bbox.w || 1)
  const height = (bbox.h || 1) * scale
  const bg = elements.find(e => e.type === 'image')
  const arrows = elements.filter(e => e.type === 'shape' && e.points)
  const cards = elements.filter(e => e.type === 'text')

  const sx = v => (v - bbox.x) * scale
  const sy = v => (v - bbox.y) * scale

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', width, height, flexShrink: 0,
        background: '#ffffff', borderRadius: 8, overflow: 'hidden',
        border: selected ? '2px solid #818cf8' : '1px solid rgba(255,255,255,0.14)',
        boxShadow: selected ? '0 0 0 3px rgba(99,102,241,0.25)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {bg && <img src={bg.content} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}

      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <marker id="dp-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0 1 L7 4 L0 7 Z" fill="#64748b" />
          </marker>
        </defs>
        {arrows.map(a => {
          const p0 = { x: sx(a.x + a.points[0].x), y: sy(a.y + a.points[0].y) }
          const p1 = { x: sx(a.x + a.points[1].x), y: sy(a.y + a.points[1].y) }
          return (
            <line
              key={a.id}
              x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
              stroke={a.styles?.stroke || '#64748b'} strokeWidth={1.4}
              strokeDasharray={a.styles?.strokeDasharray || ''}
              markerEnd="url(#dp-arrow)"
            />
          )
        })}
      </svg>

      {cards.map(c => {
        const fs = Math.max(5, px(c.styles?.fontSize) * scale)
        return (
          <div
            key={c.id}
            style={{
              position: 'absolute',
              left: sx(c.x), top: sy(c.y), width: c.width * scale, height: c.height * scale,
              boxSizing: 'border-box',
              background: c.styles?.backgroundColor || 'transparent',
              color: c.styles?.color || '#1e293b',
              border: scaleBorder(c.styles?.border, scale),
              borderRadius: Math.max(2, px(c.styles?.borderRadius) * scale),
              fontSize: fs, fontWeight: c.styles?.fontWeight || '600',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', overflow: 'hidden', lineHeight: 1.2,
              padding: `0 ${Math.max(1, 4 * scale)}px`,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
              {c.content}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// "1.5px solid #abc" → 스케일된 border 문자열(없으면 none)
function scaleBorder(border, scale) {
  if (!border || border === '0px none' || border === 'none') return 'none'
  const m = String(border).match(/^([\d.]+)px\s+(\w+)\s+(.+)$/)
  if (!m) return border
  const w = Math.max(0.5, parseFloat(m[1]) * scale)
  return `${w}px ${m[2]} ${m[3]}`
}
