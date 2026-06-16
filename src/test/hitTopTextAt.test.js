import { describe, it, expect } from 'vitest'
import { hitTopTextAt } from '../components/FlatSelectionOverlay'

const els = [
  { id: 'bg', type: 'shape', x: 0, y: 0, width: 200, height: 100, zIndex: 0 },
  { id: 't1', type: 'text', x: 10, y: 10, width: 80, height: 30, zIndex: 1 },
  { id: 't2', type: 'text', x: 10, y: 50, width: 80, height: 30, zIndex: 2 },
  { id: 'overlapLow', type: 'text', x: 100, y: 10, width: 60, height: 60, zIndex: 1 },
  { id: 'overlapHigh', type: 'text', x: 110, y: 20, width: 30, height: 30, zIndex: 5 },
]

describe('hitTopTextAt', () => {
  it('지점의 텍스트 요소 반환', () => {
    expect(hitTopTextAt(els, 20, 20).id).toBe('t1')
    expect(hitTopTextAt(els, 20, 60).id).toBe('t2')
  })

  it('도형만 있는 지점은 null (텍스트/표만 대상)', () => {
    expect(hitTopTextAt(els, 5, 95)).toBeNull() // bg(shape)만
  })

  it('겹친 텍스트는 zIndex 최상위 우선', () => {
    expect(hitTopTextAt(els, 120, 30).id).toBe('overlapHigh')
  })

  it('밖이면 null', () => {
    expect(hitTopTextAt(els, 500, 500)).toBeNull()
  })
})
