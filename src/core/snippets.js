/**
 * snippets — 자주 쓰는 데코 요소(스니펫) 레지스트리.
 * 각 스니펫 build(cs, theme) → FlatElement '스펙' 배열(또는 1개).
 * 스펙은 id/zIndex 없이 위치(x,y)·스타일까지 채운 부분 요소이며, 삽입 측에서 id/zIndex 부여.
 * 복합 스니펫은 여러 스펙을 반환(삽입 측에서 groupId로 묶음).
 * docs/snippet-elements.md 참고.
 */
import { highlightCode, CODE_FONT } from './codeHighlight'

const ACCENT_FALLBACK = '#6366f1'

// 텍스트형 데코 요소 스펙 생성기 (배경/라운드/그림자/중앙정렬 포함)
function textSpec({ x, y, w, h, content, bg, color = '#ffffff', radius = 0, size = 14, weight = 600,
  shadow = 'none', letter = 'normal', align = 'center', isRich = false, border = '0px none',
  fontFamily = 'inherit', padding = '0px', lineHeight = '1', valign = 'center' }) {
  return {
    type: 'text', x: Math.round(x), y: Math.round(y), width: w, height: h,
    content, isRich, merged: false, placeholder: '',
    styles: {
      backgroundColor: bg, backgroundImage: 'none',
      color,
      fontSize: `${size}px`, fontFamily, fontWeight: String(weight),
      fontStyle: 'normal', textAlign: align, letterSpacing: letter, lineHeight,
      textDecoration: 'none', textTransform: 'none',
      borderRadius: radius === '50%' ? '50%' : `${radius}px`,
      border, boxShadow: shadow, opacity: '1',
      padding,
      // 세로(valign)·가로(align) 정렬 (renderer가 alignItems로 flex 전환)
      display: 'flex',
      alignItems: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
      justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    },
  }
}

// 캔버스 중앙 좌표
const center = (cs, w, h) => ({ x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2) })

// 도형 스펙 생성기
function shapeSpec({ x, y, w, h, bg, radius = 0, shadow = 'none', border = '0px none' }) {
  return {
    type: 'shape', x: Math.round(x), y: Math.round(y), width: w, height: h, content: '', isRich: false, merged: false,
    styles: {
      backgroundColor: bg, backgroundImage: 'none',
      borderRadius: radius === '50%' ? '50%' : `${radius}px`,
      border, boxShadow: shadow, opacity: '1',
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
  {
    id: 'pullQuote', group: '인용', label: '풀쿼트(인용)', desc: '큰 따옴표로 강조한 인용/명언',
    build: (cs) => {
      const w = 620, h = 150
      const q = "font-size:52px;line-height:0;vertical-align:-0.35em;color:#cbd5e1;font-family:Georgia,'Times New Roman',serif"
      return [{
        type: 'text', x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2), width: w, height: h,
        content: `<span style="${q}">“</span> 인상 깊은 인용문을 입력하세요 <span style="${q}">”</span>`,
        isRich: true, merged: false, placeholder: '',
        styles: {
          backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', color: '#334155',
          fontSize: '24px', fontFamily: 'inherit', fontWeight: '500', fontStyle: 'italic',
          textAlign: 'center', lineHeight: '1.5', letterSpacing: 'normal',
          textDecoration: 'none', textTransform: 'none',
          borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      }]
    },
  },
  {
    id: 'leftBarQuote', group: '인용', label: '좌측바 인용/소제목', desc: '왼쪽 얇은 컬러 바 + 텍스트',
    build: (cs, theme) => {
      const w = 520, h = 64
      const accent = theme?.accent || ACCENT_FALLBACK
      return [{
        type: 'text', x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2), width: w, height: h,
        content: '인용 또는 소제목 텍스트', isRich: false, merged: false, placeholder: '',
        styles: {
          backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', color: '#475569',
          fontSize: '18px', fontFamily: 'inherit', fontWeight: '500', fontStyle: 'italic',
          textAlign: 'left', lineHeight: '1.5', letterSpacing: 'normal',
          textDecoration: 'none', textTransform: 'none',
          borderRadius: '0px', border: '0px none', borderLeft: `4px solid ${accent}`,
          boxShadow: 'none', opacity: '1', padding: '4px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
        },
      }]
    },
  },
]

// KPI 카드 — 카드 배경(shape) + 큰 숫자 + 라벨 + 추세. 복합(그룹) 스니펫.
SNIPPETS.push({
  id: 'kpiCard', group: '데이터', label: 'KPI 카드', desc: '큰 숫자 + 라벨 + 추세 (지표 강조)',
  build: (cs, theme) => {
    const w = 240, h = 164
    const x = Math.round((cs.w - w) / 2), y = Math.round((cs.h - h) / 2)
    const accent = theme?.accent || ACCENT_FALLBACK
    const card = {
      type: 'shape', x, y, width: w, height: h, content: '', isRich: false, merged: false,
      styles: {
        backgroundColor: '#ffffff', backgroundImage: 'none', borderRadius: '14px',
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 14px rgba(0,0,0,0.10)', opacity: '1',
      },
    }
    const number = textSpec({ x, y: y + 30, w, h: 58, content: '90%', bg: 'rgba(0,0,0,0)', color: accent, size: 46, weight: 800 })
    const label = textSpec({ x, y: y + 92, w, h: 26, content: '전환율', bg: 'rgba(0,0,0,0)', color: '#475569', size: 15, weight: 500 })
    const trend = textSpec({ x, y: y + 120, w, h: 22, content: '▲ 12% 증가', bg: 'rgba(0,0,0,0)', color: '#10b981', size: 13, weight: 600 })
    return [card, number, label, trend]
  },
})

// 단계 카드 — 숫자 뱃지 + 제목 + 설명 (How-to/온보딩 단계). 복합(그룹) 스니펫.
SNIPPETS.push({
  id: 'stepCard', group: '프로세스', label: '단계 카드', desc: '숫자 뱃지 + 제목 + 설명',
  build: (cs, theme) => {
    const w = 440, h = 80
    const x = Math.round((cs.w - w) / 2), y = Math.round((cs.h - h) / 2)
    const accent = theme?.accent || ACCENT_FALLBACK
    const titleColor = theme?.roles?.title?.color || '#1e293b'
    const descColor = theme?.roles?.muted?.color || '#64748b'
    const d = 44
    const tx = x + d + 16, tw = w - d - 16
    const badge = textSpec({ x, y: y + (h - d) / 2, w: d, h: d, content: '1', bg: accent, color: '#ffffff', radius: '50%', size: 20, weight: 800, shadow: '0 2px 8px rgba(0,0,0,0.22)' })
    const title = textSpec({ x: tx, y: y + 8, w: tw, h: 30, content: '단계 제목', bg: 'rgba(0,0,0,0)', color: titleColor, size: 18, weight: 700, align: 'left' })
    const desc = textSpec({ x: tx, y: y + 40, w: tw, h: 30, content: '이 단계 설명을 입력하세요.', bg: 'rgba(0,0,0,0)', color: descColor, size: 14, weight: 400, align: 'left' })
    return [badge, title, desc]
  },
})

// 세로 단계 카드 — 뱃지(위) + 제목 + 설명, 가운데 정렬. 가로로 여러 개 나열하기 좋음.
SNIPPETS.push({
  id: 'stepCardV', group: '프로세스', label: '단계 카드(세로)', desc: '뱃지 위 → 제목 → 설명(가운데)',
  build: (cs, theme) => {
    const w = 220, h = 150
    const x = Math.round((cs.w - w) / 2), y = Math.round((cs.h - h) / 2)
    const accent = theme?.accent || ACCENT_FALLBACK
    const titleColor = theme?.roles?.title?.color || '#1e293b'
    const descColor = theme?.roles?.muted?.color || '#64748b'
    const d = 48
    const badge = textSpec({ x: x + (w - d) / 2, y, w: d, h: d, content: '1', bg: accent, color: '#ffffff', radius: '50%', size: 22, weight: 800, shadow: '0 2px 8px rgba(0,0,0,0.22)' })
    const title = textSpec({ x, y: y + 60, w, h: 28, content: '단계 제목', bg: 'rgba(0,0,0,0)', color: titleColor, size: 17, weight: 700, align: 'center' })
    const desc = textSpec({ x, y: y + 90, w, h: 50, content: '설명을 입력하세요.', bg: 'rgba(0,0,0,0)', color: descColor, size: 13, weight: 400, align: 'center' })
    return [badge, title, desc]
  },
})

// 코드 블록(맥 터미널) — 다크 윈도우 + 상단 3색 점 + 모노스페이스 코드. 복합(그룹).
SNIPPETS.push({
  id: 'codeBlock', group: '코드', label: '코드 블록(맥 터미널)', desc: '상단 3색 점 + 다크 라운드 + 모노 코드',
  build: (cs) => {
    const w = 560, h = 220
    const x = Math.round((cs.w - w) / 2), y = Math.round((cs.h - h) / 2)
    const win = {
      type: 'shape', x, y, width: w, height: h, content: '', isRich: false, merged: false,
      // 오토핏 컨테이너: 코드(콘텐츠)를 감싸도록 높이 신축. top 패딩=시스템바 영역.
      afContainer: true, afPad: { top: 46, right: 20, bottom: 14, left: 20 }, afGap: 0,
      styles: {
        backgroundColor: '#0f172a', backgroundImage: 'none', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 28px rgba(0,0,0,0.35)', opacity: '1',
      },
    }
    const dot = (c) => `<span style="color:${c}">●</span>`
    const dots = {
      type: 'text', x: x + 16, y: y + 12, width: 90, height: 18,
      content: `${dot('#ff5f56')} ${dot('#ffbd2e')} ${dot('#27c93f')}`, isRich: true, merged: false, placeholder: '',
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', color: '#e2e8f0',
        fontSize: '14px', fontFamily: 'inherit', fontWeight: '400', fontStyle: 'normal',
        textAlign: 'left', letterSpacing: '2px', lineHeight: '1', textDecoration: 'none', textTransform: 'none',
        borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', padding: '0px',
      },
    }
    const rawCode = 'function greet(name) {\n  return `Hello, ${name}!`\n}'
    const { html: codeHtml, lang } = highlightCode(rawCode, 'auto')
    const code = {
      type: 'text', x: x + 20, y: y + 46, width: w - 40, height: h - 62,
      content: codeHtml, isRich: true, isCode: true, lang, code: rawCode, afContent: true, autoHeight: true, merged: false, placeholder: '',
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', color: '#c0caf5',
        fontSize: '15px', fontFamily: CODE_FONT,
        fontWeight: '400', fontStyle: 'normal',
        textAlign: 'left', letterSpacing: 'normal', lineHeight: '1.6', textDecoration: 'none', textTransform: 'none',
        borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', padding: '0px', whiteSpace: 'pre-wrap',
      },
    }
    return [win, dots, code]
  },
})

// 프로그레스 바 — 트랙(회색) + 채움(accent) + % 라벨. 복합(그룹).
SNIPPETS.push({
  id: 'progressBar', group: '데이터', label: '프로그레스 바', desc: '진행률 막대 + % 라벨',
  build: (cs, theme) => {
    const w = 400, barH = 14, h = 40
    const x = Math.round((cs.w - w) / 2), y = Math.round((cs.h - h) / 2)
    const accent = theme?.accent || ACCENT_FALLBACK
    const labelColor = theme?.roles?.body?.color || '#475569'
    const pct = 0.65
    const barStyle = (bg) => ({
      backgroundColor: bg, backgroundImage: 'none', borderRadius: '999px',
      border: '0px none', boxShadow: 'none', opacity: '1',
    })
    const track = { type: 'shape', x, y, width: w, height: barH, content: '', isRich: false, merged: false, styles: barStyle('#e2e8f0') }
    const fill = { type: 'shape', x, y, width: Math.round(w * pct), height: barH, content: '', isRich: false, merged: false, styles: barStyle(accent) }
    const label = textSpec({ x, y: y + 22, w, h: 20, content: '65% 완료', bg: 'rgba(0,0,0,0)', color: labelColor, size: 14, weight: 600, align: 'left' })
    return [track, fill, label]
  },
})

// 체크리스트 항목 — 녹색 ✓ + 텍스트 (단일)
SNIPPETS.push({
  id: 'checklistItem', group: '리스트', label: '체크리스트 항목', desc: '✓ + 항목 텍스트',
  build: (cs, theme) => {
    const w = 360, h = 34
    const { x, y } = center(cs, w, h)
    const tc = theme?.roles?.body?.color || '#334155'
    return [textSpec({
      x, y, w, h, isRich: true,
      content: '<span style="color:#10b981;font-weight:700">✓</span> 할 일 항목을 입력하세요',
      bg: 'rgba(0,0,0,0)', color: tc, size: 16, weight: 500, align: 'left', lineHeight: '1.4',
    })]
  },
})

// 상태 칩 — 색 점(●) + 라벨, 옅은 회색 필
SNIPPETS.push({
  id: 'statusChip', group: '라벨·뱃지', label: '상태 칩', desc: '● + 상태 텍스트 (진행중/완료)',
  build: (cs) => {
    const w = 120, h = 30
    const { x, y } = center(cs, w, h)
    return [textSpec({
      x, y, w, h, isRich: true,
      content: '<span style="color:#f59e0b">●</span> 진행중',
      bg: 'rgba(148,163,184,0.18)', color: '#334155', radius: 999, size: 13, weight: 600,
      align: 'center', padding: '0 12px',
    })]
  },
})

// 키캡 — 단축키 표기 (입체 테두리 + 모노)
SNIPPETS.push({
  id: 'keycap', group: '라벨·뱃지', label: '키캡', desc: '단축키 표기 (⌘K)',
  build: (cs) => {
    const w = 54, h = 32
    const { x, y } = center(cs, w, h)
    return [textSpec({
      x, y, w, h, content: '⌘K', bg: '#f1f5f9', color: '#334155',
      radius: 6, size: 13, weight: 600, align: 'center', padding: '0 8px',
      border: '1px solid #cbd5e1', shadow: '0 2px 0 #cbd5e1',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    })]
  },
})

// 해시 칩 — #키워드 (accent 텍스트 + 옅은 필)
SNIPPETS.push({
  id: 'hashChip', group: '라벨·뱃지', label: '해시 칩', desc: '#키워드 태그',
  build: (cs, theme) => {
    const w = 120, h = 28
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    return [textSpec({
      x, y, w, h, content: '#키워드', bg: 'rgba(148,163,184,0.18)', color: accent,
      radius: 999, size: 14, weight: 600, align: 'center', padding: '0 12px',
    })]
  },
})

// 평점 — ★★★★☆ (단일)
SNIPPETS.push({
  id: 'rating', group: '데이터', label: '평점(별)', desc: '★★★★☆ 만족도/리뷰',
  build: (cs) => {
    const w = 170, h = 40
    const { x, y } = center(cs, w, h)
    return [textSpec({ x, y, w, h, content: '★★★★☆', bg: 'rgba(0,0,0,0)', color: '#f59e0b', size: 26, weight: 400, align: 'center', letter: '2px' })]
  },
})

// 강조 결론 박스 — 테두리 + 흰 배경 + 그림자 (단일, 자체 카드)
SNIPPETS.push({
  id: 'conclusionBox', group: '구조', label: '강조 결론 박스', desc: '테두리 + 그림자 강조 박스',
  build: (cs, theme) => {
    const w = 520, h = 96
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    return [textSpec({
      x, y, w, h, content: '핵심 결론을 입력하세요', bg: '#ffffff', color: '#1e293b',
      radius: 12, size: 18, weight: 600, align: 'center', lineHeight: '1.4',
      border: `2px solid ${accent}`, shadow: '0 4px 14px rgba(0,0,0,0.10)', padding: '12px 20px',
    })]
  },
})

// 섹션 헤더 바 — 풀폭 컬러 띠 + 제목 (단일)
SNIPPETS.push({
  id: 'sectionHeaderBar', group: '구조', label: '섹션 헤더 바', desc: '풀폭 컬러 띠 + 제목',
  build: (cs, theme) => {
    const w = Math.round(cs.w * 0.86), h = 64
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    return [textSpec({
      x, y, w, h, content: '섹션 제목', bg: accent, color: '#ffffff',
      radius: 8, size: 26, weight: 700, align: 'left', padding: '0 24px',
      shadow: '0 2px 8px rgba(0,0,0,0.15)',
    })]
  },
})

// CTA 버튼 — 라운드 강조색 버튼 (단일)
SNIPPETS.push({
  id: 'ctaButton', group: '구조', label: 'CTA 버튼', desc: '라운드 강조색 버튼',
  build: (cs, theme) => {
    const w = 190, h = 50
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    return [textSpec({
      x, y, w, h, content: '자세히 보기 →', bg: accent, color: '#ffffff',
      radius: 999, size: 16, weight: 700, align: 'center', shadow: '0 4px 12px rgba(0,0,0,0.18)',
    })]
  },
})

// 대형 스탯 — 큰 숫자 + 캡션 (복합)
SNIPPETS.push({
  id: 'bigStat', group: '데이터', label: '대형 스탯', desc: '큰 숫자 + 캡션',
  build: (cs, theme) => {
    const w = 260, h = 110
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    const cap = theme?.roles?.muted?.color || '#64748b'
    return [
      textSpec({ x, y, w, h: 64, content: '90%', bg: 'rgba(0,0,0,0)', color: accent, size: 56, weight: 800, align: 'center' }),
      textSpec({ x, y: y + 70, w, h: 28, content: '전환율 증가', bg: 'rgba(0,0,0,0)', color: cap, size: 16, weight: 500, align: 'center' }),
    ]
  },
})

// 스티키 노트 — 포스트잇(기울임 + 그림자), 좌상단 텍스트
SNIPPETS.push({
  id: 'stickyNote', group: '노트', label: '스티키 노트', desc: '포스트잇 메모(기울임+그림자)',
  build: (cs) => {
    const w = 180, h = 160
    const { x, y } = center(cs, w, h)
    const s = textSpec({
      x, y, w, h, content: '메모를 입력하세요', bg: '#fde68a', color: '#78350f',
      size: 16, weight: 500, align: 'left', valign: 'top', padding: '14px', radius: 3,
      shadow: '0 6px 16px rgba(0,0,0,0.18)', lineHeight: '1.4',
    })
    s.rotation = -3
    return [s]
  },
})

// 카드 — 라운드 + 그림자 컨테이너 (단일 shape)
SNIPPETS.push({
  id: 'card', group: '구조', label: '카드', desc: '라운드 + 그림자 콘텐츠 카드',
  build: (cs) => {
    const w = 280, h = 180
    const { x, y } = center(cs, w, h)
    return [{
      type: 'shape', x, y, width: w, height: h, content: '', isRich: false, merged: false,
      styles: {
        backgroundColor: '#ffffff', backgroundImage: 'none', borderRadius: '14px',
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 6px 18px rgba(0,0,0,0.10)', opacity: '1',
      },
    }]
  },
})

// 인라인 코드칩 — 모노 + 회색 배경 (단일)
SNIPPETS.push({
  id: 'inlineCode', group: '코드', label: '인라인 코드칩', desc: '모노 + 회색 배경 (명령어/변수)',
  build: (cs) => {
    const w = 110, h = 30
    const { x, y } = center(cs, w, h)
    return [textSpec({
      x, y, w, h, content: 'code', bg: '#e2e8f0', color: '#334155',
      radius: 6, size: 14, weight: 500, align: 'center', padding: '0 10px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    })]
  },
})

// 화살표 프로세스 — 칩 → 칩 → 칩 (복합)
SNIPPETS.push({
  id: 'arrowProcess', group: '프로세스', label: '화살표 프로세스', desc: '칩 → 칩 → 칩 (워크플로우)',
  build: (cs, theme) => {
    const chipW = 104, chipH = 44, arrowW = 34
    const totalW = chipW * 3 + arrowW * 2
    const { x, y } = center(cs, totalW, chipH)
    const accent = theme?.accent || ACCENT_FALLBACK
    const arrowColor = theme?.roles?.muted?.color || '#94a3b8'
    const chip = (i, cx) => textSpec({ x: cx, y, w: chipW, h: chipH, content: `${i}단계`, bg: accent, color: '#ffffff', radius: 999, size: 15, weight: 700, align: 'center', shadow: '0 2px 6px rgba(0,0,0,0.15)' })
    const arrow = (ax) => textSpec({ x: ax, y, w: arrowW, h: chipH, content: '→', bg: 'rgba(0,0,0,0)', color: arrowColor, size: 22, weight: 700, align: 'center' })
    let cx = x
    const els = [chip(1, cx)]
    cx += chipW; els.push(arrow(cx)); cx += arrowW
    els.push(chip(2, cx)); cx += chipW; els.push(arrow(cx)); cx += arrowW
    els.push(chip(3, cx))
    return els
  },
})

// Pros/Cons — 장점/단점 2분할 박스 (복합)
SNIPPETS.push({
  id: 'prosCons', group: '비교', label: 'Pros / Cons', desc: '장점(녹)/단점(적) 2분할',
  build: (cs) => {
    const bw = 240, bh = 140, gap = 16
    const { x, y } = center(cs, bw * 2 + gap, bh)
    const boxStyle = (tint, color, bar) => ({
      backgroundColor: tint, backgroundImage: 'none', color,
      fontSize: '15px', fontFamily: 'inherit', fontWeight: '500', fontStyle: 'normal',
      textAlign: 'left', letterSpacing: 'normal', lineHeight: '1.6', textDecoration: 'none', textTransform: 'none',
      borderRadius: '10px', border: '0px none', borderLeft: `4px solid ${bar}`,
      boxShadow: 'none', opacity: '1', padding: '12px 16px',
    })
    const pro = { type: 'text', x, y, width: bw, height: bh, content: '✓ 장점\n• 항목 1\n• 항목 2', isRich: false, merged: false, placeholder: '', styles: boxStyle('rgba(16,185,129,0.10)', '#065f46', '#10b981') }
    const con = { type: 'text', x: x + bw + gap, y, width: bw, height: bh, content: '✗ 단점\n• 항목 1\n• 항목 2', isRich: false, merged: false, placeholder: '', styles: boxStyle('rgba(239,68,68,0.10)', '#991b1b', '#ef4444') }
    return [pro, con]
  },
})

// 타임라인 — 세로선 + 점 3 + 날짜/내용 3 (복합)
SNIPPETS.push({
  id: 'timeline', group: '프로세스', label: '타임라인', desc: '점 + 세로선 + 날짜/내용 (3개)',
  build: (cs, theme) => {
    const w = 360, h = 160, rowH = 52, dotD = 12
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    const titleC = theme?.roles?.title?.color || '#1e293b'
    const muteC = theme?.roles?.muted?.color || '#64748b'
    const lineX = x + 5
    const els = [shapeSpec({ x: lineX, y: y + dotD / 2, w: 2, h: rowH * 2, bg: 'rgba(148,163,184,0.5)' })]
    for (let i = 0; i < 3; i++) {
      const ry = y + i * rowH
      els.push(shapeSpec({ x: lineX - dotD / 2 + 1, y: ry, w: dotD, h: dotD, bg: accent, radius: '50%' }))
      els.push(textSpec({ x: x + 24, y: ry - 4, w: w - 24, h: 20, content: `2024.0${i + 1} · 제목`, bg: 'rgba(0,0,0,0)', color: titleC, size: 14, weight: 700, align: 'left' }))
      els.push(textSpec({ x: x + 24, y: ry + 16, w: w - 24, h: 18, content: '간단한 설명', bg: 'rgba(0,0,0,0)', color: muteC, size: 12, weight: 400, align: 'left' }))
    }
    return els
  },
})

// 터미널 출력 — 다크 박스 + $ 프롬프트 + 모노 (복합)
SNIPPETS.push({
  id: 'terminalOutput', group: '코드', label: '터미널 출력', desc: '$ 프롬프트 + 다크 모노',
  build: (cs) => {
    const w = 520, h = 120
    const { x, y } = center(cs, w, h)
    const win = shapeSpec({ x, y, w, h, bg: '#0a0e14', radius: 10, shadow: '0 6px 20px rgba(0,0,0,0.35)' })
    const text = {
      type: 'text', x: x + 16, y: y + 14, width: w - 32, height: h - 28,
      content: '$ npm run build\n✓ built in 320ms', isRich: false, merged: false, placeholder: '',
      styles: {
        backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', color: '#86efac',
        fontSize: '14px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontWeight: '400', fontStyle: 'normal', textAlign: 'left', letterSpacing: 'normal',
        lineHeight: '1.6', textDecoration: 'none', textTransform: 'none',
        borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', padding: '0px', whiteSpace: 'pre-wrap',
      },
    }
    return [win, text]
  },
})

// 파일 칩 — 📄 경로 (단일)
SNIPPETS.push({
  id: 'fileChip', group: '코드', label: '파일 칩', desc: '📄 파일 경로',
  build: (cs) => {
    const w = 200, h = 30
    const { x, y } = center(cs, w, h)
    return [textSpec({ x, y, w, h, content: '📄 src/App.jsx', bg: 'rgba(148,163,184,0.18)', color: '#334155', radius: 6, size: 13, weight: 500, align: 'center', padding: '0 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' })]
  },
})

// 말풍선 — 버블 + 꼬리 (복합)
SNIPPETS.push({
  id: 'speechBubble', group: '노트', label: '말풍선', desc: '꼬리 달린 대화 버블',
  build: (cs, theme) => {
    const w = 240, h = 90
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    const bubble = textSpec({ x, y, w, h, content: '대화를 입력하세요', bg: accent, color: '#ffffff', radius: 16, size: 16, weight: 500, align: 'center', shadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '10px 16px' })
    const tail = shapeSpec({ x: x + 30, y: y + h - 7, w: 18, h: 18, bg: accent, radius: 2 })
    tail.rotation = 45
    return [bubble, tail]
  },
})

// 코너 리본 — 기울인 강조 배너 (단일)
SNIPPETS.push({
  id: 'cornerRibbon', group: '구조', label: '코너 리본', desc: '추천/한정 강조 배너(기울임)',
  build: (cs, theme) => {
    const w = 160, h = 34
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    const s = textSpec({ x, y, w, h, content: '추천', bg: accent, color: '#ffffff', radius: 0, size: 15, weight: 800, align: 'center', letter: '2px', shadow: '0 2px 6px rgba(0,0,0,0.2)' })
    s.rotation = -45
    return [s]
  },
})

// 비교 막대(전/후) — 라벨 + 막대 2행 (복합)
SNIPPETS.push({
  id: 'comparisonBars', group: '데이터', label: '비교 막대(전/후)', desc: 'Before/After 막대 비교',
  build: (cs, theme) => {
    const w = 380, h = 90
    const { x, y } = center(cs, w, h)
    const accent = theme?.accent || ACCENT_FALLBACK
    const muteC = theme?.roles?.body?.color || '#475569'
    const labelW = 70, barX = x + labelW, barMax = w - labelW, barH = 22
    return [
      textSpec({ x, y, w: labelW, h: barH, content: 'Before', bg: 'rgba(0,0,0,0)', color: muteC, size: 13, weight: 600, align: 'left' }),
      shapeSpec({ x: barX, y, w: Math.round(barMax * 0.4), h: barH, bg: '#cbd5e1', radius: 6 }),
      textSpec({ x, y: y + 44, w: labelW, h: barH, content: 'After', bg: 'rgba(0,0,0,0)', color: muteC, size: 13, weight: 600, align: 'left' }),
      shapeSpec({ x: barX, y: y + 44, w: Math.round(barMax * 0.85), h: barH, bg: accent, radius: 6 }),
    ]
  },
})

// 아바타 + 이름/직함 (복합)
SNIPPETS.push({
  id: 'avatarCard', group: '인물', label: '아바타 + 이름', desc: '원형 아바타 + 이름/직함',
  build: (cs, theme) => {
    const w = 240, h = 64
    const { x, y } = center(cs, w, h)
    const titleC = theme?.roles?.title?.color || '#1e293b'
    const muteC = theme?.roles?.muted?.color || '#64748b'
    const d = 56, tx = x + d + 14, tw = w - d - 14, cy = y + (h - d) / 2
    return [
      shapeSpec({ x, y: cy, w: d, h: d, bg: 'rgba(148,163,184,0.25)', radius: '50%' }),
      textSpec({ x, y: cy, w: d, h: d, content: '👤', bg: 'rgba(0,0,0,0)', color: '#ffffff', size: 26, align: 'center' }),
      textSpec({ x: tx, y: y + 8, w: tw, h: 26, content: '이름', bg: 'rgba(0,0,0,0)', color: titleC, size: 17, weight: 700, align: 'left' }),
      textSpec({ x: tx, y: y + 36, w: tw, h: 22, content: '직함 · 회사', bg: 'rgba(0,0,0,0)', color: muteC, size: 13, weight: 400, align: 'left' }),
    ]
  },
})

export function getSnippet(id) {
  return SNIPPETS.find(s => s.id === id)
}
