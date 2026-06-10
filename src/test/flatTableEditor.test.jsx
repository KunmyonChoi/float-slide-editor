import { describe, it, expect, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import FlatTableEditor from '../components/FlatTableEditor'
import { useFlatStore } from '../store/flatStore'
import { createTableElement } from '../core/slideTable'

function makeTableEl() {
  return {
    id: 'tbl-1', sourceId: null, rotation: 0, zIndex: 5,
    x: 50, y: 60, ...createTableElement(2, 2, { w: 1280, h: 720 }),
  }
}

describe('FlatTableEditor — 마운트/셀편집/커밋', () => {
  beforeEach(() => {
    const el = makeTableEl()
    useFlatStore.setState({ flatElements: [el], editingFlatId: el.id, selectedFlatIds: [el.id] })
  })

  it('편집기가 throw 없이 마운트 — 4셀 렌더, 활성 셀만 편집 가능', () => {
    const el = useFlatStore.getState().flatElements[0]
    const { container } = render(<FlatTableEditor element={el} />)
    expect(container.querySelectorAll('td').length).toBe(4) // 2×2
    expect(container.querySelectorAll('td[contenteditable="true"]').length).toBe(1) // 활성 셀(0,0)
  })

  it('StrictMode 마운트 직후에도 편집 상태가 유지됨(편집기가 사라지지 않음)', () => {
    // 회귀: cleanup이 commit()으로 setEditingFlat(null)을 호출하면 편집기가 즉시 사라졌음
    const el = useFlatStore.getState().flatElements[0]
    act(() => {
      render(<StrictMode><FlatTableEditor element={el} /></StrictMode>)
    })
    expect(useFlatStore.getState().editingFlatId).toBe('tbl-1')
  })

  it('활성 셀 입력 후 Escape 커밋 시 store의 table이 갱신되고 편집 종료', () => {
    const el = useFlatStore.getState().flatElements[0]
    const { container } = render(<FlatTableEditor element={el} />)
    const active = container.querySelector('td[contenteditable="true"]') // (0,0)

    act(() => {
      active.textContent = '머리글'
      fireEvent.keyDown(active, { key: 'Escape' })
    })

    const updated = useFlatStore.getState().flatElements.find(e => e.id === 'tbl-1')
    expect(updated.table.cells[0][0].text).toBe('머리글')
    expect(useFlatStore.getState().editingFlatId).toBe(null)
  })
})
