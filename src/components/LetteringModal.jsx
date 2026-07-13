import { create } from 'zustand'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, generateImage, editImage } from '../core/OpenAIClient'
import { captureElementRegion } from '../core/captureCanvasRegion'
import { buildLetteringPrompt } from '../core/letteringPrompt'
import { LETTERING_STYLES, LETTERING_POSITIONS, LETTERING_BG } from '../core/aiLetteringPresets'
import { BlobStore } from '../core/BlobStore'
import { embedPngMetadata } from '../core/pngMeta'
import { nextFlatId } from '../core/FlatExtractor'
import { applyChromaToImageData } from '../core/chromaKey'
import { segmentImage } from '../core/CutoutBackendClient'
import { openAiSettings } from './AiSettingsModal'

const TRANSPARENT_MODEL = 'gpt-image-1.5' // gpt-image-2는 투명 미지원 → 투명 직접생성용 모델

// 이미지 dataURL 로드
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = src
  })
}

// 단색 배경(검정/흰색)을 크로마로 제거 → 투명 PNG dataURL
async function keyOutSolid(dataUrl, key) {
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const id = ctx.getImageData(0, 0, w, h)
  applyChromaToImageData(id, key, 14, 8) // 단색이라 tolerance/feather 여유
  ctx.putImageData(id, 0, 0)
  return c.toDataURL('image/png')
}

/**
 * AI 이미지 레터링 — 선택 텍스트를 방송용 위치·스타일의 레터링 이미지로 생성.
 * openLettering(element)로 연다(다른 모달과 동일 패턴 — 선택 lifecycle과 분리).
 *
 * 2모드: 제자리(박스 위치·크기 대체) / 방송 타이틀(풀캔버스 새 레이어).
 * 배경: 캔버스 캡처(editImage) / 검정·흰색 단색(generateImage). 프롬프트는 letteringPrompt.
 * (글자만 남기기(투명 분리)는 후속 P3.)
 */
const useStore = create(() => ({ open: false, element: null }))
// eslint-disable-next-line react-refresh/only-export-components -- 오프너(모달 패턴)
export function openLettering(element) { useStore.setState({ open: true, element }) }
function close() { useStore.setState({ open: false, element: null }) }

function htmlToPlain(content) {
  if (!content) return ''
  if (!/[<&]/.test(content)) return content.trim()
  const div = document.createElement('div')
  div.innerHTML = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

export function LetteringHost() {
  const open = useStore(s => s.open)
  const element = useStore(s => s.element)
  if (!open || !element) return null
  return <Dialog element={element} />
}

function Dialog({ element }) {
  const [phase, setPhase] = useState('compose') // compose | loading | preview | error
  const [mode, setMode] = useState('inplace')    // inplace | title
  const [bgId, setBgId] = useState('scene')
  const [styleId, setStyleId] = useState('youtube')
  const [positionId, setPositionId] = useState('lower-third')
  const [text, setText] = useState(() => htmlToPlain(element.content))
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
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
    setLastPrompt(prompt)
    try {
      let url
      if (bgId === 'scene') {
        // 캔버스 캡처(씬 위 레터링). 캡처 중 선택 텍스트는 숨긴다(중복 렌더 방지).
        const st = useFlatStore.getState()
        const cs = st.canvasSize || { w: 1280, h: 720 }
        const bbox = mode === 'title'
          ? { x: 0, y: 0, w: cs.w, h: cs.h }
          : { x: element.x, y: element.y, w: element.width, h: element.height }
        setStatus('캔버스 캡처 중…')
        st.previewFlatElement(element.id, { styles: { opacity: '0' } })
        let cap
        try {
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          cap = await captureElementRegion(bbox, { signal: ctrl.signal })
        } finally {
          useFlatStore.getState().previewFlatElement(element.id, { styles: { opacity: element.styles?.opacity ?? '1' } })
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
  }, [text, mode, bgId, positionId, styleId, targetSize, element.id, element.x, element.y, element.width, element.height, element.styles])

  // 글자만 남기기(투명): keyout(단색 크로마)/transparent(gpt-image-1.5)/cutout(BiRefNet)
  const isolate = useCallback(async (method) => {
    if (!imageUrl || isoBusy) return
    setIsoBusy(method); setError('')
    try {
      if (method === 'keyout') {
        const key = bgId === 'white' ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
        setImageUrl(await keyOutSolid(imageUrl, key)); setIsolated(true)
      } else if (method === 'transparent') {
        const ctrl = new AbortController(); abortRef.current = ctrl
        const { width, height } = targetSize()
        const url = await generateImage(lastPrompt, { model: TRANSPARENT_MODEL, background: 'transparent', width, height, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setImageUrl(url); setIsolated(true)
      } else if (method === 'cutout') {
        const blob = await fetch(imageUrl).then(r => r.blob())
        const r = await segmentImage(blob)
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(r.blob) })
        setImageUrl(url); setIsolated(true)
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(method === 'cutout'
        ? '전경 분리 서버에 연결할 수 없습니다 (이미지 전경 분리와 동일한 로컬 서버 필요).'
        : (e?.message || '배경 제거에 실패했습니다.'))
    } finally { setIsoBusy('') }
  }, [imageUrl, isoBusy, bgId, lastPrompt, targetSize])

  const apply = useCallback(async () => {
    if (!imageUrl) return
    // 큰 dataURL은 idb로 보관(언두/저장 비대화 방지). 메타 임베드 후 저장.
    const withMeta = embedPngMetadata(imageUrl, { description: text, prompt: `lettering:${styleId}` })
    let content = withMeta
    try {
      const blob = await fetch(withMeta).then(r => r.blob())
      content = BlobStore.toRef(await BlobStore.put(blob))
    } catch { /* 실패 시 dataURL 유지 */ }
    const st = useFlatStore.getState()
    // 투명(글자만) 결과는 잘리지 않게 contain, 그 외는 cover.
    const imgStyles = { objectFit: isolated ? 'contain' : 'cover', objectPosition: 'center center', backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', opacity: '1' }
    if (mode === 'title') {
      const cs = st.canvasSize || { w: 1280, h: 720 }
      const maxZ = st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
      const el = {
        id: nextFlatId(), sourceId: null, type: 'image', width: cs.w, height: cs.h,
        content, isRich: false, merged: false, x: 0, y: 0, zIndex: maxZ + 1, styles: imgStyles,
      }
      st.addFlatElement(el); st.setSelectedFlat?.(el.id)
    } else {
      // 제자리: 선택 텍스트를 같은 위치·크기의 이미지로 교체(되돌리기 가능)
      st.updateFlatElement(element.id, { type: 'image', content, isRich: false, styles: { ...element.styles, ...imgStyles } })
    }
    close()
  }, [imageUrl, text, styleId, mode, isolated, element.id, element.styles])

  const onClose = useCallback(() => { abortRef.current?.abort(); close() }, [])

  // 제자리 모드에서 배경 scene은 마스크/크롭 미구현(P3) → 단색 권장. 방송 타이틀은 전부 허용.
  const bgOptions = LETTERING_BG

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
              <Seg value={bgId} onChange={setBgId} options={bgOptions.map(b => [b.id, b.label])} />
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
            {/* 글자만 남기기(투명) — 배경 제거 3경로 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span style={{ ...hint, marginRight: 2 }}>글자만 남기기{isolated ? ' ✓(투명)' : ''}:</span>
              {(bgId === 'black' || bgId === 'white') && (
                <button type="button" onClick={() => isolate('keyout')} disabled={!!isoBusy} style={chipBtn}>
                  {isoBusy === 'keyout' ? '…' : '단색 키아웃'}
                </button>
              )}
              <button type="button" onClick={() => isolate('transparent')} disabled={!!isoBusy} style={chipBtn} title="gpt-image-1.5로 투명 배경 재생성">
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
          {phase === 'preview' && <button type="button" onClick={run} style={ghostBtn}>재생성</button>}
          {phase === 'preview' && <button type="button" onClick={apply} style={primaryBtn}>적용</button>}
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
