import { describe, it, expect } from 'vitest'
import { extractTableData } from '../core/FlatExtractor'
import { cellStyle, TABLE_HEADER_BG } from '../core/slideTable'

/**
 * 렌더러는 머리줄 셀에 배경이 없으면 기본 회색(TABLE_HEADER_BG)을 칠한다. 새로 만든 표엔
 * 맞는 기본값이지만, 원본이 투명이라고 한 머리줄까지 칠하면 어두운 포스터 위에 흰 띠가
 * 생긴다(전시 포스터의 비교표가 그렇게 들어왔다). 원본의 투명을 기록해 기본값을 막는다.
 */
// jsdom엔 레이아웃이 없어 크기가 0이다 — extractTableData는 크기 0인 표를 버리므로
// 측정값만 채워 준다(추출 규칙을 보려는 것이지 레이아웃을 보려는 게 아니다).
function sized(el, w, h) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0 })
}
function makeTable(headStyle = '') {
  document.body.innerHTML = `<table>
    <thead><tr><th style="${headStyle}">A</th><th style="${headStyle}">B</th></tr></thead>
    <tbody><tr><td>1</td><td>2</td></tr></tbody></table>`
  const t = document.querySelector('table')
  sized(t, 400, 160)
  t.querySelectorAll('tr').forEach(tr => sized(tr, 400, 80))
  t.querySelectorAll('th, td').forEach(c => sized(c, 200, 80))
  return t
}

describe('가져온 표의 머리줄 배경', () => {
  it('원본이 투명이면 투명으로 기록한다 — 기본 회색이 끼어들지 않는다', () => {
    const t = extractTableData(makeTable(''), window).table
    expect(t.headerRow).toBe(true)
    expect(t.cells[0].map(c => c.bg)).toEqual(['transparent', 'transparent'])
    expect(cellStyle(t, 0, 0, {}).background).toBe('transparent')
  })

  it('원본에 배경이 있으면 그 색을 쓴다', () => {
    const t = extractTableData(makeTable('background-color: rgb(15, 23, 42)'), window).table
    expect(t.cells[0][0].bg).toBe('rgb(15, 23, 42)')
  })

  it('본문 셀은 종전대로 — 투명이면 기록하지 않는다(본문엔 기본 배경이 없다)', () => {
    const t = extractTableData(makeTable(''), window).table
    expect(t.cells[1][0].bg).toBeUndefined()
  })

  it('편집기에서 새로 만든 표(셀 배경 미지정)는 여전히 기본 회색이다', () => {
    const fresh = { headerRow: true, cells: [[{ text: 'A' }], [{ text: '1' }]] }
    expect(cellStyle(fresh, 0, 0, {}).background).toBe(TABLE_HEADER_BG)
  })
})
