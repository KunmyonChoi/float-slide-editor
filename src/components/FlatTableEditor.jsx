import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import {
  tableContainerStyle, cellStyle, setCellText,
  normalizeRange, applyCellRange, rangeFirstCell,
  mergeCells, splitCell, canMerge, isMerged,
  resizeColumn, resizeRow,
} from '../core/slideTable'

const CELL_BG_SWATCHES = ['#ffffff', '#f1f5f9', '#fee2e2', '#fef9c3', '#dcfce7', '#dbeafe', '#f3e8ff', '#fce7f3']
const CELL_TEXT_SWATCHES = ['#0f172a', '#475569', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
const CELL_BORDER_SWATCHES = ['#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#ef4444', '#3b82f6']
const FONT_MIN = 8, FONT_MAX = 96, FONT_STEP = 2

/**
 * FlatTableEditor
 * 표 편집 — 셀 텍스트 편집 + 셀 범위 선택 후 서식/정렬/병합 + 열·행 크기 조정.
 * - 셀 클릭: 텍스트 편집(활성 셀) / 셀 드래그: 범위 선택
 * - 경계 드래그: 열 너비·행 높이 조정
 * - Tab/Shift+Tab 이동, Enter 줄바꿈, Esc·바깥클릭 커밋
 */
export default function FlatTableEditor({ element }) {
  const { updateFlatElement, setEditingFlat } = useFlatStore()
  const t = element.table
  const cellRefs = useRef({})
  const wrapRef = useRef(null)
  const committedRef = useRef(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const anchorRef = useRef({ r: 0, c: 0 })
  const resizeRef = useRef(null)

  const [sel, setSel] = useState({ r0: 0, c0: 0, r1: 0, c1: 0 })
  const [editing, setEditing] = useState({ r: 0, c: 0 })
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [rect, setRect] = useState(null)

  const inRange = useCallback((r, c) => {
    const n = normalizeRange(sel)
    return r >= n.r0 && r <= n.r1 && c >= n.c0 && c <= n.c1
  }, [sel])

  const flushActiveToStore = useCallback(() => {
    const ed = editingRef.current
    if (!ed) return
    const cellEl = cellRefs.current[`${ed.r}-${ed.c}`]
    if (!cellEl) return
    const raw = cellEl.innerText ?? cellEl.textContent ?? ''
    const text = raw.replace(/\n$/, '')
    const cur = useFlatStore.getState().flatElements.find(e => e.id === element.id)
    if (!cur || !cur.table.cells[ed.r] || !cur.table.cells[ed.r][ed.c]) return
    if (cur.table.cells[ed.r][ed.c].text !== text) {
      updateFlatElement(element.id, { table: setCellText(cur.table, ed.r, ed.c, text) })
    }
  }, [element.id, updateFlatElement])

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    flushActiveToStore()
    setEditingFlat(null)
  }, [flushActiveToStore, setEditingFlat])

  // 활성 셀 진입: 텍스트 주입 + 포커스(끝으로)
  useEffect(() => {
    if (!editing) return
    const cellEl = cellRefs.current[`${editing.r}-${editing.c}`]
    if (!cellEl) return
    const row = t.cells[editing.r]
    cellEl.textContent = (row && row[editing.c] && row[editing.c].text) || ''
    cellEl.focus()
    const range = document.createRange()
    range.selectNodeContents(cellEl)
    range.collapse(false)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(range)
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // 마운트: 커밋 등록 + 위치 측정. unmount는 텍스트만 flush(StrictMode 대비)
  useEffect(() => {
    committedRef.current = false
    useFlatStore.getState()._setPendingEditCommit(commit)
    const measure = () => { if (wrapRef.current) setRect(wrapRef.current.getBoundingClientRect()) }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      flushActiveToStore()
      useFlatStore.getState()._setPendingEditCommit(null)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥 클릭 → 커밋 (서식 툴바 제외)
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-table-toolbar]')) return
      if (wrapRef.current && !wrapRef.current.contains(e.target)) commit()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [commit])

  // 드래그 종료(셀 선택)
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (!movedRef.current) setEditing({ ...anchorRef.current })
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  const onCellMouseDown = (e, r, c) => {
    const ed = editingRef.current
    if (ed && ed.r === r && ed.c === c) return // 활성 셀 내부 → 네이티브 텍스트 선택
    e.preventDefault()
    flushActiveToStore()
    anchorRef.current = { r, c }
    draggingRef.current = true
    movedRef.current = false
    setSel({ r0: r, c0: c, r1: r, c1: c })
  }

  const onCellEnter = (r, c) => {
    if (!draggingRef.current) return
    if (!movedRef.current) { movedRef.current = true; setEditing(null) }
    const a = anchorRef.current
    setSel({ r0: a.r, c0: a.c, r1: r, c1: c })
  }

  const moveActive = (back) => {
    const ed = editingRef.current || { r: 0, c: 0 }
    const total = t.rows * t.cols
    const idx = (ed.r * t.cols + ed.c + (back ? -1 : 1) + total) % total
    const nr = Math.floor(idx / t.cols), nc = idx % t.cols
    setEditing({ r: nr, c: nc })
    setSel({ r0: nr, c0: nc, r1: nr, c1: nc })
  }

  const onActiveKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(); return }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); flushActiveToStore(); moveActive(e.shiftKey); return }
    e.stopPropagation()
  }

  // ── 선택 영역 서식/정렬/병합 ──
  const mutateTable = (fn, keepSelHead) => {
    flushActiveToStore()
    const cur = useFlatStore.getState().flatElements.find(e => e.id === element.id)
    if (!cur) return
    updateFlatElement(element.id, { table: fn(cur.table) })
    if (keepSelHead) {
      const n = normalizeRange(sel)
      setSel({ r0: n.r0, c0: n.c0, r1: n.r0, c1: n.c0 })
    }
    setEditing(null)
  }

  const applyToSelection = (patch) => mutateTable(tb => applyCellRange(tb, sel, patch))

  const changeFontSize = (delta) => {
    flushActiveToStore()
    const cur = useFlatStore.getState().flatElements.find(e => e.id === element.id)
    if (!cur) return
    const first = rangeFirstCell(cur.table, sel)
    const base = parseFloat(first.fontSize || element.styles.fontSize || '14') || 14
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(base) + delta))
    updateFlatElement(element.id, { table: applyCellRange(cur.table, sel, { fontSize: next + 'px' }) })
    setEditing(null)
  }

  const toggleBold = () => {
    flushActiveToStore()
    const cur = useFlatStore.getState().flatElements.find(e => e.id === element.id)
    if (!cur) return
    const isBold = String(rangeFirstCell(cur.table, sel).fontWeight || 400) === '700'
    updateFlatElement(element.id, { table: applyCellRange(cur.table, sel, { fontWeight: isBold ? 400 : 700 }) })
    setEditing(null)
  }

  const doMerge = () => mutateTable(tb => mergeCells(tb, sel), true)
  const doSplit = () => {
    const n = normalizeRange(sel)
    mutateTable(tb => splitCell(tb, n.r0, n.c0))
  }

  // ── 열/행 경계 드래그 ──
  const startResize = (e, axis, index) => {
    e.preventDefault(); e.stopPropagation()
    flushActiveToStore()
    setEditing(null) // 리사이즈 중 텍스트 편집 종료(활성 셀이 비어 보이는 것 방지)
    const cur = useFlatStore.getState().flatElements.find(el => el.id === element.id)
    const r = wrapRef.current.getBoundingClientRect()
    resizeRef.current = { axis, index, startX: e.clientX, startY: e.clientY, orig: cur.table, w: r.width, h: r.height }
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', endResize)
  }
  const onResizeMove = (e) => {
    const rs = resizeRef.current
    if (!rs) return
    const next = rs.axis === 'col'
      ? resizeColumn(rs.orig, rs.index, (e.clientX - rs.startX) / rs.w)
      : resizeRow(rs.orig, rs.index, (e.clientY - rs.startY) / rs.h)
    useFlatStore.getState().previewFlatElement(element.id, { table: next })
  }
  const endResize = () => {
    const rs = resizeRef.current
    resizeRef.current = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', endResize)
    if (!rs) return
    const cur = useFlatStore.getState().flatElements.find(el => el.id === element.id)
    const finalTable = cur.table
    // 히스토리에 올바른 old/new 기록: 원본 복원 후 최종값으로 update
    useFlatStore.getState().previewFlatElement(element.id, { table: rs.orig })
    updateFlatElement(element.id, { table: finalTable })
  }

  // 경계 위치(누적 분수)
  const colBounds = []
  { let acc = 0; for (let i = 0; i < t.cols - 1; i++) { acc += t.colFractions[i]; colBounds.push(acc) } }
  const rowBounds = []
  { let acc = 0; for (let i = 0; i < t.rows - 1; i++) { acc += t.rowFractions[i]; rowBounds.push(acc) } }

  const wrapStyle = {
    position: 'absolute', left: element.x, top: element.y,
    width: element.width, height: element.height, zIndex: 10001,
    boxSizing: 'border-box',
    outline: '2px solid rgba(99, 102, 241, 0.8)', outlineOffset: -1,
    background: element.styles?.backgroundColor || '#ffffff',
  }

  const n = normalizeRange(sel)
  const headMerged = isMerged(t, n.r0, n.c0)
  const mergeable = canMerge(sel) && !headMerged

  return (
    <>
      <div ref={wrapRef} style={wrapStyle} onMouseDown={(e) => e.stopPropagation()}>
        <table style={tableContainerStyle(element.styles)}>
          <colgroup>
            {t.colFractions.map((f, c) => <col key={c} style={{ width: `${f * 100}%` }} />)}
          </colgroup>
          <tbody>
            {t.cells.map((row, r) => (
              <tr key={r} style={{ height: `${t.rowFractions[r] * 100}%` }}>
                {row.map((cell, c) => {
                  if (cell.covered) return null
                  const isActive = editing && editing.r === r && editing.c === c
                  const selected = inRange(r, c)
                  return (
                    <td
                      key={c}
                      ref={(el) => { cellRefs.current[`${r}-${c}`] = el }}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      contentEditable={isActive || undefined}
                      suppressContentEditableWarning
                      style={{
                        ...cellStyle(t, r, c, element.styles),
                        outline: 'none',
                        cursor: isActive ? 'text' : 'cell',
                        ...(selected ? { boxShadow: 'inset 0 0 0 2px rgba(99,102,241,0.9), inset 0 0 0 200px rgba(99,102,241,0.12)' } : {}),
                      }}
                      onMouseDown={(e) => onCellMouseDown(e, r, c)}
                      onMouseEnter={() => onCellEnter(r, c)}
                      onDoubleClick={() => setEditing({ r, c })}
                      onKeyDown={isActive ? onActiveKeyDown : undefined}
                    >
                      {isActive ? null : (cell.text || '')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 열 경계 핸들 */}
        {colBounds.map((b, i) => (
          <div key={`c${i}`} title="열 너비 조정"
            onMouseDown={(e) => startResize(e, 'col', i)}
            style={{ position: 'absolute', top: 0, left: `calc(${b * 100}% - 3px)`, width: 6, height: '100%', cursor: 'col-resize', zIndex: 5 }} />
        ))}
        {/* 행 경계 핸들 */}
        {rowBounds.map((b, i) => (
          <div key={`r${i}`} title="행 높이 조정"
            onMouseDown={(e) => startResize(e, 'row', i)}
            style={{ position: 'absolute', left: 0, top: `calc(${b * 100}% - 3px)`, height: 6, width: '100%', cursor: 'row-resize', zIndex: 5 }} />
        ))}
      </div>

      {rect && createPortal(
        <CellFormatToolbar
          rect={rect}
          mergeable={mergeable}
          splittable={headMerged}
          onBg={(v) => applyToSelection({ bg: v })}
          onColor={(v) => applyToSelection({ color: v })}
          onFont={changeFontSize}
          onBold={toggleBold}
          onBorder={(v) => applyToSelection({ border: { color: v, width: 1 } })}
          onBorderNone={() => applyToSelection({ border: { width: 0 } })}
          onAlign={(v) => applyToSelection({ align: v })}
          onValign={(v) => applyToSelection({ valign: v })}
          onMerge={doMerge}
          onSplit={doSplit}
        />,
        document.body,
      )}
    </>
  )
}

// ── 셀 서식 툴바 ───────────────────────────────────
function CellFormatToolbar({ rect, mergeable, splittable, onBg, onColor, onFont, onBold, onBorder, onBorderNone, onAlign, onValign, onMerge, onSplit }) {
  const H = 40
  let top = rect.top - H - 8
  if (top < 8) top = rect.bottom + 8
  const left = Math.max(8, Math.min(window.innerWidth - 540, rect.left))
  const keep = (fn) => (e) => { e.preventDefault(); fn() }

  return (
    <div
      data-table-toolbar="true"
      style={{
        position: 'fixed', top, left, zIndex: 10060,
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px',
        background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 9, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
        maxWidth: '94vw', flexWrap: 'wrap',
      }}
    >
      <Group label="배경">
        {CELL_BG_SWATCHES.map(c => <Sw key={c} color={c} onMouseDown={keep(() => onBg(c))} />)}
        <TxtBtn onMouseDown={keep(() => onBg(undefined))} title="배경 없음">✕</TxtBtn>
      </Group>
      <Sep />
      <Group label="글자">
        {CELL_TEXT_SWATCHES.map(c => <Sw key={c} color={c} round onMouseDown={keep(() => onColor(c))} />)}
      </Group>
      <Sep />
      <TxtBtn onMouseDown={keep(() => onFont(-FONT_STEP))} title="글자 작게">A−</TxtBtn>
      <TxtBtn onMouseDown={keep(() => onFont(FONT_STEP))} title="글자 크게">A+</TxtBtn>
      <TxtBtn onMouseDown={keep(onBold)} title="굵게" style={{ fontWeight: 800 }}>B</TxtBtn>
      <Sep />
      <Group label="정렬">
        <TxtBtn onMouseDown={keep(() => onAlign('left'))} title="왼쪽">⬅</TxtBtn>
        <TxtBtn onMouseDown={keep(() => onAlign('center'))} title="가운데">↔</TxtBtn>
        <TxtBtn onMouseDown={keep(() => onAlign('right'))} title="오른쪽">➡</TxtBtn>
        <TxtBtn onMouseDown={keep(() => onValign('top'))} title="위">⬆</TxtBtn>
        <TxtBtn onMouseDown={keep(() => onValign('middle'))} title="중간">↕</TxtBtn>
        <TxtBtn onMouseDown={keep(() => onValign('bottom'))} title="아래">⬇</TxtBtn>
      </Group>
      <Sep />
      <Group label="테두리">
        {CELL_BORDER_SWATCHES.map(c => <Sw key={c} color={c} onMouseDown={keep(() => onBorder(c))} />)}
        <TxtBtn onMouseDown={keep(onBorderNone)} title="테두리 없음">✕</TxtBtn>
      </Group>
      <Sep />
      <TxtBtn onMouseDown={keep(onMerge)} title="셀 병합" disabled={!mergeable}
        style={{ opacity: mergeable ? 1 : 0.35, padding: '0 8px' }}>병합</TxtBtn>
      <TxtBtn onMouseDown={keep(onSplit)} title="병합 해제" disabled={!splittable}
        style={{ opacity: splittable ? 1 : 0.35, padding: '0 8px' }}>분할</TxtBtn>
    </div>
  )
}

function Group({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 2 }}>{label}</span>
      {children}
    </div>
  )
}
function Sw({ color, round, onMouseDown }) {
  return (
    <button type="button" onMouseDown={onMouseDown} title={color}
      style={{ width: 15, height: 15, padding: 0, borderRadius: round ? '50%' : 3,
        border: '1px solid rgba(255,255,255,0.3)', background: color, cursor: 'pointer' }} />
  )
}
function TxtBtn({ children, onMouseDown, title, style, disabled }) {
  return (
    <button type="button" onMouseDown={disabled ? undefined : onMouseDown} title={title} disabled={disabled}
      style={{ minWidth: 24, height: 24, padding: '0 5px', borderRadius: 5, border: 'none',
        cursor: disabled ? 'default' : 'pointer', fontSize: 12, lineHeight: 1, color: '#e2e8f0',
        background: 'rgba(255,255,255,0.08)', ...style }}>
      {children}
    </button>
  )
}
function Sep() {
  return <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)' }} />
}
