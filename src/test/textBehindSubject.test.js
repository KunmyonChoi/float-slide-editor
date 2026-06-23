import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

function imageEl(id, extra = {}) {
  return {
    id, type: 'image', content: 'data:image/png;base64,orig',
    x: 100, y: 80, width: 600, height: 400, zIndex: 3,
    isRich: false, styles: { objectFit: 'cover' }, ...extra,
  }
}

const CUTOUT = 'data:image/png;base64,cutoutfg'

describe('applyTextBehindSubject — 피사체 뒤 텍스트 3층 구성', () => {
  beforeEach(() => {
    useFlatStore.setState({
      canvasSize: { w: 1280, h: 720 },
      flatElements: [imageEl('img1'), { id: 'other', type: 'text', content: 'x', x: 0, y: 0, width: 50, height: 20, zIndex: 9, styles: {} }],
      selectedFlatIds: [],
    })
  })

  it('원본+타이틀+컷아웃 3층 생성, z 순서 원본<타이틀<컷아웃', () => {
    const titleId = useFlatStore.getState().applyTextBehindSubject('img1', CUTOUT)
    const els = useFlatStore.getState().flatElements
    const orig = els.find(e => e.id === 'img1')
    const title = els.find(e => e.id === titleId)
    const cutout = els.find(e => e.type === 'image' && e.id !== 'img1')

    expect(orig && title && cutout).toBeTruthy()
    expect(title.type).toBe('text')
    expect(title.content).toBe('TITLE')
    expect(cutout.content).toBe(CUTOUT)
    // 최상위(other zIndex=9) 위로: 타이틀=10, 컷아웃=11
    expect(orig.zIndex).toBeLessThan(title.zIndex)
    expect(title.zIndex).toBeLessThan(cutout.zIndex)
  })

  it('컷아웃은 원본과 동일 박스 + 동일 채움전략(objectFit 복사) → 리사이즈 정렬 유지', () => {
    useFlatStore.getState().applyTextBehindSubject('img1', CUTOUT)
    const cutout = useFlatStore.getState().flatElements.find(e => e.type === 'image' && e.id !== 'img1')
    expect([cutout.x, cutout.y, cutout.width, cutout.height]).toEqual([100, 80, 600, 400])
    expect(cutout.styles.objectFit).toBe('cover') // 원본(imageEl)의 objectFit 복사
  })

  it('objectPosition도 복사', () => {
    useFlatStore.setState({
      flatElements: [imageEl('img1', { styles: { objectFit: 'cover', objectPosition: '20% 30%' } })],
      selectedFlatIds: [],
    })
    useFlatStore.getState().applyTextBehindSubject('img1', CUTOUT)
    const cutout = useFlatStore.getState().flatElements.find(e => e.type === 'image' && e.id !== 'img1')
    expect(cutout.styles.objectFit).toBe('cover')
    expect(cutout.styles.objectPosition).toBe('20% 30%')
  })

  it('세 요소가 같은 그룹 + 타이틀 선택', () => {
    const titleId = useFlatStore.getState().applyTextBehindSubject('img1', CUTOUT)
    const els = useFlatStore.getState().flatElements
    const gids = new Set(['img1', titleId].map(id => els.find(e => e.id === id).groupId))
    const cutout = els.find(e => e.type === 'image' && e.id !== 'img1')
    expect(gids.size).toBe(1)               // 원본·타이틀 같은 그룹
    expect([...gids][0]).toBeTruthy()
    expect(cutout.groupId).toBe([...gids][0]) // 컷아웃도 같은 그룹
    expect(useFlatStore.getState().selectedFlatIds).toEqual([titleId])
  })

  it('undo 한 번에 전체 취소(원본만 남음)', () => {
    useFlatStore.getState().applyTextBehindSubject('img1', CUTOUT)
    expect(useFlatStore.getState().flatElements.length).toBe(4) // img1+other+title+cutout
    useFlatStore.getState().undo()
    const els = useFlatStore.getState().flatElements
    expect(els.length).toBe(2)
    expect(els.find(e => e.id === 'img1')).toBeTruthy()
    expect(els.find(e => e.id === 'img1').groupId).toBeFalsy() // 원복
  })

  it('없는 id/빈 컷아웃은 무시', () => {
    expect(useFlatStore.getState().applyTextBehindSubject('nope', CUTOUT)).toBeNull()
    expect(useFlatStore.getState().applyTextBehindSubject('img1', '')).toBeNull()
    expect(useFlatStore.getState().flatElements.length).toBe(2)
  })
})
