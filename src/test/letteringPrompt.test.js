import { describe, it, expect } from 'vitest'
import { buildLetteringPrompt } from '../core/letteringPrompt'
import { LETTERING_STYLES, LETTERING_POSITIONS, findLetteringStyle } from '../core/aiLetteringPresets'

describe('buildLetteringPrompt', () => {
  it('선택 텍스트를 따옴표로 정확히 포함', () => {
    const p = buildLetteringPrompt({ text: '분기 매출 +38%', styleId: 'youtube' })
    expect(p).toContain('"분기 매출 +38%"')
  })

  it('verbatim/중복금지/번역금지 제약 포함', () => {
    const p = buildLetteringPrompt({ text: 'A', styleId: 'news' })
    expect(p).toMatch(/VERBATIM/)
    expect(p).toMatch(/no duplicate text/)
    expect(p).toMatch(/no translation/)
  })

  it('스타일 directive 주입', () => {
    const p = buildLetteringPrompt({ text: 'A', styleId: 'variety' })
    expect(p).toContain(findLetteringStyle('variety').directive)
  })

  it('제자리 모드는 프레임을 채우는 배치', () => {
    const p = buildLetteringPrompt({ text: 'A', mode: 'inplace' })
    expect(p).toMatch(/filling the frame/)
  })

  it('방송 타이틀 모드는 위치 프리셋 배치', () => {
    const p = buildLetteringPrompt({ text: 'A', mode: 'title', positionId: 'lower-third' })
    expect(p).toContain('lower-third band')
  })

  it('배경 scene은 씬 유지, 단색은 solid 지시', () => {
    expect(buildLetteringPrompt({ text: 'A', bgId: 'scene' })).toMatch(/existing background scene/)
    expect(buildLetteringPrompt({ text: 'A', bgId: 'black' })).toMatch(/solid pure black/)
    expect(buildLetteringPrompt({ text: 'A', bgId: 'white' })).toMatch(/solid pure white/)
  })

  it('알 수 없는 id는 기본값 폴백(예외 없음)', () => {
    const p = buildLetteringPrompt({ text: 'A', styleId: 'nope', positionId: 'nope', bgId: 'nope', mode: 'title' })
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
  })

  it('프리셋 배열 무결성', () => {
    expect(LETTERING_STYLES.length).toBeGreaterThanOrEqual(7)
    expect(LETTERING_POSITIONS.find(p => p.id === 'lower-third')).toBeTruthy()
    for (const s of LETTERING_STYLES) { expect(s.id && s.label && s.directive).toBeTruthy() }
  })
})
