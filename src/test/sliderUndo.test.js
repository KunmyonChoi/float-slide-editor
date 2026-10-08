import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// 슬라이더 한 번 끌기 = 되돌리기 한 번.
// ① 끄는 동안 값마다 저장하는 슬라이더(곡선 휘기·유리 효과 등)는 한 동작으로 합쳐 기록한다.
// ② 끄는 동안 미리보기만 하고 놓을 때 저장하는 슬라이더(투명도·그림 보정 등)는 미리보기 전 값으로 되돌아가야 한다.

const st = () => useFlatStore.getState()
const el = (id) => st().flatElements.find(e => e.id === id)

function text(id) {
  return { id, type: 'text', x: 0, y: 0, width: 400, height: 100, zIndex: 1, content: 'BADGE', isRich: false,
    styles: { opacity: '1', backgroundColor: 'rgba(255, 255, 255, 0.2)' } }
}

describe('슬라이더 되돌리기 단위', () => {
  beforeEach(() => {
    st().clearHistory?.()
    useFlatStore.setState({ canvasSize: { w: 1920, h: 1080 }, flatElements: [text('a'), text('b')], selectedFlatIds: ['a'] })
    st().clearHistory?.()
  })

  it('미리보기 후 놓을 때 저장 → 되돌리면 미리보기 전 값', () => {
    for (const v of ['0.9', '0.7', '0.5']) st().previewFlatElement('a', { styles: { opacity: v } })
    st().updateFlatElement('a', { styles: { opacity: '0.5' } })
    expect(el('a').styles.opacity).toBe('0.5')
    st().undo()
    expect(el('a').styles.opacity).toBe('1')
    st().redo()
    expect(el('a').styles.opacity).toBe('0.5')
  })

  it('미리보기 전 값은 스타일 키·필드마다 처음 값만 기억하고, 다른 키는 건드리지 않는다', () => {
    st().previewFlatElement('a', { imageFx: { warmth: 10 } })
    st().previewFlatElement('a', { imageFx: { warmth: 40 } })
    st().updateFlatElement('a', { imageFx: { warmth: 40 } })
    st().updateFlatElement('a', { styles: { backgroundColor: 'red' } })
    st().undo()
    expect(el('a').styles.backgroundColor).toBe('rgba(255, 255, 255, 0.2)')
    expect(el('a').imageFx).toEqual({ warmth: 40 })
    st().undo()
    expect(el('a').imageFx).toBeUndefined()
  })

  it('한 동작(제스처) 안에서 값마다 저장해도 되돌리기는 한 번', () => {
    st().beginHistoryGesture()
    for (const v of [5, 10, 15, 20, 25, 30]) st().updateFlatElement('a', { textArc: v })
    st().endHistoryGesture()
    expect(el('a').textArc).toBe(30)
    st().undo()
    expect(el('a').textArc).toBeUndefined()
    expect(st().canUndo).toBe(false)
    st().redo()
    expect(el('a').textArc).toBe(30)
  })

  it('제스처 사이의 변경은 따로 기록된다(두 번 끌면 두 단계)', () => {
    st().beginHistoryGesture()
    st().updateFlatElement('a', { textArc: 10 }); st().updateFlatElement('a', { textArc: 20 })
    st().endHistoryGesture()
    st().beginHistoryGesture()
    st().updateFlatElement('a', { textArc: 40 }); st().updateFlatElement('a', { textArc: 60 })
    st().endHistoryGesture()
    st().undo(); expect(el('a').textArc).toBe(20)
    st().undo(); expect(el('a').textArc).toBeUndefined()
  })

  it('제스처 안이라도 다른 요소·다른 속성은 합치지 않는다', () => {
    st().beginHistoryGesture()
    st().updateFlatElement('a', { textArc: 10 })
    st().updateFlatElement('b', { textArc: 50 })
    st().updateFlatElement('a', { styles: { opacity: '0.4' } })
    st().endHistoryGesture()
    st().undo(); expect(el('a').styles.opacity).toBe('1')
    st().undo(); expect(el('b').textArc).toBeUndefined()
    st().undo(); expect(el('a').textArc).toBeUndefined()
  })

  it('스타일 키가 같으면 합치고, 처음 값으로 되돌린다(유리 효과)', () => {
    st().beginHistoryGesture()
    for (const n of [4, 12, 22]) st().updateFlatElement('a', { styles: { backdropFilter: `blur(${n}px) saturate(1.4)` } })
    st().endHistoryGesture()
    st().undo()
    expect(el('a').styles.backdropFilter).toBeUndefined()
    expect(st().canUndo).toBe(false)
  })

  it('여러 요소 일괄 변경도 제스처 안에서는 한 번', () => {
    st().beginHistoryGesture()
    for (const v of ['0.8', '0.6', '0.3']) st().batchUpdateFlatElements(['a', 'b'], { styles: { opacity: v } })
    st().endHistoryGesture()
    st().undo()
    expect(el('a').styles.opacity).toBe('1')
    expect(el('b').styles.opacity).toBe('1')
    expect(st().canUndo).toBe(false)
  })

  it('되돌린 뒤 같은 제스처가 이어지지 않는다(되돌리기는 제스처를 끝낸다)', () => {
    st().beginHistoryGesture()
    st().updateFlatElement('a', { textArc: 10 })
    st().undo()
    st().updateFlatElement('a', { textArc: 30 })
    st().endHistoryGesture()
    st().undo()
    expect(el('a').textArc).toBeUndefined()
    st().redo()
    expect(el('a').textArc).toBe(30)
  })
})

describe('historyGestures — 문서 이벤트로 동작 잡기', () => {
  let uninstall
  beforeEach(async () => {
    const { installHistoryGestures } = await import('../core/historyGestures')
    uninstall?.()
    uninstall = installHistoryGestures(() => useFlatStore.getState(), document)
    useFlatStore.setState({ canvasSize: { w: 1920, h: 1080 }, flatElements: [text('a')], selectedFlatIds: ['a'] })
    st().clearHistory()
  })
  const tick = () => new Promise(r => setTimeout(r, 5))
  const fire = (node, type, init = {}) => node.dispatchEvent(new Event(type, { bubbles: true, ...init }))

  it('슬라이더를 누르고 끄는 동안 값마다 저장해도, 놓으면 되돌리기 한 번', async () => {
    const range = document.createElement('input'); range.type = 'range'; document.body.appendChild(range)
    fire(range, 'pointerdown')
    for (const v of [10, 20, 30, 40]) st().updateFlatElement('a', { textArc: v })
    fire(range, 'pointerup')
    await tick()
    st().updateFlatElement('a', { textArc: 90 })   // 놓은 뒤의 변경은 새 단계
    st().undo(); expect(el('a').textArc).toBe(40)
    st().undo(); expect(el('a').textArc).toBeUndefined()
    expect(st().canUndo).toBe(false)
    range.remove()
  })

  it('다른 슬라이더를 이어 누르면(앞 슬라이더 blur) 새 동작이 끊기지 않는다', async () => {
    const r1 = document.createElement('input'); r1.type = 'range'; document.body.appendChild(r1)
    const r2 = document.createElement('input'); r2.type = 'range'; document.body.appendChild(r2)
    fire(r1, 'pointerdown'); st().updateFlatElement('a', { textArc: 10 }); fire(r1, 'pointerup'); await tick()
    fire(r2, 'pointerdown')
    r1.dispatchEvent(new FocusEvent('blur'))          // 포커스가 앞 슬라이더에서 빠진다(버블 안 함 — capture로 잡힌다)
    for (const n of [2, 8, 16]) st().updateFlatElement('a', { styles: { backdropFilter: `blur(${n}px)` } })
    fire(r2, 'pointerup'); await tick()
    st().undo(); expect(el('a').styles.backdropFilter).toBeUndefined()
    st().undo(); expect(el('a').textArc).toBeUndefined()
    expect(st().canUndo).toBe(false)
    r1.remove(); r2.remove()
  })

  it('놓는 순간 onMouseUp에서 저장해도 같은 동작에 들어간다', async () => {
    const range = document.createElement('input'); range.type = 'range'; document.body.appendChild(range)
    fire(range, 'pointerdown')
    st().updateFlatElement('a', { textArc: 10 })
    fire(range, 'pointerup')
    st().updateFlatElement('a', { textArc: 20 })   // mouseup 핸들러
    await tick()
    st().undo(); expect(el('a').textArc).toBeUndefined()
    range.remove()
  })

  it('방향키로 슬라이더를 움직이면 키를 뗄 때까지 한 단계', async () => {
    const range = document.createElement('input'); range.type = 'range'; document.body.appendChild(range)
    for (const v of [5, 10, 15]) {
      range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      st().updateFlatElement('a', { textArc: v })
    }
    range.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    await tick()
    st().undo(); expect(el('a').textArc).toBeUndefined()
    range.remove()
  })

  it('색상 창: 끄는 동안의 input은 한 단계, 창을 닫으면(change) 끝', async () => {
    const color = document.createElement('input'); color.type = 'color'; document.body.appendChild(color)
    for (const c of ['#111111', '#222222', '#333333']) { fire(color, 'input'); st().updateFlatElement('a', { styles: { color: c } }) }
    fire(color, 'change')
    await tick()
    st().updateFlatElement('a', { styles: { color: '#444444' } })
    st().undo(); expect(el('a').styles.color).toBe('#333333')
    st().undo(); expect(el('a').styles.color).toBeUndefined()
    color.remove()
  })

  it('슬라이더가 아닌 곳을 누른 동안의 변경은 합치지 않는다', async () => {
    const btn = document.createElement('button'); document.body.appendChild(btn)
    fire(btn, 'pointerdown')
    st().updateFlatElement('a', { textArc: 10 }); st().updateFlatElement('a', { textArc: 20 })
    fire(btn, 'pointerup'); await tick()
    st().undo(); expect(el('a').textArc).toBe(10)
    btn.remove()
  })
})
