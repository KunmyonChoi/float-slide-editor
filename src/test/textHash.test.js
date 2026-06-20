import { describe, it, expect } from 'vitest'
import { textHash } from '../core/textHash'

describe('textHash', () => {
  it('동일 문자열은 동일 해시(결정적)', () => {
    expect(textHash('발표 노트')).toBe(textHash('발표 노트'))
  })
  it('다른 문자열은 다른 해시', () => {
    expect(textHash('A')).not.toBe(textHash('B'))
    expect(textHash('노트 1')).not.toBe(textHash('노트 2'))
  })
  it('빈/널 안전', () => {
    expect(textHash('')).toBe(textHash(''))
    expect(typeof textHash(null)).toBe('string')
  })
})
