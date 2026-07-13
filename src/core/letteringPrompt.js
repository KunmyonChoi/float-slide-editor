import { findLetteringStyle, findLetteringPosition, findLetteringBg } from './aiLetteringPresets'

/**
 * 이미지 레터링 프롬프트 빌더.
 * (mode, 배경, 위치, 스타일, 텍스트) → gpt-image 프롬프트.
 * - mode 'inplace'(제자리): 박스=생성 프레임 → 프레임을 채우는 배치.
 * - mode 'title'(방송 타이틀): 위치 프리셋(로어서드 등) 배치.
 * - 배경 scene은 editImage(씬 위), black/white는 generateImage(단색 베이스)에 쓴다.
 *
 * @param {{ text:string, mode?:'inplace'|'title', bgId?:string, positionId?:string, styleId?:string }} a
 * @returns {string}
 */
export function buildLetteringPrompt({ text, mode = 'inplace', bgId = 'scene', positionId = 'lower-third', styleId = 'youtube' } = {}) {
  const t = (text || '').trim()
  const style = findLetteringStyle(styleId)
  const bg = findLetteringBg(bgId)
  const placement = mode === 'title'
    ? findLetteringPosition(positionId).prompt
    : 'filling the frame, well-composed with small safe margins'

  return [
    `Render the following text as stylized broadcast lettering (typography), ${placement}: "${t}".`,
    `Style: ${style.directive}.`,
    bg.id === 'scene'
      ? `Background: ${bg.prompt}; blend the lettering naturally into the scene.`
      : `Background: ${bg.prompt}.`,
    'Render the text VERBATIM, exactly as written, with correct legible characters — no extra words, no duplicate text, no translation, no watermark.',
    'High contrast, clean, and readable.',
  ].join(' ')
}
