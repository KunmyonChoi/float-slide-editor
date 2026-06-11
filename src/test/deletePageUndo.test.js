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

describe('페이지 삭제 + 실행취소(복구)', () => {
  beforeEach(() => { load(['A', 'B', 'C'], '1-0') }) // 현재 = B(index 1)

  it('deletePage: 현재 페이지 삭제 + 복구 토스트 상태 설정', () => {
    useFlatStore.getState().deletePage()
    expect(tagsOf()).toEqual(['A', 'C'])
    expect(useFlatStore.getState().flatPageCount).toBe(2)
    expect(useFlatStore.getState().pageDeleteNotice).toBeTruthy()
  })

  it('restoreDeletedPage: 삭제한 페이지를 원래 위치에 복원', () => {
    useFlatStore.getState().deletePage() // B 삭제 → [A, C]
    useFlatStore.getState().restoreDeletedPage()
    expect(tagsOf()).toEqual(['A', 'B', 'C']) // 원래 위치(index 1)에 복원
    expect(useFlatStore.getState().pageDeleteNotice).toBe(null)
  })

  it('첫/끝 페이지 삭제·복구도 위치 유지', () => {
    load(['A', 'B', 'C'], '0-0')
    useFlatStore.getState().deletePage() // A 삭제 → [B, C]
    expect(tagsOf()).toEqual(['B', 'C'])
    useFlatStore.getState().restoreDeletedPage()
    expect(tagsOf()).toEqual(['A', 'B', 'C'])
  })

  it('dismiss 후에는 복구 불가(stash 비움)', () => {
    useFlatStore.getState().deletePage()
    useFlatStore.getState().dismissPageDeleteNotice()
    expect(useFlatStore.getState().pageDeleteNotice).toBe(null)
    useFlatStore.getState().restoreDeletedPage() // no-op
    expect(tagsOf()).toEqual(['A', 'C'])
  })

  it('마지막 1장은 삭제 불가', () => {
    load(['only'], '0-0')
    useFlatStore.getState().deletePage()
    expect(tagsOf()).toEqual(['only'])
  })
})
