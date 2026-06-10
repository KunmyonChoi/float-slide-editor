import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import {
  tableContainerStyle, cellStyle, setCellText,
  normalizeRange, applyCellRange, rangeFirstCell,
} from '../core/slideTable'

const CELL_BG_SWATCHES = ['#ffffff', '#f1f5f9', '#fee2e2', '#fef9c3', '#dcfce7', '#dbeafe', '#f3e8ff', '#fce7f3']
const CELL_TEXT_SWATCHES = ['#0f172a', '#475569', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
const CELL_BORDER_SWATCHES = ['#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#ef4444', '#3b82f6']
const FONT_MIN = 8, FONT_MAX = 96, FONT_STEP = 2

/**
 * FlatTableEditor
 * 표 편집 — 셀 텍스트 편집 + 셀 범위 선택 후 서식(배경/글자색/크기/두께/테두리).
 * - 셀 클릭: 해당 셀 텍스트 편집(활성 셀, contentEditable)
 * - 셀 드래그: 범위 선택(서식 대상)
 * - Tab/Shift+Tab: 셀 이동, Enter: 줄바꿈, Esc·바깥클릭: 커밋
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

  const [sel, setSel] = useState({ r0: 0, c0: 0, r1: 0, c1: 0 })
  const [editing, setEditing] = useState({ r: 0, c: 0 })
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [rect, setRect] = useState(null)

  const inRange = useCallback((r, c) => {
    const n = normalizeRange(sel)
    return r >= n.r0 && r <= n.r1 && c >= n.c0 && c <= n.c1
  }, [sel])

  // 활성 셀의 DOM 텍스트를 스토어에 반영(변경 시에만)
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

  // 마운트: 커밋 등록 + 위치 측정. unmount는 텍스트만 flush(편집상태 유지: StrictMode 대비)
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

  // 바깥 클릭 → 커밋 (서식 툴바 클릭은 제외)
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('[data-table-toolbar]')) return
      if (wrapRef.current && !wrapRef.current.contains(e.target)) commit()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [commit])

  // 드래그 종료 처리
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (!movedRef.current) setEditing({ ...anchorRef.current }) // 클릭 → 셀 편집
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
    if (!movedRef.current) { movedRef.current = true; setEditing(null) } // 드래그 시작 → 텍스트편집 해제
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

  // ── 선택 영역 서식 ──
  const applyToSelection = (patch) => {
    flushActiveToStore()
    const cur = useFlatStore.getState().flatElements.find(e => e.id === element.id)
    if (!cur) return
    updateFlatElement(element.id, { table: applyCellRange(cur.table, sel, patch) })
    setEditing(null) // 서식 후 셀-선택 유지(텍스트 편집 종료)
  }

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
    const first = rangeFirstCell(cur.table, sel)
    const isBold = String(first.fontWeight || 400) === '700'
    updateFlatElement(element.id, { table: applyCellRange(cur.table, sel, { fontWeight: isBold ? 400 : 700 }) })
    setEditing(null)
  }

  const wrapStyle = {
    position: 'absolute', left: element.x, top: element.y,
    width: element.width, height: element.height, zIndex: 10001,
    boxSizing: 'border-box',
    outline: '2px solid rgba(99, 102, 241, 0.8)', outlineOffset: -1,
    background: element.styles?.backgroundColor || '#ffffff',
  }

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
                  const isActive = editing && editing.r === r && editing.c === c
                  const selected = inRange(r, c)
                  return (
                    <td
                      key={c}
                      ref={(el) => { cellRefs.current[`${r}-${c}`] = el }}
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
      </div>

      {rect && createPortal(
        <CellFormatToolbar
          rect={rect}
          onBg={(v) => applyToSelection({ bg: v })}
          onColor={(v) => applyToSelection({ color: v })}
          onFont={changeFontSize}
          onBold={toggleBold}
          onBorder={(v) => applyToSelection({ border: { color: v, width: 1 } })}
          onBorderNone={() => applyToSelection({ border: { width: 0 } })}
        />,
        document.body,
      )}
    </>
  )
}

// ── 셀 서식 툴바 (선택 영역에 적용) ───────────────────
function CellFormatToolbar({ rect, onBg, onColor, onFont, onBold, onBorder, onBorderNone }) {
  const H = 40
  let top = rect.top - H - 8
  if (top < 8) top = rect.bottom + 8
  const left = Math.max(8, Math.min(window.innerWidth - 360, rect.left))
  const keep = (fn) => (e) => { e.preventDefault(); fn() }

  return (
    <div
      data-table-toolbar="true"
      style={{
        position: 'fixed', top, left, zIndex: 10060,
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
        background: 'rgba(15,23,42,0.97)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 9, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
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
      <Group label="테두리">
        {CELL_BORDER_SWATCHES.map(c => <Sw key={c} color={c} onMouseDown={keep(() => onBorder(c))} />)}
        <TxtBtn onMouseDown={keep(onBorderNone)} title="테두리 없음">✕</TxtBtn>
      </Group>
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
function TxtBtn({ children, onMouseDown, title, style }) {
  return (
    <button type="button" onMouseDown={onMouseDown} title={title}
      style={{ minWidth: 24, height: 24, padding: '0 5px', borderRadius: 5, border: 'none',
        cursor: 'pointer', fontSize: 12, lineHeight: 1, color: '#e2e8f0',
        background: 'rgba(255,255,255,0.08)', ...style }}>
      {children}
    </button>
  )
}
function Sep() {
  return <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)' }} />
}
