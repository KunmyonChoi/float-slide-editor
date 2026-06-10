/**
 * slideTable — 표(table) FlatElement의 데이터 모델과 순수 헬퍼.
 *
 * 표 데이터는 element.table에 보관(컨테이너는 content 미사용):
 *   table = {
 *     rows, cols,
 *     colFractions: number[cols] (합 1),  // 상대 열 너비
 *     rowFractions: number[rows] (합 1),  // 상대 행 높이
 *     headerRow: boolean,                  // 첫 행을 헤더로 강조
 *     cells: Cell[rows][cols],
 *     border: { color, width },
 *   }
 *   Cell = { text, align?, valign?, bg? }   // align/valign/bg는 셀별 오버라이드(B단계 활용)
 *
 * 모든 변형 헬퍼는 새 table 객체를 반환(불변).
 */

export const TABLE_BORDER_COLOR = '#cbd5e1'
export const TABLE_HEADER_BG = '#f1f5f9'
export const TABLE_HEADER_COLOR = '#0f172a'
export const TABLE_BODY_COLOR = '#334155'
export const TABLE_DEFAULT_FONT_SIZE = 14

const MAX_ROWS = 30
const MAX_COLS = 12

function emptyCell(text = '') {
  return { text }
}

function normFractions(arr) {
  const sum = arr.reduce((a, b) => a + b, 0) || 1
  return arr.map(v => v / sum)
}

/** rows×cols 표 데이터 생성(균등 분할) */
export function createTableData(rows, cols) {
  rows = Math.max(1, Math.min(MAX_ROWS, Math.round(rows) || 1))
  cols = Math.max(1, Math.min(MAX_COLS, Math.round(cols) || 1))
  const cells = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) row.push(emptyCell())
    cells.push(row)
  }
  return {
    rows, cols,
    colFractions: Array(cols).fill(1 / cols),
    rowFractions: Array(rows).fill(1 / rows),
    headerRow: true,
    cells,
    border: { color: TABLE_BORDER_COLOR, width: 1 },
  }
}

/** 표 요소(부분 FlatElement) 생성 — id/zIndex/x/y는 삽입측에서 채움 */
export function createTableElement(rows, cols, canvasSize) {
  const table = createTableData(rows, cols)
  const cw = (canvasSize && canvasSize.w) || 1280
  const ch = (canvasSize && canvasSize.h) || 720
  const width = Math.min(Math.round(cw * 0.72), 130 * table.cols)
  const height = Math.min(Math.round(ch * 0.5), 46 * table.rows)
  return {
    type: 'table',
    width,
    height,
    content: '',
    isRich: false,
    merged: false,
    table,
    styles: {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: TABLE_DEFAULT_FONT_SIZE + 'px',
      color: TABLE_BODY_COLOR,
      backgroundColor: '#ffffff',
    },
  }
}

/** at 위치에 행 삽입(기본: 맨 끝) */
export function addRow(table, at = table.rows) {
  const idx = Math.max(0, Math.min(table.rows, at))
  const cells = table.cells.map(r => r.slice())
  cells.splice(idx, 0, Array.from({ length: table.cols }, () => emptyCell()))
  const rowFractions = table.rowFractions.slice()
  rowFractions.splice(idx, 0, 1 / (table.rows + 1))
  return { ...table, rows: table.rows + 1, cells, rowFractions: normFractions(rowFractions) }
}

/** at 위치 행 삭제(최소 1행 유지) */
export function removeRow(table, at) {
  if (table.rows <= 1) return table
  const idx = Math.max(0, Math.min(table.rows - 1, at))
  const cells = table.cells.map(r => r.slice())
  cells.splice(idx, 1)
  const rowFractions = table.rowFractions.slice()
  rowFractions.splice(idx, 1)
  return { ...table, rows: table.rows - 1, cells, rowFractions: normFractions(rowFractions) }
}

/** at 위치에 열 삽입(기본: 맨 끝) */
export function addCol(table, at = table.cols) {
  const idx = Math.max(0, Math.min(table.cols, at))
  const cells = table.cells.map(r => {
    const nr = r.slice()
    nr.splice(idx, 0, emptyCell())
    return nr
  })
  const colFractions = table.colFractions.slice()
  colFractions.splice(idx, 0, 1 / (table.cols + 1))
  return { ...table, cols: table.cols + 1, cells, colFractions: normFractions(colFractions) }
}

/** at 위치 열 삭제(최소 1열 유지) */
export function removeCol(table, at) {
  if (table.cols <= 1) return table
  const idx = Math.max(0, Math.min(table.cols - 1, at))
  const cells = table.cells.map(r => {
    const nr = r.slice()
    nr.splice(idx, 1)
    return nr
  })
  const colFractions = table.colFractions.slice()
  colFractions.splice(idx, 1)
  return { ...table, cols: table.cols - 1, cells, colFractions: normFractions(colFractions) }
}

/** 단일 셀 텍스트 변경 */
export function setCellText(table, r, c, text) {
  if (!table.cells[r] || !table.cells[r][c]) return table
  const cells = table.cells.map((row, ri) =>
    ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, text } : cell)) : row)
  return { ...table, cells }
}

/** 여러 셀 텍스트 일괄 적용 (편집기 커밋용). texts[r][c] (undefined면 기존 유지) */
export function setAllCellTexts(table, texts) {
  const cells = table.cells.map((row, r) =>
    row.map((cell, c) => {
      const t = texts && texts[r] ? texts[r][c] : undefined
      return t === undefined ? cell : { ...cell, text: t }
    }))
  return { ...table, cells }
}

/** headerRow 토글 */
export function setHeaderRow(table, on) {
  return { ...table, headerRow: !!on }
}

/** {r0,c0,r1,c1} 정규화(좌상↔우하 정렬) */
export function normalizeRange(range) {
  return {
    r0: Math.min(range.r0, range.r1), r1: Math.max(range.r0, range.r1),
    c0: Math.min(range.c0, range.c1), c1: Math.max(range.c0, range.c1),
  }
}

/** 범위 내 셀들에 patch 병합(셀별 서식). patch의 키가 undefined면 해제. */
export function applyCellRange(table, range, patch) {
  const { r0, c0, r1, c1 } = normalizeRange(range)
  const cells = table.cells.map((row, r) =>
    row.map((cell, c) =>
      (r >= r0 && r <= r1 && c >= c0 && c <= c1) ? { ...cell, ...patch } : cell))
  return { ...table, cells }
}

/** 범위 첫 셀(앵커) 반환 — 툴바 토글 상태 판정용 */
export function rangeFirstCell(table, range) {
  const { r0, c0 } = normalizeRange(range)
  return (table.cells[r0] && table.cells[r0][c0]) || {}
}

/** 테두리 색/두께 변경 */
export function setBorder(table, patch) {
  return { ...table, border: { ...table.border, ...patch } }
}

// ── 스타일 헬퍼 (렌더러/편집기 공용 — 시각 일관성) ──────────

export function tableContainerStyle(styles) {
  return {
    width: '100%',
    height: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    fontFamily: styles.fontFamily,
    fontSize: styles.fontSize,
    color: styles.color,
  }
}

export function cellStyle(table, r, c, styles) {
  const isHeader = table.headerRow && r === 0
  const cell = (table.cells[r] && table.cells[r][c]) || {}
  const tbw = (table.border && table.border.width) ?? 1
  const tbc = (table.border && table.border.color) || TABLE_BORDER_COLOR
  // 셀별 테두리 오버라이드
  const cb = cell.border
  const bw = cb && cb.width != null ? cb.width : tbw
  const bc = cb && cb.color ? cb.color : tbc
  return {
    border: bw > 0 ? `${bw}px solid ${bc}` : '1px solid transparent',
    padding: '6px 8px',
    // 셀별 오버라이드 > 헤더 기본 > 미설정
    background: cell.bg != null ? cell.bg : (isHeader ? TABLE_HEADER_BG : undefined),
    color: cell.color != null ? cell.color : (isHeader ? TABLE_HEADER_COLOR : (styles.color || TABLE_BODY_COLOR)),
    fontWeight: cell.fontWeight != null ? cell.fontWeight : (isHeader ? 700 : 400),
    fontSize: cell.fontSize != null ? cell.fontSize : undefined,
    textAlign: cell.align || 'left',
    verticalAlign: cell.valign || 'middle',
    overflow: 'hidden',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  }
}
