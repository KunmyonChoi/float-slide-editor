import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// 배경 레이어(전체 캔버스 + isBackground) 세 개. z=1,2,3.
function bg(id, z) {
  return { id, type: 'shape', x: 0, y: 0, width: 1280, height: 720, zIndex: z,
    content: '', isBackground: true, styles: { backgroundColor: '#eee' } }
}

function zOf(id) {
  return useFlatStore.getState().flatElements.find(e => e.id === id).zIndex
}

describe('setBackgroundOrder — 배경 레이어 임의 순서 재배치', () => {
  beforeEach(() => {
    useFlatStore.setState({
      canvasSize: { w: 1280, h: 720 },
      flatElements: [bg('a', 1), bg('b', 2), bg('c', 3)],
      selectedFlatIds: [],
    })
  })

  it('orderedIds(뒤→앞) 순서대로 기존 z 값 집합을 재할당', () => {
    // 원래 z: a=1,b=2,c=3. 새 순서 뒤→앞 = [c,a,b] → c=1,a=2,b=3
    useFlatStore.getState().setBackgroundOrder(['c', 'a', 'b'])
    expect(zOf('c')).toBe(1)
    expect(zOf('a')).toBe(2)
    expect(zOf('b')).toBe(3)
  })

  it('z 값 집합은 보존된다(배경이 콘텐츠보다 뒤라는 불변식 유지)', () => {
    useFlatStore.getState().setBackgroundOrder(['b', 'c', 'a'])
    const zs = useFlatStore.getState().flatElements.map(e => e.zIndex).sort((x, y) => x - y)
    expect(zs).toEqual([1, 2, 3])
  })

  it('undo로 원래 순서 복원', () => {
    useFlatStore.getState().setBackgroundOrder(['c', 'b', 'a'])
    expect(zOf('a')).toBe(3)
    useFlatStore.getState().undo()
    expect(zOf('a')).toBe(1)
    expect(zOf('b')).toBe(2)
    expect(zOf('c')).toBe(3)
  })

  it('부분/중복/외부 id 포함 시 무시(검증 실패)', () => {
    useFlatStore.getState().setBackgroundOrder(['a', 'b'])        // 부분
    expect(zOf('a')).toBe(1)
    useFlatStore.getState().setBackgroundOrder(['a', 'a', 'b'])   // 중복
    expect(zOf('a')).toBe(1)
    useFlatStore.getState().setBackgroundOrder(['a', 'b', 'zzz']) // 외부 id
    expect(zOf('a')).toBe(1)
  })

  it('순서 변화 없으면 히스토리에 쌓지 않음(undo 무영향)', () => {
    const before = useFlatStore.getState().canUndo
    useFlatStore.getState().setBackgroundOrder(['a', 'b', 'c']) // 동일 순서
    expect(useFlatStore.getState().canUndo).toBe(before)
  })
})
