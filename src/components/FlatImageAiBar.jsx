import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, editImage, generateImage, analyzeImageForDiagram, buildImageEnhancePrompt } from '../core/OpenAIClient'
import { captureElementRegion } from '../core/captureCanvasRegion'
import { buildDiagramElements, DIAGRAM_VARIANT_COUNT } from '../core/diagramLayout'
import { openAiSettings } from './AiSettingsModal'
import { INFOGRAPHIC_STYLES } from '../core/aiImageStyles'
import DiagramPreview from './DiagramPreview'

// 선택 배경(장식) 생성 프롬프트 — 텍스트/경쟁 요소 없는 은은한 배경.
const BG_PROMPT = 'A clean, minimal, subtle abstract background for a slide. Soft light gradient, very low contrast, lots of empty space. No text, no icons, no charts, no prominent shapes.'

/**
 * FlatImageAiBar — 이미지 요소를 단일 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 두 가지 액션:
 *  - "디자인 향상"(enhance): 영역을 캡처해 image-to-image로 글자·요소 위치는 유지한 채
 *    시각 스타일만 끌어올린다(editImage). 결과는 같은 자리에 이미지로 교체.
 *  - "내용 재구성"(reconstruct): 도식/플로우를 비전 분석해 노드+간선 그래프(JSON)로 추출하고,
 *    이를 **편집 가능한 카드(text)+화살표(shape) 요소**로 재구성한다(diagramLayout).
 *    후보(variant) 여러 개 + 원본/재구성 비교 후, 원본 이미지를 그 요소들로 교체(undo 1회).
 *
 * 구조는 텍스트용 FlatAiBar와 동일(포털 + 화면 좌표 배치).
 */
export default function FlatImageAiBar({ element, scale, canvasRef }) {
  // 'idle' | 'compose' | 'loading' | 'preview' | 'error'
  const [phase, setPhase] = useState('idle')
  // 'enhance'(디자인 향상) | 'reconstruct'(내용 재구성)
  const [method, setMethod] = useState('enhance')
  const [styleId, setStyleId] = useState('original')
  const [emphasis, setEmphasis] = useState('') // 내용 재구성 강조 방향(선택)
  const [bgOn, setBgOn] = useState(false)       // 내용 재구성: 장식 배경 이미지 추가(선택)
  const [status, setStatus] = useState('')
  const [prompt, setPrompt] = useState('')      // enhance 전용 변환 지시
  const [imageUrl, setImageUrl] = useState('')  // enhance 결과
  const [diagramSpec, setDiagramSpec] = useState(null) // reconstruct 분석 결과(그래프)
  const [bgUrl, setBgUrl] = useState('')        // reconstruct 배경 이미지(선택)
  const [selectedVariant, setSelectedVariant] = useState(0)
  const [showBefore, setShowBefore] = useState(false) // 원본/재구성 비교 토글
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false)       // enhance 미리보기 크게 보기
  const abortRef = useRef(null)
  const captureRef = useRef('')
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [])

  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + element.x * scale,
      top: cr.top + element.y * scale,
      bottom: cr.top + (element.y + element.height) * scale,
    } : null
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.height, scale, tick])

  // 선택 요소가 바뀌면 진행 중 작업 취소 + 패널을 idle로 완전 초기화
  // (다른 이미지로 전환 시 같은 컴포넌트가 재사용되므로 직전 결과가 남지 않도록)
  useEffect(() => {
    abortRef.current?.abort()
    captureRef.current = ''
    setPhase('idle'); setError(''); setStatus('')
    setEmphasis(''); setDiagramSpec(null); setBgUrl(''); setImageUrl('')
    setSelectedVariant(0); setShowBefore(false); setZoom(false)
    return () => { abortRef.current?.abort() }
  }, [element.id])

  const bbox = { x: element.x, y: element.y, w: element.width, h: element.height }

  // reconstruct 후보(variant)들 — 분석 결과/배경/박스에서 계산(추가 API 비용 없음)
  const variantsEls = useMemo(() => {
    if (!diagramSpec) return []
    const bb = { x: element.x, y: element.y, w: element.width, h: element.height }
    return Array.from({ length: DIAGRAM_VARIANT_COUNT }, (_, v) =>
      buildDiagramElements(diagramSpec, bb, { variant: v, zStart: 1, backgroundUrl: bgUrl || undefined }))
  }, [diagramSpec, bgUrl, element.x, element.y, element.width, element.height])

  const resetAll = () => {
    setPhase('idle'); setError(''); setImageUrl(''); setZoom(false)
    setEmphasis(''); setDiagramSpec(null); setBgUrl(''); setShowBefore(false); setSelectedVariant(0)
  }

  const run = useCallback(async (useMethod, directionText = '') => {
    if (!hasApiKey()) { openAiSettings(); return }
    setMethod(useMethod)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError('')
    try {
      setStatus('이미지 캡처 중…')
      const cap = await captureElementRegion(
        { x: element.x, y: element.y, w: element.width, h: element.height },
        { signal: ctrl.signal },
      )
      if (ctrl.signal.aborted) return
      captureRef.current = cap
      const directive = INFOGRAPHIC_STYLES.find(s => s.id === styleId)?.directive || ''

      if (useMethod === 'reconstruct') {
        setStatus('내용 분석 중…')
        const raw = await analyzeImageForDiagram(cap, { style: directive, direction: directionText, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        let spec
        try { spec = JSON.parse(raw) } catch { throw new Error('분석 결과(JSON)를 해석하지 못했습니다. 다시 시도해 주세요.') }
        if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
          throw new Error('이미지에서 다이어그램 구조(노드/연결)를 찾지 못했습니다. ‘디자인 향상’을 사용해 보세요.')
        }
        let bg = ''
        if (bgOn) {
          setStatus('배경 이미지 생성 중…')
          try { bg = await generateImage(BG_PROMPT, { width: element.width, height: element.height, quality: 'low', signal: ctrl.signal }) }
          catch { /* 배경 실패는 무시(다이어그램은 그대로) */ }
          if (ctrl.signal.aborted) return
        }
        setDiagramSpec(spec); setBgUrl(bg); setSelectedVariant(0); setShowBefore(false); setImageUrl('')
        setPhase('preview')
        return
      }

      // enhance
      setImageUrl('')
      const p = buildImageEnhancePrompt(directive)
      setPrompt(p)
      setStatus('AI 디자인 변환 중… (수십 초 걸릴 수 있어요)')
      const url = await editImage(cap, p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 변환에 실패했습니다.')
      setPhase('error')
    }
  }, [styleId, bgOn, element.x, element.y, element.width, element.height])

  // 재생성: reconstruct는 재분석, enhance는 캡처 재사용+편집 프롬프트
  const regenerate = useCallback(async () => {
    if (method === 'reconstruct') { run('reconstruct', emphasis); return }
    const cap = captureRef.current
    const p = prompt.trim()
    if (!cap || !p) { run('enhance'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setStatus('AI 디자인 변환 중…')
    try {
      const url = await editImage(cap, p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url); setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '이미지 변환에 실패했습니다.'); setPhase('error')
    }
  }, [method, emphasis, run, prompt, element.width, element.height])

  const apply = useCallback(() => {
    const st = useFlatStore.getState()
    if (method === 'reconstruct') {
      if (!diagramSpec) return
      const bb = { x: element.x, y: element.y, w: element.width, h: element.height }
      const maxZ = st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 0
      const els = buildDiagramElements(diagramSpec, bb, { variant: selectedVariant, zStart: maxZ + 1, backgroundUrl: bgUrl || undefined })
      st.applyLayoutElements([element.id], els) // 원본 이미지 제거 + 다이어그램 추가(undo 1회)
      st.setSelectedFlats(els.map(e => e.id))
      resetAll()
      return
    }
    if (!imageUrl) return
    st.updateFlatElement(element.id, { content: imageUrl, isRich: false, styles: { objectFit: 'contain' } })
    resetAll()
  }, [method, diagramSpec, selectedVariant, bgUrl, imageUrl, element.id, element.x, element.y, element.width, element.height])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    resetAll()
  }, [])

  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  const BAR_W = 460
  const placeAbove = elemTop - BAR_H - 8 >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - 8 : elemBottom + 8
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, elemLeft))

  const methodLabel = method === 'reconstruct' ? 'AI 내용 재구성' : 'AI 디자인 향상'

  const PANEL_W = 380
  const PANEL_H_EST = 420
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, elemLeft))
  const panelTop = Math.max(8, Math.min(
    window.innerHeight - PANEL_H_EST - 8,
    placeAbove ? elemTop - 8 - PANEL_H_EST : elemBottom + 8,
  ))
  const previewW = PANEL_W - 28

  const canApply = phase === 'preview' && (method === 'reconstruct' ? !!variantsEls[selectedVariant] : !!imageUrl)

  return createPortal(
    <>
      {/* 플로팅 액션바 (idle) */}
      {phase === 'idle' && (
        <div
          data-edit-accessory="true"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: anchorLeft, top: anchorTop, zIndex: 10040,
            display: 'flex', alignItems: 'center', gap: 6,
            height: BAR_H, padding: '0 8px', borderRadius: 10,
            background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <select
            value={styleId}
            onChange={e => setStyleId(e.target.value)}
            title="변환 화풍"
            style={styleSelectStyle}
          >
            {INFOGRAPHIC_STYLES.map(s => <option key={s.id} value={s.id} style={{ background: '#1e293b', color: '#f1f5f9' }}>{s.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => run('enhance')}
            title="이 이미지를 입력으로, 글자·요소 위치는 유지한 채 디자인을 AI로 향상합니다"
            style={aiBtnStyle}
          >
            <SparkleIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>디자인 향상</span>
          </button>
          <button
            type="button"
            onClick={() => { setMethod('reconstruct'); setPhase('compose') }}
            title="도식/플로우의 내용을 분석해 편집 가능한 카드+화살표 다이어그램으로 재구성합니다. 강조 방향을 입력할 수 있어요."
            style={aiBtnStyle}
          >
            <DiagramIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>내용 재구성</span>
          </button>
        </div>
      )}

      {/* 로딩 / compose / 미리보기 / 에러 팝업 */}
      {phase !== 'idle' && (
        <div
          data-edit-accessory="true"
          onMouseDown={e => { e.stopPropagation() }}
          style={{
            position: 'fixed', left: panelLeft, top: panelTop, width: PANEL_W, zIndex: 10045,
            background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <SparkleIcon /> {methodLabel}
          </div>

          {phase === 'compose' && (
            <>
              <div style={{ fontSize: 11, color: '#64748b' }}>어떤 점을 강조해 재구성할까요? (선택)</div>
              <textarea
                value={emphasis}
                onChange={e => setEmphasis(e.target.value)}
                rows={3}
                autoFocus
                spellCheck={false}
                placeholder="예: 데이터 흐름을 단계별로 강조 · 핵심 단계를 부각 · 분기 관계를 명확히"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run('reconstruct', emphasis) } }}
                style={textareaStyle}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={bgOn} onChange={e => setBgOn(e.target.checked)} />
                장식 배경 이미지 추가(선택)
              </label>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                내용을 분석해 <b style={{ color: '#cbd5e1' }}>편집 가능한 카드+화살표</b>로 재구성합니다. 원문 텍스트는 유지됩니다.
              </div>
            </>
          )}

          {phase === 'loading' && (
            <div style={{ fontSize: 13, color: '#94a3b8', padding: '10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner /> {status || '처리 중…'}
            </div>
          )}

          {phase === 'error' && (
            <div style={{ fontSize: 12.5, color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>
          )}

          {/* enhance 미리보기 (이미지) */}
          {phase === 'preview' && method === 'enhance' && (
            <>
              <div
                onClick={() => imageUrl && setZoom(true)}
                title="클릭하여 크게 보기"
                style={{
                  width: '100%', height: 200, borderRadius: 8, overflow: 'hidden',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: imageUrl ? 'zoom-in' : 'default',
                }}
              >
                {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>변환 지시(편집 후 재생성 가능)</div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} spellCheck={false} style={textareaStyle} />
              <div style={{ fontSize: 11, color: '#64748b' }}>적용하면 같은 자리에서 결과 이미지로 교체됩니다(되돌리기 가능).</div>
            </>
          )}

          {/* reconstruct 미리보기 (다이어그램 후보 + 원본/재구성 비교) */}
          {phase === 'preview' && method === 'reconstruct' && (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setShowBefore(false)} style={toggleBtnStyle(!showBefore)}>재구성</button>
                <button type="button" onClick={() => setShowBefore(true)} style={toggleBtnStyle(showBefore)}>원본</button>
              </div>
              <div style={{
                borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center',
                minHeight: 120,
              }}>
                {showBefore
                  ? (captureRef.current
                      ? <img src={captureRef.current} alt="" style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }} />
                      : <span style={{ fontSize: 12, color: '#64748b' }}>원본 미리보기 없음</span>)
                  : (variantsEls[selectedVariant]
                      ? <DiagramPreview elements={variantsEls[selectedVariant]} bbox={bbox} width={previewW} />
                      : null)}
              </div>
              {!showBefore && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {variantsEls.map((els, i) => (
                    <DiagramPreview
                      key={i}
                      elements={els}
                      bbox={bbox}
                      width={(previewW - (DIAGRAM_VARIANT_COUNT - 1) * 6) / DIAGRAM_VARIANT_COUNT}
                      selected={i === selectedVariant}
                      onClick={() => setSelectedVariant(i)}
                    />
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#64748b' }}>
                후보를 고르세요. 적용하면 <b style={{ color: '#cbd5e1' }}>편집 가능한 카드·화살표</b>로 교체됩니다(되돌리기 가능).
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={cancel} style={ghostBtnStyle}>취소</button>
            {phase === 'compose' && (
              <button type="button" onClick={() => run('reconstruct', emphasis)} style={primaryBtnStyle}>재구성 생성</button>
            )}
            {(phase === 'preview' || phase === 'error') && (
              <button type="button" onClick={regenerate} style={ghostBtnStyle}>재생성</button>
            )}
            {canApply && (
              <button type="button" onClick={apply} style={primaryBtnStyle}>적용</button>
            )}
          </div>
        </div>
      )}

      {/* 크게 보기 라이트박스 (enhance 이미지) */}
      {zoom && imageUrl && (
        <div
          data-edit-accessory="true"
          onMouseDown={e => { e.stopPropagation(); setZoom(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10060,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
          }}
        >
          <img src={imageUrl} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain' }} />
        </div>
      )}
    </>,
    document.body
  )
}

const aiBtnStyle = {
  display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#c7d2fe',
  background: 'rgba(99,102,241,0.18)',
}
const styleSelectStyle = {
  height: 26, maxWidth: 150, fontSize: 12, padding: '0 6px', borderRadius: 7, cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.14)', outline: 'none',
}
const textareaStyle = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical',
  padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
}
const ghostBtnStyle = {
  padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtnStyle = {
  padding: '6px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const toggleBtnStyle = (active) => ({
  flex: 1, padding: '5px 8px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: active ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.12)',
  background: active ? 'rgba(99,102,241,0.22)' : 'transparent',
  color: active ? '#c7d2fe' : '#94a3b8',
})

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
    </svg>
  )
}

function DiagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="8.5" y="14" width="7" height="7" rx="1" />
      <path d="M6.5 10v2.5a1.5 1.5 0 0 0 1.5 1.5h.5M17.5 10v2.5a1.5 1.5 0 0 1-1.5 1.5h-.5" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#a5b4fc" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}
