import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, editImage, generateImage, analyzeImageForRedesign, buildImageEnhancePrompt } from '../core/OpenAIClient'
import { captureElementRegion } from '../core/captureCanvasRegion'
import { openAiSettings } from './AiSettingsModal'
import { INFOGRAPHIC_STYLES } from '../core/aiImageStyles'

/**
 * FlatImageAiBar — 이미지 요소를 단일 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 두 가지 액션:
 *  - "디자인 향상"(enhance): 영역을 캡처해 image-to-image로 글자·요소 위치는 유지한 채
 *    시각 스타일만 끌어올린다(editImage, input_fidelity high).
 *  - "내용 재구성"(reconstruct): 논문 도식/표 등을 비전 분석해 같은 정보를 더 명확히
 *    표현하도록 재구성한 이미지를 새로 생성한다(analyzeImageForRedesign → generateImage).
 * 미리보기(적용/재생성/취소)를 거쳐 **같은 id·위치·크기로 인플레이스 교체**한다(되돌리기 가능).
 * 결과 종횡비가 박스와 어긋나도 잘리지 않도록 objectFit:contain으로 적용한다.
 *
 * 구조는 텍스트용 FlatAiBar와 동일(포털 + 화면 좌표 배치).
 */
export default function FlatImageAiBar({ element, scale, canvasRef }) {
  // 'idle' | 'compose' | 'loading' | 'preview' | 'error'
  // compose: 내용 재구성 전 '강조 방향' 입력 단계
  const [phase, setPhase] = useState('idle')
  // 'enhance'(디자인 향상) | 'reconstruct'(내용 재구성) — 마지막 실행 모드(재생성/표시에 사용)
  const [method, setMethod] = useState('enhance')
  const [styleId, setStyleId] = useState('original')
  const [emphasis, setEmphasis] = useState('') // 내용 재구성 강조 방향(선택)
  const [status, setStatus] = useState('')
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false) // 미리보기 크게 보기(라이트박스)
  const abortRef = useRef(null)
  const captureRef = useRef('') // 입력 캡처 — 재생성 시 재사용
  // 선택 요소의 화면 좌표(줌/팬 반영). ref는 렌더 중 읽지 않고 layout effect에서 계산.
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

  // 줌/팬에 따라 변하는 선택 요소의 화면 좌표를 렌더 후 측정해 state에 반영한다.
  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + element.x * scale,
      top: cr.top + element.y * scale,
      bottom: cr.top + (element.y + element.height) * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.height, scale, tick])

  // 선택 요소가 바뀌면 진행 중 작업 취소 + 캡처/강조 입력 무효화
  useEffect(() => {
    captureRef.current = ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmphasis('')
    return () => { abortRef.current?.abort() }
  }, [element.id])

  // 전체 파이프라인: 영역 캡처 → (enhance) 디자인 향상 / (reconstruct) 분석→재생성
  const run = useCallback(async (useMethod, directionText = '') => {
    if (!hasApiKey()) { openAiSettings(); return }
    setMethod(useMethod)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setImageUrl('')
    try {
      setStatus('이미지 캡처 중…')
      const cap = await captureElementRegion(
        { x: element.x, y: element.y, w: element.width, h: element.height },
        { signal: ctrl.signal },
      )
      if (ctrl.signal.aborted) return
      captureRef.current = cap
      const directive = INFOGRAPHIC_STYLES.find(s => s.id === styleId)?.directive || ''
      let p, url
      if (useMethod === 'reconstruct') {
        setStatus('내용 분석 중…')
        p = await analyzeImageForRedesign(cap, { style: directive, direction: directionText, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setPrompt(p)
        setStatus('AI 이미지 생성 중… (수십 초 걸릴 수 있어요)')
        url = await generateImage(p, { width: element.width, height: element.height, quality: 'high', signal: ctrl.signal })
      } else {
        p = buildImageEnhancePrompt(directive)
        setPrompt(p)
        setStatus('AI 디자인 변환 중… (수십 초 걸릴 수 있어요)')
        url = await editImage(cap, p, { width: element.width, height: element.height, signal: ctrl.signal })
      }
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 변환에 실패했습니다.')
      setPhase('error')
    }
  }, [styleId, element.x, element.y, element.width, element.height])

  // 현재 프롬프트(편집 가능)로 캡처를 재사용해 같은 모드로 다시 변환(분석은 생략)
  const regenerate = useCallback(async () => {
    const cap = captureRef.current
    const p = prompt.trim()
    if (!cap || !p) { run(method); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError('')
    try {
      setStatus(method === 'reconstruct' ? 'AI 이미지 생성 중…' : 'AI 디자인 변환 중…')
      const url = method === 'reconstruct'
        ? await generateImage(p, { width: element.width, height: element.height, quality: 'high', signal: ctrl.signal })
        : await editImage(cap, p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '이미지 변환에 실패했습니다.')
      setPhase('error')
    }
  }, [prompt, method, run, element.width, element.height])

  // 같은 id·위치·크기 유지한 채 이미지 content만 교체(되돌리기 가능).
  // objectFit:contain — 결과 종횡비가 박스와 달라도 잘리지 않고 전체가 보이게.
  const apply = useCallback(() => {
    if (!imageUrl) return
    useFlatStore.getState().updateFlatElement(element.id, {
      content: imageUrl,
      isRich: false,
      styles: { objectFit: 'contain' },
    })
    setPhase('idle'); setImageUrl(''); setZoom(false); setEmphasis('')
  }, [imageUrl, element.id])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase('idle'); setError(''); setImageUrl(''); setZoom(false); setEmphasis('')
  }, [])

  // 화면 좌표 (layout effect에서 계산됨)
  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  const BAR_W = 460 // 화풍 select + 버튼 2개
  const placeAbove = elemTop - BAR_H - 8 >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - 8 : elemBottom + 8
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, elemLeft))

  const methodLabel = method === 'reconstruct' ? 'AI 내용 재구성' : 'AI 디자인 향상'

  const PANEL_W = 360
  const PANEL_H_EST = 380
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, elemLeft))
  const panelTop = Math.max(8, Math.min(
    window.innerHeight - PANEL_H_EST - 8,
    placeAbove ? elemTop - 8 - PANEL_H_EST : elemBottom + 8,
  ))

  return createPortal(
    <>
      {/* 플로팅 액션바 (idle) */}
      {phase === 'idle' && (
        <div
          data-edit-accessory="true"
          // 포털 자식의 React 이벤트는 FlatCanvas(부모)로 버블링되므로 반드시 전파 차단.
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
            title="도식/표 등의 내용을 분석해 같은 정보를 더 명확히 표현하도록 재구성한 이미지를 새로 생성합니다. 강조할 방향을 입력할 수 있어요."
            style={aiBtnStyle}
          >
            <DiagramIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>내용 재구성</span>
          </button>
        </div>
      )}

      {/* 로딩 / 미리보기 / 에러 팝업 */}
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
                placeholder="예: 데이터 흐름을 단계별로 강조 · 핵심 수치를 크게 · 항목 간 비교를 명확히"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run('reconstruct', emphasis) } }}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
                }}
              />
              <div style={{ fontSize: 11, color: '#64748b' }}>
                비워두면 원본 구조를 그대로 더 명확히 재구성합니다. 원문 텍스트·데이터는 항상 유지됩니다.
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

          {phase === 'preview' && (
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
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {method === 'reconstruct' ? '생성 프롬프트' : '변환 지시'}(편집 후 재생성 가능)
              </div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
                }}
              />
              <div style={{ fontSize: 11, color: '#64748b' }}>
                적용하면 이 이미지가 같은 자리에서 결과 이미지로 교체됩니다(되돌리기 가능).
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
            {phase === 'preview' && (
              <button type="button" onClick={apply} style={primaryBtnStyle}>적용</button>
            )}
          </div>
        </div>
      )}

      {/* 크게 보기 라이트박스 */}
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
const ghostBtnStyle = {
  padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtnStyle = {
  padding: '6px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}

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
