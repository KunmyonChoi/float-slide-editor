/**
 * diagramLayout — 다이어그램 스펙(노드+간선 그래프) → 편집 가능한 flat 요소 배열.
 *
 * "내용 재구성"이 이미지를 분석해 얻은 그래프 스펙을, 격자 기반으로 배치한
 * 카드(text 요소) + 화살표(shape 요소)로 변환한다. API/캔버스 의존이 없는 순수 함수라
 * 단위 테스트가 가능하다. LLM의 자유 픽셀좌표 대신 정수 격자(col,row)만 받아
 * 픽셀 배치는 여기서 계산해 겹침 없이 정렬한다.
 */
import { nextFlatId } from './FlatExtractor'
import { pointsToBBox, absoluteToRelativePoints } from './PolyShapeUtils'

// variant별 기본 팔레트(스펙에 팔레트가 없거나 variant로 색을 바꿀 때 사용)
const DEFAULT_PALETTES = [
  ['#6366f1', '#8b5cf6', '#0ea5e9'], // indigo/violet/sky
  ['#0d9488', '#10b981', '#f59e0b'], // teal/emerald/amber
  ['#e11d48', '#f97316', '#6366f1'], // rose/orange/indigo
]

const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())

// 그래프 스펙을 안전한 형태로 정규화(누락/이상값 보정).
export function normalizeDiagramSpec(spec) {
  const s = spec || {}
  const nodes = Array.isArray(s.nodes) ? s.nodes.filter(n => n && (n.text != null)) : []
  const usedIds = new Set()
  const cleanNodes = nodes.map((n, i) => {
    let id = String(n.id != null ? n.id : `n${i}`)
    while (usedIds.has(id)) id = `${id}_${i}` // 중복 id 방지(노드 유실/엣지 오연결 방지)
    usedIds.add(id)
    return {
      id,
      text: String(n.text == null ? '' : n.text),
      role: ['primary', 'secondary', 'muted'].includes(n.role) ? n.role : 'secondary',
      col: Number.isFinite(n.col) ? Math.max(0, Math.round(n.col)) : (i % 3),
      row: Number.isFinite(n.row) ? Math.max(0, Math.round(n.row)) : Math.floor(i / 3),
    }
  })
  const ids = new Set(cleanNodes.map(n => n.id))
  const edges = (Array.isArray(s.edges) ? s.edges : [])
    .filter(e => e && ids.has(String(e.from)) && ids.has(String(e.to)) && String(e.from) !== String(e.to))
    .map(e => ({ from: String(e.from), to: String(e.to), label: e.label ? String(e.label) : '', dashed: !!e.dashed }))
  const maxCol = cleanNodes.reduce((m, n) => Math.max(m, n.col), 0)
  const maxRow = cleanNodes.reduce((m, n) => Math.max(m, n.row), 0)
  const cols = Math.max(Number.isFinite(s.cols) ? s.cols : 0, maxCol + 1, 1)
  const rows = Math.max(Number.isFinite(s.rows) ? s.rows : 0, maxRow + 1, 1)
  const palette = Array.isArray(s.palette) ? s.palette.filter(isHex) : []
  return {
    title: s.title ? String(s.title) : '',
    layout: ['horizontal', 'vertical', 'grid'].includes(s.layout) ? s.layout : 'grid',
    cols, rows, nodes: cleanNodes, edges,
    palette,
  }
}

// variant에 따라 스펙을 변형(추가 API 비용 없이 후보 생성).
// 0: 원본, 1: 행/열 전치(방향 전환), 2: 대체 팔레트(배치 동일).
function applyVariant(spec, variant) {
  if (variant === 1) {
    return {
      ...spec,
      cols: spec.rows, rows: spec.cols,
      layout: spec.layout === 'horizontal' ? 'vertical' : spec.layout === 'vertical' ? 'horizontal' : 'grid',
      nodes: spec.nodes.map(n => ({ ...n, col: n.row, row: n.col })),
    }
  }
  return spec
}

function paletteFor(spec, variant) {
  if (variant === 2) return DEFAULT_PALETTES[1]
  if (spec.palette && spec.palette.length >= 2) return spec.palette
  return DEFAULT_PALETTES[variant % DEFAULT_PALETTES.length] || DEFAULT_PALETTES[0]
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// role별 카드 스타일(팔레트 적용).
function cardStyles(role, palette, fontSize) {
  const accent = palette[0] || '#6366f1'
  const base = {
    borderRadius: '12px',
    boxShadow: '0 2px 10px rgba(15,23,42,0.12)',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: `${fontSize}px`,
    lineHeight: '1.3',
    overflow: 'hidden',
  }
  if (role === 'primary') {
    return { ...base, backgroundColor: accent, color: '#ffffff', border: '0px none' }
  }
  if (role === 'muted') {
    return { ...base, backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', boxShadow: '0 1px 4px rgba(15,23,42,0.08)' }
  }
  // secondary
  return { ...base, backgroundColor: '#ffffff', color: '#1e293b', border: `1.5px solid ${accent}` }
}

function el(base) {
  return { id: nextFlatId(), sourceId: null, merged: false, isRich: false, ...base }
}

/**
 * 그래프 스펙 → flat 요소 배열(카드 text + 화살표 shape + 선택 제목/배경).
 * @param {object} spec  normalizeDiagramSpec 입력(미정규화여도 내부에서 정규화)
 * @param {{x:number,y:number,w:number,h:number}} bbox  배치할 캔버스 영역
 * @param {{ variant?:number, zStart?:number, backgroundUrl?:string }} [opts]
 * @returns {Array<object>} flat 요소들(zIndex: 배경<화살표<카드<제목)
 */
export function buildDiagramElements(spec, bbox, opts = {}) {
  const variant = opts.variant || 0
  const norm = applyVariant(normalizeDiagramSpec(spec), variant)
  const palette = paletteFor(norm, variant)
  const { x, y, w, h } = bbox
  let z = opts.zStart || 1
  const out = []

  // 배경(선택) — 최하단
  if (opts.backgroundUrl) {
    out.push(el({
      type: 'image', content: opts.backgroundUrl,
      x, y, width: w, height: h, zIndex: z++,
      styles: { objectFit: 'cover', objectPosition: 'center center', opacity: '1', borderRadius: '0px', border: '0px none', boxShadow: 'none' },
    }))
  }

  const pad = clamp(Math.min(w, h) * 0.04, 8, 40)
  const hasTitle = !!norm.title
  const titleH = hasTitle ? clamp(h * 0.12, 28, 64) : 0
  const gridX = x + pad
  const gridY = y + pad + titleH
  const gridW = Math.max(1, w - pad * 2)
  const gridH = Math.max(1, h - pad * 2 - titleH)
  const cellW = gridW / norm.cols
  const cellH = gridH / norm.rows
  // 카드 크기 = 셀에서 간격을 뺀 크기(겹침 방지)
  const gapX = clamp(cellW * 0.16, 8, 48)
  const gapY = clamp(cellH * 0.22, 8, 48)
  const cardW = Math.max(24, cellW - gapX)
  const cardH = Math.max(20, cellH - gapY)
  const fontSize = Math.round(clamp(cardH * 0.2, 12, 24))

  // 노드 → 카드 rect 맵
  const rects = {}
  for (const n of norm.nodes) {
    const col = clamp(n.col, 0, norm.cols - 1)
    const row = clamp(n.row, 0, norm.rows - 1)
    rects[n.id] = {
      x: gridX + col * cellW + (cellW - cardW) / 2,
      y: gridY + row * cellH + (cellH - cardH) / 2,
      w: cardW, h: cardH,
    }
  }

  // 화살표(카드보다 아래 z) — 경계 중점 연결
  const arrowEls = []
  for (const e of norm.edges) {
    const s = rects[e.from], d = rects[e.to]
    if (!s || !d) continue
    const { start, end } = borderPoints(s, d)
    const bb = pointsToBBox([start, end])
    const pts = absoluteToRelativePoints([start, end], bb)
    arrowEls.push(el({
      type: 'shape', shapeType: 'line', content: '',
      points: pts, closed: false, startArrow: 'none', endArrow: 'triangle',
      x: bb.x, y: bb.y, width: bb.width, height: bb.height, zIndex: 0, // z는 아래서 채움
      styles: {
        stroke: palette[0] || '#64748b', strokeWidth: '2',
        strokeDasharray: e.dashed ? '6 5' : '', fill: 'none', opacity: '1',
      },
      _edge: e, _mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    }))
  }
  // 화살표 z 부여
  for (const a of arrowEls) { a.zIndex = z++ }

  // 카드(화살표 위)
  for (const n of norm.nodes) {
    const r = rects[n.id]
    out.push(el({
      type: 'text', content: n.text,
      x: r.x, y: r.y, width: r.w, height: r.h, zIndex: z++,
      styles: cardStyles(n.role, palette, fontSize), layoutRole: 'default',
    }))
  }

  // 화살표를 out에 합치고(카드보다 먼저 그려지도록 z는 이미 낮음) 라벨 추가
  for (const a of arrowEls) {
    const edge = a._edge, mid = a._mid
    delete a._edge; delete a._mid
    out.push(a)
    if (edge.label) {
      const lw = clamp(cellW * 0.6, 40, 220)
      const lh = clamp(fontSize * 1.8, 18, 36)
      out.push(el({
        type: 'text', content: edge.label,
        x: mid.x - lw / 2, y: mid.y - lh / 2, width: lw, height: lh, zIndex: z++,
        styles: {
          backgroundColor: '#ffffff', color: '#475569', border: '1px solid #e2e8f0',
          borderRadius: '6px', padding: '2px 6px', fontSize: `${Math.max(11, fontSize - 3)}px`,
          textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: '1.2', overflow: 'hidden',
        },
      }))
    }
  }

  // 제목(최상단)
  if (hasTitle) {
    out.push(el({
      type: 'text', content: norm.title,
      x: x + pad, y: y + pad, width: Math.max(1, w - pad * 2), height: titleH, zIndex: z++,
      styles: {
        color: '#0f172a', fontSize: `${Math.round(clamp(titleH * 0.5, 16, 34))}px`, fontWeight: '700',
        textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: '1.2', overflow: 'hidden',
      },
    }))
  }

  return out
}

// 두 카드 rect의 경계 중점을 연결하는 시작/끝 점(가로/세로 우세 방향).
function borderPoints(s, d) {
  const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
  const dc = { x: d.x + d.w / 2, y: d.y + d.h / 2 }
  const dx = dc.x - sc.x, dy = dc.y - sc.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 가로 우세
    if (dx >= 0) return { start: { x: s.x + s.w, y: sc.y }, end: { x: d.x, y: dc.y } }
    return { start: { x: s.x, y: sc.y }, end: { x: d.x + d.w, y: dc.y } }
  }
  // 세로 우세
  if (dy >= 0) return { start: { x: sc.x, y: s.y + s.h }, end: { x: dc.x, y: d.y } }
  return { start: { x: sc.x, y: s.y }, end: { x: dc.x, y: d.y + d.h } }
}

// variant 후보 개수(클라이언트 생성).
export const DIAGRAM_VARIANT_COUNT = 3
