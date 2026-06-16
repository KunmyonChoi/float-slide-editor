/**
 * 테마 = 배경 + 역할별(title/body/muted) 글자 서식의 큐레이션 세트.
 * 저위험 속성만 정의: 배경(단색/그레디언트), 글자색, 굵기, 텍스트 그림자.
 * (크기·아웃라인 등 레이아웃/내보내기 영향 속성은 제외 — 후속 단계)
 *
 * 적용 매핑:
 *  - bg → 배경 레이어 요소의 backgroundColor / backgroundImage
 *  - roles[role] → layoutRole(title/subtitle/body/left/right) 텍스트의 color/fontWeight/textShadow
 *  - default → 역할 없는(사용자가 만든) 새 텍스트의 기본 서식
 */

// 어두운/그레디언트 배경에서 가독성 확보용 은은한 그림자
const SHADOW_ON_DARK = '0 1px 3px rgba(0,0,0,0.35)'
const NO_SHADOW = 'none'

// 밝은 배경용 글자 세트 (어두운 글자)
function lightText(over = {}) {
  return {
    title: { color: '#1e293b', fontWeight: '800', textShadow: NO_SHADOW },
    body: { color: '#334155', fontWeight: '400', textShadow: NO_SHADOW },
    muted: { color: '#64748b', fontWeight: '400', textShadow: NO_SHADOW },
    default: { color: '#334155', fontWeight: '400', textShadow: NO_SHADOW },
    ...over,
  }
}
// 어두운/그레디언트 배경용 글자 세트 (밝은 글자 + 그림자)
function darkText(over = {}) {
  return {
    title: { color: '#ffffff', fontWeight: '800', textShadow: SHADOW_ON_DARK },
    body: { color: '#e2e8f0', fontWeight: '400', textShadow: SHADOW_ON_DARK },
    muted: { color: '#cbd5e1', fontWeight: '400', textShadow: SHADOW_ON_DARK },
    default: { color: '#f1f5f9', fontWeight: '400', textShadow: SHADOW_ON_DARK },
    ...over,
  }
}

const color = (v) => ({ type: 'color', value: v })
const grad = (v) => ({ type: 'gradient', value: v })

export const THEMES = [
  // ── 밝은 계열 ──
  { id: 'white', name: '화이트', accent: '#6366f1',
    bg: color('#ffffff'), roles: lightText(), swatch: ['#ffffff', '#1e293b'] },
  { id: 'paper', name: '페이퍼', accent: '#64748b',
    bg: color('#f8fafc'), roles: lightText(), swatch: ['#f8fafc', '#334155'] },
  { id: 'sand', name: '샌드', accent: '#b45309',
    bg: color('#faf5ec'), roles: lightText({ title: { color: '#3f3422', fontWeight: '800', textShadow: NO_SHADOW } }),
    swatch: ['#faf5ec', '#3f3422'] },
  { id: 'mint', name: '민트', accent: '#0d9488',
    bg: grad('linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)'),
    roles: lightText({ title: { color: '#134e4a', fontWeight: '800', textShadow: NO_SHADOW } }),
    swatch: ['#ccfbf1', '#134e4a'] },
  { id: 'peach', name: '피치', accent: '#ea580c',
    bg: grad('linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)'),
    roles: lightText({ title: { color: '#7c2d12', fontWeight: '800', textShadow: NO_SHADOW } }),
    swatch: ['#ffedd5', '#7c2d12'] },
  { id: 'sky', name: '스카이', accent: '#0284c7',
    bg: grad('linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)'),
    roles: lightText({ title: { color: '#0c4a6e', fontWeight: '800', textShadow: NO_SHADOW } }),
    swatch: ['#e0f2fe', '#0c4a6e'] },
  { id: 'lavender', name: '라벤더', accent: '#7c3aed',
    bg: grad('linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)'),
    roles: lightText({ title: { color: '#4c1d95', fontWeight: '800', textShadow: NO_SHADOW } }),
    swatch: ['#ede9fe', '#4c1d95'] },

  // ── 어두운 계열 ──
  { id: 'midnight', name: '미드나잇', accent: '#818cf8',
    bg: color('#0f172a'), roles: darkText(), swatch: ['#0f172a', '#ffffff'] },
  { id: 'charcoal', name: '차콜', accent: '#a3a3a3',
    bg: color('#171717'), roles: darkText(), swatch: ['#171717', '#fafafa'] },
  { id: 'slate', name: '슬레이트', accent: '#38bdf8',
    bg: grad('linear-gradient(135deg, #1e293b 0%, #334155 100%)'),
    roles: darkText(), swatch: ['#1e293b', '#38bdf8'] },

  // ── 그레디언트(컬러풀) 계열 ──
  { id: 'aurora', name: '오로라', accent: '#c084fc',
    bg: grad('linear-gradient(135deg, #667eea 0%, #764ba2 100%)'),
    roles: darkText(), swatch: ['#667eea', '#764ba2'] },
  { id: 'sunset', name: '선셋', accent: '#fde68a',
    bg: grad('linear-gradient(135deg, #ff6a88 0%, #ff99ac 50%, #ffb199 100%)'),
    roles: darkText(), swatch: ['#ff6a88', '#ffb199'] },
  { id: 'ocean', name: '오션', accent: '#67e8f9',
    bg: grad('linear-gradient(135deg, #0ea5e9 0%, #1e3a8a 100%)'),
    roles: darkText(), swatch: ['#0ea5e9', '#1e3a8a'] },
  { id: 'forest', name: '포레스트', accent: '#bef264',
    bg: grad('linear-gradient(135deg, #134e4a 0%, #166534 100%)'),
    roles: darkText(), swatch: ['#134e4a', '#166534'] },
  { id: 'royal', name: '로열', accent: '#fbbf24',
    bg: grad('linear-gradient(135deg, #312e81 0%, #6d28d9 100%)'),
    roles: darkText({ title: { color: '#fbbf24', fontWeight: '800', textShadow: SHADOW_ON_DARK } }),
    swatch: ['#312e81', '#fbbf24'] },
  { id: 'berry', name: '베리', accent: '#f9a8d4',
    bg: grad('linear-gradient(135deg, #831843 0%, #be185d 100%)'),
    roles: darkText(), swatch: ['#831843', '#f9a8d4'] },
]

export const DEFAULT_THEME_ID = 'white'

export function getTheme(id) {
  return THEMES.find(t => t.id === id) || THEMES[0]
}

/** 테마 배경 → 배경 레이어에 적용할 styles 일부 */
export function themeBackgroundStyles(theme) {
  if (!theme?.bg) return { backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none' }
  return theme.bg.type === 'gradient'
    ? { backgroundColor: 'rgba(0,0,0,0)', backgroundImage: theme.bg.value }
    : { backgroundColor: theme.bg.value, backgroundImage: 'none' }
}

/** layoutRole → 테마 역할 서식 (없으면 default) */
export function themeRoleStyles(theme, layoutRole) {
  const r = theme?.roles || {}
  if (layoutRole === 'title' || layoutRole === 'subtitle') return r.title || r.default
  if (layoutRole === 'body' || layoutRole === 'left' || layoutRole === 'right') return r.body || r.default
  if (layoutRole === 'muted') return r.muted || r.default
  return r.default
}
