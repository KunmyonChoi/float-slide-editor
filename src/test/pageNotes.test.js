import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

const CS = { w: 1280, h: 720 }
function page(tag) {
  return { elements: [{ id: tag, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: '', styles: {} }], canvasSize: CS, htmlSlideIndex: null }
}
function load(tags, currentKey, notesByKey = {}) {
  const data = {}
  tags.forEach((t, i) => {
    data[`${i}-0`] = { ...page(t), notes: notesByKey[`${i}-0`] || '' }
  })
  useFlatStore.getState().loadAllPages(data, currentKey)
}

describe('발표자 노트(페이지별)', () => {
  beforeEach(() => { load(['A', 'B', 'C'], '0-0') })

  it('setPageNotes로 현재 페이지 노트 설정', () => {
    useFlatStore.getState().setPageNotes('첫 슬라이드 노트')
    expect(useFlatStore.getState().pageNotes).toBe('첫 슬라이드 노트')
  })

  it('페이지 전환 시 노트가 페이지별로 보존된다', () => {
    useFlatStore.getState().setPageNotes('A의 노트')
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotes).toBe('') // B는 비어 있음
    useFlatStore.getState().setPageNotes('B의 노트')
    useFlatStore.getState().goToFlatPage(0)
    expect(useFlatStore.getState().pageNotes).toBe('A의 노트') // A 복원
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotes).toBe('B의 노트') // B 복원
  })

  it('loadAllPages가 저장된 노트를 복원', () => {
    load(['A', 'B'], '1-0', { '0-0': 'a-note', '1-0': 'b-note' })
    expect(useFlatStore.getState().pageNotes).toBe('b-note') // 현재=1-0
    useFlatStore.getState().goToFlatPage(0)
    expect(useFlatStore.getState().pageNotes).toBe('a-note')
  })

  it('getAllPages가 노트를 포함(저장 라운드트립)', () => {
    useFlatStore.getState().setPageNotes('현재 노트')
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['0-0'].notes).toBe('현재 노트')
  })

  it('notesCollapsed 토글', () => {
    const before = useFlatStore.getState().notesCollapsed
    useFlatStore.getState().toggleNotesCollapsed()
    expect(useFlatStore.getState().notesCollapsed).toBe(!before)
  })

  it('노트 음성(idb 참조+해시) 페이지별 저장·전환 보존·직렬화', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    expect(useFlatStore.getState().pageNotesAudio).toBe('idb://a0')
    // 페이지 전환 시 보존
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotesAudio).toBeNull()
    useFlatStore.getState().goToFlatPage(0)
    expect(useFlatStore.getState().pageNotesAudio).toBe('idb://a0')
    expect(useFlatStore.getState().pageNotesAudioHash).toBe('h0')
    // getAllPages에 포함
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['0-0'].notesAudio).toBe('idb://a0')
    expect(pages['0-0'].notesAudioHash).toBe('h0')
  })

  it('applyAudioToPages 일괄 적용', () => {
    useFlatStore.getState().applyAudioToPages({ '0-0': { ref: 'idb://x', hash: 'hx' }, '2-0': { ref: 'idb://z', hash: 'hz' } })
    expect(useFlatStore.getState().pageNotesAudio).toBe('idb://x') // 현재=0-0
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['2-0'].notesAudio).toBe('idb://z')
  })
})
