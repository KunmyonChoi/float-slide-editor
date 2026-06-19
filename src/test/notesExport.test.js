import { describe, it, expect } from 'vitest'
import { pagesToDeck, deckToInternalPages } from '../../packages/slide-contract/adapters.js'

const CS = { w: 1280, h: 720 }
const el = () => ({ type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: '', styles: {} })

describe('발표자 노트 → PPTX export 경로(공개 계약)', () => {
  it('pagesToDeck가 페이지 notes를 deck에 담는다(있을 때만)', () => {
    const pages = {
      '0-0': { elements: [el()], canvasSize: CS, notes: '노트 A' },
      '1-0': { elements: [el()], canvasSize: CS, notes: '' },
    }
    const deck = pagesToDeck(pages, CS)
    expect(deck.pages[0].notes).toBe('노트 A')
    expect(deck.pages[1].notes).toBeUndefined() // 빈 노트는 생략
  })

  it('deckToInternalPages가 notes를 복원한다', () => {
    const deck = {
      canvasSize: CS,
      pages: [
        { elements: [el()], canvasSize: CS, notes: '노트 A' },
        { elements: [el()], canvasSize: CS },
      ],
    }
    const { pages } = deckToInternalPages(deck)
    expect(pages['0-0'].notes).toBe('노트 A')
    expect(pages['1-0'].notes).toBe('') // 없으면 빈 문자열
  })

  it('라운드트립: 내부 pages → deck → 내부 pages 에서 notes 보존', () => {
    const pages = { '0-0': { elements: [el()], canvasSize: CS, notes: '발표 노트' } }
    const { pages: back } = deckToInternalPages(pagesToDeck(pages, CS))
    expect(back['0-0'].notes).toBe('발표 노트')
  })
})
