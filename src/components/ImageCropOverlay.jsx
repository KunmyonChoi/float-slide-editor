import { useRef, useEffect, useState, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'

/**
 * ImageCropOverlay
 * 이미지 더블클릭 시 크롭 모드 진입.
 * objectPosition을 드래그로 조정하여 이미지를 프레임 내에서 이동시킨다.
 * Escape 또는 외부 클릭으로 종료.
 */
export default function ImageCropOverlay({ element, scale }) {
  const { updateFlatElement, previewFlatElement, setCroppingFlat } = useFlatStore()
  const dragRef = useRef(null)

  // 현재 objectPosition 파싱 (% 기반)
  const parseObjPos = (pos) => {
    if (!pos || pos === 'center center') return { px: 50, py: 50 }
    const parts = pos.trim().split(/\s+/)
    // 0%는 falsy라 `|| 50`이면 0이 50으로 둔갑 → 가장자리(상/좌) 위치가 망가진다.
    const fx = parseFloat(parts[0]), fy = parseFloat(parts[1])
    return {
      px: Number.isFinite(fx) ? fx : 50,
      py: Number.isFinite(fy) ? fy : 50,
    }
  }

  const { px: initPx, py: initPy } = parseObjPos(element.styles.objectPosition)
  const [posX, setPosX] = useState(initPx)
  const [posY, setPosY] = useState(initPy)

  // element 변경 시 동기화
  useEffect(() => {
    const { px, py } = parseObjPos(element.styles.objectPosition)
    setPosX(px)
    setPosY(py)
  }, [element.styles.objectPosition])

  // Escape / 외부 클릭으로 종료
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setCroppingFlat(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setCroppingFlat])

  // 드래그 시작 — 마우스+터치(포인터) 공통. 터치는 setPointerCapture로 프레임 밖 이동도 추적.
  const handleDown = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    const startObjPos = element.styles.objectPosition || 'center center'
    const { px, py } = parseObjPos(startObjPos)
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPx: px,
      startPy: py,
      startObjPos,
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [element])

  // 이동/종료 리스너 — 마우스+포인터(터치/펜) 공통. 마우스 PointerEvent는 mouse* 가 처리(중복 방지).
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e.pointerType === 'mouse') return
      if (d.pointerId != null && e.pointerId !== d.pointerId) return
      const dx = (e.clientX - d.startClientX) / scale
      const dy = (e.clientY - d.startClientY) / scale
      // px 이동을 % 변화로 변환 (요소 크기 대비)
      const dpx = (dx / element.width) * 100
      const dpy = (dy / element.height) * 100
      // object-fit:cover에서 objectPosition%↑ = 보이는 창이 반대편으로 이동(=이미지가 반대로 움직임).
      // "이미지를 잡아서 끈다"(커서와 같은 방향) 느낌을 주려면 부호를 반대로.
      const newPx = Math.max(0, Math.min(100, d.startPx - dpx))
      const newPy = Math.max(0, Math.min(100, d.startPy - dpy))
      setPosX(newPx)
      setPosY(newPy)
      previewFlatElement(element.id, {
        styles: { objectPosition: `${newPx.toFixed(1)}% ${newPy.toFixed(1)}%` }
      })
    }
    const onUp = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e && e.pointerType === 'mouse') return
      if (e && d.pointerId != null && e.pointerId != null && e.pointerId !== d.pointerId) return
      dragRef.current = null
      const current = useFlatStore.getState().flatElements.find(x => x.id === element.id)
      const newObjPos = current?.styles?.objectPosition || 'center center'
      if (newObjPos !== d.startObjPos) {
        // revert preview → commit with history
        previewFlatElement(element.id, { styles: { objectPosition: d.startObjPos } })
        updateFlatElement(element.id, { styles: { objectPosition: newObjPos } })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [element, scale, previewFlatElement, updateFlatElement])

  // 외부 클릭 감지 (오버레이 밖)
  const handleOverlayClick = useCallback((e) => {
    // 이미지 영역 밖 클릭 시 크롭 종료
    setCroppingFlat(null)
  }, [setCroppingFlat])

  const rot = element.rotation || 0

  return (
    <div data-export-ignore="true" style={{ position: 'absolute', inset: 0, zIndex: 9990, pointerEvents: 'none' }}>
      {/* 반투명 오버레이 (캔버스 전체) — 클릭하면 크롭 종료 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9990,
          cursor: 'default',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
        onMouseDown={handleOverlayClick}
        onPointerDown={(e) => { if (e.pointerType === 'touch') handleOverlayClick(e) }}
      />
      {/* 이미지 프레임 (밝게) — 드래그로 이미지 위치 조정 */}
      <div
        style={{
          position: 'absolute',
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          zIndex: 9991,
          cursor: 'move',
          // 컨테이너의 pointerEvents:'none' 상속 차단 — 안 주면 드래그가 프레임을 통과해
          // 뒤의 백드롭(크롭 종료)으로 가서 드래그 대신 모드가 닫힌다.
          pointerEvents: 'auto',
          // 터치로 이미지를 끌어 위치 조정 — 브라우저 기본 제스처(스크롤 등) 차단
          touchAction: 'none',
          overflow: 'hidden',
          transform: rot ? `rotate(${rot}deg)` : undefined,
          transformOrigin: rot ? 'center center' : undefined,
          outline: '2px dashed rgba(99, 102, 241, 0.9)',
          outlineOffset: -1,
          borderRadius: element.styles.borderRadius,
        }}
        onMouseDown={handleDown}
        onPointerDown={(e) => { if (e.pointerType === 'touch') handleDown(e) }}
      >
        <img
          src={element.content}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: element.styles.objectFit || 'contain',
            objectPosition: `${posX.toFixed(1)}% ${posY.toFixed(1)}%`,
            display: 'block',
            pointerEvents: 'none',
          }}
        />
        {/* 십자선 가이드 */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute', left: '33.33%', top: 0, bottom: 0,
            width: 1, background: 'rgba(255, 255, 255, 0.3)',
          }} />
          <div style={{
            position: 'absolute', left: '66.66%', top: 0, bottom: 0,
            width: 1, background: 'rgba(255, 255, 255, 0.3)',
          }} />
          <div style={{
            position: 'absolute', top: '33.33%', left: 0, right: 0,
            height: 1, background: 'rgba(255, 255, 255, 0.3)',
          }} />
          <div style={{
            position: 'absolute', top: '66.66%', left: 0, right: 0,
            height: 1, background: 'rgba(255, 255, 255, 0.3)',
          }} />
        </div>
        {/* 위치 정보 표시 */}
        <div style={{
          position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.7)', color: '#fff', fontSize: 10,
          padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {Math.round(posX)}%, {Math.round(posY)}%
        </div>
      </div>
    </div>
  )
}
