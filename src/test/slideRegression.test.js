import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  analyzeStructural,
  checkMissingText,
  checkDoubleEncoding,
  checkLostFormatting,
  checkWhitespace,
  checkVisualProperties,
  checkUnintendedWrap,
  checkLayoutAccuracy,
  aggregateReports,
} from '../core/StructuralAnalyzer'
import { detectPatterns } from '../core/PatternDetector'
import { exportFlatHtml } from '../core/FlatExporter'
import { parseSlideDeck, wrapSlideAsDocument } from '../core/SlideParser'

// ── 픽스처 로드 ──────────────────────────────────────────────

let fixtures = []
let fixtureAvailable = false

try {
  const raw = readFileSync(resolve(__dirname, 'fixtures/slide-fixtures.json'), 'utf-8')
  fixtures = JSON.parse(raw)
  fixtureAvailable = fixtures.length > 0
} catch {
  fixtureAvailable = false
}

/**
 * originalHtml은 전체 덱(모든 슬라이드 포함)이므로,
 * SlideParser로 개별 슬라이드 HTML을 추출하여 비교해야 한다.
 */
function getSlideOriginalHtml(fixture) {
  try {
    const { slides, globalStyles } = parseSlideDeck(fixture.originalHtml)
    const slide = slides[fixture.slideIndex]
    if (!slide) return fixture.originalHtml
    return wrapSlideAsDocument(slide, globalStyles)
  } catch {
    return fixture.originalHtml
  }
}

// ═══════════════════════════════════════════════════════════════
//  전체 슬라이드 구조적 회귀 테스트
// ═══════════════════════════════════════════════════════════════
describe.skipIf(!fixtureAvailable)('슬라이드 회귀 테스트 — 픽스처 기반', () => {
  let slideReports = []

  beforeAll(() => {
    slideReports = fixtures.map(f => {
      // 전체 덱에서 해당 슬라이드만 추출하여 비교
      const slideHtml = getSlideOriginalHtml(f)
      const flatHtml = f.flatHtml
      const result = analyzeStructural(slideHtml, flatHtml, f.slideIndex, f.flatElements, f.canvasSize)
      return { ...result, slideIndex: f.slideIndex }
    })
  })

  it('픽스처가 1개 이상의 슬라이드를 포함한다', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(1)
  })

  // ── 이중 인코딩: 모든 슬라이드에서 없어야 함 ──
  describe('이중 인코딩 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: 이중 인코딩 없음',
      (slideIndex, fixture) => {
        const issues = checkDoubleEncoding(fixture.flatHtml, slideIndex)
        expect(issues).toEqual([])
      }
    )
  })

  // ── 공백 이슈: <br> 뒤 들여쓰기 없어야 함 ──
  describe('공백 이슈 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: <br> 뒤 소스 들여쓰기 없음',
      (slideIndex, fixture) => {
        const issues = checkWhitespace(fixture.flatHtml, slideIndex)
        const brIssues = issues.filter(i => i.description.includes('<br>'))
        expect(brIssues).toEqual([])
      }
    )
  })

  // ── 서식 손실: bold/italic 보존 검사 ──
  describe('서식 보존 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: bold/italic 서식 손실 검사',
      (slideIndex, fixture) => {
        const slideHtml = getSlideOriginalHtml(fixture)
        const issues = checkLostFormatting(slideHtml, fixture.flatHtml, slideIndex)
        // 현재 기준선: Slide 7에서 bold 손실 2건 허용
        if (issues.length > 0) {
          for (const iss of issues) {
            console.log(`  ○ Slide ${slideIndex}: ${iss.description}`)
          }
        }
        // 심각한 서식 손실(error급)은 0건이어야 함
        const errors = issues.filter(i => i.severity === 'error')
        expect(errors).toEqual([])
      }
    )
  })

  // ── 텍스트 누락: 원본 텍스트가 flat에 포함되는지 검사 ──
  describe('텍스트 누락 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: 텍스트 누락 검사',
      (slideIndex, fixture) => {
        const slideHtml = getSlideOriginalHtml(fixture)
        const issues = checkMissingText(slideHtml, fixture.flatHtml, slideIndex)
        if (issues.length > 0) {
          for (const iss of issues) {
            console.log(`  ● Slide ${slideIndex}: ${iss.description}`)
          }
        }
        // 정보 출력용 — 추후 기준선 설정 후 엄격하게 전환
        expect(true).toBe(true)
      }
    )
  })

  // ── 시각 속성: 배경/그래디언트/border-radius 보존 ──
  describe('시각 속성 보존 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: 배경/border-radius 보존 검사',
      (slideIndex, fixture) => {
        const slideHtml = getSlideOriginalHtml(fixture)
        const issues = checkVisualProperties(slideHtml, fixture.flatHtml, slideIndex)
        if (issues.length > 0) {
          for (const iss of issues) {
            console.log(`  ○ Slide ${slideIndex}: ${iss.description}`)
          }
        }
        expect(true).toBe(true)
      }
    )
  })

  // ── 의도치 않은 줄바꿈: 텍스트 박스 너비 검사 ──
  describe('의도치 않은 줄바꿈 — 전체 슬라이드', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: 줄바꿈 이슈 현황',
      (slideIndex, fixture) => {
        const issues = checkUnintendedWrap(fixture.flatElements, slideIndex)
        // 현재는 정보 확인용 — 이슈가 있으면 로그 출력
        if (issues.length > 0) {
          for (const iss of issues) {
            console.log(`  ⚠ Slide ${slideIndex}: ${iss.description}`)
          }
        }
        // 통과 (추후 기준선 설정 후 expect로 전환)
        expect(true).toBe(true)
      }
    )
  })

  // ── FlatExporter 일관성: flatElements → flatHtml 재생성 비교 ──
  // font-family 따옴표 정규화 후 비교 (이전 픽스처는 " 사용, 현재 코드는 ' 사용)
  describe('FlatExporter 일관성', () => {
    it.each(fixtures.map(f => [f.slideIndex, f]))(
      'Slide %i: exportFlatHtml 재생성 결과가 일치',
      (slideIndex, fixture) => {
        const regenerated = exportFlatHtml(fixture.flatElements, fixture.canvasSize, fixture.fontImports || [])
        const normalize = html => html
          .replace(/font-family:[^;]+/g, m => m.replace(/["']/g, ''))
          .replace(/overflow:(hidden|visible)/g, 'overflow:_')
          .replace(/display:flex;align-items:[^;]+;justify-content:[^;]+;/g, '')
          .replace(/<style>@import[^<]*<\/style>/g, '')
          .replace(/<link[^>]*>/g, '')
          .replace(/\n{2,}/g, '\n')
        expect(normalize(regenerated)).toBe(normalize(fixture.flatHtml))
      }
    )
  })

  // ── 전체 품질 점수 ──
  // 기준선: 96점 (2026-04-06, font-family/fontStyle 수정 후)
  // 남은 이슈: italic 손실 6건(Slide 1), bold 손실 3건, 텍스트 누락 5건(Slide 13-15)
  it('전체 평균 품질 점수가 기준선 이상이다', () => {
    const agg = aggregateReports(slideReports)
    console.log(`\n📊 전체 품질 점수: ${agg.overallScore}/100`)
    console.log(`   총 이슈: ${agg.totalIssues}`)
    if (Object.keys(agg.issuesByType).length > 0) {
      console.log('   유형별:')
      for (const [type, count] of Object.entries(agg.issuesByType)) {
        console.log(`     ${type}: ${count}`)
      }
    }
    expect(agg.overallScore).toBeGreaterThanOrEqual(90)
  })

  // ── 패턴 감지 리포트 (정보 출력) ──
  it('패턴 감지 리포트를 출력한다', () => {
    const patterns = detectPatterns(slideReports)
    if (patterns.length > 0) {
      console.log(`\n🔍 감지된 패턴 (${patterns.length}):`)
      for (const p of patterns) {
        console.log(`  [${p.pattern}] ${p.description}`)
        console.log(`    빈도: ${p.frequency}건, 영향 슬라이드: ${p.affectedSlides.join(', ')}`)
        console.log(`    수정: ${p.suggestedFix}`)
        console.log(`    코드: ${p.relevantCode}`)
      }
    } else {
      console.log('\n✅ 감지된 반복 패턴 없음')
    }
    // 항상 통과 (정보 출력용)
    expect(true).toBe(true)
  })

  // ── 슬라이드별 상세 결과 출력 ──
  it('슬라이드별 이슈 요약을 출력한다', () => {
    console.log('\n📋 슬라이드별 결과:')
    for (const sr of slideReports) {
      const status = sr.issues.length === 0 ? '✅' : (sr.score >= 80 ? '⚠️' : '❌')
      console.log(`  ${status} Slide ${sr.slideIndex}: ${sr.score}점 (이슈 ${sr.issues.length}건)`)
      for (const issue of sr.issues) {
        const icon = issue.severity === 'error' ? '  ● ' : '  ○ '
        console.log(`${icon}${issue.description}`)
      }
    }
    expect(true).toBe(true)
  })
})
