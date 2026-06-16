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

// 콜아웃 박스 스펙 — 좌측 컬러바 + 옅은 배경 + 아이콘(이모지) + 본문(상단 정렬, 다중행)
function calloutSpec(cs, { content, bar, tint }) {
  const w = 540, h = 96
  return {
    type: 'text', x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2), width: w, height: h,
    content, isRich: false, merged: false, placeholder: '',
    styles: {
      backgroundColor: tint, backgroundImage: 'none', color: '#1e293b',
      fontSize: '16px', fontFamily: 'inherit', fontWeight: '400', fontStyle: 'normal',
      textAlign: 'left', letterSpacing: 'normal', lineHeight: '1.5',
      textDecoration: 'none', textTransform: 'none',
      borderRadius: '8px', border: '0px none', borderLeft: `4px solid ${bar}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)', opacity: '1', padding: '12px 16px',
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
  {
    id: 'calloutTip', group: '콜아웃', label: '콜아웃: 팁', desc: '💡 강조 팁 박스 (좌측 바 + 옅은 배경)',
    build: (cs) => [calloutSpec(cs, { content: '💡 핵심 팁을 입력하세요.', bar: '#f59e0b', tint: 'rgba(245,158,11,0.12)' })],
  },
  {
    id: 'calloutWarn', group: '콜아웃', label: '콜아웃: 주의', desc: '⚠️ 경고/주의 박스',
    build: (cs) => [calloutSpec(cs, { content: '⚠️ 주의할 점을 입력하세요.', bar: '#ef4444', tint: 'rgba(239,68,68,0.12)' })],
  },
  {
    id: 'calloutInfo', group: '콜아웃', label: '콜아웃: 정보', desc: 'ℹ️ 참고 정보 박스',
    build: (cs) => [calloutSpec(cs, { content: 'ℹ️ 참고 정보를 입력하세요.', bar: '#3b82f6', tint: 'rgba(59,130,246,0.12)' })],
  },
  {
    id: 'calloutSuccess', group: '콜아웃', label: '콜아웃: 성공', desc: '✅ 성공/완료 강조 박스',
    build: (cs) => [calloutSpec(cs, { content: '✅ 성공 포인트를 입력하세요.', bar: '#10b981', tint: 'rgba(16,185,129,0.12)' })],
  },
]

export function getSnippet(id) {
  return SNIPPETS.find(s => s.id === id)
}
