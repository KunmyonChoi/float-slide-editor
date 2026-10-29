import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * AnchoredMenu — 트리거(anchorRef) 아래에 뜨는 드롭다운을 document.body로 portal하고
 * 뷰포트 안으로 가로 클램프한다. 좁은 화면/툴바 줄바꿈 시 메뉴가 화면 밖으로 잘리는 문제 해결.
 *
 * - position: fixed (조상 overflow:hidden / backdrop-filter 영향 안 받음)
 * - 가로: 트리거 중심 정렬 후 좌우 여백(margin) 안으로 클램프
 * - 세로: 트리거 아래(gap). 아래 공간이 부족하면 위로 띄움. 위아래 어느 쪽에도 다 안 들어가면(휴대폰에서
 *   긴 목록) 넓은 쪽에 두고 그 공간만큼으로 높이를 제한해 메뉴 안에서 스크롤한다 — 화면 밖으로 잘리지 않게.
 *   들어갈 때는 스크롤 컨테이너로 만들지 않는다(자식의 그림자가 잘리지 않도록).
 * - 쓸 수 있는 높이는 CSS 변수 --anchored-max-h로 내려 준다. 자체 스크롤 목록을 가진 메뉴는
 *   max-height: min(…, var(--anchored-max-h))로 맞추면 스크롤이 이중으로 생기지 않는다.
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
      const h = el?.scrollHeight || 0 // 높이를 제한해도 내용 전체 높이
      const vw = window.innerWidth, vh = window.innerHeight
      let left = a.left + a.width / 2 - w / 2
      left = Math.max(margin, Math.min(left, vw - w - margin))
      const below = vh - margin - (a.bottom + gap)
      const above = a.top - gap - margin
      let top, maxHeight
      if (!h || h <= below) { top = a.bottom + gap; maxHeight = below }
      else if (h <= above) { top = a.top - gap - h; maxHeight = above }
      else if (below >= above) { top = a.bottom + gap; maxHeight = below }
      else { top = margin; maxHeight = above }
      maxHeight = Math.max(0, Math.floor(maxHeight))
      setPos({ left, top, maxHeight, scroll: h > maxHeight })
    }
    // 메뉴 안의 스크롤은 메뉴 자리를 바꾸지 않는다 — 다시 재지 않는다
    const onScroll = (e) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) place() }
    place()
    const raf = requestAnimationFrame(place) // 메뉴 폭/높이 측정 후 재배치(2-pass)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
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
        '--anchored-max-h': pos ? `${pos.maxHeight}px` : undefined,
        ...(pos?.scroll ? { maxHeight: pos.maxHeight, overflowY: 'auto', overscrollBehavior: 'contain' } : {}),
      }}
    >
      {children}
    </div>,
    document.body
  )
}
