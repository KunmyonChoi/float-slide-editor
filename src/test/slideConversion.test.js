import { describe, it, expect } from 'vitest'
import { parseSlideDeck, wrapSlideAsDocument, extractVisibleTexts, extractFormattedText } from '../core/SlideParser'
import {
  analyzeStructural,
  checkMissingText,
  checkDoubleEncoding,
  checkLostFormatting,
  checkWhitespace,
  checkVisualProperties,
  aggregateReports,
} from '../core/StructuralAnalyzer'
import { detectPatterns, diffReports } from '../core/PatternDetector'
import { captureFixture, serializeFixtures, loadFixtures, createManifest } from '../core/FixtureManager'
import { exportFlatHtml } from '../core/FlatExporter'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── 테스트 픽스처 ─────────────────────────────────────────────

const SIMPLE_DECK = `<!DOCTYPE html>
<html lang="ko">
<head>
<style>
  .slide { position: absolute; display: none; width: 100%; height: 100%; }
  .slide.active { display: flex; }
  h1 { font-size: 2rem; }
  .accent { color: #4F46E5; }
</style>
</head>
<body>
<div class="deck">
  <div class="slide active">
    <h1>첫 번째 슬라이드</h1>
    <p>일반 텍스트와 <strong>볼드 텍스트</strong>를 포함한다.</p>
  </div>
  <div class="slide">
    <h1>두 번째 슬라이드</h1>
    <p>A &amp; B 비교</p>
    <div style="background: linear-gradient(135deg, #4F46E5, #0EA5E9); border-radius: 12px; padding: 20px;">
      <span style="font-weight: 700;">핵심 메시지</span> 내용
    </div>
  </div>
  <div class="slide">
    <h1>세 번째 슬라이드</h1>
    <table><tr>
      <td><strong>항목 A</strong> 설명</td>
      <td>값 B</td>
    </tr></table>
  </div>
</div>
</body>
</html>`

// 정상적인 Flat HTML
const GOOD_FLAT = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>Flat Export</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }</style>
</head>
<body style="width:1280px;height:800px;overflow:hidden;position:relative;">
<div style="position:absolute;left:0px;top:0px;width:1280px;height:800px;z-index:0;box-sizing:border-box;overflow:hidden;background-color:rgb(255,255,255)"></div>
<div style="position:absolute;left:60px;top:48px;width:400px;height:40px;z-index:1;box-sizing:border-box;overflow:hidden;font-size:2rem;font-weight:800">첫 번째 슬라이드</div>
<div style="position:absolute;left:60px;top:100px;width:400px;height:24px;z-index:2;box-sizing:border-box;overflow:hidden;font-size:14px">일반 텍스트와 <strong>볼드 텍스트</strong>를 포함한다.</div>
</body>
</html>`

// 문제가 있는 Flat HTML (이슈 감지용)
const BAD_FLAT = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>Flat Export</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }</style>
</head>
<body style="width:1280px;height:800px;overflow:hidden;position:relative;">
<div style="position:absolute;left:60px;top:48px;width:400px;height:40px;z-index:1;box-sizing:border-box;overflow:hidden;font-size:2rem">두 번째 슬라이드</div>
<div style="position:absolute;left:60px;top:100px;width:400px;height:24px;z-index:2;box-sizing:border-box;overflow:hidden">A &amp;amp; B 비교</div>
<div style="position:absolute;left:60px;top:140px;width:400px;height:60px;z-index:3;box-sizing:border-box;overflow:hidden;background-color:rgb(255,255,255)">핵심 메시지 내용</div>
</body>
</html>`

// ═══════════════════════════════════════════════════════════════
//  SlideParser
// ═══════════════════════════════════════════════════════════════
describe('SlideParser — 덱 HTML 파싱', () => {
  it('모든 슬라이드를 추출한다', () => {
    const result = parseSlideDeck(SIMPLE_DECK)
    expect(result.slideCount).toBe(3)
    expect(result.slides).toHaveLength(3)
  })

  it('각 슬라이드에 인덱스와 HTML이 포함된다', () => {
    const { slides } = parseSlideDeck(SIMPLE_DECK)
    expect(slides[0].index).toBe(0)
    expect(slides[0].html).toContain('첫 번째 슬라이드')
    expect(slides[1].html).toContain('두 번째 슬라이드')
    expect(slides[2].html).toContain('세 번째 슬라이드')
  })

  it('슬라이드 제목을 추출한다 (h1 우선)', () => {
    const { slides } = parseSlideDeck(SIMPLE_DECK)
    expect(slides[0].title).toBe('첫 번째 슬라이드')
    expect(slides[1].title).toBe('두 번째 슬라이드')
  })

  it('글로벌 CSS를 추출한다', () => {
    const { globalStyles } = parseSlideDeck(SIMPLE_DECK)
    expect(globalStyles).toContain('.slide')
    expect(globalStyles).toContain('h1')
    expect(globalStyles).toContain('.accent')
  })

  it('네비게이션 스타일은 제외한다', () => {
    const deckWithNav = SIMPLE_DECK.replace('</body>', '<style>.nav-injected { position: fixed; }</style></body>')
    const { globalStyles } = parseSlideDeck(deckWithNav)
    expect(globalStyles).not.toContain('.nav-injected')
  })
})

describe('wrapSlideAsDocument — 독립 HTML 문서 생성', () => {
  it('완전한 HTML 구조를 반환한다', () => {
    const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
    const doc = wrapSlideAsDocument(slides[0], globalStyles)
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('<html')
    expect(doc).toContain('</html>')
    expect(doc).toContain('slide active')
  })
})

describe('extractVisibleTexts — 텍스트 추출', () => {
  it('모든 시각적 텍스트를 추출한다', () => {
    const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
    const doc = wrapSlideAsDocument(slides[0], globalStyles)
    const texts = extractVisibleTexts(doc)
    expect(texts).toContain('첫 번째 슬라이드')
  })

  it('script/style 내용은 제외한다', () => {
    const texts = extractVisibleTexts('<html><body><script>var x = 1</script><p>텍스트</p></body></html>')
    expect(texts).not.toContain('var x = 1')
    expect(texts).toContain('텍스트')
  })
})

describe('extractFormattedText — 서식 텍스트 추출', () => {
  it('bold 서식을 감지한다', () => {
    const formatted = extractFormattedText('<html><body><p>일반 <strong>볼드</strong></p></body></html>')
    const boldEntry = formatted.find(f => f.text === '볼드')
    expect(boldEntry).toBeDefined()
    expect(boldEntry.bold).toBe(true)
  })

  it('italic 서식을 감지한다', () => {
    const formatted = extractFormattedText('<html><body><em>이탤릭</em></body></html>')
    const italicEntry = formatted.find(f => f.text === '이탤릭')
    expect(italicEntry).toBeDefined()
    expect(italicEntry.italic).toBe(true)
  })

  it('fontWeight:700 인라인 스타일도 bold로 감지한다', () => {
    const formatted = extractFormattedText('<html><body><span style="font-weight:700">스타일 볼드</span></body></html>')
    const entry = formatted.find(f => f.text === '스타일 볼드')
    expect(entry.bold).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  StructuralAnalyzer
// ═══════════════════════════════════════════════════════════════
describe('StructuralAnalyzer — 구조적 비교', () => {
  describe('checkMissingText — 텍스트 누락 검사', () => {
    it('정상 변환: 누락 없음', () => {
      const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
      const original = wrapSlideAsDocument(slides[0], globalStyles)
      const issues = checkMissingText(original, GOOD_FLAT)
      expect(issues).toHaveLength(0)
    })

    it('텍스트 누락 감지', () => {
      const original = '<html><body><p>중요한 텍스트</p><p>다른 텍스트</p></body></html>'
      const flat = '<html><body><div>다른 텍스트</div></body></html>'
      const issues = checkMissingText(original, flat)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0].type).toBe('missing_text')
      expect(issues[0].severity).toBe('error')
    })

    it('네비게이션 텍스트(Prev, Next)는 무시한다', () => {
      const original = '<html><body><p>내용</p><button>Prev</button><button>Next</button><span>1 / 5</span></body></html>'
      const flat = '<html><body><div>내용</div></body></html>'
      const issues = checkMissingText(original, flat)
      expect(issues).toHaveLength(0)
    })
  })

  describe('checkDoubleEncoding — 이중 인코딩 검사', () => {
    it('이중 인코딩 감지', () => {
      const issues = checkDoubleEncoding(BAD_FLAT)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0].type).toBe('double_encoding')
    })

    it('정상 인코딩은 이슈 없음', () => {
      const issues = checkDoubleEncoding(GOOD_FLAT)
      expect(issues).toHaveLength(0)
    })
  })

  describe('checkLostFormatting — 서식 손실 검사', () => {
    it('bold 보존 시 이슈 없음', () => {
      const original = '<html><body><p>텍스트와 <strong>볼드</strong></p></body></html>'
      const flat = '<html><body><div>텍스트와 <strong>볼드</strong></div></body></html>'
      const issues = checkLostFormatting(original, flat)
      expect(issues).toHaveLength(0)
    })

    it('bold 손실 감지', () => {
      const original = '<html><body><p><strong>볼드 텍스트</strong></p></body></html>'
      const flat = '<html><body><div>볼드 텍스트</div></body></html>'
      const issues = checkLostFormatting(original, flat)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0].type).toBe('lost_formatting')
    })
  })

  describe('checkWhitespace — 공백 이슈 검사', () => {
    it('<br> 뒤 들여쓰기 감지', () => {
      const flat = '<html><body><div>첫줄<br>\n          둘째줄</div></body></html>'
      const issues = checkWhitespace(flat)
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0].type).toBe('whitespace')
    })

    it('정상 <br>은 이슈 없음', () => {
      const flat = '<html><body><div>첫줄<br>둘째줄</div></body></html>'
      const issues = checkWhitespace(flat)
      const brIssues = issues.filter(i => i.description.includes('<br>'))
      expect(brIssues).toHaveLength(0)
    })
  })

  describe('checkVisualProperties — 시각 속성 검사', () => {
    it('gradient 배경 누락 감지', () => {
      const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
      const original = wrapSlideAsDocument(slides[1], globalStyles)
      const issues = checkVisualProperties(original, BAD_FLAT)
      const bgIssues = issues.filter(i => i.type === 'missing_background')
      expect(bgIssues.length).toBeGreaterThan(0)
    })

    it('gradient 배경 보존 시 이슈 없음', () => {
      const original = '<html><body><div style="background: linear-gradient(135deg, #f00, #00f);">내용</div></body></html>'
      const flat = '<html><body><div style="background-image:linear-gradient(135deg, #f00, #00f);">내용</div></body></html>'
      const issues = checkVisualProperties(original, flat)
      const bgIssues = issues.filter(i => i.type === 'missing_background')
      expect(bgIssues).toHaveLength(0)
    })
  })

  describe('analyzeStructural — 통합 분석', () => {
    it('정상 변환: 높은 점수', () => {
      const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
      const original = wrapSlideAsDocument(slides[0], globalStyles)
      const result = analyzeStructural(original, GOOD_FLAT, 0)
      expect(result.score).toBeGreaterThanOrEqual(80)
    })

    it('문제 있는 변환: 낮은 점수', () => {
      const { slides, globalStyles } = parseSlideDeck(SIMPLE_DECK)
      const original = wrapSlideAsDocument(slides[1], globalStyles)
      const result = analyzeStructural(original, BAD_FLAT, 1)
      expect(result.score).toBeLessThan(100)
      expect(result.issues.length).toBeGreaterThan(0)
    })
  })

  describe('aggregateReports — 결과 집계', () => {
    it('다수 슬라이드의 점수를 집계한다', () => {
      const reports = [
        { slideIndex: 0, issues: [], score: 100 },
        { slideIndex: 1, issues: [{ type: 'missing_text', severity: 'error' }], score: 90 },
        { slideIndex: 2, issues: [], score: 100 },
      ]
      const agg = aggregateReports(reports)
      expect(agg.overallScore).toBe(97) // (100+90+100)/3 rounded
      expect(agg.totalIssues).toBe(1)
      expect(agg.issuesByType.missing_text).toBe(1)
      expect(agg.worstSlides).toHaveLength(1)
      expect(agg.worstSlides[0].index).toBe(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════
//  PatternDetector
// ═══════════════════════════════════════════════════════════════
describe('PatternDetector — 패턴 감지', () => {
  it('반복되는 볼드 손실 패턴을 감지한다', () => {
    const reports = [
      { slideIndex: 0, issues: [
        { type: 'lost_formatting', severity: 'warning', description: '볼드 서식 손실: "항목 A"' },
      ]},
      { slideIndex: 2, issues: [
        { type: 'lost_formatting', severity: 'warning', description: '볼드 서식 손실: "핵심 메시지"' },
      ]},
    ]
    const patterns = detectPatterns(reports)
    const boldPattern = patterns.find(p => p.pattern === 'inline_bold_lost')
    expect(boldPattern).toBeDefined()
    expect(boldPattern.frequency).toBe(2)
    expect(boldPattern.affectedSlides).toEqual([0, 2])
    expect(boldPattern.relevantCode).toContain('FlatExtractor')
  })

  it('이중 인코딩 패턴을 감지한다', () => {
    const reports = [
      { slideIndex: 1, issues: [
        { type: 'double_encoding', severity: 'error', description: '이중 인코딩 발견: &amp;amp;' },
      ]},
    ]
    const patterns = detectPatterns(reports)
    const encPattern = patterns.find(p => p.pattern === 'double_encoding')
    expect(encPattern).toBeDefined()
    expect(encPattern.suggestedFix).toContain('getRichTextContent')
  })

  it('diffReports — 개선/회귀 비교', () => {
    const prev = [
      { slideIndex: 0, issues: [{ type: 'missing_text' }], score: 90 },
      { slideIndex: 1, issues: [{ type: 'double_encoding' }], score: 90 },
    ]
    const curr = [
      { slideIndex: 0, issues: [], score: 100 },
      { slideIndex: 1, issues: [{ type: 'double_encoding' }, { type: 'missing_text' }], score: 80 },
    ]
    const diff = diffReports(prev, curr)
    expect(diff.improved).toHaveLength(1)
    expect(diff.improved[0].slideIndex).toBe(0)
    expect(diff.regressed).toHaveLength(1)
    expect(diff.regressed[0].slideIndex).toBe(1)
    expect(diff.regressed[0].newIssues).toContain('missing_text')
  })
})

// ═══════════════════════════════════════════════════════════════
//  FixtureManager
// ═══════════════════════════════════════════════════════════════
describe('FixtureManager — 픽스처 관리', () => {
  const mockElements = [
    { id: 'flat-1', sourceId: 'fe-1', type: 'text', x: 0, y: 0, width: 100, height: 20, zIndex: 0, content: '텍스트', isRich: false, styles: {} },
  ]

  it('captureFixture — 픽스처를 캡처한다', () => {
    const fixture = captureFixture(0, '<html><body>원본</body></html>', mockElements, { w: 1280, h: 800 })
    expect(fixture.slideIndex).toBe(0)
    expect(fixture.originalHtml).toContain('원본')
    expect(fixture.flatElements).toHaveLength(1)
    expect(fixture.flatHtml).toContain('<!DOCTYPE html>')
    expect(fixture.timestamp).toBeTruthy()
    expect(fixture.elementCount).toBe(1)
  })

  it('serializeFixtures / loadFixtures — 직렬화/역직렬화', () => {
    const fixture = captureFixture(0, '<html><body>원본</body></html>', mockElements, { w: 1280, h: 800 })
    const json = serializeFixtures([fixture])
    const loaded = loadFixtures(json)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].slideIndex).toBe(0)
    expect(loaded[0].flatElements[0].content).toBe('텍스트')
  })

  it('createManifest — 매니페스트를 생성한다', () => {
    const fixture = captureFixture(0, '...', mockElements, { w: 1280, h: 800 })
    const manifest = createManifest([fixture], 'test_slides.html')
    expect(manifest.sourceFile).toBe('test_slides.html')
    expect(manifest.slideCount).toBe(1)
    expect(manifest.slides[0].index).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
//  실제 슬라이드 덱 파싱 (통합 테스트)
// ═══════════════════════════════════════════════════════════════
describe('실제 슬라이드 덱 통합 테스트', () => {
  let deckHtml
  let parsed

  try {
    deckHtml = readFileSync(resolve(__dirname, '../../../slides/AI DC Study Book_slides.html'), 'utf-8')
  } catch {
    deckHtml = null
  }

  it.skipIf(!deckHtml)('AI DC Study Book 덱 파싱 — 슬라이드 추출', () => {
    parsed = parseSlideDeck(deckHtml)
    expect(parsed.slideCount).toBeGreaterThan(0)
    expect(parsed.slides[0].html).toBeTruthy()
  })

  it.skipIf(!deckHtml)('각 슬라이드에 제목이 있다', () => {
    parsed = parsed || parseSlideDeck(deckHtml)
    for (const slide of parsed.slides) {
      expect(slide.title).toBeTruthy()
    }
  })

  it.skipIf(!deckHtml)('글로벌 CSS가 추출된다', () => {
    parsed = parsed || parseSlideDeck(deckHtml)
    expect(parsed.globalStyles).toContain('.slide')
  })

  it.skipIf(!deckHtml)('각 슬라이드를 독립 HTML로 래핑할 수 있다', () => {
    parsed = parsed || parseSlideDeck(deckHtml)
    const doc = wrapSlideAsDocument(parsed.slides[0], parsed.globalStyles)
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('slide active')
  })
})
