import { describe, it, expect } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'

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
})
