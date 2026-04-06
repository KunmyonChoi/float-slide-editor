import { describe, it, expect } from 'vitest'
import { resolveAlignment, readCurrentAlignment } from '../core/AlignmentResolver'

/** getComputedStyle 모의 객체 생성 */
function mockCS(display = 'block', flexDirection = '') {
  return { display, flexDirection, gridAutoFlow: '' }
}

// ═══════════════════════════════════════════════════════════════
//  resolveAlignment — 의도 → CSS 속성 매핑
// ═══════════════════════════════════════════════════════════════
describe('resolveAlignment — flex-row 부모', () => {
  const cs = mockCS('flex', 'row')

  it('가로 center → marginLeft:auto + marginRight:auto (main-axis)', () => {
    const result = resolveAlignment(cs, 'h', 'center')
    expect(result).toEqual([
      { prop: 'marginLeft', value: 'auto' },
      { prop: 'marginRight', value: 'auto' },
    ])
  })

  it('가로 start → marginRight:auto', () => {
    const result = resolveAlignment(cs, 'h', 'start')
    expect(result).toEqual([
      { prop: 'marginLeft', value: '' },
      { prop: 'marginRight', value: 'auto' },
    ])
  })

  it('가로 end → marginLeft:auto', () => {
    const result = resolveAlignment(cs, 'h', 'end')
    expect(result).toEqual([
      { prop: 'marginLeft', value: 'auto' },
      { prop: 'marginRight', value: '' },
    ])
  })

  it('세로 center → alignSelf:center (cross-axis)', () => {
    const result = resolveAlignment(cs, 'v', 'center')
    expect(result).toEqual([{ prop: 'alignSelf', value: 'center' }])
  })

  it('세로 start → alignSelf:flex-start', () => {
    const result = resolveAlignment(cs, 'v', 'start')
    expect(result).toEqual([{ prop: 'alignSelf', value: 'flex-start' }])
  })

  it('세로 end → alignSelf:flex-end', () => {
    const result = resolveAlignment(cs, 'v', 'end')
    expect(result).toEqual([{ prop: 'alignSelf', value: 'flex-end' }])
  })
})

describe('resolveAlignment — flex-column 부모', () => {
  const cs = mockCS('flex', 'column')

  it('가로 center → alignSelf:center (cross-axis)', () => {
    const result = resolveAlignment(cs, 'h', 'center')
    expect(result).toEqual([{ prop: 'alignSelf', value: 'center' }])
  })

  it('세로 center → marginTop:auto + marginBottom:auto (main-axis)', () => {
    const result = resolveAlignment(cs, 'v', 'center')
    expect(result).toEqual([
      { prop: 'marginTop', value: 'auto' },
      { prop: 'marginBottom', value: 'auto' },
    ])
  })

  it('세로 start → marginBottom:auto', () => {
    const result = resolveAlignment(cs, 'v', 'start')
    expect(result).toEqual([
      { prop: 'marginTop', value: '' },
      { prop: 'marginBottom', value: 'auto' },
    ])
  })

  it('세로 end → marginTop:auto', () => {
    const result = resolveAlignment(cs, 'v', 'end')
    expect(result).toEqual([
      { prop: 'marginTop', value: 'auto' },
      { prop: 'marginBottom', value: '' },
    ])
  })
})

describe('resolveAlignment — grid 부모', () => {
  const cs = mockCS('grid', '')

  it('가로 center → justifySelf:center', () => {
    const result = resolveAlignment(cs, 'h', 'center')
    expect(result).toEqual([{ prop: 'justifySelf', value: 'center' }])
  })

  it('세로 center → alignSelf:center', () => {
    const result = resolveAlignment(cs, 'v', 'center')
    expect(result).toEqual([{ prop: 'alignSelf', value: 'center' }])
  })

  it('가로 end → justifySelf:end', () => {
    const result = resolveAlignment(cs, 'h', 'end')
    expect(result).toEqual([{ prop: 'justifySelf', value: 'end' }])
  })
})

describe('resolveAlignment — block 부모', () => {
  const cs = mockCS('block', '')

  it('가로 center → margin auto', () => {
    const result = resolveAlignment(cs, 'h', 'center')
    expect(result).toEqual([
      { prop: 'marginLeft', value: 'auto' },
      { prop: 'marginRight', value: 'auto' },
    ])
  })

  it('세로 정렬은 빈 배열 (block에서 불가)', () => {
    const result = resolveAlignment(cs, 'v', 'center')
    expect(result).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════
//  readCurrentAlignment — 현재 상태 역추론
// ═══════════════════════════════════════════════════════════════
describe('readCurrentAlignment — flex-row', () => {
  const cs = mockCS('flex', 'row')

  it('marginLeft:auto + marginRight:auto → h:center', () => {
    const style = { marginLeft: 'auto', marginRight: 'auto', alignSelf: '' }
    expect(readCurrentAlignment(cs, style).h).toBe('center')
  })

  it('alignSelf:center → v:center', () => {
    const style = { marginLeft: '', marginRight: '', alignSelf: 'center' }
    expect(readCurrentAlignment(cs, style).v).toBe('center')
  })

  it('alignSelf:flex-start → v:start', () => {
    const style = { marginLeft: '', marginRight: '', alignSelf: 'flex-start' }
    expect(readCurrentAlignment(cs, style).v).toBe('start')
  })

  it('정렬 없음 → null', () => {
    const style = { marginLeft: '', marginRight: '', alignSelf: '' }
    expect(readCurrentAlignment(cs, style).h).toBeNull()
    expect(readCurrentAlignment(cs, style).v).toBeNull()
  })
})

describe('readCurrentAlignment — flex-column', () => {
  const cs = mockCS('flex', 'column')

  it('alignSelf:center → h:center (cross-axis)', () => {
    const style = { alignSelf: 'center', marginTop: '', marginBottom: '' }
    expect(readCurrentAlignment(cs, style).h).toBe('center')
  })

  it('marginTop:auto + marginBottom:auto → v:center (main-axis)', () => {
    const style = { alignSelf: '', marginTop: 'auto', marginBottom: 'auto' }
    expect(readCurrentAlignment(cs, style).v).toBe('center')
  })
})

describe('readCurrentAlignment — grid', () => {
  const cs = mockCS('grid', '')

  it('justifySelf:center → h:center', () => {
    const style = { justifySelf: 'center', alignSelf: '' }
    expect(readCurrentAlignment(cs, style).h).toBe('center')
  })

  it('alignSelf:end → v:end', () => {
    const style = { justifySelf: '', alignSelf: 'end' }
    expect(readCurrentAlignment(cs, style).v).toBe('end')
  })
})
