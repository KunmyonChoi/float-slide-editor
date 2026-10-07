import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import PresentedSlide from '../components/PresentedSlide'
import { useFlatStore } from '../store/flatStore'
import { computeSteps, makeLoopAnim } from '../core/slideAnimation'

const shape = (id, extra = {}) => ({
  id, type: 'shape', x: 10, y: 20, width: 100, height: 50, zIndex: 1, content: '',
  styles: { backgroundColor: 'rgb(255, 0, 0)', borderRadius: '8px' }, ...extra,
})

function renderSlide(elements, revealed = 0, playingStep = -1) {
  return render(
    <PresentedSlide slideKey={1} page={{}} elements={elements} animInfo={computeSteps(elements)}
      revealed={revealed} playingStep={playingStep} scale={1} canvasSize={{ w: 1280, h: 720 }} />,
  )
}
const loopWrappers = (container) => [...container.querySelectorAll('.fe-loop-anim')]

describe('발표 화면 — 반복 효과 래퍼', () => {
  beforeEach(() => { useFlatStore.setState({ canvasSize: { w: 1280, h: 720 }, selectedFlatIds: [] }) })

  it('반복만 있는 요소: 위치 래퍼 안에서 슬라이드 진입부터 반복', () => {
    const { container } = renderSlide([shape('a', { loopAnim: makeLoopAnim('pulse') })])
    const [w] = loopWrappers(container)
    expect(w).toBeTruthy()
    expect(w.style.animation).toContain('feLoopPulse 1200ms')
    expect(w.style.animation).toContain('infinite')
    expect(w.style.getPropertyValue('--fe-li')).toBe('1')
    expect(w.parentElement.style.left).toBe('10px')
  })

  it('클릭 단계 요소: 드러나기 전엔 반복 없음, 드러나면 등장 후 시작', () => {
    const el = shape('c', {
      anim: { effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click', ref: null }, seq: 1 },
      loopAnim: makeLoopAnim('float'),
    })
    expect(loopWrappers(renderSlide([el], 0).container)).toHaveLength(0)
    const [w] = loopWrappers(renderSlide([el], 1, 0).container)
    // 숨김↔보임 전환에도 래퍼 구조는 유지(자식 리마운트 방지) — 숨김일 땐 animation만 없다
    const { container } = renderSlide([el], 0)
    const hidden = container.querySelector('[style*="center center"] > [style*="inset"]')
    expect(hidden).toBeTruthy()
    expect(hidden.style.animation).toBe('')
    expect(w.style.animation).toContain('feLoopFloat 3000ms ease-in-out 500ms')
  })

  it('반짝 스윕은 요소 곡률로 자르는 클래스/반경을 쓴다', () => {
    const { container } = renderSlide([shape('s', { loopAnim: makeLoopAnim('shimmer') })])
    const [w] = loopWrappers(container)
    expect(w.className).toContain('fe-loop-shimmer')
    expect(w.style.borderRadius).toBe('8px')
  })

  it('반복 효과가 없으면 래퍼도 없다', () => {
    expect(loopWrappers(renderSlide([shape('n')]).container)).toHaveLength(0)
  })
})
