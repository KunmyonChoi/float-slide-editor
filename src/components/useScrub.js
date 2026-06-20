import { useRef } from 'react'

const clamp = (v, min, max) => {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}

// step 단위에 맞춰 부동소수 누적 오차 정리 (예: 0.1 단위 스냅)
const snap = (v, step) => {
  if (!step) return v
  const inv = 1 / step
  return Math.round(v * inv) / inv
}

/**
 * 숫자 스크럽(드래그) 훅 — 마우스 / 터치 / 펜 공용(Pointer Events).
 *
 * 반환된 핸들러를 "드래그 핸들"(주로 라벨)에 펼쳐 붙인다.
 * 입력 박스 자체는 그대로 두어 탭/클릭 = 키보드 입력으로 유지(탭·드래그 분리).
 *
 * 실수 방지 장치:
 *  - 데드존 3px: 그 이상 움직여야 스크럽 시작(탭 시 값 안 바뀜)
 *  - setPointerCapture + touchAction:none: 손가락이 벗어나거나 페이지가 스크롤되지 않음
 *  - ESC: 시작값으로 복원 후 취소
 *  - min/max 클램프, step 스냅
 *  - 드래그 1회 = 히스토리 1건(드래그 중 onPreview, 손 뗌 onCommit)
 *
 * 가속:
 *  - Shift: ×10 (거칠게)  /  Alt: ×0.1 (미세하게)
 *
 * @param {number}   value        현재 값
 * @param {number}   step         기본 증감 단위(기본 1)
 * @param {number}   [min]
 * @param {number}   [max]
 * @param {number}   [sensitivity] 1 step 당 픽셀 수(기본 1 = 1px당 1step)
 * @param {(v:number)=>void} onPreview 드래그 중(히스토리 없이) 미리보기
 * @param {(v:number)=>void} onCommit  손 뗌(히스토리 기록)
 */
export function useScrub({ value, step = 1, min, max, sensitivity = 1, onPreview, onCommit }) {
  const drag = useRef(null)

  const finish = (cancelled) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    window.removeEventListener('keydown', onKey)
    if (cancelled) { onPreview && onPreview(d.startVal) }
    else if (d.moved) { onCommit(d.last) }
  }

  const onKey = (e) => {
    if (e.key === 'Escape' && drag.current) { e.preventDefault(); finish(true) }
  }

  const onPointerDown = (e) => {
    if (e.button != null && e.button > 0) return // 좌클릭 / 터치 / 펜만
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const start = Number(value) || 0
    drag.current = { id: e.pointerId, startX: e.clientX, startVal: start, last: start, moved: false }
    window.addEventListener('keydown', onKey)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.startX
    // 데드존 — 터치는 손가락 떨림이 커서 더 크게(탭이 값 변경으로 오인되지 않게)
    const dead = e.pointerType === 'touch' ? 8 : 3
    if (!d.moved && Math.abs(dx) < dead) return
    d.moved = true
    const mult = e.shiftKey ? step * 10 : e.altKey ? step * 0.1 : step
    let next = d.startVal + Math.round(dx / sensitivity) * mult
    next = snap(clamp(next, min, max), mult)
    if (next !== d.last) { d.last = next; onPreview && onPreview(next) }
  }

  const onPointerUp = (e) => {
    if (drag.current && e.pointerId === drag.current.id) finish(false)
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' },
  }
}
