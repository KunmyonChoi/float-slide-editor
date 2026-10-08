import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { SLIDE_LAYOUTS } from '../core/slideLayouts'

const px = (v) => parseFloat(v)
const titleOf = (els) => els.find(e => e.layoutRole === 'title')

describe('세로 캔버스', () => {
  beforeEach(() => { useFlatStore.getState().startScratchProject('title') })

  it('시작 레이아웃 글자 크기는 짧은 변 기준 — 가로 1920×1080과 세로 1080×1920이 같다', () => {
    const layout = SLIDE_LAYOUTS.find(l => l.id === 'title')
    const land = titleOf(layout.build({ w: 1920, h: 1080 }))
    const vert = titleOf(layout.build({ w: 1080, h: 1920 }))
    expect(px(land.styles.fontSize)).toBe(81)
    expect(px(vert.styles.fontSize)).toBe(81)
    expect(vert.width).toBe(864) // 0.8 × 1080 — 제목 박스가 폭 안에 있다
  })

  it('새 프로젝트를 타겟 화면 크기로 시작한다', () => {
    useFlatStore.getState().startScratchProject('title', { w: 1080, h: 1920 })
    const st = useFlatStore.getState()
    expect(st.canvasSize).toEqual({ w: 1080, h: 1920 })
    const bg = st.flatElements.find(e => e.isBackground)
    expect([bg.width, bg.height]).toEqual([1080, 1920])
  })

  it('가로→세로 해상도 변경: 글자는 줄어드는 쪽(가로 비율)에 맞춰 폭을 넘지 않는다', () => {
    const before = titleOf(useFlatStore.getState().flatElements)
    useFlatStore.getState().setResolution({ w: 1080, h: 1920 })
    const after = titleOf(useFlatStore.getState().flatElements)
    expect(px(after.styles.fontSize)).toBeCloseTo(px(before.styles.fontSize) * 1080 / 1920, 1)
    expect(after.width).toBeCloseTo(before.width * 1080 / 1920, 1)
  })

  it('같은 방향 변경(1920×1080→1280×720)은 기존처럼 평균 비율', () => {
    const before = titleOf(useFlatStore.getState().flatElements)
    useFlatStore.getState().setResolution({ w: 1280, h: 720 })
    const after = titleOf(useFlatStore.getState().flatElements)
    expect(px(after.styles.fontSize)).toBeCloseTo(px(before.styles.fontSize) * 2 / 3, 1)
  })

  it('가로→정사각(1920×1080→1080×1080): 폭이 줄어드는 비율로 글자도 줄인다', () => {
    const before = titleOf(useFlatStore.getState().flatElements)
    useFlatStore.getState().setResolution({ w: 1080, h: 1080 })
    const after = titleOf(useFlatStore.getState().flatElements)
    expect(px(after.styles.fontSize)).toBeCloseTo(px(before.styles.fontSize) * 1080 / 1920, 1)
  })
})
