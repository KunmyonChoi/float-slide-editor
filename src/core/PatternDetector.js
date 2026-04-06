/**
 * PatternDetector
 * 다수 슬라이드의 분석 결과에서 반복되는 실패 패턴을 감지하고
 * 수정해야 할 코드 위치를 가이드한다.
 */

/**
 * @typedef {{
 *   pattern: string,
 *   description: string,
 *   frequency: number,
 *   affectedSlides: number[],
 *   suggestedFix: string,
 *   relevantCode: string
 * }} PatternAnalysis
 */

/** 패턴 규칙 정의 */
const PATTERN_RULES = [
  {
    pattern: 'inline_bold_lost',
    issueType: 'lost_formatting',
    match: (issue) => issue.description?.includes('볼드'),
    description: '<strong> 또는 <b> 태그의 볼드 서식이 Flat 변환에서 손실됨',
    suggestedFix: 'getRichTextContent()에서 SEMANTIC_FORMAT_TAGS 처리 확인. data-editor-id 있는 <strong>이 cleanInlineHtml 대신 textContent로 추출되고 있을 수 있음.',
    relevantCode: 'src/core/FlatExtractor.js → getRichTextContent(), SEMANTIC_FORMAT_TAGS',
  },
  {
    pattern: 'inline_italic_lost',
    issueType: 'lost_formatting',
    match: (issue) => issue.description?.includes('이탤릭'),
    description: '<em> 또는 <i> 태그의 이탤릭 서식이 손실됨',
    suggestedFix: 'getRichTextContent()에서 em, i 태그 보존 확인.',
    relevantCode: 'src/core/FlatExtractor.js → getRichTextContent(), SEMANTIC_FORMAT_TAGS',
  },
  {
    pattern: 'text_missing_in_table',
    issueType: 'missing_text',
    match: (issue) => {
      const text = issue.original || ''
      // 테이블 셀 관련 짧은 텍스트 패턴
      return text.length < 50
    },
    description: '테이블 셀(<td>) 내 텍스트가 Flat 변환에서 누락됨',
    suggestedFix: 'tryMergeContainerText()의 병합 조건 확인. 셀 내 인라인 자식이 있을 때 텍스트가 누락될 수 있음.',
    relevantCode: 'src/core/FlatExtractor.js → tryMergeContainerText(), buildFlatElement()',
  },
  {
    pattern: 'double_encoding',
    issueType: 'double_encoding',
    match: () => true,
    description: 'HTML 엔티티가 이중 인코딩됨 (&amp;amp; 등)',
    suggestedFix: 'getRichTextContent()에서 isRich=true 반환 시 이미 escapeHtml() 적용됨. exporter에서 추가 escHtml() 호출하지 않는지 확인.',
    relevantCode: 'src/core/FlatExtractor.js → getRichTextContent(), src/core/FlatExporter.js → exportFlatHtml()',
  },
  {
    pattern: 'whitespace_after_br',
    issueType: 'whitespace',
    match: (issue) => issue.description?.includes('<br>'),
    description: '<br> 태그 뒤에 소스 코드 들여쓰기 공백이 잔존함',
    suggestedFix: 'getRichTextContent()의 afterBr 로직 확인. \\n + 공백 조합이 /^\\s+/ 정규식으로 처리되는지 확인.',
    relevantCode: 'src/core/FlatExtractor.js → getRichTextContent() afterBr 처리',
  },
  {
    pattern: 'border_radius_lost',
    issueType: 'missing_border_radius',
    match: () => true,
    description: '부모의 overflow:hidden에 의한 border-radius 클리핑이 자식에 상속되지 않음',
    suggestedFix: 'getInheritedBorderRadius()의 TOLERANCE 값(현재 4px)과 edge detection 로직 확인. 병합 요소 경로에서도 적용되는지 확인.',
    relevantCode: 'src/core/FlatExtractor.js → getInheritedBorderRadius(), buildFlatElement(), tryMergeContainerText()',
  },
  {
    pattern: 'gradient_text_lost',
    issueType: 'missing_background',
    match: (issue) => issue.description?.includes('background-clip') || issue.description?.includes('그래디언트 텍스트'),
    description: '-webkit-background-clip:text를 사용한 그래디언트 텍스트가 손실됨',
    suggestedFix: 'extractStyles()에서 webkitBackgroundClip 캡처 확인. textStyle()에서 -webkit-background-clip:text 조건 출력 확인.',
    relevantCode: 'src/core/FlatExtractor.js → extractStyles(), src/core/FlatExporter.js → textStyle()',
  },
]

/**
 * 다수 슬라이드의 분석 결과에서 반복 패턴을 감지한다.
 * @param {Array<{ slideIndex: number, issues: object[] }>} slideReports
 * @returns {PatternAnalysis[]}
 */
export function detectPatterns(slideReports) {
  const patternMap = new Map()

  for (const report of slideReports) {
    for (const issue of report.issues) {
      for (const rule of PATTERN_RULES) {
        if (issue.type === rule.issueType && rule.match(issue)) {
          if (!patternMap.has(rule.pattern)) {
            patternMap.set(rule.pattern, {
              pattern: rule.pattern,
              description: rule.description,
              frequency: 0,
              affectedSlides: [],
              suggestedFix: rule.suggestedFix,
              relevantCode: rule.relevantCode,
            })
          }
          const entry = patternMap.get(rule.pattern)
          entry.frequency++
          if (!entry.affectedSlides.includes(report.slideIndex)) {
            entry.affectedSlides.push(report.slideIndex)
          }
        }
      }
    }
  }

  // 빈도 내림차순 정렬
  return Array.from(patternMap.values()).sort((a, b) => b.frequency - a.frequency)
}

/**
 * 두 분석 보고서를 비교하여 개선/회귀를 감지한다.
 * @param {Array<{ slideIndex: number, issues: object[], score: number }>} previous
 * @param {Array<{ slideIndex: number, issues: object[], score: number }>} current
 * @returns {{
 *   improved: Array<{ slideIndex: number, prevScore: number, currScore: number, fixedIssues: string[] }>,
 *   regressed: Array<{ slideIndex: number, prevScore: number, currScore: number, newIssues: string[] }>,
 *   unchanged: number
 * }}
 */
export function diffReports(previous, current) {
  const prevMap = new Map(previous.map(r => [r.slideIndex, r]))
  const improved = []
  const regressed = []
  let unchanged = 0

  for (const curr of current) {
    const prev = prevMap.get(curr.slideIndex)
    if (!prev) continue

    if (curr.score > prev.score) {
      const prevTypes = new Set(prev.issues.map(i => i.type))
      const currTypes = new Set(curr.issues.map(i => i.type))
      const fixed = [...prevTypes].filter(t => !currTypes.has(t))
      improved.push({
        slideIndex: curr.slideIndex,
        prevScore: prev.score,
        currScore: curr.score,
        fixedIssues: fixed,
      })
    } else if (curr.score < prev.score) {
      const prevTypes = new Set(prev.issues.map(i => i.type))
      const currTypes = new Set(curr.issues.map(i => i.type))
      const newOnes = [...currTypes].filter(t => !prevTypes.has(t))
      regressed.push({
        slideIndex: curr.slideIndex,
        prevScore: prev.score,
        currScore: curr.score,
        newIssues: newOnes,
      })
    } else {
      unchanged++
    }
  }

  return { improved, regressed, unchanged }
}
