import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { IMAGE_STYLES, INFOGRAPHIC_STYLES } from '../core/aiImageStyles'
import { BlobStore } from '../core/BlobStore'
import { listAudioSources } from '../core/audioSources'
import { startLipsyncJob } from '../core/lipsyncRunner'
import { startVideoMatteJob } from '../core/videoMatteRunner'
import { checkMatteHealth } from '../core/VideoMatteBackendClient'
import { checkCutoutBackend } from '../core/CutoutBackendClient'
import {
  startTextToImageJob, startImageEditJob, startOutpaintJob,
  startCutoutJob, startInfographicJob,
} from '../core/imageJobRunner'
import { openAiSettings } from './AiSettingsModal'
import MatteInstallModal from './MatteInstallModal'
import CutoutInstallModal from './CutoutInstallModal'
import MaskBrushOverlay from './MaskBrushOverlay'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'

/**
 * AiActionBar — 선택된 요소(들) 위에 뜨는 **단일** AI 플로팅바.
 *
 * 이전에는 요소 타입마다 다른 바(텍스트/이미지/영상/다중)가 떠서 버튼 개수·위치가 매번
 * 달라졌다. 여기서는 `✨ AI ▾` 하나로 접고, 선택 상태에 맞는 액션만 메뉴에 노출한다.
 *
 * 모든 장기 작업은 즉시 전역 작업 트레이(aiJobStore/AiJobTray)로 넘어간다 — 바는
 * "무엇을 할지 고르고, 필요하면 입력을 받는" 데까지만 책임지고 바로 idle로 돌아온다.
 * 따라서 생성 중에도 캔버스를 계속 편집할 수 있고, 결과 확인·적용은 트레이가 담당한다.
 */
export default function AiActionBar({ elements, scale, canvasRef }) {
  // 'idle' | 'edit'(설명으로 편집 입력) | 'lipsync'(음성 선택)
  const [phase, setPhase] = useState('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [busy, setBusy] = useState('')          // 서버 확인 등 짧은 선행 작업 표시
  const [error, setError] = useState('')        // 시작 전 오류(생성 중 오류는 트레이가 보여준다)
  const [showCutoutInstall, setShowCutoutInstall] = useState(false)
  const [showMatteInstall, setShowMatteInstall] = useState(false)

  // 설명으로 편집 입력 상태
  const [prompt, setPrompt] = useState('')
  const [maskOn, setMaskOn] = useState(false)
  const [brushTool, setBrushTool] = useState('brush') // 'brush' | 'erase'
  const [brushSize, setBrushSize] = useState(48)
  const [maskCount, setMaskCount] = useState(0)
  const maskRef = useRef(null)

  // 립싱크 음성 선택
  const [pickIdx, setPickIdx] = useState(0)

  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)
  const diagramMode = useFlatStore(s => s.diagramMode)
  const flatElements = useFlatStore(s => s.flatElements)
  const pageNotesAudio = useFlatStore(s => s.pageNotesAudio)

  const single = elements.length === 1 ? elements[0] : null
  const type = single?.type
  const selKey = elements.map(e => e.id).join(',')

  // 선택이 바뀌면 열려 있던 메뉴/입력을 닫는다
  useEffect(() => {
    setPhase('idle'); setMenuOpen(false); setStyleOpen(false); setError('')
    setPrompt(''); setMaskOn(false); setMaskCount(0); setPickIdx(0)
  }, [selKey])

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [])

  // 선택 bbox(캔버스 좌표) → 화면 좌표
  let minX = Infinity, minY = Infinity, maxY = -Infinity
  for (const e of elements) {
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y); maxY = Math.max(maxY, e.y + e.height)
  }
  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + minX * scale,
      top: cr.top + minY * scale,
      bottom: cr.top + maxY * scale,
    } : null
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom) return prev
      return next
    })
  }, [canvasRef, minX, minY, maxY, scale, tick])

  const pageKey = () => useFlatStore.getState().getCurrentPageKey()

  // ── 액션 ────────────────────────────────────────────────────────
  const closeMenus = () => { setMenuOpen(false); setStyleOpen(false); setError('') }

  // 이미지 생성 — 텍스트 단일이면 텍스트 내용 기반, 그 외/다중이면 선택 영역 캡처 기반
  const runImageGen = useCallback((styleId) => {
    closeMenus()
    try {
      const started = (single && type === 'text')
        ? startTextToImageJob({ element: single, styleId, pageKey: pageKey() })
        : startInfographicJob({ mode: 'selection', ids: elements.map(e => e.id), styleId, pageKey: pageKey() })
      if (!started) openAiSettings() // 키가 없으면 러너가 null → 설정 열기
    } catch (e) {
      setError(e?.message || '이미지 생성을 시작하지 못했습니다.')
    }
  }, [single, type, elements])

  // 설명으로 편집 — 입력 후 잡 시작. 마스크 핸들은 오버레이 언마운트 후에도 유효(클로저 보유).
  const runEdit = useCallback(() => {
    const p = prompt.trim()
    if (!p || !single) return
    const handle = (maskOn && maskRef.current?.hasStrokes()) ? maskRef.current : null
    const started = startImageEditJob({
      element: single, prompt: p, pageKey: pageKey(),
      mask: handle ? ((w, h) => handle.buildMask(w, h)) : null,
    })
    if (!started) { openAiSettings(); return }
    setPhase('idle'); setPrompt(''); setMaskOn(false); setMaskCount(0)
  }, [prompt, maskOn, single])

  const runOutpaint = useCallback(() => {
    closeMenus()
    if (!single) return
    if (!startOutpaintJob({ element: single, pageKey: pageKey() })) openAiSettings()
  }, [single])

  // 피사체 뒤에 글자 넣기 — 서버가 없으면 설치 안내부터(잡을 만들지 않음)
  const runCutout = useCallback(async () => {
    closeMenus()
    if (!single || busy) return
    setBusy('cutout')
    try {
      if (!(await checkCutoutBackend(true))) { setShowCutoutInstall(true); return }
      startCutoutJob({ element: single, pageKey: pageKey() })
    } finally { setBusy('') }
  }, [single, busy])

  // 영상 배경 지우기 — 서버가 없으면 설치 안내부터
  const runMatte = useCallback(async () => {
    closeMenus()
    if (!single || busy) return
    setBusy('matte')
    try {
      const h = await checkMatteHealth()
      if (!h.ok) { setShowMatteInstall(true); return }
      startVideoMatteJob({ videoEl: single, pageKey: pageKey() })
    } finally { setBusy('') }
  }, [single, busy])

  const audioSources = useMemo(
    () => (type === 'video' ? listAudioSources(flatElements, pageNotesAudio) : []),
    [type, flatElements, pageNotesAudio],
  )
  const runLipsync = useCallback(() => {
    const src = audioSources[pickIdx]
    if (!src || !single) return
    startLipsyncJob({ videoEl: single, audioSource: src, pageKey: pageKey() })
    setPhase('idle')
  }, [audioSources, pickIdx, single])

  // ── 메뉴 구성 ───────────────────────────────────────────────────
  // 구동 영상 가능 여부 — 임베드(YouTube 등)·외부 URL은 픽셀/업로드 불가
  const videoUsable = useMemo(() => {
    if (type !== 'video') return false
    const c = single.content || ''
    const isEmbed = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i.test(c)
    return !isEmbed && (BlobStore.isIdbRef(c) || c.startsWith('blob:') || c.startsWith('data:'))
  }, [type, single])

  // 여백 채우기는 '맞추기(contain)'일 때만 의미가 있다 — 숨기지 않고 이유를 붙여 비활성화한다.
  const isContainFit = type === 'image' && (single.styles?.objectFit ?? 'contain') === 'contain'

  const canGenerate = (single && type === 'text') || elements.length > 1
  const styleList = (single && type === 'text') ? IMAGE_STYLES : INFOGRAPHIC_STYLES

  const items = []
  if (canGenerate) items.push({ id: 'gen', label: '이미지 생성', styles: true })
  if (type === 'image') {
    items.push({ id: 'edit', label: '설명으로 편집…', onClick: () => { closeMenus(); setPrompt(''); setPhase('edit') } })
    items.push({
      id: 'outpaint', label: '여백까지 그림 채우기', onClick: runOutpaint,
      disabled: !isContainFit, reason: '이미지가 ‘맞추기’ 모드일 때만 — 지금은 채울 여백이 없어요',
    })
    items.push({ id: 'cutout', label: '피사체 뒤에 글자 넣기', onClick: runCutout, note: busy === 'cutout' ? '확인 중…' : '로컬 서버' })
  }
  if (type === 'video') {
    items.push({
      id: 'matte', label: '배경 지우기', onClick: runMatte,
      disabled: !videoUsable, reason: '임베드·외부 URL 영상은 쓸 수 없어요 (로컬·업로드 영상만)',
      note: busy === 'matte' ? '확인 중…' : '로컬 서버',
    })
    items.push({
      id: 'lipsync', label: '립싱크…', onClick: () => { closeMenus(); setPhase('lipsync') },
      disabled: !videoUsable, reason: '임베드·외부 URL 영상은 쓸 수 없어요 (로컬·업로드 영상만)',
    })
  }

  // 드래그 이동 — 그립 핸들로 바를 자유 위치로(선택이 바뀌면 자동 복귀)
  const barRef = useRef(null)
  const { pos: dragPos, startDrag, dragging } = useDraggableToolbar(selKey, barRef)

  if (!rect || items.length === 0) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  const BAR_W = 120
  // 다이어그램 모드에선 연결점(요소 바깥 ~14px + 터치 반지름 ~13px)을 덮지 않게 넉넉히 띄운다.
  const GAP = diagramMode ? 30 : 8
  const placeAbove = elemTop - BAR_H - GAP >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - GAP : elemBottom + GAP
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, elemLeft))
  const barLeft = dragPos ? dragPos.left : anchorLeft
  const barTop = dragPos ? dragPos.top : anchorTop

  const PANEL_W = 360
  const PANEL_H_EST = 300
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, elemLeft))
  const panelTop = Math.max(8, Math.min(
    window.innerHeight - PANEL_H_EST - 8,
    placeAbove ? elemTop - 8 - PANEL_H_EST : elemBottom + 8,
  ))

  return createPortal(
    <>
      {phase === 'idle' && (
        <div
          ref={barRef}
          data-edit-accessory="true"
          // 포털 자식의 React 이벤트는 FlatCanvas(부모)로 버블링되므로 반드시 전파 차단.
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
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => { setMenuOpen(v => !v); setStyleOpen(false) }}
              title="이 선택에 쓸 수 있는 AI 작업"
              style={aiBtnStyle}
            >
              <SparkleIcon />
              <span style={{ fontSize: 12, marginLeft: 5 }}>AI ▾</span>
            </button>
            {menuOpen && (
              <div style={menuStyle}>
                {items.map(it => (
                  it.styles ? (
                    <div key={it.id}>
                      <button type="button" style={menuItemStyle} onClick={() => setStyleOpen(v => !v)}>
                        <span>{it.label}</span>
                        <span style={{ color: '#64748b', fontSize: 11 }}>{styleOpen ? '▾' : '▸'}</span>
                      </button>
                      {styleOpen && styleList.map(s => (
                        <button key={s.id} type="button" style={{ ...menuItemStyle, paddingLeft: 22 }}
                          onClick={() => runImageGen(s.id)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      key={it.id}
                      type="button"
                      disabled={it.disabled}
                      title={it.disabled ? it.reason : undefined}
                      onClick={it.onClick}
                      style={{ ...menuItemStyle, ...(it.disabled ? disabledItemStyle : {}) }}
                    >
                      <span>{it.label}</span>
                      {it.note && <span style={{ color: '#64748b', fontSize: 10.5, marginLeft: 10 }}>{it.note}</span>}
                    </button>
                  )
                ))}
                {items.some(i => i.disabled) && (
                  <div style={{ fontSize: 10.5, color: '#64748b', padding: '4px 10px 2px', lineHeight: 1.5 }}>
                    {items.find(i => i.disabled)?.reason}
                  </div>
                )}
              </div>
            )}
          </span>
          {error && (
            <span style={{ fontSize: 11, color: '#fca5a5', maxWidth: 260, lineHeight: 1.4 }}>{error}</span>
          )}
        </div>
      )}

      {/* 설명으로 편집 — 입력 패널 */}
      {phase === 'edit' && single && (
        <div data-edit-accessory="true" onMouseDown={e => e.stopPropagation()} style={panelStyle(panelLeft, panelTop, PANEL_W)}>
          <div style={panelTitleStyle}><SparkleIcon /> 설명으로 편집</div>
          <div style={hintStyle}>이미지를 어떻게 편집할까요?</div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            autoFocus
            spellCheck={false}
            placeholder="예: 배경을 흰색으로 · 워터마크/잡티 제거 · 색감을 더 밝고 선명하게"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runEdit() } }}
            style={textareaStyle}
          />
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
          <div style={hintStyle}>시작하면 작업 트레이에서 진행되고, 완료 후 트레이에서 적용합니다.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setPhase('idle')} style={ghostBtnStyle}>취소</button>
            <button type="button" onClick={runEdit} disabled={!prompt.trim()}
              style={{ ...primaryBtnStyle, opacity: prompt.trim() ? 1 : 0.5, cursor: prompt.trim() ? 'pointer' : 'default' }}>
              편집 시작
            </button>
          </div>
        </div>
      )}

      {phase === 'edit' && single && maskOn && (
        <MaskBrushOverlay
          ref={maskRef}
          element={single}
          scale={scale}
          canvasRef={canvasRef}
          tool={brushTool}
          brushSize={brushSize}
          objectFit={single.styles?.objectFit || 'contain'}
          onStrokesChange={setMaskCount}
        />
      )}

      {/* 립싱크 — 음성 선택 패널 */}
      {phase === 'lipsync' && single && (
        <div data-edit-accessory="true" onMouseDown={e => e.stopPropagation()} style={panelStyle(panelLeft, panelTop, 320)}>
          <div style={panelTitleStyle}><SparkleIcon /> 립싱크</div>
          <div style={hintStyle}>이 영상의 입을 어떤 음성에 맞출까요?</div>
          {audioSources.length === 0 ? (
            <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>
              사용할 음성이 없습니다 — mp3를 캔버스에 추가하거나, 노트에서 음성을 생성하세요.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {audioSources.map((s, i) => (
                <button key={s.id} type="button" onClick={() => setPickIdx(i)}
                  style={{
                    textAlign: 'left', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer',
                    border: `1px solid ${i === pickIdx ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    background: i === pickIdx ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                    color: i === pickIdx ? '#c7d2fe' : '#cbd5e1',
                  }}>{s.label}</button>
              ))}
            </div>
          )}
          <div style={hintStyle}>생성은 작업 트레이에서 진행됩니다.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setPhase('idle')} style={ghostBtnStyle}>취소</button>
            <button type="button" onClick={runLipsync} disabled={audioSources.length === 0}
              style={{ ...primaryBtnStyle, ...(audioSources.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>생성</button>
          </div>
        </div>
      )}

      {showCutoutInstall && <CutoutInstallModal onClose={() => setShowCutoutInstall(false)} />}
      {showMatteInstall && <MatteInstallModal onClose={() => setShowMatteInstall(false)} />}
    </>,
    document.body,
  )
}

const panelStyle = (left, top, width) => ({
  position: 'fixed', left, top, width, zIndex: 10045,
  background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
  boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 14,
  display: 'flex', flexDirection: 'column', gap: 10,
})
const panelTitleStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }
const hintStyle = { fontSize: 11, color: '#64748b', lineHeight: 1.5 }
const aiBtnStyle = {
  display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#c7d2fe',
  background: 'rgba(99,102,241,0.18)',
}
const ghostBtnStyle = {
  padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtnStyle = {
  padding: '6px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const menuStyle = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 10050,
  display: 'flex', flexDirection: 'column', minWidth: 210, maxHeight: '60vh', overflowY: 'auto', padding: 4,
  background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
}
const menuItemStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12.5, borderRadius: 7,
  border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', whiteSpace: 'nowrap',
}
const disabledItemStyle = { color: '#64748b', cursor: 'not-allowed' }
const textareaStyle = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical',
  padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5,
  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
}
const toolBtnStyle = {
  padding: '4px 9px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const toolBtnActive = { background: 'rgba(99,102,241,0.35)', color: '#fff', borderColor: 'transparent' }

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
    </svg>
  )
}
