import { create } from 'zustand'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, advisePresentation, regenerateSlideHtml } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import FlatElementRenderer from './FlatElementRenderer'

/**
 * AI 어드바이저 — 전체 덱 + 발표 목적/청중을 분석해 전반 평가와 슬라이드별 코멘트를 제시.
 *
 * 비차단(non-modal) 플로팅 패널: 배경을 가리지 않아 조언을 보면서 캔버스를 그대로 편집할 수
 * 있고, 헤더를 드래그해 옮기거나 접을 수 있다. 슬라이드 코멘트를 클릭하면 해당 페이지로
 * 이동하되 패널은 유지된다. App에 <AdviserHost />를 한 번 마운트한다.
 */

const useAdviserStore = create(() => ({ open: false }))

export function openAdviser() {
  if (!hasApiKey()) { openAiSettings(); return }
  useAdviserStore.setState({ open: true })
}
function closeAdviser() { useAdviserStore.setState({ open: false }) }

export function AdviserHost() {
  const open = useAdviserStore(s => s.open)
  if (!open) return null
  return <AdviserPanel />
}

// flat 요소(HTML/평문) → 평문
function htmlToPlain(content) {
  if (!content) return ''
  if (!/[<&]/.test(content)) return content.trim()
  const div = document.createElement('div')
  div.innerHTML = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

// 전체 페이지의 텍스트를 슬라이드별로 수집(캐시 기반 — 로드 시 프리로드됨)
function buildDeckSlides() {
  const pages = useFlatStore.getState().getFlatPageList()
  return pages.map(p => ({
    index: p.index + 1,
    text: (p.elements || [])
      .filter(e => e.type === 'text' && e.content)
      .map(e => htmlToPlain(e.content))
      .filter(Boolean)
      .join('\n'),
  }))
}

// AI가 생성한 슬라이드 HTML을 숨김 iframe에 렌더해 flat 요소로 추출.
// 추출은 data-editor-id 마커에 의존하므로 prepareHtmlForEditor로 마커를 먼저 부착하고,
// 임시 iframe은 스크립트 비활성(주입 스크립트의 부모-postMessage 부작용 차단)으로 둔다.
async function renderHtmlToFlat(rawHtml, canvasSize) {
  const { prepareHtmlForEditor } = await import('../core/ElementRegistry')
  const { html } = prepareHtmlForEditor(rawHtml)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin') // 스크립트 미실행(마커·CSS는 적용)
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${canvasSize.w}px;height:${canvasSize.h}px;border:0;`
  iframe.srcdoc = html
  document.body.appendChild(iframe)
  try {
    await new Promise(res => {
      let done = false
      const f = () => { if (!done) { done = true; res() } }
      iframe.onload = f
      setTimeout(f, 3000)
    })
    try {
      const ff = iframe.contentDocument?.fonts
      if (ff?.ready) await Promise.race([ff.ready, new Promise(r => setTimeout(r, 2500))])
    } catch { /* 무시 */ }
    await new Promise(r => setTimeout(r, 150)) // 레이아웃 정착
    const { extractFlatElementsFromIframe } = await import('../core/FlatExtractor')
    return extractFlatElementsFromIframe({ current: iframe })
  } finally {
    iframe.remove()
  }
}

// 작은 슬라이드 미리보기(요소 비대화형 렌더)
function MiniSlide({ elements, canvasSize, width }) {
  const cs = canvasSize?.w ? canvasSize : { w: 1280, h: 720 }
  const scale = width / cs.w
  const height = Math.round(cs.h * scale)
  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden', background: '#fff', borderRadius: 4, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: cs.w, height: cs.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {(elements || []).map(el => (
          <FlatElementRenderer key={el.id} element={el} isSelected={false} isEditing={false} scale={scale} canvasSize={cs} />
        ))}
      </div>
    </div>
  )
}

const PANEL_W = 400

function AdviserPanel() {
  const [phase, setPhase] = useState('input') // 'input' | 'loading' | 'result' | 'error'
  const [purpose, setPurpose] = useState('')
  const [audience, setAudience] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  // 슬라이드별 AI 적용 상태: { index, status:'loading'|'preview'|'applied'|'error', updates, beforeMap, note, error }
  const [apply, setApply] = useState(null)
  const applyAbortRef = useRef(null)
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, (typeof window !== 'undefined' ? window.innerWidth : 1280) - PANEL_W - 24),
    y: 72,
  }))
  const abortRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => () => { abortRef.current?.abort(); applyAbortRef.current?.abort() }, [])

  // 헤더 드래그로 패널 이동
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      const x = Math.max(0, Math.min(window.innerWidth - 120, d.ox + e.clientX - d.sx))
      const y = Math.max(0, Math.min(window.innerHeight - 40, d.oy + e.clientY - d.sy))
      setPos({ x, y })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const onHeaderDown = (e) => {
    if (e.target.closest('button')) return // 헤더 버튼은 드래그 아님
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    e.preventDefault()
  }

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(''); setPhase('loading')
    try {
      const slides = buildDeckSlides()
      if (slides.length === 0) throw new Error('분석할 슬라이드가 없습니다.')
      const res = await advisePresentation(slides, { purpose, audience, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setResult(res)
      setPhase('result')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '분석에 실패했습니다.')
      setPhase('error')
    }
  }, [purpose, audience])

  const goSlide = useCallback((idx1) => {
    useFlatStore.getState().goToFlatPage(idx1 - 1) // 패널 유지 — 보면서 편집
  }, [])

  // 슬라이드별 AI 적용 — 해당 슬라이드를 조언대로 재구성(HTML 재생성→추출), 전/후 미리보기
  const startApply = useCallback(async (slide) => {
    applyAbortRef.current?.abort()
    const ctrl = new AbortController()
    applyAbortRef.current = ctrl
    useFlatStore.getState().goToFlatPage(slide.index - 1) // 동기 복원
    const st = useFlatStore.getState()
    const before = st.flatElements
    const canvasSize = st.canvasSize
    const slideText = before
      .filter(e => e.type === 'text' && e.content)
      .map(e => htmlToPlain(e.content)).filter(Boolean).join('\n')
    setApply({ index: slide.index, status: 'loading' })
    try {
      const html = await regenerateSlideHtml({ text: slideText }, {
        comment: slide.comment, suggestions: slide.suggestions || [], purpose, audience, canvasSize, signal: ctrl.signal,
      })
      if (ctrl.signal.aborted) return
      const extracted = await renderHtmlToFlat(html, canvasSize)
      if (ctrl.signal.aborted) return
      if (!extracted.elements || extracted.elements.length === 0) throw new Error('재구성 결과가 비어 있습니다.')
      setApply({ index: slide.index, status: 'preview', before, after: extracted.elements, canvasSize, fontImports: extracted.fontImports || [] })
    } catch (e) {
      if (e?.name === 'AbortError') return
      setApply({ index: slide.index, status: 'error', error: e?.message || '재구성 실패' })
    }
  }, [purpose, audience])

  const confirmApply = useCallback(() => {
    if (!apply || apply.status !== 'preview') return
    useFlatStore.getState().goToFlatPage(apply.index - 1) // 적용 직전 해당 페이지로(동기)
    useFlatStore.getState().replaceCurrentPageElements(apply.after, apply.fontImports)
    setApply({ index: apply.index, status: 'applied' })
  }, [apply])

  const cancelApply = useCallback(() => { applyAbortRef.current?.abort(); setApply(null) }, [])

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 12.5,
    background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: PANEL_W, zIndex: 9000,
        background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column',
        maxHeight: collapsed ? undefined : '80vh',
      }}
    >
      {/* 헤더(드래그 핸들) */}
      <div
        onMouseDown={onHeaderDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
          cursor: 'move', userSelect: 'none',
        }}
      >
        <BulbIcon />
        <span style={{ fontSize: 14, fontWeight: 600 }}>AI 어드바이저</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>· 전체 덱</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setCollapsed(c => !c)} title={collapsed ? '펼치기' : '접기'} style={iconBtnStyle}>
          {collapsed ? '▢' : '—'}
        </button>
        <button type="button" onClick={closeAdviser} title="닫기" style={iconBtnStyle}>✕</button>
      </div>

      {!collapsed && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', flex: '1 1 auto' }}>
          {/* 입력: 목적/청중 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>발표 목적</div>
              <input style={fieldStyle} value={purpose} placeholder="예: 아키텍처 의사결정 설득"
                onChange={e => setPurpose(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>청중</div>
              <input style={fieldStyle} value={audience} placeholder="예: 경영진 / 엔지니어"
                onChange={e => setAudience(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={run} disabled={phase === 'loading'} style={primaryBtnStyle}>
              {phase === 'result' || phase === 'error' ? '다시 분석' : '분석'}
            </button>
          </div>

          {/* 본문 */}
          <div style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            {phase === 'loading' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#94a3b8', padding: '20px 4px' }}>
                <Spinner /> 전체 덱을 분석하는 중…
              </div>
            )}
            {phase === 'error' && (
              <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5, padding: '6px 2px' }}>{error}</div>
            )}
            {phase === 'input' && (
              <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, padding: '6px 2px' }}>
                목적·청중을 입력하고 <b>분석</b>을 누르면 전체 흐름 평가와 슬라이드별 코멘트를 보여줍니다. 조언을 보면서 캔버스를 그대로 편집할 수 있어요.
              </div>
            )}
            {phase === 'result' && result && (
              <AdviserResult
                result={result} onGoSlide={goSlide}
                apply={apply} onStartApply={startApply} onConfirmApply={confirmApply} onCancelApply={cancelApply}
              />
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

function AdviserResult({ result, onGoSlide, apply, onStartApply, onConfirmApply, onCancelApply }) {
  const o = result.overall || {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13, fontSize: 12.5, lineHeight: 1.6 }}>
      {o.summary && <Section title="전반 평가"><div style={{ color: '#e2e8f0' }}>{o.summary}</div></Section>}
      {Array.isArray(o.strengths) && o.strengths.length > 0 && (
        <Section title="강점"><Bullets items={o.strengths} color="#86efac" /></Section>
      )}
      {Array.isArray(o.improvements) && o.improvements.length > 0 && (
        <Section title="개선점"><Bullets items={o.improvements} color="#fca5a5" /></Section>
      )}
      {result.flow && (
        <Section title="흐름·구성"><div style={{ color: '#cbd5e1', whiteSpace: 'pre-line' }}>{result.flow}</div></Section>
      )}
      {Array.isArray(result.slides) && result.slides.length > 0 && (
        <Section title="슬라이드별 코멘트">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {result.slides.map(s => {
              const a = apply && apply.index === s.index ? apply : null
              return (
              <div key={s.index} style={{
                padding: '7px 9px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <button type="button" onClick={() => onGoSlide(s.index)}
                    style={{ fontSize: 11.5, fontWeight: 600, color: '#c7d2fe', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                    title="이 슬라이드로 이동(패널 유지)">슬라이드 {s.index} ↗</button>
                  <div style={{ flex: 1 }} />
                  {(!a || a.status === 'error' || a.status === 'applied') && (
                    <button type="button" onClick={() => onStartApply(s)}
                      style={applyBtnStyle} title="AI가 이 슬라이드 텍스트를 조언대로 수정(미리보기 후 확정)">
                      {a?.status === 'applied' ? '다시 적용' : 'AI 적용'}
                    </button>
                  )}
                </div>
                {s.comment && <div style={{ color: '#cbd5e1' }}>{s.comment}</div>}
                {Array.isArray(s.suggestions) && s.suggestions.length > 0 && <Bullets items={s.suggestions} color="#fcd34d" small />}

                {/* AI 적용 영역 */}
                {a?.status === 'loading' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
                    <Spinner /> 슬라이드 재구성 중… (수십 초)
                  </div>
                )}
                {a?.status === 'error' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#fca5a5' }}>{a.error}</div>
                )}
                {a?.status === 'applied' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#86efac' }}>적용됨 ✓ (Ctrl+Z로 되돌리기)</div>
                )}
                {a?.status === 'preview' && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10.5, color: '#fca5a5', marginBottom: 3 }}>변경 전</div>
                        <MiniSlide elements={a.before} canvasSize={a.canvasSize} width={150} />
                      </div>
                      <span style={{ color: '#94a3b8' }}>→</span>
                      <div>
                        <div style={{ fontSize: 10.5, color: '#86efac', marginBottom: 3 }}>변경 후(재구성)</div>
                        <MiniSlide elements={a.after} canvasSize={a.canvasSize} width={150} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button type="button" onClick={onCancelApply} style={miniGhostBtn}>취소</button>
                      <button type="button" onClick={onConfirmApply} style={miniPrimaryBtn}>확정(교체)</button>
                    </div>
                  </div>
                )}
              </div>
            )})}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  )
}
function Bullets({ items, color, small }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: small ? 12 : 12.5 }}>
      {items.map((it, i) => (
        <li key={i} style={{ marginTop: i ? 3 : 0 }}>
          <span style={{ color }}>•</span> <span>{typeof it === 'string' ? it : JSON.stringify(it)}</span>
        </li>
      ))}
    </ul>
  )
}

const primaryBtnStyle = {
  padding: '6px 16px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const applyBtnStyle = {
  padding: '3px 9px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
  border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.18)', color: '#c7d2fe',
}
const miniGhostBtn = {
  padding: '4px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const miniPrimaryBtn = {
  padding: '4px 12px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const iconBtnStyle = {
  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 13, borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#cbd5e1',
}

function BulbIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
    </svg>
  )
}
function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#a5b4fc" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}
