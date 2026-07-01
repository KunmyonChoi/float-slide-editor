import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BlobStore } from '../core/BlobStore'
import { useElementScreenRect } from './useElementScreenRect'

/**
 * ImageComparePreview — 편집 결과를 선택 이미지 요소 '위'에 겹쳐 캔버스에서 전후 비교.
 *
 * 원본(before)과 결과(after)를 둘 다 같은 objectFit으로 그려, 세로 구분선(split%) 왼쪽=원본,
 * 오른쪽=결과가 보이게 한다(결과를 clip-path로 잘라 그 아래 원본이 드러남). 두 이미지가 같은
 * fit이라 비교가 'AI 변경'만 격리한다(fit 불일치로 인한 가짜 차이 없음). showOriginal(홀드) 시
 * 결과를 숨겨 원본 전체를 보여준다. 적용 전 비파괴(요소 content는 그대로).
 */
export default function ImageComparePreview({ element, scale, canvasRef, resultUrl, objectFit = 'contain', split, onSplit, showOriginal }) {
  const rect = useElementScreenRect(element, scale, canvasRef)
  const boxRef = useRef(null)
  const draggingRef = useRef(false)
  const [beforeUrl, setBeforeUrl] = useState('')

  // 원본(before) 이미지 URL 준비(idb 참조 해석)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try { const u = await BlobStore.contentUrl(element.content); if (alive) setBeforeUrl(u) }
      catch { if (alive) setBeforeUrl('') }
    })()
    return () => { alive = false }
  }, [element.content])

  const setSplitFromEvent = (e) => {
    const b = boxRef.current?.getBoundingClientRect()
    if (!b || b.width <= 0) return
    onSplit?.(Math.max(0, Math.min(100, ((e.clientX - b.left) / b.width) * 100)))
  }
  const onPointerDown = (e) => { e.stopPropagation(); draggingRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setSplitFromEvent(e) }
  const onPointerMove = (e) => { if (draggingRef.current) { e.stopPropagation(); setSplitFromEvent(e) } }
  const endDrag = (e) => { if (draggingRef.current) { e.stopPropagation(); draggingRef.current = false; e.currentTarget?.releasePointerCapture?.(e.pointerId) } }

  if (!rect) return null
  const imgStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit, userSelect: 'none' }
  return createPortal(
    <div
      ref={boxRef}
      data-edit-accessory="true"
      onMouseDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 10043, overflow: 'hidden' }}
    >
      {/* 원본(before) — 전체 바탕 */}
      {beforeUrl && <img src={beforeUrl} alt="" draggable={false} style={imgStyle} />}
      {!showOriginal && (
        <>
          {/* 결과(after) — split 오른쪽만 보이게 잘라 그 아래 원본이 드러남 */}
          <img src={resultUrl} alt="" draggable={false} style={{ ...imgStyle, clipPath: `inset(0 0 0 ${split}%)` }} />
          <div style={{ position: 'absolute', left: `${split}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
          <div
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{
              position: 'absolute', left: `${split}%`, top: '50%', transform: 'translate(-50%,-50%)',
              width: 26, height: 26, borderRadius: 13, background: 'rgba(15,23,42,0.9)', color: '#fff',
              border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', cursor: 'ew-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, touchAction: 'none',
            }}
          >⇔</div>
          <span style={badgeStyle('left')}>전</span>
          <span style={badgeStyle('right')}>후</span>
        </>
      )}
    </div>,
    document.body,
  )
}

function badgeStyle(side) {
  return {
    position: 'absolute', top: 6, [side]: 6, padding: '1px 7px', borderRadius: 6,
    fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(15,23,42,0.7)', pointerEvents: 'none',
  }
}
