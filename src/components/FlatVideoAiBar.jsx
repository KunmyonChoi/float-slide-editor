import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from '../core/BlobStore'
import { listAudioSources } from '../core/audioSources'
import { startLipsyncJob } from '../core/lipsyncRunner'
import { startVideoMatteJob } from '../core/videoMatteRunner'
import { checkMatteHealth } from '../core/VideoMatteBackendClient'
import MatteInstallModal from './MatteInstallModal'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'

/**
 * FlatVideoAiBar — 비디오 요소 단일 선택 시 뜨는 전용 AI 플로팅바.
 * (텍스트=FlatAiBar, 이미지=FlatImageAiBar와 동일한 진입 문법으로 일관성 유지.)
 *
 * 액션 "AI 립싱크 영상 생성": 구동 영상(이 비디오) + 오디오 소스(캔버스 mp3/노트 음성)를
 * 골라 전역 작업(aiJobStore)으로 시작. 진행/결과는 작업 트레이(AiJobTray)가 담당하므로
 * 이 바는 idle→compose(오디오 선택)→생성까지만 책임진다.
 */
export default function FlatVideoAiBar({ element, scale, canvasRef }) {
  const [phase, setPhase] = useState('idle') // 'idle' | 'compose'
  const [pickIdx, setPickIdx] = useState(0)
  const [showInstall, setShowInstall] = useState(false)
  const [matteBusy, setMatteBusy] = useState(false)
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)
  const barRef = useRef(null)
  const { pos: dragPos, startDrag, dragging } = useDraggableToolbar(element.id, barRef)

  const flatElements = useFlatStore(s => s.flatElements)
  const pageNotesAudio = useFlatStore(s => s.pageNotesAudio)
  // 다이어그램 모드면 연결점(도트)을 가리지 않도록 플로팅바를 더 멀리 띄운다(아래 GAP).
  const diagramMode = useFlatStore(s => s.diagramMode)
  const audioSources = listAudioSources(flatElements, pageNotesAudio)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => { window.removeEventListener('scroll', rerender, true); window.removeEventListener('resize', rerender) }
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

  // 선택 바뀌면 compose 닫기
  useEffect(() => { setPhase('idle'); setPickIdx(0) }, [element.id])

  // 구동 영상 가능 여부 — 임베드(YouTube 등)·외부 URL은 픽셀/업로드 불가
  const content = element.content || ''
  const isEmbed = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i.test(content)
  const isLocal = BlobStore.isIdbRef(content) || content.startsWith('blob:') || content.startsWith('data:')
  const usable = !isEmbed && isLocal

  const generate = useCallback(() => {
    const src = audioSources[pickIdx]
    if (!src) return
    startLipsyncJob({ videoEl: element, audioSource: src, pageKey: useFlatStore.getState().getCurrentPageKey() })
    setPhase('idle') // 진행은 트레이에서
  }, [audioSources, pickIdx, element])

  // 전경 분리(고품질, B2) — 서버 헬스체크 후 잡 시작(없으면 설치 안내)
  const runMatte = useCallback(async () => {
    if (!usable || matteBusy) return
    setMatteBusy(true)
    try {
      const h = await checkMatteHealth()
      if (!h.ok) { setShowInstall(true); return }
      startVideoMatteJob({ videoEl: element, pageKey: useFlatStore.getState().getCurrentPageKey() })
    } finally {
      setMatteBusy(false)
    }
  }, [usable, matteBusy, element])

  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect
  const BAR_H = 36
  // 다이어그램 모드에선 연결점(요소 바깥 ~14px + 터치 반지름 ~13px)을 덮지 않도록 넉넉히 띄운다.
  const GAP = diagramMode ? 30 : 8
  const placeAbove = elemTop - BAR_H - GAP >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - GAP : elemBottom + GAP
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - 360, elemLeft))
  const barLeft = dragPos ? dragPos.left : anchorLeft
  const barTop = dragPos ? dragPos.top : anchorTop

  const PANEL_W = 320
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, elemLeft))
  const panelTop = Math.max(8, Math.min(window.innerHeight - 320, placeAbove ? elemTop - 8 - 280 : elemBottom + 8))

  return createPortal(
    <>
      {phase === 'idle' && (
        <div
          ref={barRef}
          data-edit-accessory="true"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: barLeft, top: barTop, zIndex: 10040,
            display: 'flex', alignItems: 'center', gap: 6, height: BAR_H, padding: '0 8px', borderRadius: 10,
            background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <GripHandle onPointerDown={startDrag} dragging={dragging} />
          <button
            type="button"
            onClick={() => usable && setPhase('compose')}
            disabled={!usable}
            title={usable ? '구동 영상 + 음성으로 AI 립싱크 영상을 생성합니다'
              : '임베드/외부 URL 영상은 립싱크에 쓸 수 없습니다 (로컬·업로드 영상만)'}
            style={{
              display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8, border: 'none',
              cursor: usable ? 'pointer' : 'not-allowed', color: usable ? '#c7d2fe' : '#64748b',
              background: usable ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
            }}
          >
            <span style={{ fontSize: 14 }}>🎬</span>
            <span style={{ fontSize: 12, marginLeft: 5 }}>AI 립싱크</span>
          </button>
          <button
            type="button"
            onClick={runMatte}
            disabled={!usable || matteBusy}
            title={usable ? '영상에서 사람만 남긴 투명 배경 영상(고품질) — 로컬 서버 필요'
              : '임베드/외부 URL 영상은 쓸 수 없습니다 (로컬·업로드 영상만)'}
            style={{
              display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8, border: 'none',
              cursor: (usable && !matteBusy) ? 'pointer' : 'not-allowed', color: usable ? '#c7d2fe' : '#64748b',
              background: usable ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)', opacity: matteBusy ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 14 }}>✂️</span>
            <span style={{ fontSize: 12, marginLeft: 5 }}>{matteBusy ? '확인 중…' : '전경 분리'}</span>
          </button>
        </div>
      )}

      {showInstall && <MatteInstallModal onClose={() => setShowInstall(false)} />}

      {phase === 'compose' && (
        <div
          data-edit-accessory="true"
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: panelLeft, top: panelTop, width: PANEL_W, zIndex: 10045,
            background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            🎬 AI 립싱크 영상
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>이 영상의 입을 어떤 음성에 맞출까요?</div>

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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setPhase('idle')} style={ghostBtn}>취소</button>
            <button type="button" onClick={generate} disabled={audioSources.length === 0}
              style={{ ...primaryBtn, ...(audioSources.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>생성</button>
          </div>
          <div style={{ fontSize: 10.5, color: '#64748b' }}>생성은 백그라운드로 진행되며, 진행/결과는 우측 하단 작업 트레이에서 확인합니다.</div>
        </div>
      )}
    </>,
    document.body
  )
}

const ghostBtn = {
  padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtn = {
  padding: '6px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
