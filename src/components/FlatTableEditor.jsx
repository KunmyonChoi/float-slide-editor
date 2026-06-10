import { useRef, useEffect, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { tableContainerStyle, cellStyle, setAllCellTexts } from '../core/slideTable'

/**
 * FlatTableEditor
 * 표 요소 편집 모드 — 각 셀을 contentEditable로 겹쳐 인라인 편집.
 * Tab/Shift+Tab으로 셀 이동, Enter는 셀 내 줄바꿈, Escape·바깥 클릭으로 커밋.
 */
export default function FlatTableEditor({ element }) {
  const { updateFlatElement, setEditingFlat } = useFlatStore()
  const t = element.table
  const cellRefs = useRef({})        // `${r}-${c}` → td DOM
  const committedRef = useRef(false)
  const wrapRef = useRef(null)

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const texts = t.cells.map((row, r) => row.map((cell, c) => {
      const el = cellRefs.current[`${r}-${c}`]
      return el ? el.innerText.replace(/\n$/, '') : cell.text
    }))
    updateFlatElement(element.id, { table: setAllCellTexts(t, texts) })
    setEditingFlat(null)
  }, [element.id, t, updateFlatElement, setEditingFlat])

  // 마운트: 셀 텍스트 주입 + 첫 셀 포커스 + 페이지 이동 시 커밋 등록
  useEffect(() => {
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const el = cellRefs.current[`${r}-${c}`]
        if (el) el.textContent = t.cells[r][c].text || ''
      }
    }
    const first = cellRefs.current['0-0']
    if (first) {
      first.focus()
      const range = document.createRange()
      range.selectNodeContents(first)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    committedRef.current = false
    useFlatStore.getState()._setPendingEditCommit(commit)
    return () => {
      commit()
      useFlatStore.getState()._setPendingEditCommit(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥 클릭 → 커밋
  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) commit()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [commit])

  const focusCell = useCallback((r, c) => {
    const el = cellRefs.current[`${r}-${c}`]
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  const focusAdjacent = useCallback((back) => {
    const active = document.activeElement
    let cur = null
    for (const key in cellRefs.current) {
      if (cellRefs.current[key] === active) { cur = key; break }
    }
    if (!cur) return
    const [r, c] = cur.split('-').map(Number)
    const total = t.rows * t.cols
    let idx = (r * t.cols + c + (back ? -1 : 1) + total) % total
    focusCell(Math.floor(idx / t.cols), idx % t.cols)
  }, [t.rows, t.cols, focusCell])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); commit(); return
    }
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation(); focusAdjacent(e.shiftKey); return
    }
    e.stopPropagation() // 캔버스로 전파 차단(삭제 단축키 등)
  }, [commit, focusAdjacent])

  const wrapStyle = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    zIndex: 10001,
    boxSizing: 'border-box',
    outline: '2px solid rgba(99, 102, 241, 0.8)',
    outlineOffset: -1,
    background: element.styles?.backgroundColor || '#ffffff',
  }

  return (
    <div ref={wrapRef} style={wrapStyle} onMouseDown={(e) => e.stopPropagation()}>
      <table style={tableContainerStyle(element.styles)}>
        <colgroup>
          {t.colFractions.map((f, c) => <col key={c} style={{ width: `${f * 100}%` }} />)}
        </colgroup>
        <tbody>
          {t.cells.map((row, r) => (
            <tr key={r} style={{ height: `${t.rowFractions[r] * 100}%` }}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  ref={(el) => { cellRefs.current[`${r}-${c}`] = el }}
                  contentEditable
                  suppressContentEditableWarning
                  style={{ ...cellStyle(t, r, c, element.styles), cursor: 'text', outline: 'none' }}
                  onKeyDown={onKeyDown}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
