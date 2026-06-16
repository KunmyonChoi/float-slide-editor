import { describe, it, expect } from 'vitest'
import { BACKGROUND_STYLES, BACKGROUND_GROUPS, DEFAULT_BACKGROUND_STYLE_ID, getBackgroundStyle, buildBackgroundPrompt } from '../core/backgroundStyles'

describe('backgroundStyles', () => {
  it('17종, 고유 id + label/desc/directive + 유효한 group', () => {
    expect(BACKGROUND_STYLES.length).toBe(17)
    const ids = new Set(BACKGROUND_STYLES.map(s => s.id))
    expect(ids.size).toBe(17)
    expect(ids.has(DEFAULT_BACKGROUND_STYLE_ID)).toBe(true)
    for (const s of BACKGROUND_STYLES) {
      expect(s.label).toBeTruthy()
      expect(s.desc).toBeTruthy()
      expect(s.directive.length).toBeGreaterThan(10)
      expect(BACKGROUND_GROUPS).toContain(s.group)
    }
  })

  it('모든 섹션에 1개 이상 스타일', () => {
    for (const g of BACKGROUND_GROUPS) {
      expect(BACKGROUND_STYLES.some(s => s.group === g)).toBe(true)
    }
  })

  it('getBackgroundStyle: 알 수 없는 id면 첫 스타일 폴백', () => {
    expect(getBackgroundStyle('nope').id).toBe(BACKGROUND_STYLES[0].id)
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
