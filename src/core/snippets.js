/**
 * snippets — 자주 쓰는 데코 요소(스니펫) 레지스트리.
 * 각 스니펫 build(cs, theme) → FlatElement '스펙' 배열(또는 1개).
 * 스펙은 id/zIndex 없이 위치(x,y)·스타일까지 채운 부분 요소이며, 삽입 측에서 id/zIndex 부여.
 * 복합 스니펫은 여러 스펙을 반환(삽입 측에서 groupId로 묶음).
 * docs/snippet-elements.md 참고.
 */

const ACCENT_FALLBACK = '#6366f1'

// 텍스트형 데코 요소 스펙 생성기 (배경/라운드/그림자/중앙정렬 포함)
function textSpec({ x, y, w, h, content, bg, color = '#ffffff', radius = 0, size = 14, weight = 600, shadow = 'none', letter = 'normal', align = 'center' }) {
  return {
    type: 'text', x: Math.round(x), y: Math.round(y), width: w, height: h,
    content, isRich: false, merged: false, placeholder: '',
    styles: {
      backgroundColor: bg, backgroundImage: 'none',
      color,
      fontSize: `${size}px`, fontFamily: 'inherit', fontWeight: String(weight),
      fontStyle: 'normal', textAlign: align, letterSpacing: letter, lineHeight: '1',
      textDecoration: 'none', textTransform: 'none',
      borderRadius: radius === '50%' ? '50%' : `${radius}px`,
      border: '0px none', boxShadow: shadow, opacity: '1',
      padding: '0px',
      // 세로 중앙 정렬 (renderer가 alignItems로 flex 전환)
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  }
}

export const SNIPPETS = [
  {
    id: 'pill', group: '라벨·뱃지', label: '필 라벨', desc: '라운드 배경의 작은 태그 (NEW·카테고리)',
    build: (cs, theme) => {
      const w = 130, h = 34
      const accent = theme?.accent || ACCENT_FALLBACK
      return [textSpec({
        x: (cs.w - w) / 2, y: (cs.h - h) / 2, w, h,
        content: 'LABEL', bg: accent, color: '#ffffff',
        radius: 999, size: 13, weight: 700, letter: '0.06em',
        shadow: '0 2px 6px rgba(0,0,0,0.18)',
      })]
    },
  },
  {
    id: 'numberBadge', group: '라벨·뱃지', label: '숫자 뱃지', desc: '원형 배경 + 숫자 (단계·순위)',
    build: (cs, theme) => {
      const d = 48
      const accent = theme?.accent || ACCENT_FALLBACK
      return [textSpec({
        x: (cs.w - d) / 2, y: (cs.h - d) / 2, w: d, h: d,
        content: '1', bg: accent, color: '#ffffff',
        radius: '50%', size: 22, weight: 800,
        shadow: '0 2px 8px rgba(0,0,0,0.22)',
      })]
    },
  },
]

export function getSnippet(id) {
  return SNIPPETS.find(s => s.id === id)
}
