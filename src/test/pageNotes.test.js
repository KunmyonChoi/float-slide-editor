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

describe('가라오케 자막(STT) — 페이지별 저장·음성 교체 시 무효화', () => {
  beforeEach(() => { load(['A', 'B', 'C'], '0-0') })

  const CAPTIONS = { text: '안녕하세요', words: [{ word: '안녕하세요', start: 0, end: 0.8 }], forRef: 'idb://a0' }

  it('setPageNotesCaptions로 현재 페이지 자막 설정 + getAllPages 라운드트립', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    useFlatStore.getState().setPageNotesCaptions(CAPTIONS)
    expect(useFlatStore.getState().pageNotesCaptions).toEqual(CAPTIONS)
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['0-0'].notesCaptions).toEqual(CAPTIONS)
  })

  it('페이지 전환 시 자막이 페이지별로 보존된다', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    useFlatStore.getState().setPageNotesCaptions(CAPTIONS)
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull() // B는 자막 없음
    useFlatStore.getState().goToFlatPage(0)
    expect(useFlatStore.getState().pageNotesCaptions).toEqual(CAPTIONS) // A 복원
  })

  it('음성을 새로 설정(setPageNotesAudio)하면 기존 자막은 자동으로 사라진다 — "음성 교체 전까지만 유지"', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    useFlatStore.getState().setPageNotesCaptions(CAPTIONS)
    expect(useFlatStore.getState().pageNotesCaptions).toEqual(CAPTIONS)

    useFlatStore.getState().setPageNotesAudio('idb://a1-새음성', 'h1') // 음성 재생성/재업로드
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull()
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['0-0'].notesCaptions).toBeNull()
  })

  it('음성을 삭제(null)해도 자막이 함께 지워진다', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    useFlatStore.getState().setPageNotesCaptions(CAPTIONS)
    useFlatStore.getState().setPageNotesAudio(null, '')
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull()
  })

  it('applyAudioToPages(일괄 음성 재생성)는 대상 페이지들의 기존 자막도 함께 지운다', () => {
    useFlatStore.getState().setPageNotesAudio('idb://a0', 'h0')
    useFlatStore.getState().setPageNotesCaptions(CAPTIONS)
    useFlatStore.getState().goToFlatPage(2)
    useFlatStore.getState().setPageNotesAudio('idb://c0', 'hc')
    useFlatStore.getState().setPageNotesCaptions({ text: 'C', words: [], forRef: 'idb://c0' })
    useFlatStore.getState().goToFlatPage(0)

    useFlatStore.getState().applyAudioToPages({ '0-0': { ref: 'idb://new-a', hash: 'ha2' }, '2-0': { ref: 'idb://new-c', hash: 'hc2' } })
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull() // 현재(0-0)도 함께 무효화
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['2-0'].notesCaptions).toBeNull()
  })

  it('loadAllPages가 저장된 자막을 복원(프로젝트 파일 라운드트립)', () => {
    const data = {
      '0-0': { ...page('A'), notes: '', notesAudio: 'idb://a0', notesCaptions: CAPTIONS },
      '1-0': { ...page('B'), notes: '' },
    }
    useFlatStore.getState().loadAllPages(data, '0-0')
    expect(useFlatStore.getState().pageNotesCaptions).toEqual(CAPTIONS)
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull()
  })

  it('구버전 프로젝트(notesCaptions 필드 없음)를 열어도 에러 없이 null', () => {
    const data = { '0-0': { ...page('A'), notes: '' } } // notesCaptions 아예 없음
    useFlatStore.getState().loadAllPages(data, '0-0')
    expect(useFlatStore.getState().pageNotesCaptions).toBeNull()
  })

  it('_pageCache에 없는(편집기에서 한 번도 방문 안 한) 페이지도 hydrateFrom으로 캐시 항목을 만들어 자막을 저장한다', () => {
    // '5-0'은 _pageCache에 없는 페이지(발표 중 백그라운드 프리페치가 만나는 상황을 흉내)
    const snapshot = { elements: [], canvasSize: CS, fontImports: [], notesAudio: 'idb://z9' }
    useFlatStore.getState().setPageNotesCaptions({ text: 'Z', words: [], forRef: 'idb://z9' }, '5-0', snapshot)
    const { pages } = useFlatStore.getState().getAllPages()
    expect(pages['5-0'].notesCaptions).toEqual({ text: 'Z', words: [], forRef: 'idb://z9' })
    expect(pages['5-0'].notesAudio).toBe('idb://z9') // hydrate가 나머지 필드도 함께 채움
  })
})
