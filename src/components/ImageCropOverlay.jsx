import { useRef, useEffect, useState, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from '../core/BlobStore'

/**
 * ImageCropOverlay — 채우기(cover) 크롭 미세 조정.
 * 바운딩 박스는 고정한 채 컨텐츠를 확대/축소(zoom)하면 상하좌우가 잘리고, 드래그로 어느 부분이
 * 박스 안에 보일지 정한다. 이미지·동영상 공통. Escape/외부 클릭으로 종료.
 *
 * 저장 모델: element.crop = { zoom(≥1), x, y(px, 박스-로컬 오프셋) }. 렌더러(cropCss)가 동일하게
 * transform: translate(x,y) scale(zoom)로 적용 → 편집·발표 모드 일치. zoom=1·오프셋0이면 무변환.
 * (zoom=1일 때 드래그는 기존처럼 objectPosition으로 종횡비 프레이밍.)
 */
const ZOOM_MIN = 1, ZOOM_MAX = 5

export default function ImageCropOverlay({ element, scale }) {
  const { updateFlatElement, previewFlatElement, setCroppingFlat } = useFlatStore()
  const dragRef = useRef(null)
  const commitTimer = useRef(null)

  const parseObjPos = (pos) => {
    if (!pos || pos === 'center center') return { px: 50, py: 50 }
    const parts = pos.trim().split(/\s+/)
    const fx = parseFloat(parts[0]), fy = parseFloat(parts[1])
    return { px: Number.isFinite(fx) ? fx : 50, py: Number.isFinite(fy) ? fy : 50 }
  }

  const c0 = element.crop || {}
  const [zoom, setZoom] = useState(c0.zoom || 1)
  const [ox, setOx] = useState(c0.x || 0)
  const [oy, setOy] = useState(c0.y || 0)
  const { px: initPx, py: initPy } = parseObjPos(element.styles.objectPosition)
  const [posX, setPosX] = useState(initPx)
  const [posY, setPosY] = useState(initPy)

  // element 외부 변경 동기화
  useEffect(() => {
    const c = element.crop || {}
    setZoom(c.zoom || 1); setOx(c.x || 0); setOy(c.y || 0)
    const { px, py } = parseObjPos(element.styles.objectPosition)
    setPosX(px); setPosY(py)
  }, [element.crop, element.styles.objectPosition])

  // 미디어 URL 해석(idb 참조 → blob URL)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    const ref = element.content
    if (BlobStore.isIdbRef(ref)) BlobStore.getUrl(BlobStore.parseRef(ref)).then(u => { if (!cancelled) setUrl(u) })
    else setUrl(ref)
    return () => { cancelled = true }
  }, [element.content])

  // 오프셋 클램프 — 확대 배율에 따른 오버플로 범위(±(z-1)/2·박스크기) 안으로. 잘림 없이 항상 박스를 덮음.
  const maxOff = (z) => ({ x: (z - 1) / 2 * element.width, y: (z - 1) / 2 * element.height })
  const clampOff = (x, y, z) => { const m = maxOff(z); return { x: Math.max(-m.x, Math.min(m.x, x)), y: Math.max(-m.y, Math.min(m.y, y)) } }

  const previewCrop = (z, x, y) => {
    const cl = clampOff(x, y, z)
    setZoom(z); setOx(cl.x); setOy(cl.y)
    previewFlatElement(element.id, { crop: { zoom: z, x: cl.x, y: cl.y } })
    return cl
  }
  const commitCrop = (z, x, y) => {
    const cl = clampOff(x, y, z)
    updateFlatElement(element.id, { crop: { zoom: z, x: cl.x, y: cl.y } })
  }
  // 휠/버튼 줌은 프리뷰로 반영하고, 잠시 멈추면 커밋(히스토리 항목 폭주 방지).
  const scheduleCommit = (z, x, y) => {
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => commitCrop(z, x, y), 250)
  }
  useEffect(() => () => clearTimeout(commitTimer.current), [])

  const applyZoom = useCallback((z) => {
    const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
    const cl = previewCrop(nz, ox, oy)
    scheduleCommit(nz, cl.x, cl.y)
  }, [ox, oy]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape 종료
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCroppingFlat(null) }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setCroppingFlat])

  // 휠 줌
  const onWheel = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
  }, [zoom, applyZoom])

  // 드래그 시작 — zoom>1이면 오프셋(x,y) 팬, zoom=1이면 objectPosition(종횡비) 팬.
  const handleDown = useCallback((e) => {
    e.stopPropagation(); e.preventDefault()
    dragRef.current = {
      startClientX: e.clientX, startClientY: e.clientY,
      startOx: ox, startOy: oy, startPx: posX, startPy: posY,
      panMode: zoom > 1,
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [ox, oy, posX, posY, zoom])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e.pointerType === 'mouse') return
      if (d.pointerId != null && e.pointerId !== d.pointerId) return
      const dx = (e.clientX - d.startClientX) / scale
      const dy = (e.clientY - d.startClientY) / scale
      if (d.panMode) {
        const cl = previewCrop(zoom, d.startOx + dx, d.startOy + dy)
        d.lastX = cl.x; d.lastY = cl.y
      } else {
        const dpx = (dx / element.width) * 100
        const dpy = (dy / element.height) * 100
        // 이미지를 잡아 끄는 방향감 → objectPosition은 반대 부호.
        const newPx = Math.max(0, Math.min(100, d.startPx - dpx))
        const newPy = Math.max(0, Math.min(100, d.startPy - dpy))
        setPosX(newPx); setPosY(newPy)
        previewFlatElement(element.id, { styles: { objectPosition: `${newPx.toFixed(1)}% ${newPy.toFixed(1)}%` } })
      }
    }
    const onUp = (e) => {
      const d = dragRef.current
      if (!d) return
      if (e && e.pointerType === 'mouse') return
      if (e && d.pointerId != null && e.pointerId != null && e.pointerId !== d.pointerId) return
      dragRef.current = null
      if (d.panMode) {
        commitCrop(zoom, d.lastX ?? d.startOx, d.lastY ?? d.startOy)
      } else {
        const cur = useFlatStore.getState().flatElements.find(x => x.id === element.id)
        const newObjPos = cur?.styles?.objectPosition || 'center center'
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
  }, [element, scale, zoom, previewFlatElement, updateFlatElement]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverlayClick = useCallback(() => { setCroppingFlat(null) }, [setCroppingFlat])

  const rot = element.rotation || 0
  const atDefault = zoom === 1 && !ox && !oy   // 크롭 기본 상태(초기화 버튼 비활성 판정)
  const objPos = `${posX.toFixed(1)}% ${posY.toFixed(1)}%`
  const mediaTransform = `translate(${ox}px, ${oy}px) scale(${zoom})`
  const mediaStyle = {
    width: '100%', height: '100%', objectFit: element.styles.objectFit || 'contain',
    objectPosition: objPos, transform: mediaTransform, transformOrigin: 'center center',
    display: 'block', pointerEvents: 'none',
  }

  return (
    <div data-export-ignore="true" style={{ position: 'absolute', inset: 0, zIndex: 9990, pointerEvents: 'none' }}>
      {/* 반투명 백드롭 — 클릭 시 종료 */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9990, pointerEvents: 'auto', touchAction: 'none' }}
        onMouseDown={handleOverlayClick}
        onPointerDown={(e) => { if (e.pointerType === 'touch') handleOverlayClick(e) }}
      />
      {/* 크롭 프레임 — 드래그로 이동, 휠로 확대/축소 */}
      <div
        style={{
          position: 'absolute', left: element.x, top: element.y, width: element.width, height: element.height,
          zIndex: 9991, cursor: 'move', pointerEvents: 'auto', touchAction: 'none', overflow: 'hidden',
          transform: rot ? `rotate(${rot}deg)` : undefined, transformOrigin: rot ? 'center center' : undefined,
          outline: '2px dashed rgba(99,102,241,0.9)', outlineOffset: -1, borderRadius: element.styles.borderRadius,
        }}
        onMouseDown={handleDown}
        onPointerDown={(e) => { if (e.pointerType === 'touch') handleDown(e) }}
        onWheel={onWheel}
      >
        {url && (element.type === 'video'
          ? <video src={url} muted autoPlay loop playsInline style={mediaStyle} />
          : <img src={url} alt="" draggable={false} style={mediaStyle} />)}
        {/* 삼분할 가이드 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.3)' }} />
          <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.3)' }} />
        </div>
      </div>
      {/* 줌 컨트롤 (프레임 하단 중앙) — 터치에서도 확대/축소 가능 */}
      <div
        style={{
          position: 'absolute', left: element.x + element.width / 2, top: element.y + element.height + 10 / scale,
          transform: 'translateX(-50%)', zIndex: 9992, pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 8 / scale, padding: `${6 / scale}px ${10 / scale}px`,
          borderRadius: 10 / scale, background: 'rgba(15,23,42,0.92)', border: `${1 / scale}px solid rgba(255,255,255,0.15)`,
          fontSize: 13 / scale, color: '#e2e8f0', whiteSpace: 'nowrap', fontFamily: 'system-ui, sans-serif',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => applyZoom(zoom / 1.15)} style={zoomBtn(scale)}>−</button>
        <span style={{ minWidth: 44 / scale, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => applyZoom(zoom * 1.15)} style={zoomBtn(scale)}>＋</button>
        {/* 초기화는 항상 자리 유지(기본 상태면 비활성). 조건부 렌더 시 폭이 변해 −/＋가 밀려 오클릭 발생. */}
        <button type="button"
          disabled={atDefault}
          onClick={atDefault ? undefined : () => { setPosX(50); setPosY(50); previewFlatElement(element.id, { styles: { objectPosition: '50% 50%' } }); updateFlatElement(element.id, { crop: { zoom: 1, x: 0, y: 0 }, styles: { objectPosition: '50% 50%' } }); setZoom(1); setOx(0); setOy(0) }}
          style={{ ...zoomBtn(scale), width: 'auto', padding: `0 ${8 / scale}px`, color: atDefault ? '#64748b' : '#fca5a5', opacity: atDefault ? 0.4 : 1, cursor: atDefault ? 'default' : 'pointer' }}>초기화</button>
      </div>
    </div>
  )
}

function zoomBtn(scale) {
  const s = scale || 1
  return {
    width: 26 / s, height: 26 / s, borderRadius: 7 / s, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.08)', border: `${1 / s}px solid rgba(255,255,255,0.15)`,
    color: '#e2e8f0', fontSize: 16 / s, lineHeight: 1, padding: 0,
  }
}
