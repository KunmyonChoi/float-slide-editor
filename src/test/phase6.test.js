import { describe, it, expect, beforeEach } from 'vitest'
import { resetCounter } from '../core/ElementRegistry'

function setupStore(bodyHtml) {
  return async () => {
    // 카운터를 100부터 시작 — 기존 테스트 fixture ID(fe-1~99)와 충돌 방지
    resetCounter()
    for (let i = 0; i < 100; i++) (await import('../core/ElementRegistry')).nextId()

    const mod = await import('../store/editorStore')
    const store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>${bodyHtml}</body></html>`)
    doc.close()

    // elements Map 구축 — iframe DOM에서 data-editor-id를 읽어서
    const elements = new Map()
    doc.querySelectorAll('[data-editor-id]').forEach(el => {
      elements.set(el.getAttribute('data-editor-id'), {
        id: el.getAttribute('data-editor-id'),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('data-editor-type') || 'text',
      })
    })

    store.setState({
      slideHtml: '<html></html>',
      elements,
      selectedId: null,
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
    return store
  }
}

// ═══════════════════════════════════════════════════════════════
//  구조 편집 — 요소 삽입
// ═══════════════════════════════════════════════════════════════
describe('구조 편집 — 요소 삽입', () => {
  let store

  beforeEach(async () => {
    store = await setupStore(`
      <div data-editor-id="fe-1" data-editor-type="container">
        <p data-editor-id="fe-2" data-editor-type="text">기존 텍스트</p>
      </div>
    `)()
  })

  it('컨테이너에 텍스트 요소를 삽입할 수 있다', () => {
    const newId = store.getState().insertElement('fe-1', 'p', { textContent: '새 단락' })
    expect(newId).toMatch(/^fe-\d+$/)
    const doc = store.getState().iframeRef.current.contentDocument
    const el = doc.querySelector(`[data-editor-id="${newId}"]`)
    expect(el).not.toBeNull()
    expect(el.textContent).toBe('새 단락')
    expect(el.tagName.toLowerCase()).toBe('p')
  })

  it('삽입된 요소가 elements Map에 등록된다', () => {
    const newId = store.getState().insertElement('fe-1', 'p')
    expect(store.getState().elements.has(newId)).toBe(true)
    expect(store.getState().elements.get(newId).type).toBe('text')
  })

  it('이미지 요소를 삽입할 수 있다', () => {
    const newId = store.getState().insertElement('fe-1', 'img', { src: 'test.png', alt: '테스트' })
    const doc = store.getState().iframeRef.current.contentDocument
    const el = doc.querySelector(`[data-editor-id="${newId}"]`)
    expect(el.getAttribute('src')).toBe('test.png')
    expect(store.getState().elements.get(newId).type).toBe('image')
  })

  it('컨테이너(div) 요소를 삽입할 수 있다', () => {
    const newId = store.getState().insertElement('fe-1', 'div')
    expect(store.getState().elements.get(newId).type).toBe('container')
  })

  it('삽입 후 canUndo가 true이다', () => {
    store.getState().insertElement('fe-1', 'p')
    expect(store.getState().canUndo).toBe(true)
  })

  it('삽입 undo → 요소가 DOM에서 제거된다', () => {
    const newId = store.getState().insertElement('fe-1', 'p', { textContent: '삭제될 요소' })
    store.getState().undo()
    const doc = store.getState().iframeRef.current.contentDocument
    expect(doc.querySelector(`[data-editor-id="${newId}"]`)).toBeNull()
    expect(store.getState().elements.has(newId)).toBe(false)
  })

  it('삽입 undo → redo → 요소가 다시 나타난다', () => {
    const newId = store.getState().insertElement('fe-1', 'p', { textContent: '복원될 요소' })
    store.getState().undo()
    store.getState().redo()
    const doc = store.getState().iframeRef.current.contentDocument
    expect(doc.querySelector(`[data-editor-id="${newId}"]`)).not.toBeNull()
    expect(store.getState().elements.has(newId)).toBe(true)
  })

  it('parentId가 null이면 body에 삽입한다', () => {
    const newId = store.getState().insertElement(null, 'p', { textContent: 'body 직속' })
    const doc = store.getState().iframeRef.current.contentDocument
    const el = doc.querySelector(`[data-editor-id="${newId}"]`)
    expect(el.parentElement).toBe(doc.body)
  })
})

// ═══════════════════════════════════════════════════════════════
//  구조 편집 — 요소 삭제
// ═══════════════════════════════════════════════════════════════
describe('구조 편집 — 요소 삭제', () => {
  let store

  beforeEach(async () => {
    store = await setupStore(`
      <div data-editor-id="fe-1" data-editor-type="container">
        <p data-editor-id="fe-2" data-editor-type="text">첫번째</p>
        <p data-editor-id="fe-3" data-editor-type="text">두번째</p>
        <p data-editor-id="fe-4" data-editor-type="text">세번째</p>
      </div>
    `)()
  })

  it('요소를 삭제할 수 있다', () => {
    store.getState().removeElement('fe-3')
    const doc = store.getState().iframeRef.current.contentDocument
    expect(doc.querySelector('[data-editor-id="fe-3"]')).toBeNull()
  })

  it('삭제된 요소가 elements Map에서 제거된다', () => {
    store.getState().removeElement('fe-3')
    expect(store.getState().elements.has('fe-3')).toBe(false)
  })

  it('삭제 시 selectedId가 null로 초기화된다', () => {
    store.setState({ selectedId: 'fe-3' })
    store.getState().removeElement('fe-3')
    expect(store.getState().selectedId).toBeNull()
  })

  it('삭제 undo → 요소가 원래 위치에 복원된다', () => {
    store.getState().removeElement('fe-3')
    store.getState().undo()
    const doc = store.getState().iframeRef.current.contentDocument
    const el = doc.querySelector('[data-editor-id="fe-3"]')
    expect(el).not.toBeNull()
    expect(el.textContent).toBe('두번째')
    // 원래 위치 확인 (fe-2 다음, fe-4 이전)
    const children = [...el.parentElement.querySelectorAll('[data-editor-id]')]
    const idx = children.findIndex(c => c.getAttribute('data-editor-id') === 'fe-3')
    expect(idx).toBe(1) // 0:fe-2, 1:fe-3, 2:fe-4
  })

  it('삭제 undo 후 elements Map에 복원된다', () => {
    store.getState().removeElement('fe-3')
    store.getState().undo()
    expect(store.getState().elements.has('fe-3')).toBe(true)
  })

  it('삭제 undo → redo → 다시 삭제된다', () => {
    store.getState().removeElement('fe-3')
    store.getState().undo()
    store.getState().redo()
    const doc = store.getState().iframeRef.current.contentDocument
    expect(doc.querySelector('[data-editor-id="fe-3"]')).toBeNull()
    expect(store.getState().elements.has('fe-3')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  구조 편집 — 요소 이동 (순서 변경)
// ═══════════════════════════════════════════════════════════════
describe('구조 편집 — 요소 이동', () => {
  let store

  beforeEach(async () => {
    store = await setupStore(`
      <div data-editor-id="fe-1" data-editor-type="container">
        <p data-editor-id="fe-2" data-editor-type="text">A</p>
        <p data-editor-id="fe-3" data-editor-type="text">B</p>
        <p data-editor-id="fe-4" data-editor-type="text">C</p>
      </div>
    `)()
  })

  function getOrder() {
    const doc = store.getState().iframeRef.current.contentDocument
    const container = doc.querySelector('[data-editor-id="fe-1"]')
    return [...container.querySelectorAll(':scope > [data-editor-id]')].map(
      el => el.getAttribute('data-editor-id')
    )
  }

  it('moveElement(id, -1) — 위로 이동', () => {
    store.getState().moveElement('fe-3', -1)
    expect(getOrder()).toEqual(['fe-3', 'fe-2', 'fe-4'])
  })

  it('moveElement(id, 1) — 아래로 이동', () => {
    store.getState().moveElement('fe-3', 1)
    expect(getOrder()).toEqual(['fe-2', 'fe-4', 'fe-3'])
  })

  it('첫 번째 요소를 위로 이동하면 변화 없음', () => {
    store.getState().moveElement('fe-2', -1)
    expect(getOrder()).toEqual(['fe-2', 'fe-3', 'fe-4'])
    expect(store.getState().canUndo).toBe(false)
  })

  it('마지막 요소를 아래로 이동하면 변화 없음', () => {
    store.getState().moveElement('fe-4', 1)
    expect(getOrder()).toEqual(['fe-2', 'fe-3', 'fe-4'])
    expect(store.getState().canUndo).toBe(false)
  })

  it('이동 undo → 원래 순서 복원', () => {
    store.getState().moveElement('fe-3', -1)
    store.getState().undo()
    expect(getOrder()).toEqual(['fe-2', 'fe-3', 'fe-4'])
  })

  it('이동 undo → redo → 다시 이동 적용', () => {
    store.getState().moveElement('fe-3', -1)
    store.getState().undo()
    store.getState().redo()
    expect(getOrder()).toEqual(['fe-3', 'fe-2', 'fe-4'])
  })
})
