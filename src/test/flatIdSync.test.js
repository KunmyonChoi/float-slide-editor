import { describe, it, expect } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId, resetFlatCounter } from '../core/FlatExtractor'

describe('flat ID 카운터 동기화', () => {
  it('loadAllPages가 로드된 최대 ID 이후로 카운터를 올려 충돌을 막는다', () => {
    useFlatStore.getState().loadAllPages({
      '0-0': {
        elements: [
          { id: 'flat-9000', type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, styles: {} },
          { id: 'flat-8500', type: 'text', x: 0, y: 0, width: 10, height: 10, zIndex: 2, content: 'hi', styles: {} },
        ],
        canvasSize: { w: 1280, h: 720 }, fontImports: [],
      },
    }, '0-0')
    // 다음 발급 ID는 로드된 최대(9000)보다 커야 함
    const n = +nextFlatId().split('-')[1]
    expect(n).toBeGreaterThan(9000)
  })

  it('현재 페이지보다 다른 페이지의 ID가 클 때도 충돌 없이 발급한다 (멀티페이지 덱 + 드롭)', () => {
    // 0페이지(현재)는 작은 ID, 1페이지(캐시)는 큰 ID — 현재 페이지만 보면 카운터가 역행한다.
    useFlatStore.getState().loadAllPages({
      '0-0': {
        elements: [{ id: 'flat-3', type: 'text', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: 'a', styles: {} }],
        canvasSize: { w: 1280, h: 720 }, fontImports: [],
      },
      '1-0': {
        elements: [{ id: 'flat-120', type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, styles: {} }],
        canvasSize: { w: 1280, h: 720 }, fontImports: [],
      },
    }, '0-0')
    // 현재 페이지(0)에서 새 요소(영상 등)를 드롭하면 1페이지의 flat-120과 겹치면 안 된다.
    const ids = new Set()
    const all = [...useFlatStore.getState().flatElements.map(e => e.id), 'flat-120']
    for (let i = 0; i < 5; i++) {
      const id = nextFlatId()
      expect(all.includes(id)).toBe(false) // 기존(라이브+다른 페이지) ID와 충돌 금지
      expect(ids.has(id)).toBe(false)
      ids.add(id); all.push(id)
    }
  })

  it('캐시된 페이지로 복귀하면 전역 최대 ID 이상으로 카운터를 복구한다', () => {
    useFlatStore.getState().loadAllPages({
      '0-0': {
        elements: [{ id: 'flat-5', type: 'text', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: 'a', styles: {} }],
        canvasSize: { w: 1280, h: 720 }, fontImports: [],
      },
      '1-0': {
        elements: [{ id: 'flat-500', type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, styles: {} }],
        canvasSize: { w: 1280, h: 720 }, fontImports: [],
      },
    }, '0-0')
    // 카운터를 강제로 역행시켜 충돌 위험 상황을 만든다(추출 시 resetFlatCounter가 0으로 떨구는 상황 모사).
    resetFlatCounter()
    // 0페이지로 복귀 → _restoreFromCache가 전역 최대(500)로 카운터를 끌어올려야 한다.
    useFlatStore.getState().goToFlatPage(0)
    const n = +nextFlatId().split('-')[1]
    expect(n).toBeGreaterThan(500)
  })
})
