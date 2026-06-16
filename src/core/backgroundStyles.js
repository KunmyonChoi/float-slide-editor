/**
 * 슬라이드 배경 AI 생성용 스타일 프리셋.
 * 일반 이미지와 달리 "텍스트가 올라갈 자리(safe zone)를 비우고 절제"되도록
 * 각 스타일 directive에 세이프존/저대비 지시를 내장한다.
 *
 * 시작: 서로 차이가 큰 5종. (최종적으로 17종까지 확장 예정)
 */
export const BACKGROUND_STYLES = [
  {
    id: 'gradient',
    label: '소프트 그라데이션',
    directive: 'a soft, smooth multi-color mesh gradient with gentle blends and lots of open space, very minimal, no shapes or objects',
  },
  {
    id: 'sidePanel',
    label: '사이드 패널',
    directive: 'a structured layout with a colored/textured visual block occupying only the LEFT third, and the right two-thirds left clean and empty for text; clear vertical division',
  },
  {
    id: 'geometric',
    label: '기하 추상',
    directive: 'subtle abstract geometric shapes (circles, triangles, soft blobs) arranged only around the corners and edges, with the central area kept clean and uncluttered',
  },
  {
    id: 'photoScrim',
    label: '사진 + 스크림',
    directive: 'a full-bleed atmospheric photographic scene with a smooth dark gradient overlay (scrim) along the bottom and side so light text stays readable; cinematic, muted',
  },
  {
    id: 'sectionDivider',
    label: '섹션 디바이더',
    directive: 'a bold, expressive section-divider background with a strong color field and large dramatic abstract forms on one side, leaving the opposite side open for a large section title',
  },
]

export const DEFAULT_BACKGROUND_STYLE_ID = 'gradient'

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
