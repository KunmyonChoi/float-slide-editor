import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

function el(id, extra = {}) {
  return { id, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: '', styles: {}, ...extra }
}

describe('flat 그룹 기능', () => {
  beforeEach(() => {
    useFlatStore.setState({
      flatElements: [el('a'), el('b'), el('c'), el('d')],
      selectedFlatIds: [],
    })
  })

  it('groupSelected: 2개 이상 선택 시 같은 groupId 부여', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a', 'b'])
    s.groupSelected()
    const els = useFlatStore.getState().flatElements
    const ga = els.find(e => e.id === 'a').groupId
    const gb = els.find(e => e.id === 'b').groupId
    expect(ga).toBeTruthy()
    expect(ga).toBe(gb)
    expect(els.find(e => e.id === 'c').groupId).toBeUndefined()
  })

  it('groupSelected: 1개 이하면 무시', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a'])
    s.groupSelected()
    expect(useFlatStore.getState().flatElements.find(e => e.id === 'a').groupId).toBeUndefined()
  })

  it('selectFlatGroupAware: 그룹 요소 클릭 시 그룹 전체 선택', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a', 'b'])
    s.groupSelected()
    s.setSelectedFlats([])
    s.selectFlatGroupAware('a', false) // a 클릭 → a,b 모두
    expect(new Set(useFlatStore.getState().selectedFlatIds)).toEqual(new Set(['a', 'b']))
  })

  it('selectFlatGroupAware: 비그룹 요소는 단독 선택', () => {
    useFlatStore.getState().selectFlatGroupAware('c', false)
    expect(useFlatStore.getState().selectedFlatIds).toEqual(['c'])
  })

  it('ungroupSelected: 선택된 그룹 해제', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a', 'b'])
    s.groupSelected()
    // 그룹 멤버 하나만 선택해도 그룹 전체 해제
    s.setSelectedFlats(['a', 'b'])
    s.ungroupSelected()
    const els = useFlatStore.getState().flatElements
    expect(els.find(e => e.id === 'a').groupId).toBeNull()
    expect(els.find(e => e.id === 'b').groupId).toBeNull()
  })

  it('expandSelectionToGroups: 그룹 일부만 잡혀도 전체 포함', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a', 'b'])
    s.groupSelected()
    const expanded = s.expandSelectionToGroups(['a']) // a만 → a,b
    expect(new Set(expanded)).toEqual(new Set(['a', 'b']))
  })

  it('그룹/해제는 단일 undo 단위', () => {
    const s = useFlatStore.getState()
    s.setSelectedFlats(['a', 'b'])
    s.groupSelected()
    expect(useFlatStore.getState().flatElements.find(e => e.id === 'a').groupId).toBeTruthy()
    useFlatStore.getState().undo()
    expect(useFlatStore.getState().flatElements.find(e => e.id === 'a').groupId).toBeUndefined()
  })
})
