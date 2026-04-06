import { useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { compareFlatConversion } from '../core/FlatCompare'
import { exportOriginalHtml, exportFlatHtml, downloadHtml } from '../core/FlatExporter'

/**
 * ComparePanel
 * Flat 변환 품질 검증 패널. split/flat 모드에서 표시.
 * 비교 실행 → 구조적 리포트 + HTML 내보내기.
 */
export default function ComparePanel() {
  const iframeRef = useEditorStore(s => s.iframeRef)
  const { flatElements, canvasSize, fontImports, viewMode } = useFlatStore()
  const [report, setReport] = useState(null)
  const [expanded, setExpanded] = useState(null) // 'missing' | 'extra' | 'drift' | null

  const isActive = viewMode !== 'html' && flatElements.length > 0

  const runCompare = useCallback(() => {
    if (!iframeRef) return
    const result = compareFlatConversion(iframeRef, flatElements)
    setReport(result)
    setExpanded(null)
  }, [iframeRef, flatElements])

  const handleExportOriginal = useCallback(() => {
    const html = exportOriginalHtml(iframeRef)
    if (html) downloadHtml(html, 'original.html')
  }, [iframeRef])

  const handleExportFlat = useCallback(() => {
    const html = exportFlatHtml(flatElements, canvasSize, fontImports)
    downloadHtml(html, 'flat.html')
  }, [flatElements, canvasSize, fontImports])

  if (!isActive) return null

  const s = report?.summary

  return (
    <div
      className="fixed z-40 rounded-xl overflow-hidden select-none"
      style={{
        left: 16, bottom: 16,
        width: 300,
        maxHeight: 420,
        background: 'rgba(15,23,42,0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
        <span className="text-xs font-medium text-slate-400">변환 검증</span>
        <div className="flex gap-1.5">
          <SmallBtn onClick={handleExportOriginal} title="원본 HTML 내보내기">원본</SmallBtn>
          <SmallBtn onClick={handleExportFlat} title="Flat HTML 내보내기">Flat</SmallBtn>
          <SmallBtn onClick={runCompare} highlight title="비교 실행">검증</SmallBtn>
        </div>
      </div>

      {/* 리포트 */}
      {s && (
        <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: 360 }}>
          {/* 요약 */}
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="원본 요소" value={s.total} />
            <Stat label="매칭" value={s.matched} color="text-emerald-400" />
            <Stat label="누락" value={s.missing} color={s.missing > 0 ? 'text-red-400' : 'text-slate-500'} />
            <Stat label="추가" value={s.extra} color={s.extra > 0 ? 'text-amber-400' : 'text-slate-500'} />
            <Stat label="평균 위치오차" value={`${s.avgPosDelta}px`} />
            <Stat label="최대 위치오차" value={`${s.maxPosDelta}px`} color={s.maxPosDelta > 5 ? 'text-amber-400' : 'text-slate-500'} />
            {s.textMismatches > 0 && (
              <Stat label="텍스트 불일치" value={s.textMismatches} color="text-red-400" />
            )}
          </div>

          {/* 점수 바 */}
          <ScoreBar matched={s.matched} total={s.total} />

          {/* 누락 목록 */}
          {s.missing > 0 && (
            <Section
              title={`누락 (${s.missing})`}
              color="text-red-400"
              expanded={expanded === 'missing'}
              onToggle={() => setExpanded(expanded === 'missing' ? null : 'missing')}
            >
              {report.missing.map(m => (
                <Row key={m.sourceId}>
                  <code className="text-red-300">&lt;{m.tag}&gt;</code>
                  <span className="text-slate-500 text-xs ml-1">
                    {r(m.x)},{r(m.y)} {r(m.w)}x{r(m.h)}
                  </span>
                  {m.text && <span className="text-slate-600 text-xs ml-1 truncate max-w-[120px]">"{m.text.slice(0, 30)}"</span>}
                </Row>
              ))}
            </Section>
          )}

          {/* 추가 목록 */}
          {s.extra > 0 && (
            <Section
              title={`추가 (${s.extra})`}
              color="text-amber-400"
              expanded={expanded === 'extra'}
              onToggle={() => setExpanded(expanded === 'extra' ? null : 'extra')}
            >
              {report.extra.map(e => (
                <Row key={e.id || e.sourceId}>
                  <code className="text-amber-300">{e.type}</code>
                  <span className="text-slate-500 text-xs ml-1">
                    {r(e.x)},{r(e.y)} {r(e.w)}x{r(e.h)}
                  </span>
                </Row>
              ))}
            </Section>
          )}

          {/* 위치 오차 큰 요소 */}
          {(() => {
            const drifted = report.matched
              .filter(m => m.posDelta > 1)
              .sort((a, b) => b.posDelta - a.posDelta)
            if (drifted.length === 0) return null
            return (
              <Section
                title={`위치 오차 (${drifted.length})`}
                color="text-amber-400"
                expanded={expanded === 'drift'}
                onToggle={() => setExpanded(expanded === 'drift' ? null : 'drift')}
              >
                {drifted.slice(0, 20).map(m => (
                  <Row key={m.sourceId}>
                    <code className="text-slate-300">&lt;{m.tag}&gt;</code>
                    <span className="text-amber-400 text-xs ml-1 font-mono">{m.posDelta}px</span>
                    <span className="text-slate-600 text-xs ml-1">
                      dx:{m.delta.dx} dy:{m.delta.dy}
                    </span>
                    {!m.textMatch && <span className="text-red-400 text-xs ml-1">text!</span>}
                  </Row>
                ))}
              </Section>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────

function SmallBtn({ children, onClick, highlight, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'px-2 py-1 rounded-md text-xs transition-colors cursor-pointer',
        highlight
          ? 'bg-indigo-600/50 text-indigo-200 hover:bg-indigo-600/70'
          : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, color = 'text-slate-300' }) {
  return (
    <div className="bg-white/5 rounded-lg px-2 py-1.5">
      <p className="text-xs text-slate-600">{label}</p>
      <p className={`text-xs font-mono font-medium ${color}`}>{value}</p>
    </div>
  )
}

function ScoreBar({ matched, total }) {
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0
  const color = pct === 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 font-mono">{pct}%</span>
    </div>
  )
}

function Section({ title, color, expanded, onToggle, children }) {
  return (
    <div className="border-t border-white/5 pt-2">
      <button
        onClick={onToggle}
        className={`text-xs font-medium ${color} hover:underline cursor-pointer flex items-center gap-1`}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>
          &#9654;
        </span>
        {title}
      </button>
      {expanded && <div className="mt-1.5 space-y-1">{children}</div>}
    </div>
  )
}

function Row({ children }) {
  return (
    <div className="flex items-center text-xs pl-3 py-0.5">{children}</div>
  )
}

function r(n) { return Math.round(n * 10) / 10 }
