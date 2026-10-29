import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import AnchoredMenu from '../components/AnchoredMenu'

// 트리거 위치·화면 높이·메뉴 내용 높이를 정해 두고 메뉴 자리를 본다
function place({ anchor, vh = 600, contentH }) {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return contentH } })
  const ih = window.innerHeight
  window.innerHeight = vh
  const ref = createRef()
  ref.current = { getBoundingClientRect: () => ({ left: 100, width: 80, ...anchor }) }
  const { baseElement, unmount } = render(<AnchoredMenu anchorRef={ref} open><div>menu</div></AnchoredMenu>)
  const box = [...baseElement.querySelectorAll('div')].find(d => d.style.position === 'fixed')
  const out = { top: parseFloat(box.style.top), maxHeight: parseFloat(box.style.maxHeight), overflowY: box.style.overflowY, varMax: box.style.getPropertyValue('--anchored-max-h') }
  unmount()
  window.innerHeight = ih
  if (desc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', desc)
  else delete HTMLElement.prototype.scrollHeight
  return out
}

describe('AnchoredMenu 세로 배치 — 화면 밖으로 잘리지 않게', () => {
  it('아래에 다 들어가면 트리거 아래, 스크롤 컨테이너로 만들지 않는다(그림자 보존)', () => {
    const r = place({ anchor: { top: 70, bottom: 100 }, contentH: 200 })
    expect(r.top).toBe(106)
    expect(r.overflowY).toBe('')
    expect(r.maxHeight).toBeNaN()
    expect(r.varMax).toBe('486px') // 자체 스크롤 목록이 맞출 수 있게 쓸 수 있는 높이는 알려 준다
  })

  it('아래가 모자라고 위에 들어가면 트리거 위', () => {
    expect(place({ anchor: { top: 500, bottom: 530 }, contentH: 300 }).top).toBe(500 - 6 - 300)
  })

  it('어느 쪽에도 다 안 들어가면(휴대폰의 긴 목록) 넓은 쪽에 두고 높이를 제한해 스크롤', () => {
    const r = place({ anchor: { top: 70, bottom: 100 }, contentH: 900 })
    expect(r.top).toBe(106)
    expect(r.maxHeight).toBe(600 - 8 - 106)   // 화면 아래 여백까지
    expect(r.overflowY).toBe('auto')
    const up = place({ anchor: { top: 500, bottom: 530 }, contentH: 900 })
    expect(up.top).toBe(8)
    expect(up.maxHeight).toBe(500 - 6 - 8)     // 트리거 바로 위까지
  })
})
