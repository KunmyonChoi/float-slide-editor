import { describe, it, expect } from 'vitest'
import {
  createTableData, createTableElement, addRow, removeRow, addCol, removeCol,
  setCellText, setAllCellTexts, setHeaderRow, setBorder,
  normalizeRange, applyCellRange, rangeFirstCell, cellStyle,
} from '../core/slideTable'
import { internalElementToPublic, publicElementToInternal } from '../../packages/slide-contract/adapters'

const sumClose = (arr) => Math.abs(arr.reduce((a, b) => a + b, 0) - 1) < 1e-9

describe('slideTable 모델/헬퍼', () => {
  it('createTableData: 균등 분할 + 셀 채움', () => {
    const t = createTableData(3, 4)
    expect(t.rows).toBe(3)
    expect(t.cols).toBe(4)
    expect(t.cells.length).toBe(3)
    expect(t.cells[0].length).toBe(4)
    expect(sumClose(t.colFractions)).toBe(true)
    expect(sumClose(t.rowFractions)).toBe(true)
    expect(t.headerRow).toBe(true)
  })

  it('범위 클램프(최소 1, 최대치)', () => {
    expect(createTableData(0, 0).rows).toBe(1)
    expect(createTableData(0, 0).cols).toBe(1)
    expect(createTableData(999, 999).cols).toBeLessThanOrEqual(12)
    expect(createTableData(999, 999).rows).toBeLessThanOrEqual(30)
  })

  it('addRow/addCol: 차원 증가 + 분수 정규화', () => {
    let t = createTableData(2, 2)
    t = addRow(t)
    expect(t.rows).toBe(3)
    expect(t.cells.length).toBe(3)
    expect(t.cells[2].length).toBe(2)
    expect(sumClose(t.rowFractions)).toBe(true)
    t = addCol(t)
    expect(t.cols).toBe(3)
    expect(t.cells[0].length).toBe(3)
    expect(sumClose(t.colFractions)).toBe(true)
  })

  it('removeRow/removeCol: 최소 1 유지', () => {
    let t = createTableData(1, 1)
    expect(removeRow(t, 0).rows).toBe(1)
    expect(removeCol(t, 0).cols).toBe(1)
    t = createTableData(3, 3)
    t = removeRow(t, 1)
    expect(t.rows).toBe(2)
    expect(sumClose(t.rowFractions)).toBe(true)
    t = removeCol(t, 0)
    expect(t.cols).toBe(2)
    expect(sumClose(t.colFractions)).toBe(true)
  })

  it('setCellText / setAllCellTexts: 불변 갱신', () => {
    let t = createTableData(2, 2)
    const t2 = setCellText(t, 0, 1, '안녕')
    expect(t.cells[0][1].text).toBe('')      // 원본 불변
    expect(t2.cells[0][1].text).toBe('안녕')
    const t3 = setAllCellTexts(t, [['a', 'b'], ['c', 'd']])
    expect(t3.cells[1][0].text).toBe('c')
    // undefined는 기존 유지
    const t4 = setAllCellTexts(t3, [[undefined, 'B']])
    expect(t4.cells[0][0].text).toBe('a')
    expect(t4.cells[0][1].text).toBe('B')
  })

  it('setHeaderRow / setBorder', () => {
    let t = createTableData(2, 2)
    expect(setHeaderRow(t, false).headerRow).toBe(false)
    const tb = setBorder(t, { color: '#ff0000', width: 3 })
    expect(tb.border.color).toBe('#ff0000')
    expect(tb.border.width).toBe(3)
  })

  it('createTableElement: 표 요소 형태', () => {
    const el = createTableElement(3, 3, { w: 1280, h: 720 })
    expect(el.type).toBe('table')
    expect(el.table.rows).toBe(3)
    expect(el.content).toBe('')
    expect(el.width).toBeGreaterThan(0)
    expect(el.height).toBeGreaterThan(0)
  })
})

describe('셀 범위 선택/서식', () => {
  it('normalizeRange: 좌상↔우하 정렬', () => {
    expect(normalizeRange({ r0: 2, c0: 3, r1: 0, c1: 1 })).toEqual({ r0: 0, c0: 1, r1: 2, c1: 3 })
  })

  it('applyCellRange: 범위 내 셀에만 patch 병합', () => {
    let t = createTableData(3, 3)
    t = applyCellRange(t, { r0: 0, c0: 0, r1: 1, c1: 1 }, { bg: '#fee2e2' })
    expect(t.cells[0][0].bg).toBe('#fee2e2')
    expect(t.cells[1][1].bg).toBe('#fee2e2')
    expect(t.cells[2][2].bg).toBeUndefined() // 범위 밖
    expect(t.cells[0][2].bg).toBeUndefined()
  })

  it('applyCellRange: 역방향 범위도 정규화되어 적용', () => {
    let t = createTableData(2, 2)
    t = applyCellRange(t, { r0: 1, c0: 1, r1: 0, c1: 0 }, { color: '#ff0000', fontWeight: 700 })
    expect(t.cells[0][0].color).toBe('#ff0000')
    expect(t.cells[0][0].fontWeight).toBe(700)
    expect(t.cells[1][1].color).toBe('#ff0000')
  })

  it('rangeFirstCell: 앵커(좌상) 셀 반환', () => {
    let t = createTableData(2, 2)
    t = setCellText(t, 0, 1, 'X')
    expect(rangeFirstCell(t, { r0: 0, c0: 1, r1: 1, c1: 1 }).text).toBe('X')
  })

  it('cellStyle: 셀별 오버라이드(bg/color/fontWeight/fontSize/border) 반영', () => {
    let t = createTableData(2, 2)
    t = applyCellRange(t, { r0: 1, c0: 0, r1: 1, c1: 0 },
      { bg: '#dbeafe', color: '#1e293b', fontWeight: 700, fontSize: '20px', border: { color: '#ef4444', width: 2 } })
    const s = cellStyle(t, 1, 0, { color: '#334155' })
    expect(s.background).toBe('#dbeafe')
    expect(s.color).toBe('#1e293b')
    expect(s.fontWeight).toBe(700)
    expect(s.fontSize).toBe('20px')
    expect(s.border).toBe('2px solid #ef4444')
  })

  it('cellStyle: 헤더 행 기본 강조(오버라이드 없을 때)', () => {
    const t = createTableData(2, 2) // headerRow true
    const s = cellStyle(t, 0, 0, { color: '#334155' })
    expect(s.fontWeight).toBe(700)
    expect(s.background).toBeTruthy()
  })
})

describe('공개 계약 어댑터 — 표 라운드트립', () => {
  it('table 필드가 internal→public→internal 보존', () => {
    const el = {
      type: 'table', x: 10, y: 20, width: 300, height: 150, rotation: 0, zIndex: 5,
      content: '', isRich: false,
      table: createTableData(2, 3),
      styles: { color: '#334155', fontSize: '14px' },
    }
    el.table = setCellText(el.table, 0, 0, '머리글')
    const pub = internalElementToPublic(el)
    expect(pub.type).toBe('table')
    expect(pub.table.cells[0][0].text).toBe('머리글')
    expect(pub.src).toBeUndefined()  // table은 src로 흘러가지 않음

    const back = publicElementToInternal(pub)
    expect(back.type).toBe('table')
    expect(back.content).toBe('')
    expect(back.table.cols).toBe(3)
    expect(back.table.cells[0][0].text).toBe('머리글')
  })
})
