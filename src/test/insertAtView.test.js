import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// FlatCanvas가 넘겨 두는 캔버스 요소 흉내 — 배율 2로 확대해 화면 가운데가 캔버스 (850, 525)
const zoomedCanvas = {
  current: {
    getBoundingClientRect: () => ({ left: -1500, top: -900, width: 3840, height: 2160 }),
    parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
  },
}

describe('AWS 아이콘·그룹 넣기 — 드롭 위치가 없으면 지금 보고 있는 화면 가운데', () => {
  beforeEach(() => {
    useFlatStore.setState({ flatElements: [], selectedFlatIds: [], canvasSize: { w: 1920, h: 1080 }, _canvasRef: zoomedCanvas })
    useFlatStore.getState().clearHistory()
  })

  it('아이콘(56px)이 화면 가운데에', () => {
    useFlatStore.getState().insertAwsIcon('API-Gateway')
    const icon = useFlatStore.getState().flatElements.find(e => e.type === 'image')
    expect(icon).toBeTruthy()
    expect([icon.x + 28, icon.y + 28]).toEqual([850, 525])
  })

  it('드롭 위치를 주면 그 자리', () => {
    useFlatStore.getState().insertAwsIcon('API-Gateway', 300, 200)
    const icon = useFlatStore.getState().flatElements.find(e => e.type === 'image')
    expect([icon.x + 28, icon.y + 28]).toEqual([300, 200])
  })

  it('화면을 모르면 캔버스 가운데', () => {
    useFlatStore.setState({ _canvasRef: null })
    useFlatStore.getState().insertAwsGroup('vpc')
    const rect = useFlatStore.getState().flatElements.find(e => e.type === 'shape')
    expect(Math.round(rect.x + rect.width / 2)).toBe(960)
    expect(Math.round(rect.y + rect.height / 2)).toBe(540)
  })
})
