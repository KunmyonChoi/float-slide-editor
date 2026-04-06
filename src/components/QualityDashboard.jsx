import { useState, useCallback, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { extractFlatElements } from '../core/FlatExtractor'
import { compareFlatConversion } from '../core/FlatCompare'
import { exportOriginalHtml, exportFlatHtml } from '../core/FlatExporter'
import { analyzeStructural, aggregateReports } from '../core/StructuralAnalyzer'
import { detectPatterns } from '../core/PatternDetector'
import { captureFixture, downloadAllFixtures } from '../core/FixtureManager'
import { parseSlideDeck, wrapSlideAsDocument } from '../core/SlideParser'

/**
 * QualityDashboard
 * 전체 슬라이드 덱을 순회하며 Flat 변환 품질을 일괄 분석한다.
 * - 슬라이드별 구조적 분석 (텍스트 누락, 서식 손실, 인코딩 등)
 * - 레이아웃 비교 (위치/크기 오차)
 * - 패턴 감지 + 수정 가이드
 * - 픽스처 캡처/다운로드
 */
export default function QualityDashboard({ open, onClose }) {
  const iframeRef = useEditorStore(s => s.iframeRef)
  const { viewMode } = useFlatStore()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [report, setReport] = useState(null)
  const [expandedSlide, setExpandedSlide] = useState(null)
  const [expandedPatterns, setExpandedPatterns] = useState(false)
  const fixturesRef = useRef([])

  const isActive = open && viewMode !== 'html'

  const runFullAnalysis = useCallback(async () => {
    if (!iframeRef?.current) return
    const iframe = iframeRef.current
    const win = iframe.contentWindow
    if (!win) return

    setRunning(true)
    setReport(null)
    fixturesRef.current = []

    // 슬라이드 수 파악 — reveal.js 또는 .slide 패턴
    const doc = iframe.contentDocument
    const isReveal = !!doc.querySelector('.reveal')
    let total
    if (isReveal && win.Reveal) {
      // reveal.js: 수평 슬라이드 수 (수직 슬라이드는 별도 순회)
      total = win.Reveal.getTotalSlides?.() || doc.querySelectorAll('.reveal .slides > section').length || 1
    } else {
      const slides = doc.querySelectorAll('.slide')
      total = slides.length || 1
    }
    setProgress({ current: 0, total })

    // 전체 덱 HTML을 파싱하여 개별 슬라이드 추출 (구조적 분석용)
    const fullDeckHtml = exportOriginalHtml(iframeRef) || ''
    let parsedDeck = null
    try {
      parsedDeck = parseSlideDeck(fullDeckHtml)
    } catch { /* 파싱 실패 시 fullDeckHtml 폴백 */ }

    const slideReports = []

    for (let i = 0; i < total; i++) {
      setProgress({ current: i + 1, total })

      // 슬라이드 이동 — reveal.js API 또는 postMessage
      if (isReveal && win.Reveal) {
        win.Reveal.slide(i, 0)
      } else if (typeof win.showSlide === 'function') {
        win.showSlide(i)
      } else {
        win.postMessage({ type: 'goto', index: i }, '*')
      }
      await wait(350) // 렌더링 대기

      // 추출
      const { elements, canvasSize, fontImports } = extractFlatElements(iframeRef)
      const originalHtml = exportOriginalHtml(iframeRef) || ''
      const flatHtml = exportFlatHtml(elements, canvasSize, fontImports)

      // 개별 슬라이드 HTML 추출 — 전체 덱이 아닌 해당 슬라이드만 비교
      let slideOriginalHtml = originalHtml
      if (parsedDeck && parsedDeck.slides[i]) {
        slideOriginalHtml = wrapSlideAsDocument(parsedDeck.slides[i], parsedDeck.globalStyles)
      }

      // 레이아웃 비교 (라이브 DOM)
      const comparison = compareFlatConversion(iframeRef, elements)

      // 구조적 분석 — 개별 슬라이드 HTML vs flat HTML + 줄바꿈 검사
      const structural = analyzeStructural(slideOriginalHtml, flatHtml, i, elements, canvasSize)

      slideReports.push({
        slideIndex: i,
        elementCount: elements.length,
        comparison,
        structural,
        issues: structural.issues,
        score: structural.score,
      })

      // 픽스처 저장
      fixturesRef.current.push(captureFixture(i, originalHtml, elements, canvasSize, fontImports))
    }

    // 집계
    const aggregate = aggregateReports(slideReports)
    const patterns = detectPatterns(slideReports)

    // 첫 슬라이드로 복귀
    if (isReveal && win.Reveal) {
      win.Reveal.slide(0, 0)
    } else if (typeof win.showSlide === 'function') {
      win.showSlide(0)
    } else {
      win.postMessage({ type: 'goto', index: 0 }, '*')
    }

    setReport({ slideReports, aggregate, patterns })
    setRunning(false)
  }, [iframeRef])

  const handleDownloadFixtures = useCallback(() => {
    if (fixturesRef.current.length > 0) {
      downloadAllFixtures(fixturesRef.current, 'slide-fixtures.json')
    }
  }, [])

  if (!isActive) return null

  return (
    <div
      className="fixed z-50 rounded-xl overflow-hidden select-none"
      style={{
        right: 16, top: 60,
        width: 380,
        maxHeight: 'calc(100vh - 80px)',
        background: 'rgba(15,23,42,0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        overflowY: 'auto',
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <span className="text-white text-sm font-semibold">Quality Dashboard</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
      </div>

      {/* 액션 버튼 */}
      <div className="px-4 py-3 flex gap-2">
        <button
          onClick={runFullAnalysis}
          disabled={running}
          className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600/60 text-white hover:bg-indigo-600/80 disabled:opacity-40 transition-colors"
        >
          {running ? `분석 중... (${progress.current}/${progress.total})` : '전체 분석 실행'}
        </button>
        {report && (
          <button
            onClick={handleDownloadFixtures}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600/40 text-emerald-300 hover:bg-emerald-600/60 transition-colors"
          >
            픽스처 저장
          </button>
        )}
      </div>

      {/* 프로그레스 바 */}
      {running && (
        <div className="px-4 pb-2">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 결과 */}
      {report && (
        <>
          {/* 요약 */}
          <div className="px-4 py-3 border-t border-white/5">
            <ScoreBar score={report.aggregate.overallScore} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              <StatBox label="슬라이드" value={report.slideReports.length} />
              <StatBox label="총 이슈" value={report.aggregate.totalIssues} color={report.aggregate.totalIssues > 0 ? 'amber' : 'emerald'} />
              <StatBox label="패턴" value={report.patterns.length} color={report.patterns.length > 0 ? 'amber' : 'emerald'} />
            </div>
          </div>

          {/* 이슈 유형별 */}
          {Object.keys(report.aggregate.issuesByType).length > 0 && (
            <div className="px-4 py-2 border-t border-white/5">
              <div className="text-xs text-slate-500 mb-2">이슈 유형</div>
              {Object.entries(report.aggregate.issuesByType).map(([type, count]) => (
                <div key={type} className="flex justify-between text-xs py-0.5">
                  <span className="text-slate-400">{ISSUE_LABELS[type] || type}</span>
                  <span className="text-amber-400 font-mono">{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* 패턴 감지 */}
          {report.patterns.length > 0 && (
            <div className="px-4 py-2 border-t border-white/5">
              <button
                onClick={() => setExpandedPatterns(v => !v)}
                className="flex items-center gap-1 text-xs text-amber-400 font-medium w-full"
              >
                <span>{expandedPatterns ? '▾' : '▸'}</span>
                감지된 패턴 ({report.patterns.length})
              </button>
              {expandedPatterns && report.patterns.map((p, i) => (
                <div key={i} className="mt-2 p-2 bg-white/3 rounded-lg">
                  <div className="text-xs text-white font-medium">{p.description}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    영향 슬라이드: {p.affectedSlides.join(', ')} ({p.frequency}건)
                  </div>
                  <div className="text-xs text-emerald-400 mt-1">
                    수정 가이드: {p.suggestedFix}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5 font-mono">
                    {p.relevantCode}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 슬라이드별 결과 */}
          <div className="px-4 py-2 border-t border-white/5">
            <div className="text-xs text-slate-500 mb-2">슬라이드별 결과</div>
            {report.slideReports.map(sr => (
              <div key={sr.slideIndex} className="mb-1">
                <button
                  onClick={() => setExpandedSlide(expandedSlide === sr.slideIndex ? null : sr.slideIndex)}
                  className="flex items-center justify-between w-full text-xs py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-slate-300">
                    Slide {sr.slideIndex}
                    <span className="text-slate-600 ml-1">({sr.elementCount}개)</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {sr.comparison?.summary && (
                      <span className="text-slate-600">
                        매칭 {sr.comparison.summary.matched}/{sr.comparison.summary.total}
                      </span>
                    )}
                    <ScoreBadge score={sr.score} />
                  </span>
                </button>
                {expandedSlide === sr.slideIndex && sr.issues.length > 0 && (
                  <div className="ml-3 mb-2">
                    {sr.issues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs py-0.5">
                        <span className={issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                          {issue.severity === 'error' ? '●' : '○'}
                        </span>
                        <span className="text-slate-400">{issue.description}</span>
                      </div>
                    ))}
                    {sr.comparison?.summary?.missing > 0 && (
                      <div className="text-xs text-red-400 py-0.5">
                        + 레이아웃 비교: 누락 {sr.comparison.summary.missing}개, 위치오차 평균 {sr.comparison.summary.avgPosDelta?.toFixed(1)}px
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────

function ScoreBar({ score }) {
  const color = score >= 90 ? '#10b981' : score >= 70 ? '#f59e0b' : '#ef4444'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">전체 품질 점수</span>
        <span style={{ color }} className="font-bold">{score}점</span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  )
}

function ScoreBadge({ score }) {
  const color = score >= 90 ? 'text-emerald-400' : score >= 70 ? 'text-amber-400' : 'text-red-400'
  return <span className={`font-mono font-medium ${color}`}>{score}</span>
}

function StatBox({ label, value, color = 'slate' }) {
  const colors = {
    slate: 'text-white',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }
  return (
    <div className="text-center p-2 bg-white/3 rounded-lg">
      <div className={`text-lg font-bold ${colors[color]}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

const ISSUE_LABELS = {
  missing_text: '텍스트 누락',
  lost_formatting: '서식 손실',
  double_encoding: '이중 인코딩',
  whitespace: '공백 이슈',
  missing_background: '배경 누락',
  missing_border_radius: 'border-radius 누락',
  unintended_wrap: '의도치 않은 줄바꿈',
  out_of_bounds: '캔버스 밖 요소',
  size_correction: '크기 보정 편차',
  overlap: '요소 겹침',
  zero_size: '크기 0 요소',
  element_count: '요소 수 불일치',
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}
