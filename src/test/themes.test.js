import { describe, it, expect, beforeEach } from 'vitest'
import { THEMES, getTheme, themeBackgroundStyles, themeRoleStyles, DEFAULT_THEME_ID } from '../core/themes'
import { useFlatStore } from '../store/flatStore'

describe('themes 정의', () => {
  it('16개 테마, 모두 고유 id/필수 필드', () => {
    expect(THEMES).toHaveLength(16)
    const ids = new Set(THEMES.map(t => t.id))
    expect(ids.size).toBe(16)
    for (const t of THEMES) {
      expect(t.bg && (t.bg.type === 'color' || t.bg.type === 'gradient')).toBe(true)
      expect(t.roles.title.color).toBeTruthy()
      expect(t.roles.body.color).toBeTruthy()
      expect(t.roles.default.color).toBeTruthy()
    }
  })

  it('getTheme: 알 수 없는 id면 첫 테마 폴백', () => {
    expect(getTheme('nope').id).toBe(THEMES[0].id)
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID)
  })

  it('themeBackgroundStyles: gradient/color 매핑', () => {
    const g = themeBackgroundStyles(getTheme('aurora'))
    expect(g.backgroundImage).toContain('gradient')
    expect(g.backgroundColor).toBe('rgba(0,0,0,0)')
    const c = themeBackgroundStyles(getTheme('white'))
    expect(c.backgroundColor).toBe('#ffffff')
    expect(c.backgroundImage).toBe('none')
  })

  it('themeRoleStyles: 역할 매핑(title/subtitle→title, body/left/right→body)', () => {
    const t = getTheme('midnight')
    expect(themeRoleStyles(t, 'title')).toBe(t.roles.title)
    expect(themeRoleStyles(t, 'subtitle')).toBe(t.roles.title)
    expect(themeRoleStyles(t, 'left')).toBe(t.roles.body)
    expect(themeRoleStyles(t, undefined)).toBe(t.roles.default)
  })
})

describe('applyThemeToCurrentPage', () => {
  const cs = { w: 1280, h: 720 }
  beforeEach(() => {
    useFlatStore.setState({
      canvasSize: cs,
      themeId: DEFAULT_THEME_ID,
      selectedFlatIds: [],
      editingFlatId: null,
      flatElements: [
        { id: 'bg', type: 'shape', content: '', isRich: false, x: 0, y: 0, width: 1280, height: 720, zIndex: 1, locked: true, styles: { backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none' } },
        { id: 'title', type: 'text', layoutRole: 'title', content: '제목', isRich: false, x: 100, y: 80, width: 600, height: 60, zIndex: 2, styles: { color: '#000', fontWeight: '400', textShadow: 'none' } },
        { id: 'free', type: 'text', content: '사용자색', isRich: false, x: 100, y: 200, width: 300, height: 40, zIndex: 3, styles: { color: '#ff0000', fontWeight: '400', textShadow: 'none' } },
      ],
    })
    useFlatStore.getState().clearHistory()
  })

  it('배경 레이어 스타일 + 역할 텍스트 서식 교체, 역할 없는 텍스트는 보존', () => {
    useFlatStore.getState().setTheme('midnight')
    const els = useFlatStore.getState().flatElements
    const theme = getTheme('midnight')
    const bg = els.find(e => e.id === 'bg')
    expect(bg.styles.backgroundColor).toBe(theme.bg.value) // midnight=color
    const title = els.find(e => e.id === 'title')
    expect(title.styles.color).toBe(theme.roles.title.color)
    expect(title.styles.fontWeight).toBe(theme.roles.title.fontWeight)
    // 역할 없는 텍스트는 사용자 색 보존
    const free = els.find(e => e.id === 'free')
    expect(free.styles.color).toBe('#ff0000')
  })

  it('배경 레이어가 없으면 새로 생성', () => {
    useFlatStore.setState({
      flatElements: [
        { id: 'title', type: 'text', layoutRole: 'title', content: 'x', isRich: false, x: 0, y: 0, width: 100, height: 40, zIndex: 1, styles: { color: '#000', fontWeight: '400', textShadow: 'none' } },
      ],
    })
    useFlatStore.getState().clearHistory()
    useFlatStore.getState().setTheme('aurora')
    const els = useFlatStore.getState().flatElements
    const bg = els.find(e => e.type === 'shape' && !e.content && e.width === cs.w && e.height === cs.h)
    expect(bg).toBeTruthy()
    expect(bg.styles.backgroundImage).toContain('gradient')
  })
})
