import { describe, it, expect, beforeEach } from 'vitest'
import { THEMES, getTheme, themeBackgroundStyles, themeRoleStyles, DEFAULT_THEME_ID } from '../core/themes'
import { useFlatStore } from '../store/flatStore'
import { deserializeProject } from '../core/ProjectSerializer'

describe('사용자정의 테마', () => {
  beforeEach(() => {
    useFlatStore.setState({ themeId: 'white', customTheme: undefined })
    useFlatStore.getState().setCustomTheme(undefined) // 무시됨(null/없음)
  })

  it('updateCustomTheme: 역할색/배경 토큰 갱신', () => {
    useFlatStore.setState({ customTheme: { id: 'custom', name: '사용자정의', bg: { type: 'color', value: '#fff' }, roles: { title: { color: '#000', fontWeight: '800', textShadow: 'none' }, body: { color: '#333', fontWeight: '400', textShadow: 'none' }, muted: { color: '#666', fontWeight: '400', textShadow: 'none' }, default: { color: '#333', fontWeight: '400', textShadow: 'none' } }, swatch: ['#fff', '#000'] } })
    useFlatStore.getState().updateCustomTheme({ role: 'title', style: { color: '#ff0000' } })
    useFlatStore.getState().updateCustomTheme({ bg: { type: 'color', value: '#101010' } })
    const ct = useFlatStore.getState().customTheme
    expect(ct.roles.title.color).toBe('#ff0000')
    expect(ct.bg.value).toBe('#101010')
  })

  it('_currentTheme: themeId가 custom이면 customTheme 반환', () => {
    const ct = { id: 'custom', name: '사용자정의', bg: { type: 'color', value: '#123456' }, roles: { title: { color: '#fff', fontWeight: '800', textShadow: 'none' }, body: { color: '#eee', fontWeight: '400', textShadow: 'none' }, muted: { color: '#ccc', fontWeight: '400', textShadow: 'none' }, default: { color: '#eee', fontWeight: '400', textShadow: 'none' } }, swatch: ['#123456', '#fff'] }
    useFlatStore.setState({ themeId: 'custom', customTheme: ct })
    expect(useFlatStore.getState()._currentTheme().bg.value).toBe('#123456')
    useFlatStore.setState({ themeId: 'ocean' })
    expect(useFlatStore.getState()._currentTheme().id).toBe('ocean')
  })

  it('custom 테마 적용 → 배경/제목색이 custom 토큰으로', () => {
    const cs = { w: 1280, h: 720 }
    const ct = { id: 'custom', name: '사용자정의', bg: { type: 'color', value: '#222233' }, roles: { title: { color: '#ffcc00', fontWeight: '800', textShadow: 'none' }, body: { color: '#dddddd', fontWeight: '400', textShadow: 'none' }, muted: { color: '#aaa', fontWeight: '400', textShadow: 'none' }, default: { color: '#ddd', fontWeight: '400', textShadow: 'none' } }, swatch: ['#222233', '#ffcc00'] }
    useFlatStore.setState({
      canvasSize: cs, customTheme: ct, themeId: 'white', selectedFlatIds: [], editingFlatId: null,
      flatElements: [
        { id: 'bg', sourceId: '__bg', type: 'shape', content: '', isRich: false, x: 0, y: 0, width: 1280, height: 720, zIndex: 1, locked: true, styles: { backgroundColor: '#fff', backgroundImage: 'none' } },
        { id: 'title', type: 'text', layoutRole: 'title', content: 'T', isRich: false, x: 0, y: 0, width: 200, height: 40, zIndex: 2, styles: { color: '#000', fontWeight: '400', textShadow: 'none' } },
      ],
    })
    useFlatStore.getState().clearHistory()
    useFlatStore.getState().setTheme('custom')
    const els = useFlatStore.getState().flatElements
    expect(els.find(e => e.id === 'bg').styles.backgroundColor).toBe('#222233')
    expect(els.find(e => e.id === 'title').styles.color).toBe('#ffcc00')
  })
})

describe('themeId 직렬화 복원', () => {
  it('deserializeProject가 themeId/customTheme를 반환', () => {
    const json = JSON.stringify({
      version: 2, themeId: 'custom', customTheme: { id: 'custom', roles: {}, bg: { type: 'color', value: '#1a1a1a' } }, currentPageKey: '0-0',
      pages: { '0-0': { elements: [], canvasSize: { w: 1280, h: 720 } } },
    })
    const r = deserializeProject(json)
    expect(r.themeId).toBe('custom')
    expect(r.customTheme.bg.value).toBe('#1a1a1a')
  })
  it('deserializeProject가 themeId를 반환', () => {
    const json = JSON.stringify({
      version: 2, themeId: 'ocean', currentPageKey: '0-0',
      pages: { '0-0': { elements: [], canvasSize: { w: 1280, h: 720 } } },
    })
    expect(deserializeProject(json).themeId).toBe('ocean')
  })
  it('themeId 없으면 null', () => {
    const json = JSON.stringify({
      version: 2, currentPageKey: '0-0',
      pages: { '0-0': { elements: [], canvasSize: { w: 1280, h: 720 } } },
    })
    expect(deserializeProject(json).themeId).toBeNull()
  })
})

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
        { id: 'bg', sourceId: '__bg', type: 'shape', content: '', isRich: false, x: 0, y: 0, width: 1280, height: 720, zIndex: 1, locked: true, styles: { backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none' } },
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

  it('addPage: 새 슬라이드에 현재 테마 배경 자동 생성', () => {
    useFlatStore.getState().loadAllPages(
      { '0-0': { elements: [], canvasSize: cs, fontImports: [], htmlSlideIndex: null } }, '0-0')
    useFlatStore.setState({ themeId: 'aurora' })
    useFlatStore.getState().addPage()
    const els = useFlatStore.getState().flatElements
    const bg = els.find(e => e.type === 'shape' && !e.content && e.width === cs.w && e.height === cs.h)
    expect(bg).toBeTruthy()
    expect(bg.styles.backgroundImage).toContain('gradient')
  })

  it('addPage: 현재 슬라이드에 배경 레이어(이미지)가 있으면 새 슬라이드로 복제', () => {
    const bgImg = 'url(data:image/png;base64,AAAA)'
    useFlatStore.getState().loadAllPages({
      '0-0': {
        elements: [
          { id: 'bg', sourceId: '__bg', type: 'shape', content: '', isRich: false, x: 0, y: 0, width: cs.w, height: cs.h, zIndex: 0, locked: true, styles: { backgroundColor: 'rgba(0,0,0,0)', backgroundImage: bgImg, backgroundSize: 'cover' } },
        ],
        canvasSize: cs, fontImports: [], htmlSlideIndex: null,
      },
    }, '0-0')
    useFlatStore.getState().addPage('titleContent')
    const els = useFlatStore.getState().flatElements
    const bg = els.find(e => e.type === 'shape' && !e.content)
    expect(bg).toBeTruthy()
    expect(bg.styles.backgroundImage).toBe(bgImg) // 현재 배경 복제됨
    expect(bg.id).not.toBe('bg')                   // 새 id
  })

  it("addPage('titleContent'): 테마 배경 + 제목/본문 레이아웃 텍스트", () => {
    useFlatStore.getState().loadAllPages(
      { '0-0': { elements: [], canvasSize: cs, fontImports: [], htmlSlideIndex: null } }, '0-0')
    useFlatStore.setState({ themeId: 'midnight' })
    useFlatStore.getState().addPage('titleContent')
    const els = useFlatStore.getState().flatElements
    expect(els.some(e => e.type === 'shape' && !e.content)).toBe(true) // 배경
    const roles = els.filter(e => e.type === 'text' && e.layoutRole).map(e => e.layoutRole)
    expect(roles).toContain('title')
    expect(roles.length).toBeGreaterThanOrEqual(2) // 제목 + 본문
    const title = els.find(e => e.layoutRole === 'title')
    expect(title.styles.color).toBe(getTheme('midnight').roles.title.color)
  })

  it('applyThemeToDeck: 모든 페이지에 배경+역할색 적용', () => {
    const mkPage = () => ({
      elements: [
        { id: 'bg' + Math.random(), type: 'shape', content: '', isRich: false, x: 0, y: 0, width: 1280, height: 720, zIndex: 1, locked: true, styles: { backgroundColor: '#fff', backgroundImage: 'none' } },
        { id: 't' + Math.random(), type: 'text', layoutRole: 'title', content: 'x', isRich: false, x: 0, y: 0, width: 200, height: 40, zIndex: 2, styles: { color: '#000', fontWeight: '400', textShadow: 'none' } },
      ],
      canvasSize: cs, fontImports: [], htmlSlideIndex: null,
    })
    useFlatStore.getState().loadAllPages({ '0-0': mkPage(), '1-0': mkPage() }, '0-0')
    useFlatStore.setState({ themeId: 'midnight' })
    useFlatStore.getState().applyThemeToDeck()
    const theme = getTheme('midnight')
    for (const p of useFlatStore.getState().getFlatPageList()) {
      const title = p.elements.find(e => e.layoutRole === 'title')
      expect(title.styles.color).toBe(theme.roles.title.color)
      const bg = p.elements.find(e => e.type === 'shape')
      expect(bg.styles.backgroundColor).toBe(theme.bg.value)
    }
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
