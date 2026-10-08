/**
 * 슬라이더·색상 창을 끄는 동안의 변경을 되돌리기 한 번으로 묶는다.
 *
 * 패널의 슬라이더는 값이 바뀔 때마다 저장하는 것(곡선 휘기·유리 효과·그림자 등)과 미리보기 후 놓을 때 저장하는 것
 * (투명도·그림 보정 등)이 섞여 있다. 컨트롤마다 고치는 대신 문서 전체에서 '누름 → 놓음'을 한 동작으로 잡아
 * 저장소(flatStore)에 알린다. 저장소는 그 사이 같은 요소·같은 속성의 기록을 하나로 합친다.
 *
 *  - 슬라이더(input[type=range]): 누를 때 시작, 놓을 때 끝. 방향키로 움직이면 키를 뗄 때 끝.
 *  - 색상 창(input[type=color]): 창 안에서 끄는 동안 input이 이어지고, 창을 닫으면(change) 끝.
 *  - 그 밖에 끌어서 값을 바꾸는 컨트롤은 data-history-gesture 속성을 달면 같은 규칙을 따른다.
 */

const SLIDER = 'input[type="range"], [data-history-gesture]'
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

export function installHistoryGestures(getStore, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || doc.__feHistoryGestures) return () => {}
  doc.__feHistoryGestures = true
  let open = null   // 'pointer' | 'key' | 'color'
  const begin = (kind) => { if (!open) { open = kind; getStore().beginHistoryGesture() } }
  // 놓는 순간의 onMouseUp·change 저장까지 같은 동작에 들어가도록 한 박자 뒤에 끝낸다
  const end = (kind) => { if (open === kind) setTimeout(() => { if (open === kind) { open = null; getStore().endHistoryGesture() } }, 0) }
  const isSlider = (t) => t && t.closest && t.closest(SLIDER)
  const isColor = (t) => t && t.matches && t.matches('input[type="color"]')

  const onDown = (e) => { if (isSlider(e.target)) begin('pointer') }
  const onUp = () => end('pointer')
  const onKeyDown = (e) => { if (KEYS.has(e.key) && isSlider(e.target)) begin('key') }
  const onKeyUp = (e) => { if (KEYS.has(e.key)) end('key') }
  const onInput = (e) => { if (isColor(e.target)) begin('color') }
  const onChange = (e) => { if (isColor(e.target)) end('color') }
  // 포커스가 빠지면 키보드·색상 창 동작만 끝낸다. 누름 동작은 다른 슬라이더를 누르는 순간 앞 슬라이더에서
  // blur가 나므로(새 동작이 막 시작된 뒤) 여기서 끝내면 안 된다 — 놓을 때(pointerup)만 끝난다.
  const onBlur = (e) => {
    if (open === 'color' && isColor(e.target)) end('color')
    else if (open === 'key' && isSlider(e.target)) end('key')
  }

  const opts = { capture: true }
  doc.addEventListener('pointerdown', onDown, opts)
  doc.addEventListener('pointerup', onUp, opts)
  doc.addEventListener('pointercancel', onUp, opts)
  doc.addEventListener('keydown', onKeyDown, opts)
  doc.addEventListener('keyup', onKeyUp, opts)
  doc.addEventListener('input', onInput, opts)
  doc.addEventListener('change', onChange, opts)
  doc.addEventListener('blur', onBlur, opts)
  return () => {
    doc.removeEventListener('pointerdown', onDown, opts)
    doc.removeEventListener('pointerup', onUp, opts)
    doc.removeEventListener('pointercancel', onUp, opts)
    doc.removeEventListener('keydown', onKeyDown, opts)
    doc.removeEventListener('keyup', onKeyUp, opts)
    doc.removeEventListener('input', onInput, opts)
    doc.removeEventListener('change', onChange, opts)
    doc.removeEventListener('blur', onBlur, opts)
    if (open) getStore().endHistoryGesture()
    open = null
    delete doc.__feHistoryGestures
  }
}
