import { describe, it, expect } from 'vitest'
import { BACKGROUND_STYLES, DEFAULT_BACKGROUND_STYLE_ID, buildBackgroundPrompt } from '../core/backgroundStyles'

describe('backgroundStyles', () => {
  it('시작 5종, 고유 id + directive 보유', () => {
    expect(BACKGROUND_STYLES.length).toBe(5)
    const ids = new Set(BACKGROUND_STYLES.map(s => s.id))
    expect(ids.size).toBe(5)
    expect(ids.has(DEFAULT_BACKGROUND_STYLE_ID)).toBe(true)
    for (const s of BACKGROUND_STYLES) {
      expect(s.label).toBeTruthy()
      expect(s.directive.length).toBeGreaterThan(10)
    }
  })

  it('buildBackgroundPrompt: 무텍스트/세이프존/16:9 규칙 + 스타일 directive 포함', () => {
    const style = BACKGROUND_STYLES.find(s => s.id === 'sidePanel')
    const p = buildBackgroundPrompt(style, '핀테크')
    expect(p).toContain('16:9')
    expect(p.toLowerCase()).toContain('no text')
    expect(p.toLowerCase()).toContain('negative space')
    expect(p).toContain('LEFT third') // sidePanel directive
    expect(p).toContain('핀테크')      // 주제 반영
  })

  it('주제 없으면 주제 절 생략', () => {
    const p = buildBackgroundPrompt(BACKGROUND_STYLES[0], '')
    expect(p).not.toContain('Theme/subject')
  })
})
