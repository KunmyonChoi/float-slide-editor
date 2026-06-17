import { describe, it, expect } from 'vitest'
import { buildDiagramElements, normalizeDiagramSpec, DIAGRAM_VARIANT_COUNT } from '../core/diagramLayout'

const SPEC = {
  title: '처리 흐름',
  layout: 'horizontal',
  cols: 3, rows: 1,
  nodes: [
    { id: 'a', text: '입력 데이터', role: 'primary', col: 0, row: 0 },
    { id: 'b', text: '전처리', role: 'secondary', col: 1, row: 0 },
    { id: 'c', text: '결과', role: 'muted', col: 2, row: 0 },
  ],
  edges: [
    { from: 'a', to: 'b', label: '', dashed: false },
    { from: 'b', to: 'c', label: '검증', dashed: true },
  ],
  palette: ['#6366f1', '#8b5cf6'],
}
const BBOX = { x: 100, y: 50, w: 900, h: 300 }

const cards = els => els.filter(e => e.type === 'text' && e.styles.borderRadius === '12px')
const arrows = els => els.filter(e => e.type === 'shape' && e.shapeType === 'line')
const rectsOverlap = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

describe('normalizeDiagramSpec', () => {
  it('이상값을 보정하고 self/무효 edge를 거른다', () => {
    const n = normalizeDiagramSpec({
      nodes: [{ text: 'x' }, { id: 'k', text: 'y', role: 'bogus', col: -2, row: 1.7 }],
      edges: [{ from: 'k', to: 'k' }, { from: 'k', to: 'nope' }, { from: 'n0', to: 'k' }],
      cols: 0, rows: 0,
    })
    expect(n.nodes).toHaveLength(2)
    expect(n.nodes[0].id).toBe('n0')          // id 자동 생성
    expect(n.nodes[1].role).toBe('secondary') // 잘못된 role 보정
    expect(n.nodes[1].col).toBe(0)            // 음수 보정
    expect(n.nodes[1].row).toBe(2)            // 반올림
    expect(n.edges).toHaveLength(1)           // self/존재X 제거, 유효 1개
    expect(n.cols).toBeGreaterThanOrEqual(1)
    expect(n.rows).toBeGreaterThanOrEqual(1)
  })

  it('중복 노드 id를 유일하게 만든다(노드 유실 방지)', () => {
    const n = normalizeDiagramSpec({
      nodes: [{ id: 'x', text: 'A' }, { id: 'x', text: 'B' }],
      edges: [],
    })
    expect(n.nodes).toHaveLength(2)
    expect(new Set(n.nodes.map(x => x.id)).size).toBe(2)
  })
})

describe('buildDiagramElements', () => {
  it('노드 수만큼 카드를 만들고 원문 텍스트를 그대로 담는다', () => {
    const els = buildDiagramElements(SPEC, BBOX)
    const c = cards(els)
    expect(c).toHaveLength(3)
    expect(c.map(e => e.content).sort()).toEqual(['결과', '입력 데이터', '전처리'])
    // 모두 편집 가능한 text 요소
    expect(c.every(e => e.type === 'text' && e.isRich === false)).toBe(true)
  })

  it('카드가 bbox 안에 있고 서로 겹치지 않는다', () => {
    const c = cards(buildDiagramElements(SPEC, BBOX))
    for (const e of c) {
      expect(e.x).toBeGreaterThanOrEqual(BBOX.x)
      expect(e.y).toBeGreaterThanOrEqual(BBOX.y)
      expect(e.x + e.width).toBeLessThanOrEqual(BBOX.x + BBOX.w + 0.5)
      expect(e.y + e.height).toBeLessThanOrEqual(BBOX.y + BBOX.h + 0.5)
    }
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++)
        expect(rectsOverlap(c[i], c[j])).toBe(false)
  })

  it('edge마다 화살표(shape line, endArrow triangle)를 만든다', () => {
    const a = arrows(buildDiagramElements(SPEC, BBOX))
    expect(a).toHaveLength(2)
    expect(a.every(e => e.endArrow === 'triangle' && e.points.length === 2)).toBe(true)
    // dashed edge는 strokeDasharray가 채워짐
    expect(a.some(e => e.styles.strokeDasharray)).toBe(true)
  })

  it('dashed edge 라벨이 text 요소로 추가된다', () => {
    const els = buildDiagramElements(SPEC, BBOX)
    expect(els.some(e => e.type === 'text' && e.content === '검증')).toBe(true)
  })

  it('제목이 있으면 상단 제목 요소가 최상단 z', () => {
    const els = buildDiagramElements(SPEC, BBOX)
    const title = els.find(e => e.content === '처리 흐름')
    expect(title).toBeTruthy()
    const maxZ = Math.max(...els.map(e => e.zIndex))
    expect(title.zIndex).toBe(maxZ)
  })

  it('z 순서: 화살표 < 카드', () => {
    const els = buildDiagramElements(SPEC, BBOX)
    const maxArrowZ = Math.max(...arrows(els).map(e => e.zIndex))
    const minCardZ = Math.min(...cards(els).map(e => e.zIndex))
    expect(maxArrowZ).toBeLessThan(minCardZ)
  })

  it('id가 모두 유일하다', () => {
    const els = buildDiagramElements(SPEC, BBOX)
    const ids = els.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('zStart로 z 오프셋, backgroundUrl이면 최하단 이미지', () => {
    const els = buildDiagramElements(SPEC, BBOX, { zStart: 50, backgroundUrl: 'data:image/png;base64,AAA' })
    const bg = els.find(e => e.type === 'image')
    expect(bg).toBeTruthy()
    expect(bg.content).toContain('data:image/png')
    expect(bg.zIndex).toBe(50) // 최하단
    expect(Math.min(...els.map(e => e.zIndex))).toBe(50)
  })

  it('variant 1(전치)은 카드 배치가 달라진다', () => {
    const v0 = cards(buildDiagramElements(SPEC, BBOX, { variant: 0 }))
    const v1 = cards(buildDiagramElements(SPEC, BBOX, { variant: 1 }))
    const key = c => c.map(e => `${Math.round(e.x)},${Math.round(e.y)}`).sort().join('|')
    expect(key(v0)).not.toEqual(key(v1))
  })

  it('variant 2는 팔레트(primary 카드 배경)가 달라진다', () => {
    const prim0 = cards(buildDiagramElements(SPEC, BBOX, { variant: 0 })).find(e => e.styles.color === '#ffffff')
    const prim2 = cards(buildDiagramElements(SPEC, BBOX, { variant: 2 })).find(e => e.styles.color === '#ffffff')
    expect(prim0.styles.backgroundColor).not.toEqual(prim2.styles.backgroundColor)
  })

  it('bbox가 크면 좌표도 그에 맞게 스케일된다', () => {
    const small = cards(buildDiagramElements(SPEC, { x: 0, y: 0, w: 300, h: 100 }))
    const big = cards(buildDiagramElements(SPEC, { x: 0, y: 0, w: 1200, h: 400 }))
    const spanSmall = Math.max(...small.map(e => e.x + e.width))
    const spanBig = Math.max(...big.map(e => e.x + e.width))
    expect(spanBig).toBeGreaterThan(spanSmall * 2)
  })

  it('DIAGRAM_VARIANT_COUNT는 3', () => {
    expect(DIAGRAM_VARIANT_COUNT).toBe(3)
  })
})
