import { describe, it, expect, beforeEach } from 'vitest'
import { HistoryStack } from '../core/HistoryStack'

// ═══════════════════════════════════════════════════════════════
//  HistoryStack — 기본 동작
// ═══════════════════════════════════════════════════════════════
describe('HistoryStack — 기본 동작', () => {
  let stack

  beforeEach(() => {
    stack = new HistoryStack()
  })

  it('초기 상태에서 canUndo/canRedo가 false', () => {
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })

  it('push 후 canUndo가 true', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    expect(stack.canUndo).toBe(true)
    expect(stack.canRedo).toBe(false)
  })

  it('undo()가 역방향 커맨드를 반환한다', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    const cmd = stack.undo()
    expect(cmd).toEqual({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
  })

  it('undo 후 canRedo가 true', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.undo()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(true)
  })

  it('redo()가 정방향 커맨드를 반환한다', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.undo()
    const cmd = stack.redo()
    expect(cmd).toEqual({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
  })

  it('빈 상태에서 undo()가 null을 반환한다', () => {
    expect(stack.undo()).toBeNull()
  })

  it('빈 상태에서 redo()가 null을 반환한다', () => {
    expect(stack.redo()).toBeNull()
  })

  it('clear() 후 스택이 초기화된다', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.clear()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  HistoryStack — 다단계 Undo/Redo
// ═══════════════════════════════════════════════════════════════
describe('HistoryStack — 다단계 Undo/Redo', () => {
  let stack

  beforeEach(() => {
    stack = new HistoryStack()
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'b', newValue: 'c' })
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'c', newValue: 'd' })
  })

  it('연속 undo가 역순으로 커맨드를 반환한다', () => {
    const c3 = stack.undo()
    const c2 = stack.undo()
    const c1 = stack.undo()
    expect(c3.newValue).toBe('d')
    expect(c2.newValue).toBe('c')
    expect(c1.newValue).toBe('b')
    expect(stack.undo()).toBeNull()
  })

  it('undo 2번 후 redo가 올바른 커맨드를 반환한다', () => {
    stack.undo() // d→c
    stack.undo() // c→b
    const cmd = stack.redo()
    expect(cmd.oldValue).toBe('b')
    expect(cmd.newValue).toBe('c')
  })

  it('undo 후 새 push가 redo 히스토리를 제거한다', () => {
    stack.undo() // d→c
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'c', newValue: 'x' })
    expect(stack.canRedo).toBe(false)
    const cmd = stack.undo()
    expect(cmd.newValue).toBe('x')
  })
})

// ═══════════════════════════════════════════════════════════════
//  HistoryStack — 최대 크기 제한
// ═══════════════════════════════════════════════════════════════
describe('HistoryStack — 최대 크기 제한', () => {
  it('기본 최대 크기가 50이다', () => {
    const stack = new HistoryStack()
    for (let i = 0; i < 60; i++) {
      stack.push({ type: 'setText', id: 'fe-1', oldValue: String(i), newValue: String(i + 1) })
    }
    // 50개만 유지 — undo 50번 가능
    let count = 0
    while (stack.undo()) count++
    expect(count).toBe(50)
  })

  it('커스텀 최대 크기를 지정할 수 있다', () => {
    const stack = new HistoryStack(5)
    for (let i = 0; i < 10; i++) {
      stack.push({ type: 'setText', id: 'fe-1', oldValue: String(i), newValue: String(i + 1) })
    }
    let count = 0
    while (stack.undo()) count++
    expect(count).toBe(5)
  })

  it('오래된 항목이 먼저 제거된다', () => {
    const stack = new HistoryStack(3)
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'b', newValue: 'c' })
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'c', newValue: 'd' })
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'd', newValue: 'e' })
    // a→b 가 제거됨, 가장 오래된 undo는 b→c
    const c3 = stack.undo()
    const c2 = stack.undo()
    const c1 = stack.undo()
    expect(c3.newValue).toBe('e')
    expect(c2.newValue).toBe('d')
    expect(c1.newValue).toBe('c')
    expect(stack.undo()).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
//  HistoryStack — 다양한 커맨드 타입
// ═══════════════════════════════════════════════════════════════
describe('HistoryStack — 다양한 커맨드 타입', () => {
  let stack

  beforeEach(() => {
    stack = new HistoryStack()
  })

  it('setStyle 커맨드를 저장하고 복원한다', () => {
    stack.push({ type: 'setStyle', id: 'fe-1', prop: 'color', oldValue: 'red', newValue: 'blue' })
    const cmd = stack.undo()
    expect(cmd.type).toBe('setStyle')
    expect(cmd.prop).toBe('color')
    expect(cmd.oldValue).toBe('red')
    expect(cmd.newValue).toBe('blue')
  })

  it('setAttribute 커맨드를 저장하고 복원한다', () => {
    stack.push({ type: 'setAttribute', id: 'fe-1', attr: 'src', oldValue: 'a.png', newValue: 'b.png' })
    const cmd = stack.undo()
    expect(cmd.type).toBe('setAttribute')
    expect(cmd.attr).toBe('src')
  })

  it('서로 다른 타입의 커맨드가 순서대로 관리된다', () => {
    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    stack.push({ type: 'setStyle', id: 'fe-2', prop: 'fontSize', oldValue: '12px', newValue: '16px' })
    stack.push({ type: 'setAttribute', id: 'fe-3', attr: 'alt', oldValue: '', newValue: 'photo' })

    const c3 = stack.undo()
    const c2 = stack.undo()
    const c1 = stack.undo()
    expect(c3.type).toBe('setAttribute')
    expect(c2.type).toBe('setStyle')
    expect(c1.type).toBe('setText')
  })
})

// ═══════════════════════════════════════════════════════════════
//  HistoryStack — size 속성
// ═══════════════════════════════════════════════════════════════
describe('HistoryStack — size 속성', () => {
  it('push/undo/redo에 따라 size가 정확하다', () => {
    const stack = new HistoryStack()
    expect(stack.size).toBe(0)

    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'a', newValue: 'b' })
    expect(stack.size).toBe(1)

    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'b', newValue: 'c' })
    expect(stack.size).toBe(2)

    stack.undo()
    expect(stack.size).toBe(2) // undo해도 전체 스택 크기는 유지 (포인터만 이동)

    stack.push({ type: 'setText', id: 'fe-1', oldValue: 'b', newValue: 'd' })
    expect(stack.size).toBe(2) // redo 히스토리 제거 후 새 커맨드 추가
  })
})

// ═══════════════════════════════════════════════════════════════
//  editorStore — 뮤테이션 메서드
// ═══════════════════════════════════════════════════════════════
describe('editorStore — 뮤테이션 & Undo/Redo', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    // iframe mock 설정
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)

    // iframe 내부에 테스트용 요소 생성
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <p data-editor-id="fe-1" data-editor-type="text" style="color: red; font-size: 14px;">원본 텍스트</p>
      <img data-editor-id="fe-2" data-editor-type="image" src="old.png" alt="이미지" />
    </body></html>`)
    doc.close()

    // store 초기화
    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([
        ['fe-1', { id: 'fe-1', tag: 'p', type: 'text' }],
        ['fe-2', { id: 'fe-2', tag: 'img', type: 'image' }],
      ]),
      selectedId: null,
      iframeRef: { current: iframe },
      mode: 'edit',
    })

    // history 초기화
    store.getState().clearHistory()
  })

  it('applyText가 텍스트를 변경하고 히스토리에 기록한다', () => {
    store.getState().applyText('fe-1', '새 텍스트')
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.textContent).toBe('새 텍스트')
    expect(store.getState().canUndo).toBe(true)
  })

  it('applyStyle이 스타일을 변경하고 히스토리에 기록한다', () => {
    store.getState().applyStyle('fe-1', 'color', 'blue')
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.style.color).toBe('blue')
    expect(store.getState().canUndo).toBe(true)
  })

  it('applyAttribute가 속성을 변경하고 히스토리에 기록한다', () => {
    store.getState().applyAttribute('fe-2', 'src', 'new.png')
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-2"]')
    expect(el.getAttribute('src')).toBe('new.png')
    expect(store.getState().canUndo).toBe(true)
  })

  it('undo가 텍스트 변경을 되돌린다', () => {
    store.getState().applyText('fe-1', '변경됨')
    store.getState().undo()
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.textContent).toBe('원본 텍스트')
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(true)
  })

  it('undo가 스타일 변경을 되돌린다', () => {
    store.getState().applyStyle('fe-1', 'color', 'blue')
    store.getState().undo()
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.style.color).toBe('red')
  })

  it('undo가 속성 변경을 되돌린다', () => {
    store.getState().applyAttribute('fe-2', 'src', 'new.png')
    store.getState().undo()
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-2"]')
    expect(el.getAttribute('src')).toBe('old.png')
  })

  it('redo가 되돌린 변경을 다시 적용한다', () => {
    store.getState().applyText('fe-1', '변경됨')
    store.getState().undo()
    store.getState().redo()
    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.textContent).toBe('변경됨')
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().canRedo).toBe(false)
  })

  it('다단계 undo/redo가 올바르게 동작한다', () => {
    store.getState().applyText('fe-1', '첫번째')
    store.getState().applyText('fe-1', '두번째')
    store.getState().applyText('fe-1', '세번째')

    store.getState().undo() // 세번째 → 두번째
    store.getState().undo() // 두번째 → 첫번째

    const el = store.getState().iframeRef.current.contentDocument.querySelector('[data-editor-id="fe-1"]')
    expect(el.textContent).toBe('첫번째')

    store.getState().redo() // 첫번째 → 두번째
    expect(el.textContent).toBe('두번째')
  })

  it('loadHtml 시 히스토리가 초기화된다', () => {
    store.getState().applyText('fe-1', '변경됨')
    expect(store.getState().canUndo).toBe(true)
    store.getState().loadHtml('<!DOCTYPE html><html><body><p>새 슬라이드</p></body></html>')
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)
  })

  it('존재하지 않는 요소에 대한 뮤테이션은 무시된다', () => {
    store.getState().applyText('fe-999', '없는 요소')
    expect(store.getState().canUndo).toBe(false)
  })

  it('canUndo/canRedo 상태가 스토어에 반영된다', () => {
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(false)

    store.getState().applyText('fe-1', '변경')
    expect(store.getState().canUndo).toBe(true)

    store.getState().undo()
    expect(store.getState().canRedo).toBe(true)
  })
})
