import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, editImage, buildImageEnhancePrompt } from '../core/OpenAIClient'
import { captureElementRegion } from '../core/captureCanvasRegion'
import { openAiSettings } from './AiSettingsModal'
import { INFOGRAPHIC_STYLES } from '../core/aiImageStyles'
import { segmentImage, checkCutoutBackend } from '../core/CutoutBackendClient'
import CutoutInstallModal from './CutoutInstallModal'
import { BlobStore } from '../core/BlobStore'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'
import MaskBrushOverlay from './MaskBrushOverlay'
import ImageComparePreview from './ImageComparePreview'

// data URL 이미지의 실제 픽셀 크기
function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('이미지 크기를 읽지 못했습니다.'))
    img.src = dataUrl
  })
}

// 이미지 요소의 원본 소스(content) → Blob. idb 참조면 BlobStore, 아니면 직접 fetch.
// (박스 캡처가 아니라 원본을 분리해야 컷아웃 종횡비=원본과 같아 그룹 리사이즈에 어긋나지 않음)
async function elementImageBlob(content) {
  if (!content) throw new Error('이미지 소스를 찾을 수 없습니다.')
  if (BlobStore.isIdbRef(content)) {
    const b = await BlobStore.get(BlobStore.parseRef(content))
    if (!b) throw new Error('이미지 데이터를 불러오지 못했습니다.')
    return b
  }
  const res = await fetch(content)
  return res.blob()
}

/**
 * 이미지를 박스 크기(elementW×elementH) 캔버스에 contain-fit 위치로 그리고,
 * 빈 letterbox/pillarbox 영역은 투명으로 둔다.
 * → OpenAI image edit API가 투명 영역을 자연스럽게 채울 수 있다(아웃페인팅).
 */
async function composeContainFit(content, elementW, elementH) {
  let imgUrl = content
  let revokeOnDone = false
  if (BlobStore.isIdbRef(content)) {
    const blob = await BlobStore.get(BlobStore.parseRef(content))
    if (!blob) throw new Error('이미지 데이터를 불러오지 못했습니다.')
    imgUrl = URL.createObjectURL(blob)
    revokeOnDone = true
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (revokeOnDone) URL.revokeObjectURL(imgUrl)
      const imgAR = img.naturalWidth / img.naturalHeight
      const boxAR = elementW / elementH
      let dw, dh, dx, dy
      if (imgAR >= boxAR) {
        // 이미지가 박스보다 가로가 넓음 → 상하 여백(letterbox)
        dw = elementW; dh = elementW / imgAR
        dx = 0;        dy = (elementH - dh) / 2
      } else {
        // 이미지가 박스보다 세로가 긺 → 좌우 여백(pillarbox)
        dh = elementH; dw = elementH * imgAR
        dx = (elementW - dw) / 2; dy = 0
      }
      const canvas = document.createElement('canvas')
      canvas.width = elementW; canvas.height = elementH
      canvas.getContext('2d').drawImage(img, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh))
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      if (revokeOnDone) URL.revokeObjectURL(imgUrl)
      reject(new Error('이미지를 불러오지 못했습니다.'))
    }
    img.src = imgUrl
  })
}

/**
 * FlatImageAiBar — 이미지 요소를 단일 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 두 가지 액션(둘 다 OpenAI image-to-image `editImage` 사용):
 *  - "디자인 다듬기"(enhance): 화풍 선택 → 글자·요소 위치는 유지한 채 시각 스타일만 향상.
 *  - "설명으로 편집"(edit): 사용자가 입력한 지시대로 이미지를 편집(배경 변경/요소 제거/보정 등).
 * 결과 미리보기(설명으로 편집·재생성·크게보기) 후 확인하면 같은 자리에서 이미지를 교체한다
 * (되돌리기 가능). 결과 종횡비가 박스와 어긋나도 잘리지 않도록 objectFit:contain.
 */
export default function FlatImageAiBar({ element, scale, canvasRef }) {
  // 'idle' | 'compose' | 'loading' | 'preview' | 'error'
  const [phase, setPhase] = useState('idle')
  const [mode, setMode] = useState('enhance') // 'enhance' | 'edit'
  const [styleId, setStyleId] = useState('original')
  const [styleMenuOpen, setStyleMenuOpen] = useState(false) // '디자인 다듬기' 화풍 드롭다운
  const [status, setStatus] = useState('')
  const [prompt, setPrompt] = useState('') // 활성 프롬프트(편집 지시 / 변환 지시)
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false)
  // 마스크(부분 편집) — '설명으로 편집' compose에서 켜면 이미지 위에 브러시 오버레이
  const [maskOn, setMaskOn] = useState(false)
  const [brushTool, setBrushTool] = useState('brush') // 'brush' | 'erase'
  const [brushSize, setBrushSize] = useState(48)
  const [maskCount, setMaskCount] = useState(0) // 칠한(편집가능) 스트로크 수(버튼 안내용)
  const maskRef = useRef(null)
  const lastMaskRef = useRef(null) // 직전에 사용한 마스크 dataURL(재생성 시 재사용)
  // 캔버스 전후 비교(미리보기)
  const [split, setSplit] = useState(50)   // 세로 구분선 위치(%)
  const [holding, setHolding] = useState(false) // '원본 보기' 홀드 중
  const compareFit = mode === 'outpaint' ? 'cover' : 'contain' // 적용 시 objectFit과 동일
  const abortRef = useRef(null)
  const captureRef = useRef('') // 입력 캡처 — 재생성 시 재사용
  const cutoutBlobRef = useRef(null) // 분리 결과 PNG blob — 적용 시 data URL로 변환
  const [serverDown, setServerDown] = useState(false) // 분리 서버 미연결 → 설치 안내 노출
  const [showInstall, setShowInstall] = useState(false)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.height, scale, tick])

  // 선택 요소가 바뀌면 진행 중 작업 취소 + idle로 초기화
  useEffect(() => {
    abortRef.current?.abort()
    captureRef.current = ''
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('idle'); setMode('enhance'); setError(''); setStatus(''); setPrompt(''); setImageUrl(''); setZoom(false)
    setServerDown(false); setShowInstall(false)
    setMaskOn(false); setMaskCount(0); lastMaskRef.current = null
    setSplit(50); setHolding(false)
    return () => { abortRef.current?.abort() }
  }, [element.id])

  // 캡처 → editImage. enhance는 화풍 기반 향상 프롬프트, edit는 사용자 프롬프트 사용.
  const run = useCallback(async (useMode, userPrompt, styleOverride) => {
    if (!hasApiKey()) { openAiSettings(); return }
    let p
    if (useMode === 'edit') {
      p = (userPrompt != null ? userPrompt : prompt).trim()
      if (!p) return // 편집 지시 없으면 실행 안 함
    } else {
      // 드롭다운에서 고른 화풍(styleOverride)이 있으면 그것을, 없으면 현재 styleId 사용(setState 지연 회피).
      const sid = styleOverride || styleId
      const directive = INFOGRAPHIC_STYLES.find(s => s.id === sid)?.directive || ''
      p = buildImageEnhancePrompt(directive)
    }
    // 마스크 핸들을 phase 변경(→오버레이 언마운트) 전에 확보한다. loading으로 바뀌면
    // MaskBrushOverlay가 언마운트되어 maskRef.current가 null이 되므로 여기서 잡아둔다.
    // (핸들 객체는 strokes ref·요소 크기·contentRect를 클로저로 보유 → 언마운트 후에도 buildMask 유효)
    const maskHandle = (useMode === 'edit' && maskOn && maskRef.current?.hasStrokes()) ? maskRef.current : null
    setMode(useMode); setPrompt(p)
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
      // 부분 편집: 마스크가 있으면 캡처 해상도에 맞춰 생성 → 그 영역만 편집. 재생성 위해 보관.
      let mask
      if (maskHandle) {
        const { w, h } = await imageSize(cap)
        mask = maskHandle.buildMask(w, h) || undefined
      }
      lastMaskRef.current = mask || null
      setStatus(useMode === 'edit' ? 'AI 이미지 편집 중… (수십 초 걸릴 수 있어요)' : '디자인 다듬는 중… (수십 초 걸릴 수 있어요)')
      const url = await editImage(cap, p, { width: element.width, height: element.height, mask, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 변환에 실패했습니다.')
      setPhase('error')
    }
  }, [styleId, prompt, maskOn, element.x, element.y, element.width, element.height])

  // 현재 프롬프트(편집 가능)로 캡처를 재사용해 다시 변환
  const regenerate = useCallback(async () => {
    const cap = captureRef.current
    const p = prompt.trim()
    if (!cap || !p) { run(mode, prompt); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setStatus(mode === 'edit' ? 'AI 이미지 편집 중…' : '디자인 다듬는 중…')
    try {
      // 마스크 편집이었으면 같은 마스크로 재생성(영역 일관 유지)
      const mask = mode === 'edit' ? (lastMaskRef.current || undefined) : undefined
      const url = await editImage(cap, p, { width: element.width, height: element.height, mask, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '이미지 변환에 실패했습니다.')
      setPhase('error')
    }
  }, [prompt, mode, run, element.width, element.height])

  // 빈 공간 채우기(아웃페인팅): contain 상태 이미지의 letterbox/pillarbox 영역을 AI로 채움
  const runOutpaint = useCallback(async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setMode('outpaint'); setPhase('loading'); setError(''); setImageUrl('')
    try {
      setStatus('이미지 합성 중…')
      const composite = await composeContainFit(element.content, element.width, element.height)
      if (ctrl.signal.aborted) return
      captureRef.current = composite
      setStatus('AI 빈 공간 채우기 중… (수십 초 걸릴 수 있어요)')
      const p = 'Seamlessly fill the transparent letterbox/pillarbox areas by naturally extending the existing scene. Match the exact colors, lighting, textures, mood, and visual style of the original image. The result must look like the image was always this size — no visible seams or transitions.'
      setPrompt(p)
      const url = await editImage(composite, p, { width: element.width, height: element.height, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setImageUrl(url); setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '빈 공간 채우기에 실패했습니다.')
      setPhase('error')
    }
  }, [element.content, element.width, element.height])

  // 같은 id·위치·크기 유지한 채 이미지 content만 교체(되돌리기 가능).
  const apply = useCallback(() => {
    if (!imageUrl) return
    useFlatStore.getState().updateFlatElement(element.id, {
      content: imageUrl,
      isRich: false,
      // 아웃페인팅 결과는 박스 크기에 맞게 생성되었으므로 cover로 빈틈 없이 표시
      styles: { objectFit: mode === 'outpaint' ? 'cover' : 'contain' },
    })
    setPhase('idle'); setImageUrl(''); setZoom(false)
  }, [imageUrl, element.id, mode])

  // 피사체 분리(서버) → 전경 컷아웃 미리보기
  const runCutout = useCallback(async () => {
    setMode('cutout')
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setImageUrl(''); setServerDown(false); setStatus('분리 서버 확인 중…')
    try {
      const ok = await checkCutoutBackend(true)
      if (ctrl.signal.aborted) return
      if (!ok) {
        setServerDown(true)
        setError('피사체 분리 서버에 연결할 수 없습니다. 한 번만 설치하면 됩니다.')
        setPhase('error'); return
      }
      setStatus('이미지 불러오는 중…')
      const inputBlob = await elementImageBlob(element.content)
      if (ctrl.signal.aborted) return
      setStatus('피사체 분리 중…')
      const r = await segmentImage(inputBlob, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      cutoutBlobRef.current = r.blob
      setImageUrl(r.url)
      setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '피사체 분리에 실패했습니다.')
      setPhase('error')
    }
  }, [element.content])

  // 컷아웃 적용: 원본(배경)+타이틀(중간)+컷아웃(앞) 3층 자동 배치
  const applyCutout = useCallback(async () => {
    const blob = cutoutBlobRef.current
    if (!blob) return
    // 컷아웃 PNG는 BlobStore(idb://)에 저장 — 프로젝트 JSON 비대 방지(일반 이미지와 동일,
    // ProjectSerializer가 저장 시 media/로 패킹). content엔 참조만 들어감.
    const key = await BlobStore.put(blob)
    useFlatStore.getState().applyTextBehindSubject(element.id, BlobStore.toRef(key))
    setPhase('idle'); setImageUrl(''); setZoom(false)
  }, [element.id])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase('idle'); setError(''); setImageUrl(''); setZoom(false); setServerDown(false)
  }, [])

  // 드래그 이동 — 그립 핸들로 idle 액션바를 자유 위치로 옮김(선택 변경 시 자동 복귀)
  const barRef = useRef(null)
  const { pos: dragPos, startDrag, dragging } = useDraggableToolbar(element.id, barRef)

  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  const BAR_W = 600
  const placeAbove = elemTop - BAR_H - 8 >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - 8 : elemBottom + 8
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, elemLeft))
  const barLeft = dragPos ? dragPos.left : anchorLeft
  const barTop = dragPos ? dragPos.top : anchorTop

  const modeLabel = mode === 'cutout' ? '피사체 뒤 텍스트'
    : mode === 'outpaint' ? 'AI 빈 공간 채우기'
    : mode === 'edit' ? '설명으로 편집' : '디자인 다듬기'

  // objectFit이 contain(맞추기)일 때만 빈 공간 채우기 버튼 노출
  const isContainFit = (element.styles?.objectFit ?? 'contain') === 'contain'

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
          ref={barRef}
          data-edit-accessory="true"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: barLeft, top: barTop, zIndex: 10040,
            display: 'flex', alignItems: 'center', gap: 6,
            height: BAR_H, padding: '0 8px', borderRadius: 10,
            background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <GripHandle onPointerDown={startDrag} dragging={dragging} />
          {/* '디자인 다듬기' 버튼 자체가 화풍 드롭다운 — 화풍을 고르면 그 스타일로 바로 실행.
              (별도 콤보가 다른 버튼에도 적용되는 듯 혼동되던 문제 해결) */}
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => setStyleMenuOpen(v => !v)}
              title="화풍을 골라 글자·요소 위치는 그대로 두고 디자인을 AI로 다듬습니다"
              style={aiBtnStyle}
            >
              <SparkleIcon />
              <span style={{ fontSize: 12, marginLeft: 5 }}>디자인 다듬기 ▾</span>
            </button>
            {styleMenuOpen && (
              <div style={menuStyle}>
                {INFOGRAPHIC_STYLES.map(s => (
                  <button key={s.id} type="button" style={menuItemStyle}
                    onClick={() => { setStyleMenuOpen(false); setStyleId(s.id); run('enhance', null, s.id) }}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.14)', margin: '0 2px' }} />
          <button
            type="button"
            onClick={() => { setMode('edit'); setPrompt(''); setPhase('compose') }}
            title="입력한 지시대로 이미지를 편집합니다 (예: 배경을 흰색으로, 워터마크 제거, 더 밝게)"
            style={aiBtnStyle}
          >
            <EditIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>설명으로 편집</span>
          </button>
          <button
            type="button"
            onClick={runCutout}
            title="피사체(인물/객체)를 분리해 그 '뒤'에 텍스트를 넣는 3층 구성을 만듭니다"
            style={aiBtnStyle}
          >
            <LayersIcon />
            <span style={{ fontSize: 12, marginLeft: 5 }}>피사체 뒤 텍스트</span>
          </button>
          {isContainFit && (
            <button
              type="button"
              onClick={runOutpaint}
              title="맞추기(contain) 모드의 빈 letterbox·pillarbox 영역을 AI로 자연스럽게 채웁니다"
              style={aiBtnStyle}
            >
              <OutpaintIcon />
              <span style={{ fontSize: 12, marginLeft: 5 }}>빈 공간 채우기</span>
            </button>
          )}
        </div>
      )}

      {/* compose / 로딩 / 미리보기 / 에러 팝업 */}
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
            <SparkleIcon /> {modeLabel}
          </div>

          {phase === 'compose' && (
            <>
              <div style={{ fontSize: 11, color: '#64748b' }}>이미지를 어떻게 편집할까요?</div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                autoFocus
                spellCheck={false}
                placeholder="예: 배경을 흰색으로 · 워터마크/잡티 제거 · 색감을 더 밝고 선명하게 · 손글씨를 깔끔한 인쇄체로"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run('edit', prompt) } }}
                style={textareaStyle}
              />
              {/* 부분 편집(마스크) — 켜면 이미지 위에 브러시로 편집 영역 지정 */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
                <input type="checkbox" checked={maskOn} onChange={e => setMaskOn(e.target.checked)} />
                🖌 영역 지정(마스크) — 칠한 부분만 편집
              </label>
              {maskOn && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#cbd5e1' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => setBrushTool('brush')}
                      style={{ ...toolBtnStyle, ...(brushTool === 'brush' ? toolBtnActive : {}) }}>브러시</button>
                    <button type="button" onClick={() => setBrushTool('erase')}
                      style={{ ...toolBtnStyle, ...(brushTool === 'erase' ? toolBtnActive : {}) }}>지우개</button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    크기<input type="range" min={8} max={160} value={brushSize}
                      onChange={e => setBrushSize(Number(e.target.value))} style={{ width: 90 }} />
                  </label>
                  <button type="button" onClick={() => maskRef.current?.clear()} style={toolBtnStyle}>모두 지우기</button>
                  <span style={{ color: '#64748b', fontSize: 11 }}>
                    {maskCount > 0 ? '이미지 위 빨간 영역만 편집됩니다' : '이미지 위를 칠하세요'}
                  </span>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#64748b' }}>입력한 지시대로 이미지를 편집한 결과를 미리 보여드립니다. 확인 후 적용하면 교체됩니다.</div>
            </>
          )}

          {phase === 'compose' && mode === 'edit' && maskOn && (
            <MaskBrushOverlay
              ref={maskRef}
              element={element}
              scale={scale}
              canvasRef={canvasRef}
              tool={brushTool}
              brushSize={brushSize}
              objectFit={element.styles?.objectFit ?? 'contain'}
              onStrokesChange={setMaskCount}
            />
          )}

          {phase === 'loading' && (
            <div style={{ fontSize: 13, color: '#94a3b8', padding: '10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner /> {status || '처리 중…'}
            </div>
          )}

          {phase === 'error' && (
            <div style={{ fontSize: 12.5, color: '#fca5a5', lineHeight: 1.5, whiteSpace: 'pre-wrap', userSelect: 'text', WebkitUserSelect: 'text' }}>{error}</div>
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
                {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', ...(mode === 'cutout' ? CHECKER_BG : null) }} />}
              </div>
              {mode === 'cutout' ? (
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  분리된 전경(투명 배경). 적용하면 <b>원본 + 타이틀 텍스트 + 전경</b> 3층이 만들어져
                  텍스트가 피사체 <b>뒤</b>로 가려집니다. 'TITLE'을 <b>드래그해 원하는 위치</b>에 놓고,
                  더블클릭해 내용을 입력하세요(텍스트는 독립 레이어라 자유 배치).
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {mode === 'edit' ? '편집 지시' : '변환 지시'}(편집 후 재생성 가능)
                  </div>
                  <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    style={textareaStyle}
                  />
                  <div style={{ fontSize: 11, color: '#64748b' }}>적용하면 같은 자리에서 결과 이미지로 교체됩니다(되돌리기 가능).</div>
                </>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 전후 비교 보조(캔버스 오버레이와 연동) — cutout 제외 */}
            {phase === 'preview' && mode !== 'cutout' && (
              <>
                <button type="button"
                  onPointerDown={() => setHolding(true)} onPointerUp={() => setHolding(false)} onPointerLeave={() => setHolding(false)}
                  title="누르는 동안 원본을 보여줍니다" style={{ ...ghostBtnStyle, marginRight: 'auto' }}>원본 보기(꾹)</button>
                <button type="button" onClick={() => setSplit(50)} title="구분선을 가운데로" style={ghostBtnStyle}>리셋</button>
              </>
            )}
            <button type="button" onClick={cancel} style={ghostBtnStyle}>취소</button>
            {serverDown && phase === 'error' && (
              <button type="button" onClick={() => setShowInstall(true)} style={primaryBtnStyle}>설치 안내</button>
            )}
            {phase === 'compose' && (
              <button type="button" onClick={() => run('edit', prompt)} style={primaryBtnStyle}>편집 실행</button>
            )}
            {(phase === 'preview' || phase === 'error') && (
              <button type="button"
                onClick={mode === 'cutout' ? runCutout : mode === 'outpaint' ? runOutpaint : regenerate}
                style={ghostBtnStyle}>
                {mode === 'cutout' ? '다시 시도' : '재생성'}
              </button>
            )}
            {phase === 'preview' && (
              <button type="button" onClick={mode === 'cutout' ? applyCutout : apply} style={primaryBtnStyle}>적용</button>
            )}
          </div>
        </div>
      )}

      {/* 캔버스 전후 비교 오버레이(미리보기) — 요소 위에 결과를 겹쳐 세로 슬라이더로 비교 */}
      {phase === 'preview' && mode !== 'cutout' && imageUrl && (
        <ImageComparePreview
          element={element} scale={scale} canvasRef={canvasRef}
          resultUrl={imageUrl} objectFit={compareFit}
          split={split} onSplit={setSplit} showOriginal={holding}
        />
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

      {/* 분리 서버 설치 안내(OS 감지, 다운로드/도커) */}
      {showInstall && <CutoutInstallModal onClose={() => setShowInstall(false)} />}
    </>,
    document.body
  )
}

const aiBtnStyle = {
  display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#c7d2fe',
  background: 'rgba(99,102,241,0.18)',
}
const toolBtnStyle = {
  padding: '4px 9px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const toolBtnActive = { background: 'rgba(99,102,241,0.35)', color: '#fff', borderColor: 'transparent' }
const menuStyle = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 10050,
  display: 'flex', flexDirection: 'column', minWidth: 160, maxHeight: 300, overflowY: 'auto', padding: 4,
  background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
}
const menuItemStyle = {
  textAlign: 'left', padding: '7px 10px', fontSize: 12.5, borderRadius: 7, whiteSpace: 'nowrap',
  border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
}
// 투명(전경) 미리보기용 체커 배경
const CHECKER_BG = {
  backgroundImage:
    'linear-gradient(45deg,#94a3b8 25%,transparent 25%),linear-gradient(-45deg,#94a3b8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#94a3b8 75%),linear-gradient(-45deg,transparent 75%,#94a3b8 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
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

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function OutpaintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" fillOpacity="0.3" strokeWidth="1.5" />
      <path d="M3 7h4M3 17h4M17 3v4M17 21v-4M7 3v4M21 7h-4M21 17h-4M7 21v-4" strokeWidth="1.5" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
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
