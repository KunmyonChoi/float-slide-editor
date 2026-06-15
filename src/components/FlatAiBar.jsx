import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, generateImagePrompt, generateImage } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import { IMAGE_STYLES } from '../core/aiImageStyles'

/**
 * FlatAiBar — 텍스트 박스(요소)를 단일 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 액션 "AI 이미지 생성": 텍스트 박스 내용을 분석해 목적에 맞는 영어 프롬프트를 만들고,
 * 그 프롬프트로 이미지를 생성한 뒤, 미리보기(적용/재생성/취소)를 거쳐 **같은 위치·크기의
 * 이미지 요소로 텍스트 박스를 교체**한다(되돌리기 가능).
 *
 * 캔버스 줌과 무관하게 읽기 좋게 하려고 document.body 포털 + 화면 좌표로 배치한다.
 */
export default function FlatAiBar({ element, scale, canvasRef }) {
  // 'idle' | 'loading' | 'preview' | 'error'
  const [phase, setPhase] = useState('idle')
  const [styleId, setStyleId] = useState('flat')
  const [status, setStatus] = useState('')
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef(null)
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
  // (DOM 측정→state는 레이아웃 의존 위치잡기의 정당한 패턴 — 동일값이면 setState 생략)
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

  // 선택 요소가 바뀌면 진행 중 작업 취소
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [element.id])

  const sourceText = useCallback(() => htmlToPlain(element.content), [element.content])

  // 전체 파이프라인: 텍스트 분석 → 프롬프트 → 이미지 생성
  const run = useCallback(async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    const text = sourceText()
    if (!text) { setError('텍스트 박스에 분석할 내용이 없습니다.'); setPhase('error'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setImageUrl('')
    try {
      setStatus('내용 분석 중…')
      const directive = IMAGE_STYLES.find(s => s.id === styleId)?.directive || ''
      const p = await generateImagePrompt(text, { style: directive, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setPrompt(p)
      setStatus('AI 이미지 생성 중… (수십 초 걸릴 수 있어요)')
      const url = await generateImage(p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 호출에 실패했습니다.')
      setPhase('error')
    }
  }, [sourceText, styleId, element.width, element.height])

  // 현재 프롬프트(편집 가능)로 이미지만 다시 생성
  const regenerate = useCallback(async () => {
    const p = prompt.trim()
    if (!p) { run(); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setStatus('AI 이미지 생성 중…')
    try {
      const url = await generateImage(p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '이미지 생성에 실패했습니다.')
      setPhase('error')
    }
  }, [prompt, run, element.width, element.height])

  // 텍스트 박스를 같은 위치·크기의 이미지 요소로 교체(되돌리기 가능)
  const apply = useCallback(() => {
    if (!imageUrl) return
    useFlatStore.getState().updateFlatElement(element.id, {
      type: 'image',
      content: imageUrl,
      isRich: false,
      styles: {
        objectFit: 'cover',
        objectPosition: 'center center',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
      },
    })
    setPhase('idle'); setImageUrl('')
  }, [imageUrl, element.id])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase('idle'); setError(''); setImageUrl('')
  }, [])

  // 화면 좌표 (layout effect에서 계산됨)
  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  const placeAbove = elemTop - BAR_H - 8 >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - 8 : elemBottom + 8
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - 360, elemLeft))

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
          // (안 하면 mousedown이 캔버스 마퀴로 전달돼 mouseup에서 선택 해제→바 언마운트)
          // preventDefault는 하지 않음 — <select> 드롭다운 열림을 막기 때문.
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
            title="이미지 화풍"
            style={styleSelectStyle}
          >
            {IMAGE_STYLES.map(s => <option key={s.id} value={s.id} style={{ background: '#1e293b', color: '#f1f5f9' }}>{s.label}</option>)}
          </select>
          <button
            type="button"
            onClick={run}
            title="텍스트 박스 내용을 분석해 어울리는 이미지를 생성하고, 이 영역을 이미지로 교체합니다"
            style={aiBtnStyle}
          >
            <SparkleIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>AI 이미지 생성</span>
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
            <SparkleIcon /> AI 이미지 생성
          </div>

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
              <div style={{
                width: '100%', height: 200, borderRadius: 8, overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>프롬프트(편집 후 재생성 가능)</div>
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
                적용하면 이 텍스트 박스가 같은 위치·크기의 이미지로 교체됩니다(되돌리기 가능).
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={cancel} style={ghostBtnStyle}>취소</button>
            {(phase === 'preview' || phase === 'error') && (
              <button type="button" onClick={regenerate} style={ghostBtnStyle}>재생성</button>
            )}
            {phase === 'preview' && (
              <button type="button" onClick={apply} style={primaryBtnStyle}>적용</button>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}

// content(HTML 또는 평문) → 평문
function htmlToPlain(content) {
  if (!content) return ''
  if (!/[<&]/.test(content)) return content.trim()
  const div = document.createElement('div')
  div.innerHTML = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
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
