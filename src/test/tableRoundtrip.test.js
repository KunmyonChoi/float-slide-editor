import { describe, it, expect } from 'vitest'
import { exportFlatHtml } from '../core/FlatExporter'
import { extractTableData } from '../core/FlatExtractor'
import { createTableData } from '../core/slideTable'

// ── 헬퍼 ─────────────────────────────────────────────────────

function makeTableEl({ rows = 3, cols = 3, headerTag = 'th', useThead = true, colW = null, rowH = null, texts = null } = {}) {
  const table = document.createElement('table')
  const widths = colW || new Array(cols).fill(100)
  const heights = rowH || new Array(rows).fill(40)
  const mk = (tag) => document.createElement(tag)
  const body = mk('tbody')
  const head = useThead ? mk('thead') : null
  for (let r = 0; r < rows; r++) {
    const tr = mk('tr')
    stubRect(tr, { width: widths.reduce((a, b) => a + b, 0), height: heights[r] })
    for (let c = 0; c < cols; c++) {
      const cell = mk(r === 0 && headerTag ? headerTag : 'td')
      cell.textContent = texts ? texts[r][c] : `r${r}c${c}`
      stubRect(cell, { width: widths[c], height: heights[r] })
      tr.appendChild(cell)
    }
    if (r === 0 && head) head.appendChild(tr)
    else body.appendChild(tr)
  }
  if (head) table.appendChild(head)
  table.appendChild(body)
  stubRect(table, {
    width: widths.reduce((a, b) => a + b, 0),
    height: heights.reduce((a, b) => a + b, 0),
  })
  document.body.appendChild(table)
  return table
}

function stubRect(el, { width, height, left = 0, top = 0 }) {
  el.getBoundingClientRect = () => ({ width, height, left, top, right: left + width, bottom: top + height })
}

/** getComputedStyle 대용 — 표 추출이 읽는 값만 */
const fakeWin = (over = {}) => ({
  getComputedStyle: (el) => ({
    borderTopWidth: '1px',
    borderTopColor: 'rgb(203, 213, 225)',
    textAlign: 'start',
    verticalAlign: 'middle',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    color: 'rgb(51, 65, 85)',
    fontSize: '26px',
    fontFamily: 'sans-serif',
    fontWeight: el.tagName === 'TH' ? '700' : '400',
    ...over,
  }),
})

function tableElement(table, over = {}) {
  return {
    id: 'flat-1', type: 'table', table,
    x: 120, y: 240, width: 1680, height: 480, zIndex: 2, rotation: 0,
    content: '', isRich: false, merged: false,
    styles: { fontSize: '26px', fontFamily: 'sans-serif', color: '#334155', backgroundColor: 'rgba(0, 0, 0, 0)' },
    ...over,
  }
}

// ═══════════════════════════════════════════════════════════
//  내보내기 — 표가 <table>로 나간다 (이전에는 빈 도형이었다)
// ═══════════════════════════════════════════════════════════
describe('exportFlatHtml — 표 직렬화', () => {
  const build = () => {
    const t = createTableData(3, 3)
    t.headerRow = true
    t.colFractions = [0.25, 0.15, 0.6]
    t.cells[0][0].text = '영역'
    t.cells[1][2].text = '핵심 <부분>'
    return t
  }

  it('<table>과 셀 텍스트를 내보낸다', () => {
    const html = exportFlatHtml([tableElement(build())], { w: 1920, h: 1080 })
    expect(html).toContain('<table')
    expect(html).toContain('영역')
    expect(html).toContain('핵심 &lt;부분&gt;') // 이스케이프
  })

  it('colFractions를 colgroup 폭으로 내보낸다', () => {
    const html = exportFlatHtml([tableElement(build())], { w: 1920, h: 1080 })
    expect(html).toContain('width:25%')
    expect(html).toContain('width:15%')
    expect(html).toContain('width:60%')
  })

  it('headerRow는 <thead><th>로 나간다', () => {
    const html = exportFlatHtml([tableElement(build())], { w: 1920, h: 1080 })
    expect(html).toContain('<thead>')
    expect(html).toContain('<th ')
  })

  it('행 높이는 px로 고정한다(%는 브라우저가 재분배해 왕복이 밀린다)', () => {
    const t = build()
    t.rowFractions = [0.25, 0.5, 0.25]
    const html = exportFlatHtml([tableElement(t)], { w: 1920, h: 1080 })
    expect(html).toContain('height:120px') // 0.25 × 480
    expect(html).toContain('height:240px') // 0.5 × 480
  })

  it('병합 셀은 colspan/rowspan으로, 가려진 칸은 출력하지 않는다', () => {
    const t = build()
    t.cells[2][0].colSpan = 2
    t.cells[2][1] = { text: '', covered: true }
    const html = exportFlatHtml([tableElement(t)], { w: 1920, h: 1080 })
    expect(html).toContain('colspan="2"')
    expect((html.match(/<td /g) || []).length).toBe(5) // 3×3 중 헤더 3(th) 제외, covered 1칸 제외
  })

  it('표 데이터가 비어 있어도 깨지지 않는다', () => {
    const el = tableElement({ rows: 0, cols: 0, cells: [], colFractions: [], rowFractions: [] })
    expect(() => exportFlatHtml([el], { w: 1920, h: 1080 })).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════
//  가져오기 — <table>이 표 요소로 복원된다 (이전에는 셀별 텍스트)
// ═══════════════════════════════════════════════════════════
describe('extractTableData — <table> → 표 요소 데이터', () => {
  it('행·열·헤더·셀 텍스트를 복원한다', () => {
    const el = makeTableEl({ rows: 3, cols: 3 })
    const { table } = extractTableData(el, fakeWin())
    expect(table.rows).toBe(3)
    expect(table.cols).toBe(3)
    expect(table.headerRow).toBe(true)
    expect(table.cells[0][0].text).toBe('r0c0')
    expect(table.cells[2][2].text).toBe('r2c2')
  })

  it('열 폭·행 높이를 실제 렌더 비율로 복원한다(합 1)', () => {
    const el = makeTableEl({ cols: 3, colW: [400, 200, 400], rowH: [50, 100, 50] })
    const { table } = extractTableData(el, fakeWin())
    expect(table.colFractions[0]).toBeCloseTo(0.4, 3)
    expect(table.colFractions[1]).toBeCloseTo(0.2, 3)
    expect(table.colFractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(table.rowFractions[1]).toBeCloseTo(0.5, 3)
  })

  it('테두리와 본문 서식을 복원한다', () => {
    const el = makeTableEl()
    const { table, font } = extractTableData(el, fakeWin())
    expect(table.border).toEqual({ width: 1, color: 'rgb(203, 213, 225)' })
    expect(font.fontSize).toBe('26px')
    expect(font.color).toBe('rgb(51, 65, 85)')
  })

  it('<thead> 없이 첫 행이 전부 <th>여도 headerRow', () => {
    const el = makeTableEl({ useThead: false, headerTag: 'th' })
    expect(extractTableData(el, fakeWin()).table.headerRow).toBe(true)
  })

  it('헤더가 없으면 headerRow=false', () => {
    const el = makeTableEl({ useThead: false, headerTag: null })
    expect(extractTableData(el, fakeWin()).table.headerRow).toBe(false)
  })

  it('colspan/rowspan을 반영하고 가려진 칸을 covered로 채운다', () => {
    const el = makeTableEl({ rows: 2, cols: 3, useThead: false, headerTag: null })
    const firstRow = el.querySelectorAll('tr')[0]
    const wide = firstRow.children[0]
    wide.setAttribute('colspan', '2')
    firstRow.removeChild(firstRow.children[1]) // 병합된 만큼 셀 제거
    const { table } = extractTableData(el, fakeWin())
    expect(table.cols).toBe(3)
    expect(table.cells[0][0].colSpan).toBe(2)
    expect(table.cells[0][1].covered).toBe(true)
    expect(table.cells[0][2].covered).toBeUndefined()
  })

  it('셀 정렬·배경만 다른 경우 셀 단위로 저장한다', () => {
    const el = makeTableEl()
    const win = {
      getComputedStyle: (cell) => ({
        ...fakeWin().getComputedStyle(cell),
        textAlign: cell.tagName === 'TH' ? 'center' : 'start',
        backgroundColor: cell.tagName === 'TH' ? 'rgb(241, 245, 249)' : 'rgba(0, 0, 0, 0)',
      }),
    }
    const { table } = extractTableData(el, win)
    expect(table.cells[0][0].align).toBe('center')
    expect(table.cells[0][0].bg).toBe('rgb(241, 245, 249)')
    expect(table.cells[1][0].align).toBeUndefined()
    expect(table.cells[1][0].bg).toBeUndefined()
  })

  it('중첩 표·미디어가 들어 있으면 null (기존 셀별 추출로 폴백)', () => {
    const nested = makeTableEl({ rows: 2, cols: 2 })
    nested.querySelector('td, th').appendChild(document.createElement('table'))
    expect(extractTableData(nested, fakeWin())).toBeNull()

    const withImg = makeTableEl({ rows: 2, cols: 2 })
    withImg.querySelector('td, th').appendChild(document.createElement('img'))
    expect(extractTableData(withImg, fakeWin())).toBeNull()
  })

  it('모델 상한(30행·12열)을 넘으면 null', () => {
    expect(extractTableData(makeTableEl({ rows: 2, cols: 13 }), fakeWin())).toBeNull()
    expect(extractTableData(makeTableEl({ rows: 31, cols: 2 }), fakeWin())).toBeNull()
  })

  it('크기 0인 표는 null', () => {
    const el = makeTableEl({ rows: 2, cols: 2 })
    stubRect(el, { width: 0, height: 0 })
    expect(extractTableData(el, fakeWin())).toBeNull()
  })
})
