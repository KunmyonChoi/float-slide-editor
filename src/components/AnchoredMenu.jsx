import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * AnchoredMenu — 트리거(anchorRef) 아래에 뜨는 드롭다운을 document.body로 portal하고
 * 뷰포트 안으로 가로 클램프한다. 좁은 화면/툴바 줄바꿈 시 메뉴가 화면 밖으로 잘리는 문제 해결.
 *
 * - position: fixed (조상 overflow:hidden / backdrop-filter 영향 안 받음)
 * - 가로: 트리거 중심 정렬 후 좌우 여백(margin) 안으로 클램프
 * - 세로: 트리거 아래(gap). 아래 공간이 부족하면 위로 띄움.
 * - 메뉴 위에서의 mousedown은 전파 차단 → 각 컴포넌트의 '바깥 클릭 닫기'가 오작동하지 않음.
 *
 * @param {{ anchorRef: React.RefObject, open: boolean, children: React.ReactNode,
 *           gap?: number, margin?: number, z?: number }} props
 */
export default function AnchoredMenu({ anchorRef, open, children, gap = 6, margin = 8, z = 200 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      if (!a) return
      const el = ref.current
      const w = el?.offsetWidth || 0
      const h = el?.offsetHeight || 0
      const vw = window.innerWidth, vh = window.innerHeight
      let left = a.left + a.width / 2 - w / 2
      left = Math.max(margin, Math.min(left, vw - w - margin))
      let top = a.bottom + gap
      if (h && top + h > vh - margin) {
        const above = a.top - gap - h
        top = above >= margin ? above : Math.max(margin, vh - h - margin)
      }
      setPos({ left, top })
    }
    place()
    const raf = requestAnimationFrame(place) // 메뉴 폭/높이 측정 후 재배치(2-pass)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, gap, margin])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        zIndex: z,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  )
}
