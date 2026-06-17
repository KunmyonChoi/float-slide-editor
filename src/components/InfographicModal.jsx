import { create } from 'zustand'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'
import { hasApiKey, analyzeImageForInfographic, generateImage, editImage } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import { INFOGRAPHIC_STYLES } from '../core/aiImageStyles'
import { captureElementRegion } from '../core/captureCanvasRegion'

/**
 * AI 인포그래픽 변환.
 *
 * mode 'page'      — 현재 페이지 전체를 캡처 → 슬라이드 크기 인포그래픽 이미지.
 * mode 'selection' — 선택 요소들의 bbox 영역만 캡처 → bbox 크기 인포그래픽 이미지.
 *
 * 비전 분석 → 이미지 생성 → 미리보기 후 삽입/교체. 어디서든 openInfographic()으로 연다.
 */

const useInfographicStore = create(() => ({ open: false, mode: 'page', ids: [] }))

export function openInfographic({ mode = 'page', ids = [] } = {}) {
  if (!hasApiKey()) { openAiSettings(); return }
  useInfographicStore.setState({ open: true, mode, ids })
}

function closeInfographic() {
  useInfographicStore.setState({ open: false })
}

export function InfographicHost() {
  const open = useInfographicStore(s => s.open)
  if (!open) return null
  return <InfographicDialog />
}

function bboxOf(ids) {
  const els = useFlatStore.getState().flatElements.filter(e => ids.includes(e.id))
  if (!els.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const e of els) {
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y)
    maxX = Math.max(maxX, e.x + e.width); maxY = Math.max(maxY, e.y + e.height)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function buildImageEl(dataUrl, rect, zIndex) {
  return {
    id: nextFlatId(), sourceId: null,
    type: 'image', width: rect.w, height: rect.h,
    content: dataUrl, isRich: false, merged: false,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      borderRadius: '0px', border: '0px none', boxShadow: 'none',
      // 요소 크기는 대상 영역에 맞추고, 맞춤(objectFit)은 일반 이미지 기본값(contain).
      // 잘리지 않으며 필요하면 속성 패널에서 cover/fill로 변경.
      opacity: '1', objectFit: 'contain',
    },
    x: rect.x, y: rect.y, zIndex,
  }
}

const METHOD_DESC = {
  analyze: '슬라이드 내용을 분석해 인포그래픽을 새로 그립니다. 깔끔하게 재구성하지만 원본 구도와 달라질 수 있습니다.',
  edit: '캡처를 입력으로 줘 원본 구도·위치·비율을 유지하며 변환합니다(gpt-image-1.5, input_fidelity high). 원문 텍스트 보존에 유리할 수 있습니다.',
}

function InfographicDialog() {
  const mode = useInfographicStore(s => s.mode)
  const ids = useInfographicStore(s => s.ids)
  const [status, setStatus] = useState('idle') // 'idle'|'capturing'|'analyzing'|'generating'|'error'
  const [method, setMethod] = useState('analyze') // 'analyze'(분석→재생성) | 'edit'(이미지 편집)
  const [styleId, setStyleId] = useState('auto') // 화풍(스타일)
  const [prompt, setPrompt] = useState('')
  const [results, setResults] = useState({ analyze: null, edit: null }) // 방법별 생성 이미지 캐시
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false) // 크게 보기
  const targetRef = useRef(null)  // 결과 이미지를 넣을 캔버스 좌표 사각형
  const captureRef = useRef(null) // 캡처(선택 모드면 bbox crop) — 1회만 만들고 재사용
  const abortRef = useRef(null)

  // 현재 페이지/선택 영역을 캡처(필요 시 crop)해 captureRef에 보관(1회)
  const ensureCapture = useCallback(async (ctrl) => {
    if (captureRef.current) return captureRef.current
    setStatus('capturing')
    let input
    if (mode === 'selection') {
      const bbox = bboxOf(ids)
      if (!bbox || bbox.w < 2 || bbox.h < 2) throw new Error('선택된 요소를 찾을 수 없습니다.')
      targetRef.current = bbox
      input = await captureElementRegion(bbox, { signal: ctrl.signal })
    } else {
      const canvasNode = useFlatStore.getState()._canvasRef?.current
      if (!canvasNode) throw new Error('캔버스를 찾을 수 없습니다.')
      const cs = useFlatStore.getState().canvasSize
      const { exportAsImage } = await import('../core/ImageExporter.js')
      targetRef.current = { x: 0, y: 0, w: cs.w, h: cs.h }
      input = await exportAsImage(canvasNode, { format: 'png', scale: 2 })
    }
    captureRef.current = input
    return input
  }, [mode, ids])

  // 통합 생성: useMethod로 분석-재생성/이미지-편집 선택. basePrompt 있으면 분석 생략.
  // 결과는 results[useMethod]에 캐싱 — 탭 전환 시 재사용(자동 재생성 안 함).
  const generate = useCallback(async (useMethod, basePrompt) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError('')
    try {
      const cap = await ensureCapture(ctrl)
      if (ctrl.signal.aborted) return
      let p = (basePrompt || '').trim()
      if (!p) {
        setStatus('analyzing')
        const directive = INFOGRAPHIC_STYLES.find(s => s.id === styleId)?.directive || ''
        p = await analyzeImageForInfographic(cap, { style: directive, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setPrompt(p)
      }
      setStatus('generating')
      const t = targetRef.current
      const url = useMethod === 'edit'
        ? await editImage(cap, p, { width: t.w, height: t.h, signal: ctrl.signal })
        : await generateImage(p, { width: t.w, height: t.h, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setResults(r => ({ ...r, [useMethod]: url }))
      setStatus('idle')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 변환에 실패했습니다.')
      setStatus('error')
    }
  }, [ensureCapture, styleId])

  // 탭 전환 — 생성하지 않음(캐시된 이미지 있으면 표시, 없으면 설명)
  const switchMethod = useCallback((m) => setMethod(m), [])

  // 화풍 변경 — 분석 결과가 화풍에 묶이므로 무효화하고 설명+생성 상태로 복귀
  // (캡처는 화풍 무관이라 유지, 다음 '생성' 시 새 화풍으로 재분석)
  const changeStyle = useCallback((id) => {
    if (id === styleId) return
    abortRef.current?.abort()
    setStyleId(id)
    setPrompt('')
    setResults({ analyze: null, edit: null })
    setError('')
    setStatus('idle')
  }, [styleId])

  // 진행 중 작업 정리만(오픈 시 자동 생성 없음)
  useEffect(() => () => abortRef.current?.abort(), [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    closeInfographic()
  }, [])

  // 대상 영역(targetRef) 위치·크기로 현재 탭 이미지를 현재 페이지 맨 위에 삽입
  const insertHere = useCallback(() => {
    const url = results[method]
    if (!url || !targetRef.current) return
    const st = useFlatStore.getState()
    const maxZ = st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 0
    const el = buildImageEl(url, targetRef.current, maxZ + 1)
    st.addFlatElement(el)
    st.setSelectedFlat(el.id)
    closeInfographic()
  }, [results, method])

  // (page) 현재 페이지 바로 뒤에 빈 슬라이드 추가 후 인포그래픽 이미지 배치
  const addNextSlide = useCallback(() => {
    const url = results[method]
    if (!url) return
    const st = useFlatStore.getState()
    st.addPage()
    const cs = useFlatStore.getState().canvasSize
    useFlatStore.getState().addFlatElement(buildImageEl(url, { x: 0, y: 0, w: cs.w, h: cs.h }, 1))
    closeInfographic()
  }, [results, method])

  // (selection) 선택 원본 삭제 후 bbox 자리에 현재 탭 이미지 삽입
  const replaceOriginals = useCallback(() => {
    const url = results[method]
    if (!url || !targetRef.current) return
    const st = useFlatStore.getState()
    st.setSelectedFlats(ids)
    st.removeSelectedElements() // batch_remove (undo 1회)
    const after = useFlatStore.getState()
    const maxZ = after.flatElements.length ? Math.max(...after.flatElements.map(e => e.zIndex)) : 0
    const el = buildImageEl(url, targetRef.current, maxZ + 1)
    after.addFlatElement(el)
    after.setSelectedFlat(el.id)
    closeInfographic()
  }, [results, method, ids])

  const isLoading = status === 'capturing' || status === 'analyzing' || status === 'generating'
  const statusText = status === 'capturing' ? (mode === 'selection' ? '선택 영역 캡처 중…' : '현재 페이지 캡처 중…')
    : status === 'analyzing' ? '내용 분석 중…'
    : status === 'generating' ? (method === 'edit' ? '이미지 편집 중… (수십 초 걸릴 수 있어요)' : '인포그래픽 이미지 생성 중… (수십 초 걸릴 수 있어요)')
    : ''

  const activeUrl = results[method]
  const t = targetRef.current
  const aspect = t && t.w && t.h ? `${t.w} / ${t.h}` : '16 / 9'

  return createPortal(
    <>
    <div
      onMouseDown={cancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(580px, 94vw)',
          background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 600 }}>
          <SparkleIcon /> AI 인포그래픽 변환
          <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>
            {mode === 'selection' ? '· 선택 영역' : '· 현재 페이지'}
          </span>
        </div>

        {/* 생성 방법 토글 — 전환해도 재생성하지 않음(캐시 표시) */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'analyze', label: '분석→재생성', hint: '내용을 분석해 새로 그림' },
            { id: 'edit', label: '이미지 편집', hint: '캡처를 입력으로 구도 유지' },
          ].map(m => (
            <button
              key={m.id}
              type="button"
              disabled={isLoading}
              onClick={() => switchMethod(m.id)}
              title={m.hint}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 8,
                cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1,
                border: method === m.id ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.12)',
                background: method === m.id ? 'rgba(99,102,241,0.22)' : 'transparent',
                color: method === m.id ? '#c7d2fe' : '#94a3b8',
              }}
            >{m.label}</button>
          ))}
        </div>

        {/* 화풍(스타일) 선택 — 변경 시 결과 무효화 후 재분석 필요 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>화풍</span>
          <select
            value={styleId}
            disabled={isLoading}
            onChange={e => changeStyle(e.target.value)}
            title="이미지 화풍"
            style={{
              flex: 1, height: 30, fontSize: 12, padding: '0 8px', borderRadius: 8,
              cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.5 : 1,
              background: 'rgba(255,255,255,0.06)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.14)', outline: 'none',
            }}
          >
            {INFOGRAPHIC_STYLES.map(s => (
              <option key={s.id} value={s.id} style={{ background: '#1e293b', color: '#f1f5f9' }}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* 본문: 진행 중 / 에러 / 이미지 / 설명 */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#94a3b8', padding: '24px 4px' }}>
            <Spinner /> {statusText}
          </div>
        )}

        {!isLoading && status === 'error' && (
          <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5, padding: '8px 2px' }}>
            {error}
            <div style={{ color: '#64748b', marginTop: 6 }}>‘다시 생성’을 눌러 시도하세요.</div>
          </div>
        )}

        {!isLoading && status !== 'error' && activeUrl && (
          <>
            <div
              onClick={() => setZoom(true)}
              title="클릭하여 크게 보기"
              style={{
                width: '100%', aspectRatio: aspect, maxHeight: 320, borderRadius: 8, overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-in',
              }}
            >
              <img src={activeUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>클릭하면 크게 볼 수 있어요 · 생성 스펙(JSON, 편집 후 재생성 가능)</div>
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
          </>
        )}

        {!isLoading && status !== 'error' && !activeUrl && (
          <>
            <div style={{
              fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, padding: '14px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
            }}>
              {METHOD_DESC[method]}
              <div style={{ color: '#64748b', marginTop: 8, fontSize: 12 }}>‘생성’을 누르면 시작합니다.</div>
            </div>
            {prompt && (
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                spellCheck={false}
                title="생성 스펙(JSON) — 편집 후 생성"
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
                }}
              />
            )}
          </>
        )}

        {/* 푸터 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={cancel} style={ghostBtnStyle}>취소</button>
          {!isLoading && !activeUrl && (
            <button type="button" onClick={() => generate(method, prompt)} style={primaryBtnStyle}>
              {status === 'error' ? '다시 생성' : '생성'}
            </button>
          )}
          {!isLoading && activeUrl && (
            <>
              <button type="button" onClick={() => generate(method, prompt)} style={ghostBtnStyle}>재생성</button>
              {mode === 'selection' ? (
                <>
                  <button type="button" onClick={insertHere} style={ghostBtnStyle}>원본 위에 삽입</button>
                  <button type="button" onClick={replaceOriginals} style={primaryBtnStyle}>원본 교체</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={insertHere} style={ghostBtnStyle}>현재 페이지에 추가</button>
                  <button type="button" onClick={addNextSlide} style={primaryBtnStyle}>다음 슬라이드로 추가</button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {/* 크게 보기 라이트박스 */}
    {zoom && activeUrl && (
      <div
        onMouseDown={e => { e.stopPropagation(); setZoom(false) }}
        style={{
          position: 'fixed', inset: 0, zIndex: 20010,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
        }}
      >
        <img src={activeUrl} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain' }} />
      </div>
    )}
    </>,
    document.body
  )
}

const ghostBtnStyle = {
  padding: '7px 13px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtnStyle = {
  padding: '7px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
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
