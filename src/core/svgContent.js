/**
 * svgContent — 추출·렌더가 공유하는 svg 마크업 정리 규칙.
 *
 * flat 요소는 '상자(x/y/width/height) + 마크업'으로 이뤄진다. svg는 마크업을 통째로 보존하는데,
 * 원본에서 자기를 배치하던 `position:absolute;left:…;top:…`이 그 안에 남아 있으면 렌더할 때
 * 상자 위치에 한 번 더 더해져 두 배로 밀린다. 전면 캔버스 svg(left:0;top:0)는 우연히 멀쩡했고,
 * 관계선처럼 잘라 쓴 svg에서 드러났다(실제 덱에서 곡선이 화면 아래로 쏟아졌다).
 *
 * 배치는 상자가 책임진다 — 마크업에서는 뗀다. 회전 등 다른 transform은 건드리지 않는다.
 */

const SELF_POSITIONING = new Set([
  'position', 'left', 'top', 'right', 'bottom',
  'margin', 'margin-left', 'margin-top', 'margin-right', 'margin-bottom',
])

/**
 * 루트 `<svg>` 태그의 인라인 style에서 자기 배치 선언만 지운다(안쪽 자식은 그대로).
 * @param {string} html svg outerHTML
 * @returns {string}
 */
export function stripSvgSelfPositioning(html) {
  if (typeof html !== 'string' || !html) return html
  return html.replace(/^\s*<svg\b[^>]*>/i, (tag) =>
    tag.replace(/\sstyle\s*=\s*"([^"]*)"/i, (_attr, style) => {
      const kept = style
        .split(';')
        .map(d => d.trim())
        .filter(d => d && !SELF_POSITIONING.has(d.split(':')[0].trim().toLowerCase()))
      return kept.length ? ` style="${kept.join(';')};"` : ''
    }))
}
