/**
 * FlatCompare
 * 원본 iframe DOM과 Flat 변환 결과를 요소 단위로 비교하여
 * 누락/추가/위치 오차를 정량적으로 리포트한다.
 * FlatExtractor와 동일한 필터링 규칙을 사용한다.
 */

import { isVisuallyMeaningful, isNavigationElement, hasChildTextElements, INLINE_TAGS, hasDistinctStyle, isEmbeddedInline } from './FlatExtractor'

/** iframe에서 시각적으로 유효한 원본 요소 목록 수집 (FlatExtractor와 동일 규칙) */
function collectOriginalElements(iframeRef) {
  const iframe = iframeRef?.current
  if (!iframe) return []
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) return []

  const result = []
  const allEls = doc.querySelectorAll('[data-editor-id]')

  for (const el of allEls) {
    const cs = win.getComputedStyle(el)
    if (cs.display === 'none') continue
    if (isNavigationElement(el, cs)) continue

    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue

    const editorType = el.getAttribute('data-editor-type')
    const sourceId = el.getAttribute('data-editor-id')
    const tag = el.tagName.toLowerCase()

    let include = false
    let type = editorType

    if (editorType === 'text') {
      // 인라인 서식 요소이면서 부모 텍스트에 포함되는 경우 스킵
      const tag = el.tagName.toLowerCase()
      if (INLINE_TAGS.has(tag)) {
        const parent = el.parentElement
        if (parent && parent.hasAttribute('data-editor-id') &&
            parent.getAttribute('data-editor-type') === 'text') {
          if (!hasDistinctStyle(el) || isEmbeddedInline(el)) continue
        }
      }
      // 자식 독립 텍스트 요소만 있고 고유 텍스트+시각 속성이 없으면 스킵
      if (hasChildTextElements(el)) {
        let ownText = ''
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) ownText += node.textContent
          else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute('data-editor-id')) {
              const childTag = node.tagName.toLowerCase()
              if (!INLINE_TAGS.has(childTag)) continue
              if (hasDistinctStyle(node) && !isEmbeddedInline(node)) continue
            }
            ownText += node.textContent
          }
        }
        if (!ownText.trim() && !isVisuallyMeaningful(cs)) continue
      }
      include = true
    } else if (editorType === 'image') {
      include = true
    } else if (editorType === 'container') {
      if (isVisuallyMeaningful(cs)) {
        include = true
        type = 'shape'
      } else {
        // 텍스트만 있는 말단 컨테이너는 text로 추출
        const containerText = (el.textContent || '').trim()
        const hasChildEditors = el.querySelector('[data-editor-id]')
        if (containerText && !hasChildEditors) {
          include = true
          type = 'text'
        }
      }
    }

    if (include) {
      // 텍스트 추출 (독립 추출 대상 제외, embedded 인라인은 포함)
      let text = ''
      if (type === 'text') {
        if (hasChildTextElements(el)) {
          for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent
            else if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.hasAttribute('data-editor-id')) {
                const childTag = node.tagName.toLowerCase()
                if (!INLINE_TAGS.has(childTag)) continue
                if (hasDistinctStyle(node) && !isEmbeddedInline(node)) continue
              }
              text += node.textContent
            }
          }
          text = text.trim()
        } else {
          text = (el.textContent || '').trim()
        }
      }

      result.push({
        sourceId, tag, type,
        x: rect.left, y: rect.top,
        w: rect.width, h: rect.height,
        text,
        src: editorType === 'image' ? (el.getAttribute('src') || '') : '',
      })
    }
  }

  return result
}

/**
 * 원본 iframe과 Flat 요소를 비교한다.
 * @param {React.RefObject} iframeRef
 * @param {FlatElement[]} flatElements
 * @returns {{ matched, missing, extra, summary }}
 */
export function compareFlatConversion(iframeRef, flatElements) {
  const originals = collectOriginalElements(iframeRef)

  // sourceId → flat 요소 맵
  const flatBySource = new Map()
  const unmatchedFlat = new Set()
  for (const fe of flatElements) {
    if (fe.sourceId === '__body') continue
    flatBySource.set(fe.sourceId, fe)
    unmatchedFlat.add(fe.sourceId)
  }

  const matched = []
  const missing = []

  for (const orig of originals) {
    const fe = flatBySource.get(orig.sourceId)
    if (fe) {
      unmatchedFlat.delete(orig.sourceId)
      const dx = Math.abs(fe.x - orig.x)
      const dy = Math.abs(fe.y - orig.y)
      const dw = Math.abs(fe.width - orig.w)
      const dh = Math.abs(fe.height - orig.h)
      const textMatch = orig.type === 'text'
        ? fe.content.trim() === orig.text
        : true

      matched.push({
        sourceId: orig.sourceId,
        tag: orig.tag,
        type: orig.type,
        original: { x: orig.x, y: orig.y, w: orig.w, h: orig.h, text: orig.text },
        flat: { x: fe.x, y: fe.y, w: fe.width, h: fe.height, text: fe.content?.trim() || '' },
        delta: { dx: round(dx), dy: round(dy), dw: round(dw), dh: round(dh) },
        posDelta: round(Math.sqrt(dx * dx + dy * dy)),
        sizeDelta: round(Math.sqrt(dw * dw + dh * dh)),
        textMatch,
      })
    } else {
      missing.push(orig)
    }
  }

  const extra = [...unmatchedFlat].map(sourceId => {
    const fe = flatBySource.get(sourceId)
    return { id: fe.id, sourceId, type: fe.type, x: fe.x, y: fe.y, w: fe.width, h: fe.height }
  })

  const posDeltas = matched.map(m => m.posDelta)
  const avgPosDelta = posDeltas.length > 0
    ? round(posDeltas.reduce((a, b) => a + b, 0) / posDeltas.length)
    : 0
  const maxPosDelta = posDeltas.length > 0 ? Math.max(...posDeltas) : 0
  const textMismatches = matched.filter(m => !m.textMatch).length

  return {
    matched,
    missing,
    extra,
    summary: {
      total: originals.length,
      matched: matched.length,
      missing: missing.length,
      extra: extra.length,
      avgPosDelta,
      maxPosDelta,
      textMismatches,
    },
  }
}

function round(n) { return Math.round(n * 10) / 10 }
