import { create } from 'zustand'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, generateImage, editImage } from '../core/OpenAIClient'
import { captureElementRegion } from '../core/captureCanvasRegion'
import { buildLetteringPrompt } from '../core/letteringPrompt'
import { LETTERING_STYLES, LETTERING_POSITIONS, LETTERING_BG } from '../core/aiLetteringPresets'
import { htmlToPlain } from '../core/slideTextDigest'
import { applyChromaKey } from '../core/chromaKey'
import { segmentImage } from '../core/CutoutBackendClient'
import { storeResultRef } from '../core/aiResult'
import { embedPngMetadata } from '../core/pngMeta'
import { nextFlatId } from '../core/FlatExtractor'
import { openAiSettings } from './AiSettingsModal'

const TRANSPARENT_MODEL = 'gpt-image-1.5' // gpt-image-2는 투명 미지원 → 투명 직접생성용 모델

// gpt-image-1.5는 유동 크기 미지원 → 지원 고정 크기(1024²/1024x1536/1536x1024)에서 비율로 선택.
function supportedSize(width, height) {
  const r = (width || 1) / (height || 1)
  if (r > 1.2) return '1536x1024'
  if (r < 0.83) return '1024x1536'
  return '1024x1024'
}

/**
 * AI 이미지 레터링 — 선택 텍스트를 방송용 위치·스타일의 레터링 이미지로 생성.
 * openLettering(element)로 연다. 결과는 열 때의 페이지에 바인딩된다(비동기 중 페이지 전환 대비).
 *
 * 2모드: 제자리(박스 위치·크기 대체) / 방송 타이틀(풀캔버스 새 레이어).
 * 배경: 캔버스 캡처(editImage) / 검정·흰색 단색(generateImage).
 * 글자만 남기기(투명): ① 단색 크로마 키아웃 / ② gpt-image-1.5 투명 재생성 / ③ cutout(BiRefNet).
 */
const useStore = create(() => ({ open: false, element: null, pageKey: null }))
// eslint-disable-next-line react-refresh/only-export-components -- 오프너(모달 패턴)
export function openLettering(element) {
  useStore.setState({ open: true, element, pageKey: useFlatStore.getState().getCurrentPageKey() })
}
function close() { useStore.setState({ open: false, element: null, pageKey: null }) }

export function LetteringHost() {
  const open = useStore(s => s.open)
  const element = useStore(s => s.element)
  const pageKey = useStore(s => s.pageKey)
  if (!open || !element) return null
  return <Dialog element={element} pageKey={pageKey} />
}

function Dialog({ element, pageKey }) {
  const [phase, setPhase] = useState('compose') // compose | loading | preview | error
  const [mode, setMode] = useState('inplace')    // inplace | title
  const [bgId, setBgId] = useState('scene')
  const [styleId, setStyleId] = useState('youtube')
  const [positionId, setPositionId] = useState('lower-third')
  const [text, setText] = useState(() => htmlToPlain(element.content))
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [isolated, setIsolated] = useState(false) // 배경 제거(투명 레터링) 적용됨
  const [isoBusy, setIsoBusy] = useState('')       // 진행 중 분리 방법 라벨
  const abortRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  // 대상 크기: 제자리=박스, 방송 타이틀=캔버스
  const targetSize = useCallback(() => {
    const cs = useFlatStore.getState().canvasSize || { w: 1280, h: 720 }
    return mode === 'title'
      ? { width: cs.w, height: cs.h }
      : { width: Math.round(element.width), height: Math.round(element.height) }
  }, [mode, element.width, element.height])

  const run = useCallback(async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    const t = text.trim()
    if (!t) { setError('레터링할 문구가 없습니다.'); setPhase('error'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setImageUrl(''); setIsolated(false)
    const { width, height } = targetSize()
    const prompt = buildLetteringPrompt({ text: t, mode, bgId, positionId, styleId })
    try {
      let url
      if (bgId === 'scene') {
        // 캔버스 캡처(씬 위 레터링). 열 때의 페이지에서만 유효(비동기 중 페이지 전환 방지).
        const st = useFlatStore.getState()
        if (pageKey && pageKey !== st.getCurrentPageKey()) {
          setError('레터링은 원본 슬라이드에서 실행하세요 (다른 슬라이드로 이동됨).'); setPhase('error'); return
        }
        const cs = st.canvasSize || { w: 1280, h: 720 }
        const bbox = mode === 'title'
          ? { x: 0, y: 0, w: cs.w, h: cs.h }
          : { x: element.x, y: element.y, w: element.width, h: element.height }
        setStatus('캔버스 캡처 중…')
        // 캡처 중 원본 텍스트를 숨긴다(중복 렌더 방지). 원래 opacity로 복원(없었으면 언셋).
        const origOp = st.flatElements.find(e => e.id === element.id)?.styles?.opacity
        st.previewFlatElement(element.id, { styles: { opacity: '0' } })
        let cap
        try {
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          cap = await captureElementRegion(bbox, { signal: ctrl.signal })
        } finally {
          useFlatStore.getState().previewFlatElement(element.id, { styles: { opacity: origOp ?? '' } })
        }
        if (ctrl.signal.aborted) return
        setStatus('레터링 생성 중… (수십 초)')
        url = await editImage(cap, prompt, { width, height, signal: ctrl.signal })
      } else {
        setStatus('레터링 생성 중… (수십 초)')
        url = await generateImage(prompt, { width, height, signal: ctrl.signal })
      }
      if (ctrl.signal.aborted) return
      setImageUrl(url); setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 호출에 실패했습니다.'); setPhase('error')
    }
  }, [text, mode, bgId, positionId, styleId, targetSize, pageKey, element.id, element.x, element.y, element.width, element.height])

  // 글자만 남기기(투명): keyout(단색 크로마)/transparent(gpt-image-1.5)/cutout(BiRefNet)
  const isolate = useCallback(async (method) => {
    if (!imageUrl || isoBusy) return
    if (method === 'transparent' && !hasApiKey()) { openAiSettings(); return }
    setIsoBusy(method); setError('')
    try {
      if (method === 'keyout') {
        const key = bgId === 'white' ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
        setImageUrl(await applyChromaKey(imageUrl, key, 14)); setIsolated(true)
      } else if (method === 'transparent') {
        const ctrl = new AbortController(); abortRef.current = ctrl
        const { width, height } = targetSize()
        // 씬 참조 없는 투명 전용 프롬프트로 새로 생성(gpt-image-1.5 네이티브 알파).
        const prompt = buildLetteringPrompt({ text: text.trim(), mode, bgId: 'transparent', positionId, styleId })
        const url = await generateImage(prompt, { model: TRANSPARENT_MODEL, background: 'transparent', size: supportedSize(width, height), signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setImageUrl(url); setIsolated(true)
      } else if (method === 'cutout') {
        const blob = await fetch(imageUrl).then(r => r.blob())
        const r = await segmentImage(blob)
        if (r.url) URL.revokeObjectURL(r.url) // 내부 objectURL 미사용 → 누수 방지
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(r.blob) })
        setImageUrl(url); setIsolated(true)
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(method === 'cutout'
        ? '전경 분리 서버에 연결할 수 없습니다 (이미지 전경 분리와 동일한 로컬 서버 필요).'
        : (e?.message || '배경 제거에 실패했습니다.'))
    } finally { setIsoBusy('') }
  }, [imageUrl, isoBusy, bgId, text, mode, positionId, styleId, targetSize])

  const apply = useCallback(async () => {
    if (!imageUrl) return
    const st = useFlatStore.getState()
    const imgStyles = { objectFit: 'contain', objectPosition: 'center center', backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', opacity: '1' }
    const ref = await storeResultRef(embedPngMetadata(imageUrl, { description: text, prompt: `lettering:${styleId}` }))
    if (mode === 'title') {
      const cs = st.canvasSize || { w: 1280, h: 720 }
      const onCurrent = !pageKey || pageKey === st.getCurrentPageKey()
      const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
      const el = { id: nextFlatId(), sourceId: null, type: 'image', width: cs.w, height: cs.h, content: ref, isRich: false, merged: false, x: 0, y: 0, zIndex: maxZ + 1, styles: imgStyles }
      if (!st.addElementToPage(pageKey, el)) { setError('원본 슬라이드를 찾을 수 없습니다.'); return }
      if (onCurrent) st.setSelectedFlat?.(el.id)
    } else {
      // 제자리: 원본 텍스트를 같은 위치·크기의 이미지로 교체(원본 페이지에 바인딩, 되돌리기 가능)
      const ok = st.applyToElementOnPage(pageKey, element.id, { type: 'image', content: ref, isRich: false, styles: imgStyles })
      if (!ok) { setError('원본 텍스트 요소를 찾을 수 없습니다 (삭제/이동됨).'); return }
    }
    close()
  }, [imageUrl, text, styleId, mode, pageKey, element.id])

  const onClose = useCallback(() => { abortRef.current?.abort(); close() }, [])
  const busy = phase === 'loading' || !!isoBusy

  return createPortal(
    <div onMouseDown={onClose} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>✨ 이미지 레터링</div>

        {phase !== 'preview' && phase !== 'loading' && (
          <>
            <Field label="문구">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="레터링할 짧은 문구"
                style={textareaStyle} />
              <div style={hint}>짧을수록(3~5단어) 정확합니다. 한글은 재생성으로 다듬으세요.</div>
            </Field>
            <Field label="모드">
              <Seg value={mode} onChange={setMode} options={[['inplace', '제자리'], ['title', '방송 타이틀']]} />
            </Field>
            <Field label="배경">
              <Seg value={bgId} onChange={setBgId} options={LETTERING_BG.map(b => [b.id, b.label])} />
            </Field>
            <Field label="스타일">
              <select value={styleId} onChange={e => setStyleId(e.target.value)} style={selectStyle}>
                {LETTERING_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            {mode === 'title' && (
              <Field label="위치">
                <select value={positionId} onChange={e => setPositionId(e.target.value)} style={selectStyle}>
                  {LETTERING_POSITIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
            )}
            {phase === 'error' && <div style={{ fontSize: 12.5, color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>}
          </>
        )}

        {phase === 'loading' && (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '20px 2px', textAlign: 'center' }}>{status || '처리 중…'}</div>
        )}

        {phase === 'preview' && (
          <>
            <div style={previewBox}>
              {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span style={{ ...hint, marginRight: 2 }}>글자만 남기기{isolated ? ' ✓(투명)' : ''}:</span>
              {(bgId === 'black' || bgId === 'white') && (
                <button type="button" onClick={() => isolate('keyout')} disabled={!!isoBusy} style={chipBtn}>
                  {isoBusy === 'keyout' ? '…' : '단색 키아웃'}
                </button>
              )}
              <button type="button" onClick={() => isolate('transparent')} disabled={!!isoBusy} style={chipBtn} title="gpt-image-1.5로 투명 배경 새로 생성">
                {isoBusy === 'transparent' ? '재생성…' : '투명 재생성(1.5)'}
              </button>
              <button type="button" onClick={() => isolate('cutout')} disabled={!!isoBusy} style={chipBtn} title="로컬 전경 분리 서버(BiRefNet)">
                {isoBusy === 'cutout' ? '분리…' : '전경 분리'}
              </button>
            </div>
            {error && <div style={{ fontSize: 11.5, color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>}
            <div style={hint}>
              {mode === 'title' ? '적용하면 풀캔버스 이미지로 새 레이어에 추가됩니다.' : '적용하면 이 텍스트가 같은 위치·크기의 이미지로 교체됩니다.'} (되돌리기 가능)
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>취소</button>
          {(phase === 'compose' || phase === 'error') && <button type="button" onClick={run} style={primaryBtn}>생성</button>}
          {phase === 'preview' && <button type="button" onClick={run} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.5 : 1 }}>재생성</button>}
          {phase === 'preview' && <button type="button" onClick={apply} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>적용</button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  )
}

function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(([id, lbl]) => (
        <button key={id} type="button" onClick={() => onChange(id)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${value === id ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.12)'}`,
            background: value === id ? 'rgba(99,102,241,0.2)' : 'transparent',
            color: value === id ? '#c7d2fe' : '#cbd5e1', fontWeight: value === id ? 600 : 400,
          }}>{lbl}</button>
      ))}
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(440px, 96vw)', maxHeight: '90vh', overflowY: 'auto', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }
const textareaStyle = { width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5, background: 'rgba(255,255,255,0.06)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none' }
const selectStyle = { width: '100%', padding: '7px 10px', fontSize: 12.5, borderRadius: 8, background: '#0b1220', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.16)' }
const previewBox = { width: '100%', height: 220, borderRadius: 8, overflow: 'hidden', background: 'repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50%/16px 16px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const hint = { fontSize: 11, color: '#64748b', lineHeight: 1.5 }
const chipBtn = { padding: '5px 10px', fontSize: 11.5, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(129,140,248,0.4)', background: 'rgba(99,102,241,0.14)', color: '#c7d2fe', whiteSpace: 'nowrap' }
const ghostBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: '#cbd5e1' }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
