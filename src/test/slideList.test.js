import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

const CS = { w: 1280, h: 720 }
function page(tag) {
  return { elements: [{ id: tag, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: '', styles: {} }], canvasSize: CS, htmlSlideIndex: null }
}
function load(tags, currentKey) {
  const data = {}
  tags.forEach((t, i) => { data[`${i}-0`] = page(t) })
  useFlatStore.getState().loadAllPages(data, currentKey)
}
const tagsOf = () => useFlatStore.getState().getFlatPageList().map(p => p.elements[0]?.id)

describe('getFlatPageList', () => {
  beforeEach(() => { load(['A', 'B', 'C'], '1-0') })

  it('순서·인덱스·현재 페이지 플래그', () => {
    const list = useFlatStore.getState().getFlatPageList()
    expect(list.map(p => p.index)).toEqual([0, 1, 2])
    expect(list.map(p => p.elements[0].id)).toEqual(['A', 'B', 'C'])
    expect(list.find(p => p.isCurrent).index).toBe(1)
  })

  it('현재 페이지는 라이브 flatElements 사용', () => {
    // 라이브 상태를 바꾸면 현재 페이지(index 1) 썸네일 데이터도 바뀜
    const live = [{ id: 'LIVE', type: 'shape', x: 0, y: 0, width: 1, height: 1, zIndex: 1, content: '', styles: {} }]
    useFlatStore.setState({ flatElements: live })
    const list = useFlatStore.getState().getFlatPageList()
    expect(list[1].elements[0].id).toBe('LIVE')   // 현재=라이브
    expect(list[0].elements[0].id).toBe('A')        // 그 외=캐시
  })

  it('부작용 없음(_saveCurrentPage 호출 안 함) — 호출 후에도 순서 동일', () => {
    const before = useFlatStore.getState().flatCurrentPage
    useFlatStore.getState().getFlatPageList()
    expect(useFlatStore.getState().flatCurrentPage).toBe(before)
    expect(tagsOf()).toEqual(['A', 'B', 'C'])
  })
})

describe('reorderPage', () => {
  it('다른 페이지를 끝으로 이동, 현재 페이지 추적', () => {
    load(['A', 'B', 'C'], '1-0') // current = B
    useFlatStore.getState().reorderPage(0, 2) // A → 끝
    expect(tagsOf()).toEqual(['B', 'C', 'A'])
    const list = useFlatStore.getState().getFlatPageList()
    expect(list.find(p => p.isCurrent).elements[0].id).toBe('B') // 여전히 B가 현재
    expect(useFlatStore.getState().flatCurrentPage).toBe(0)       // B는 이제 index 0
  })

  it('현재 페이지 자체를 이동', () => {
    load(['A', 'B', 'C'], '0-0') // current = A
    useFlatStore.getState().reorderPage(0, 2) // A(현재) → 끝
    expect(tagsOf()).toEqual(['B', 'C', 'A'])
    expect(useFlatStore.getState().flatCurrentPage).toBe(2)
    expect(useFlatStore.getState().getFlatPageList().find(p => p.isCurrent).elements[0].id).toBe('A')
  })

  it('범위 밖/동일 인덱스는 무시', () => {
    load(['A', 'B', 'C'], '0-0')
    useFlatStore.getState().reorderPage(1, 1)
    expect(tagsOf()).toEqual(['A', 'B', 'C'])
    useFlatStore.getState().reorderPage(0, 9)
    expect(tagsOf()).toEqual(['A', 'B', 'C'])
  })

  it('중간 삽입(앞쪽 → 뒤쪽 사이)', () => {
    load(['A', 'B', 'C', 'D'], '0-0')
    useFlatStore.getState().reorderPage(1, 2) // B를 C 뒤로
    expect(tagsOf()).toEqual(['A', 'C', 'B', 'D'])
  })
})
