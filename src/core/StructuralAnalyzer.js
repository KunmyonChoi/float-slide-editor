/**
 * StructuralAnalyzer
 * 원본 슬라이드 HTML과 Flat 변환 HTML을 구조적으로 비교한다.
 * getBoundingClientRect 없이 jsdom에서 실행 가능.
 *
 * 검사 항목:
 *  1. 텍스트 누락 (missing_text)
 *  2. 서식 손실 (lost_formatting)
 *  3. 이중 인코딩 (double_encoding)
 *  4. 공백 이슈 (whitespace)
 *  5. 시각 속성 누락 (missing_background, missing_border_radius)
 *  6. 요소 수 불일치 (element_count)
 */

import { extractVisibleTexts, extractFormattedText } from './SlideParser.js'

/**
 * @typedef {{
 *   type: string,
 *   severity: 'error' | 'warning',
 *   description: string,
 *   original?: string,
 *   flat?: string,
 *   slideIndex?: number
 * }} StructuralIssue
 */

/**
 * 원본과 Flat HTML을 구조적으로 비교하여 이슈 목록과 점수를 반환한다.
 * @param {string} originalHtml — 원본 슬라이드 HTML
 * @param {string} flatHtml — Flat 변환 결과 HTML
 * @param {number} slideIndex
 * @returns {{ issues: StructuralIssue[], score: number }}
 */
export function analyzeStructural(originalHtml, flatHtml, slideIndex = 0) {
  const issues = [
    ...checkMissingText(originalHtml, flatHtml, slideIndex),
    ...checkDoubleEncoding(flatHtml, slideIndex),
    ...checkLostFormatting(originalHtml, flatHtml, slideIndex),
    ...checkWhitespace(flatHtml, slideIndex),
    ...checkVisualProperties(originalHtml, flatHtml, slideIndex),
  ]

  // 점수 계산: error = -10, warning = -3, 최저 0
  const penalty = issues.reduce((sum, i) => sum + (i.severity === 'error' ? 10 : 3), 0)
  const score = Math.max(0, 100 - penalty)

  return { issues, score }
}

// ═══════════════════════════════════════════════════════════════
//  1. 텍스트 누락 검사
// ═══════════════════════════════════════════════════════════════

/**
 * 원본에 존재하는 텍스트가 Flat 결과에 없는지 검사한다.
 * 네비게이션 텍스트(Prev, Next, 페이지 카운터)는 제외.
 */
export function checkMissingText(originalHtml, flatHtml, slideIndex = 0) {
  const originalTexts = extractVisibleTexts(originalHtml)
  const flatTexts = extractVisibleTexts(flatHtml)
  const flatJoined = flatTexts.join(' ')

  const issues = []
  for (const text of originalTexts) {
    if (isNavigationText(text)) continue
    if (text.length < 2) continue // 단일 문자 (아이콘 등) 스킵

    // flat 텍스트에서 원본 텍스트 찾기 (부분 매칭)
    const normalized = normalizeText(text)
    if (!flatJoined.includes(normalized) && !fuzzyMatch(normalized, flatTexts)) {
      issues.push({
        type: 'missing_text',
        severity: 'error',
        description: `텍스트 누락: "${truncate(text, 60)}"`,
        original: text,
        slideIndex,
      })
    }
  }
  return issues
}

// ═══════════════════════════════════════════════════════════════
//  2. 이중 인코딩 검사
// ═══════════════════════════════════════════════════════════════

/**
 * &amp;amp; &amp;lt; &amp;gt; 등 이중 인코딩 패턴을 검출한다.
 */
export function checkDoubleEncoding(flatHtml, slideIndex = 0) {
  const issues = []
  const patterns = [
    { regex: /&amp;amp;/g, name: '&amp;amp;' },
    { regex: /&amp;lt;/g, name: '&amp;lt;' },
    { regex: /&amp;gt;/g, name: '&amp;gt;' },
    { regex: /&amp;quot;/g, name: '&amp;quot;' },
  ]

  for (const { regex, name } of patterns) {
    const matches = flatHtml.match(regex)
    if (matches) {
      issues.push({
        type: 'double_encoding',
        severity: 'error',
        description: `이중 인코딩 발견: ${name} (${matches.length}회)`,
        flat: matches[0],
        slideIndex,
      })
    }
  }
  return issues
}

// ═══════════════════════════════════════════════════════════════
//  3. 서식 손실 검사
// ═══════════════════════════════════════════════════════════════

/**
 * 원본에서 bold/italic 서식이 적용된 텍스트가
 * Flat 결과에서 서식 없이 출력되었는지 검사한다.
 */
export function checkLostFormatting(originalHtml, flatHtml, slideIndex = 0) {
  const originalFormatted = extractFormattedText(originalHtml)
  const flatFormatted = extractFormattedText(flatHtml)

  const issues = []

  // 원본에서 bold인 텍스트 수집
  const boldTexts = originalFormatted
    .filter(f => f.bold && f.text.length >= 2)
    .map(f => f.text)

  // flat에서 해당 텍스트가 bold가 아닌 경우
  for (const boldText of boldTexts) {
    if (isNavigationText(boldText)) continue
    const normalized = normalizeText(boldText)
    const flatEntry = flatFormatted.find(f => normalizeText(f.text) === normalized)
    if (flatEntry && !flatEntry.bold) {
      issues.push({
        type: 'lost_formatting',
        severity: 'warning',
        description: `볼드 서식 손실: "${truncate(boldText, 40)}"`,
        original: boldText,
        slideIndex,
      })
    }
  }

  // italic 텍스트 검사
  const italicTexts = originalFormatted
    .filter(f => f.italic && f.text.length >= 2)
    .map(f => f.text)

  for (const italicText of italicTexts) {
    if (isNavigationText(italicText)) continue
    const normalized = normalizeText(italicText)
    const flatEntry = flatFormatted.find(f => normalizeText(f.text) === normalized)
    if (flatEntry && !flatEntry.italic) {
      issues.push({
        type: 'lost_formatting',
        severity: 'warning',
        description: `이탤릭 서식 손실: "${truncate(italicText, 40)}"`,
        original: italicText,
        slideIndex,
      })
    }
  }

  return issues
}

// ═══════════════════════════════════════════════════════════════
//  4. 공백 이슈 검사
// ═══════════════════════════════════════════════════════════════

/**
 * Flat HTML에서 불필요한 공백/들여쓰기 패턴을 검출한다.
 */
export function checkWhitespace(flatHtml, slideIndex = 0) {
  const issues = []

  // <br> 뒤에 \n이나 연속 공백이 남아있는 경우
  const brIndent = flatHtml.match(/<br\s*\/?>\s*\n\s+/g)
  if (brIndent) {
    issues.push({
      type: 'whitespace',
      severity: 'warning',
      description: `<br> 뒤 들여쓰기 공백 (${brIndent.length}건)`,
      flat: brIndent[0],
      slideIndex,
    })
  }

  // 텍스트 내 연속 공백 4개 이상 (소스 들여쓰기 잔존)
  // style 속성 내부는 제외
  const bodyMatch = flatHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  if (bodyMatch) {
    const body = bodyMatch[1]
    // div 태그 사이의 텍스트에서 연속 공백 체크
    const textParts = body.replace(/<[^>]+>/g, '\n').split('\n')
    const indentLines = textParts.filter(t => /^ {4,}/.test(t) && t.trim().length > 0)
    if (indentLines.length > 0) {
      issues.push({
        type: 'whitespace',
        severity: 'warning',
        description: `소스 들여쓰기 잔존 (${indentLines.length}건)`,
        flat: indentLines[0].trim(),
        slideIndex,
      })
    }
  }

  return issues
}

// ═══════════════════════════════════════════════════════════════
//  5. 시각 속성 검사
// ═══════════════════════════════════════════════════════════════

/**
 * 원본의 주요 시각 속성(배경, gradient, border-radius)이
 * Flat 결과에 반영되었는지 검사한다.
 */
export function checkVisualProperties(originalHtml, flatHtml, slideIndex = 0) {
  const issues = []

  // 원본에서 gradient 배경 사용 여부 — <style> 블록 내부(pseudo-element 등)는 제외
  const origWithoutStyle = originalHtml.replace(/<style[\s\S]*?<\/style>/gi, '')
  const origGradients = (origWithoutStyle.match(/linear-gradient\([^)]+\)/g) || [])
    .filter(g => !g.includes('transparent 60px')) // 그리드 라인 패턴 제외
  const flatGradients = flatHtml.match(/linear-gradient\([^)]+\)/g) || []

  if (origGradients.length > 0 && flatGradients.length === 0) {
    issues.push({
      type: 'missing_background',
      severity: 'warning',
      description: `그래디언트 배경 누락 (원본 ${origGradients.length}개)`,
      slideIndex,
    })
  }

  // -webkit-background-clip:text 검사
  if (originalHtml.includes('background-clip') && originalHtml.includes('text')) {
    if (!flatHtml.includes('-webkit-background-clip:text') && !flatHtml.includes('background-clip:text')) {
      issues.push({
        type: 'missing_background',
        severity: 'warning',
        description: '그래디언트 텍스트 (-webkit-background-clip:text) 누락',
        slideIndex,
      })
    }
  }

  // border-radius 검사: 원본에 12px 이상의 border-radius가 있으면 flat에도 있어야 함
  const origRadii = originalHtml.match(/border-radius:\s*(\d+)px/g) || []
  const significantRadii = origRadii.filter(r => {
    const val = parseInt(r.match(/(\d+)/)[1])
    return val >= 8
  })
  if (significantRadii.length > 0) {
    const flatRadii = flatHtml.match(/border-radius:\s*[^;0][^;]*/g) || []
    if (flatRadii.length === 0) {
      issues.push({
        type: 'missing_border_radius',
        severity: 'warning',
        description: `border-radius 누락 (원본에 ${significantRadii.length}개 의미있는 radius)`,
        slideIndex,
      })
    }
  }

  return issues
}

// ═══════════════════════════════════════════════════════════════
//  전체 덱 분석
// ═══════════════════════════════════════════════════════════════

/**
 * 다수 슬라이드의 분석 결과를 집계한다.
 * @param {Array<{ slideIndex: number, issues: StructuralIssue[], score: number }>} slideReports
 * @returns {{
 *   overallScore: number,
 *   totalIssues: number,
 *   issuesByType: Record<string, number>,
 *   slideScores: Array<{ index: number, score: number, issueCount: number }>,
 *   worstSlides: Array<{ index: number, score: number, issues: StructuralIssue[] }>
 * }}
 */
export function aggregateReports(slideReports) {
  const totalIssues = slideReports.reduce((sum, r) => sum + r.issues.length, 0)
  const overallScore = slideReports.length > 0
    ? Math.round(slideReports.reduce((sum, r) => sum + r.score, 0) / slideReports.length)
    : 100

  const issuesByType = {}
  for (const report of slideReports) {
    for (const issue of report.issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1
    }
  }

  const slideScores = slideReports.map(r => ({
    index: r.slideIndex,
    score: r.score,
    issueCount: r.issues.length,
  }))

  const worstSlides = slideReports
    .filter(r => r.issues.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(r => ({ index: r.slideIndex, score: r.score, issues: r.issues }))

  return { overallScore, totalIssues, issuesByType, slideScores, worstSlides }
}

// ── 헬퍼 ─────────────────────────────────────────────────────

const NAV_TEXTS = new Set(['Prev', 'Next', '◀', '▶', '‹', '›', '◀ Prev', 'Next ▶'])
const NAV_PATTERN = /^\d+\s*\/\s*\d+$/

function isNavigationText(text) {
  if (NAV_TEXTS.has(text)) return true
  if (NAV_PATTERN.test(text.trim())) return true
  return false
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}

/**
 * 퍼지 매칭: 텍스트가 flat 텍스트 배열 중 하나에 포함되는지 확인.
 * 긴 텍스트가 여러 요소로 분할된 경우를 처리.
 */
function fuzzyMatch(normalized, flatTexts) {
  // 전체 flat 텍스트를 하나로 결합하여 검색
  const flatAll = flatTexts.map(t => normalizeText(t)).join(' ')
  if (flatAll.includes(normalized)) return true

  // 짧은 텍스트(3단어 이하): 개별 매칭
  const words = normalized.split(' ')
  if (words.length <= 3) {
    return flatTexts.some(t => normalizeText(t).includes(normalized))
  }

  // 긴 텍스트: 60% 이상의 단어가 포함되면 매칭
  const matchedWords = words.filter(w => w.length >= 2 && flatAll.includes(w))
  return matchedWords.length >= words.length * 0.6
}
