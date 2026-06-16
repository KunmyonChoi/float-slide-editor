/**
 * 슬라이드 배경 AI 생성용 스타일 프리셋 (17종).
 * 일반 이미지와 달리 "텍스트가 올라갈 자리(safe zone)를 비우고 절제"되도록
 * 각 directive에 스타일 묘사를 두고, 공통 세이프존/무텍스트 규칙은 buildBackgroundPrompt가 부여.
 *
 * 각 항목: { id, label(한글), group(섹션), desc(한 줄 설명), directive(영문 프롬프트) }
 */

// 섹션 표시 순서
export const BACKGROUND_GROUPS = ['미니멀', '구조형', '그래픽', '사진/몰입', '기능형']

export const BACKGROUND_STYLES = [
  // ── 미니멀 ──
  { id: 'gradient', group: '미니멀', label: '소프트 그라데이션', desc: '부드러운 색 번짐, 여백 넉넉',
    directive: 'a soft, smooth multi-color mesh gradient with gentle blends and lots of open space, very minimal, no shapes or objects' },
  { id: 'solidAccent', group: '미니멀', label: '단색 + 코너 악센트', desc: '단색 바탕에 모서리 작은 곡선/도형',
    directive: 'a solid flat color background with a single small subtle accent shape or curved line only in one corner, the rest empty' },
  { id: 'texture', group: '미니멀', label: '미세 텍스처', desc: '종이·노이즈·그리드 질감, 거의 무지',
    directive: 'a near-solid background with a very subtle fine texture (paper grain, faint grid or tiny dots), low contrast and understated' },

  // ── 구조형 ──
  { id: 'sidePanel', group: '구조형', label: '사이드 패널', desc: '좌측 1/3 컬러블록, 우측 비움',
    directive: 'a structured layout with a colored or textured visual block occupying only the LEFT third, the right two-thirds left clean and empty for text; clear vertical division' },
  { id: 'headerBand', group: '구조형', label: '상단 헤더 밴드', desc: '위쪽 띠(제목 자리) + 아래 여백',
    directive: 'a horizontal colored band across the TOP of the slide for a title area, the rest below kept clean and empty' },
  { id: 'diagonal', group: '구조형', label: '대각선 분할', desc: '사선으로 둘로 나뉜 컬러',
    directive: 'the canvas split diagonally into two contrasting color fields, one side kept plain and uncluttered for text' },
  { id: 'contentCard', group: '구조형', label: '콘텐츠 카드', desc: '반투명 패널/프레임 위 텍스트',
    directive: 'a soft background with a subtle semi-transparent rounded panel or frame in the center to hold text, gentle shadow' },

  // ── 그래픽 ──
  { id: 'geometric', group: '그래픽', label: '기하 추상', desc: '모서리에 도형, 중앙 비움',
    directive: 'subtle abstract geometric shapes (circles, triangles, soft blobs) arranged only around the corners and edges, the central area kept clean' },
  { id: 'lineArt', group: '그래픽', label: '라인아트 / 블루프린트', desc: '얇은 선·등고선, 기술 느낌',
    directive: 'minimal thin line art, blueprint or topographic contour lines, monochrome and sparse, lots of empty space' },
  { id: 'memphis', group: '그래픽', label: '멤피스 / 플레이풀', desc: '컬러풀 도형을 가장자리에',
    directive: 'playful Memphis-style colorful small shapes, dots and squiggles scattered ONLY around the edges, the center kept clear' },
  { id: 'wave', group: '그래픽', label: '웨이브 / 유동 곡선', desc: '하단을 흐르는 곡선',
    directive: 'smooth flowing wave and fluid curves along the BOTTOM of the slide, the upper area kept open and clean' },

  // ── 사진/몰입 ──
  { id: 'photoScrim', group: '사진/몰입', label: '사진 + 스크림', desc: '사진 위 어두운 오버레이로 가독',
    directive: 'a full-bleed atmospheric photographic scene with a smooth dark gradient overlay (scrim) along the bottom and one side so light text stays readable; cinematic, muted' },
  { id: 'bokeh', group: '사진/몰입', label: '보케 / 파티클', desc: '다크 배경 빛망울·입자, 깊이감',
    directive: 'a dark background with soft out-of-focus bokeh lights, particles and subtle glow, deep and atmospheric' },
  { id: 'natureSilhouette', group: '사진/몰입', label: '자연 실루엣', desc: '하단 산·풍경 실루엣, 위는 비움',
    directive: 'a minimal scene with a landscape or mountain silhouette along the bottom and a wide open sky above for text' },

  // ── 기능형 ──
  { id: 'sectionDivider', group: '기능형', label: '섹션 디바이더', desc: '강렬한 컬러 + 대형 형태(섹션용)',
    directive: 'a bold, expressive section-divider background with a strong color field and large dramatic abstract forms on one side, the opposite side open for a large section title' },
  { id: 'techData', group: '기능형', label: '테크 / 데이터', desc: '노드·회로·글로우(다크)',
    directive: 'a dark technology background with a faint network of connected nodes and lines or a subtle circuit pattern with soft glow, futuristic' },
  { id: 'corporate', group: '기능형', label: '코퍼릿 / 브랜드', desc: '클린 + 악센트 라인 + 로고 자리',
    directive: 'a clean corporate background with a single thin accent line or bar and lots of white space, professional and restrained' },
]

export const DEFAULT_BACKGROUND_STYLE_ID = 'gradient'

export function getBackgroundStyle(id) {
  return BACKGROUND_STYLES.find(s => s.id === id) || BACKGROUND_STYLES[0]
}

/** AI 배경 생성 프롬프트 — 세이프존/무텍스트/16:9 공통 규칙 + 스타일 directive + 선택 주제 */
export function buildBackgroundPrompt(style, extra) {
  const dir = style?.directive || ''
  const subject = (extra || '').trim() ? ` Theme/subject to evoke: ${extra.trim()}.` : ''
  return [
    'A clean, modern 16:9 presentation slide background image.',
    dir + '.',
    subject,
    'Keep it subtle and low-contrast so overlaid title and body text remain readable;',
    'leave generous empty negative space for text.',
    'Absolutely NO text, words, letters, numbers, watermarks, or logos in the image.',
    'Flat, professional, high resolution.',
  ].filter(Boolean).join(' ')
}
