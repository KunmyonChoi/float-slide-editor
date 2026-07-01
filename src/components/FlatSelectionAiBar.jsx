import { useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { openInfographic } from './InfographicModal'
import { openImagenLayout } from './ImagenLayoutModal'
import { useFlatStore } from '../store/flatStore'

const IMG_BACKEND_KEY = 'ai-image-backend' // AI 설정(이미지 엔진)과 공유
const readImgBackend = () => { try { return localStorage.getItem(IMG_BACKEND_KEY) || 'openai' } catch { return 'openai' } }

/**
 * FlatSelectionAiBar — 여러 요소를 (마퀴 등으로) 다중 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 액션 "AI 인포그래픽": 선택 요소들의 bbox 영역을 캡처/분석해 인포그래픽 이미지를 만들고,
 * bbox 크기·위치의 이미지 요소로 삽입(또는 원본 교체)한다 — InfographicModal(selection 모드).
 * 액션 "레이아웃 이미지"(선택이 전부 텍스트 + 이미지 엔진이 로컬 ideogram일 때만): 텍스트 박스들의
 * 위치·내용을 bbox JSON 캡션으로 만들어 Ideogram 4로 정밀 레이아웃 이미지를 생성 — ImagenLayoutModal.
 *
 * 캔버스 줌과 무관하게 읽기 좋도록 document.body 포털 + 화면 좌표로 배치.
 */
export default function FlatSelectionAiBar({ elements, scale, canvasRef }) {
  const allText = elements.length > 0 && elements.every(e => e.type === 'text')
  // 이미지 엔진 설정을 반영해 레이아웃 이미지 버튼 노출 결정(설정 변경 즉시 반영).
  const [imgBackend, setImgBackend] = useState(readImgBackend)
  useEffect(() => {
    const sync = () => setImgBackend(readImgBackend())
    window.addEventListener('storage', sync)               // 다른 탭에서 변경
    window.addEventListener('ai-image-backend-change', sync) // 같은 탭(AI 설정 저장)
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('ai-image-backend-change', sync) }
  }, [])
  // 레이아웃 이미지(Ideogram)는 로컬 ideogram 엔진을 쓸 때만 노출
  const showLayout = allText && imgBackend === 'local'
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

  // 선택 요소들의 bbox(캔버스 좌표) → 화면 좌표로 변환
  let minX = Infinity, minY = Infinity, maxX = -Infinity
  for (const e of elements) {
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y); maxX = Math.max(maxX, e.x + e.width)
  }

  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + minX * scale,
      right: cr.left + maxX * scale,
      top: cr.top + minY * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.right === next.right && prev.top === next.top) return prev
      return next
    })
  }, [canvasRef, minX, minY, maxX, scale, tick])

  if (!rect) return null
  const BAR_H = 34
  const placeAbove = rect.top - BAR_H - 8 >= 8
  const top = placeAbove ? rect.top - BAR_H - 8 : rect.top + 8
  // bbox 가로 중앙 정렬(화면 안쪽으로 클램프). 버튼 수에 따라 폭 추정.
  const barW = showLayout ? 320 : 160
  const center = (rect.left + rect.right) / 2
  const left = Math.max(8, Math.min(window.innerWidth - barW - 8, center - barW / 2))

  return createPortal(
    <div
      data-edit-accessory="true"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: 10040,
        display: 'flex', alignItems: 'center', height: BAR_H, padding: '0 8px', borderRadius: 10,
        background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => openInfographic({ mode: 'selection', ids: elements.map(e => e.id) })}
        title="선택 영역을 분석해 인포그래픽 이미지로 만들어 삽입/교체합니다"
        style={btnStyle}
      >
        <SparkleIcon />
        <span style={{ fontSize: 12, marginLeft: 5 }}>AI 인포그래픽</span>
      </button>
      {showLayout && (
        <button
          type="button"
          onClick={() => {
            const st = useFlatStore.getState()
            openImagenLayout({ els: elements, canvasSize: st.canvasSize, pageKey: st.getCurrentPageKey() })
          }}
          title="선택한 텍스트 박스들의 위치·내용으로 정밀한 레이아웃 이미지를 생성합니다 (Ideogram 4)"
          style={btnStyle}
        >
          <span style={{ fontSize: 13 }}>🖼️</span>
          <span style={{ fontSize: 12, marginLeft: 5 }}>레이아웃 이미지</span>
        </button>
      )}
    </div>,
    document.body
  )
}

const btnStyle = {
  display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#c7d2fe', background: 'rgba(99,102,241,0.18)',
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
    </svg>
  )
}
