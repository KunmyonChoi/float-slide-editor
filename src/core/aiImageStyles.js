/**
 * AI 이미지 화풍 목록 — 텍스트→이미지(FlatAiBar)와 인포그래픽 변환(InfographicModal)이 공유.
 * directive는 프롬프트/스펙에 주입되는 영어 화풍 지시문. 'auto'는 빈 문자열(모델/시스템 기본 사용).
 */
export const IMAGE_STYLES = [
  { id: 'auto', label: '자동 (내용에 맞게)', directive: '' },
  { id: 'flat', label: '플랫 인포그래픽', directive: 'clean flat vector infographic illustration, simple geometric shapes, modern business style' },
  { id: 'isometric', label: '아이소메트릭', directive: 'isometric 3D vector illustration, soft shadows, clean and modern' },
  { id: 'line', label: '미니멀 라인아트', directive: 'minimal single-weight line art, outline illustration with lots of negative space' },
  { id: '3d', label: '3D 렌더', directive: 'soft 3D render, rounded clay-like shapes, studio lighting, pastel palette' },
  { id: 'photo', label: '사진 (실사)', directive: 'photorealistic editorial photograph, natural lighting, shallow depth of field' },
  { id: 'geometric', label: '추상 지오메트릭', directive: 'abstract geometric composition, bold shapes and smooth gradients, corporate modern' },
  { id: 'watercolor', label: '수채화', directive: 'soft watercolor illustration, gentle washes, hand-painted texture' },
  { id: 'sketch', label: '손그림 스케치', directive: 'hand-drawn sketch, friendly pencil and ink doodle style' },
]

/**
 * 인포그래픽 변환용 화풍 목록 — 공통 목록에 '원본 스타일 유지'를 추가.
 * (텍스트→이미지와 달리 인포그래픽은 입력 슬라이드가 있어 원본 스타일 보존이 의미가 있다.
 *  특히 이미지 편집 방식과 함께 쓰면 원본 구도·색·서체를 최대한 유지한다.)
 */
export const INFOGRAPHIC_STYLES = [
  { id: 'original', label: '원본 스타일 유지', directive: "preserve the original slide's existing visual style, color palette, fonts and overall look as closely as possible; redraw cleanly but do NOT switch to a different art style" },
  ...IMAGE_STYLES,
]

