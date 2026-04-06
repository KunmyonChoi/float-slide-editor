import { describe, it, expect, beforeEach } from 'vitest'
import { resetCounter } from '../core/ElementRegistry'

function setupStore(bodyHtml) {
  return async () => {
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
//  wrapAndInsert — cross-axis 삽입 (자동 래핑)
// ═══════════════════════════════════════════════════════════════
describe('wrapAndInsert — cross-axis 삽입', () => {
  let store

  beforeEach(async () => {
    store = await setupStore(`
      <div data-editor-id="fe-1" data-editor-type="container" style="display:flex;flex-direction:column;">
        <p data-editor-id="fe-2" data-editor-type="text">텍스트A</p>
        <p data-editor-id="fe-3" data-editor-type="text">텍스트B</p>
      </div>
    `)()
  })

  it('래퍼 div가 생성되고 원본 요소와 새 요소가 그 안에 들어간다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })

    const doc = store.getState().iframeRef.current.contentDocument
    const wrapper = doc.querySelector('[data-editor-id="fe-2"]').parentElement
    expect(wrapper.getAttribute('data-editor-type')).toBe('container')
    expect(wrapper.style.display).toBe('flex')
    // 래퍼 안에 원본 + 새 요소 = 2개
    expect(wrapper.children.length).toBe(2)
  })

  it('래퍼의 flex-direction이 부모의 cross-axis (row)로 설정된다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })

    const doc = store.getState().iframeRef.current.contentDocument
    const wrapper = doc.querySelector('[data-editor-id="fe-2"]').parentElement
    expect(wrapper.style.flexDirection).toBe('row')
  })

  it('side="before"이면 새 요소가 원본 앞에 삽입된다', () => {
    const newId = store.getState().wrapAndInsert('fe-2', 'before', 'p', { textContent: '왼쪽' })

    const doc = store.getState().iframeRef.current.contentDocument
    const wrapper = doc.querySelector(`[data-editor-id="${newId}"]`).parentElement
    expect(wrapper.children[0].getAttribute('data-editor-id')).toBe(newId)
    expect(wrapper.children[1].getAttribute('data-editor-id')).toBe('fe-2')
  })

  it('side="after"이면 새 요소가 원본 뒤에 삽입된다', () => {
    const newId = store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '오른쪽' })

    const doc = store.getState().iframeRef.current.contentDocument
    const wrapper = doc.querySelector(`[data-editor-id="${newId}"]`).parentElement
    expect(wrapper.children[0].getAttribute('data-editor-id')).toBe('fe-2')
    expect(wrapper.children[1].getAttribute('data-editor-id')).toBe(newId)
  })

  it('새 요소가 selectedId로 설정된다', () => {
    const newId = store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })
    expect(store.getState().selectedId).toBe(newId)
  })

  it('elements 맵에 래퍼와 새 요소가 추가된다', () => {
    const newId = store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })
    const { elements } = store.getState()
    // 원본(fe-2) + 래퍼 + 새요소 모두 존재
    expect(elements.has('fe-2')).toBe(true)
    expect(elements.has(newId)).toBe(true)
    // 래퍼도 elements에 존재
    const doc = store.getState().iframeRef.current.contentDocument
    const wrapperId = doc.querySelector('[data-editor-id="fe-2"]').parentElement.getAttribute('data-editor-id')
    expect(elements.has(wrapperId)).toBe(true)
    expect(elements.get(wrapperId).type).toBe('container')
  })

  it('래퍼가 원본의 원래 위치에 삽입된다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })

    const doc = store.getState().iframeRef.current.contentDocument
    const container = doc.querySelector('[data-editor-id="fe-1"]')
    // fe-1의 첫 번째 자식이 래퍼, 두 번째가 fe-3
    const firstChild = container.children[0]
    expect(firstChild.getAttribute('data-editor-type')).toBe('container')
    expect(container.children[1].getAttribute('data-editor-id')).toBe('fe-3')
  })

  it('canUndo가 true로 설정된다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })
    expect(store.getState().canUndo).toBe(true)
  })

  it('undo하면 래퍼가 제거되고 원본이 원래 위치로 복원된다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })
    store.getState().undo()

    const doc = store.getState().iframeRef.current.contentDocument
    const container = doc.querySelector('[data-editor-id="fe-1"]')
    // 원래대로 fe-2, fe-3만 존재
    expect(container.children.length).toBe(2)
    expect(container.children[0].getAttribute('data-editor-id')).toBe('fe-2')
    expect(container.children[1].getAttribute('data-editor-id')).toBe('fe-3')
    // 래퍼와 새 요소가 elements에서 제거됨
    const { elements } = store.getState()
    expect(elements.has('fe-2')).toBe(true)
    expect(elements.has('fe-3')).toBe(true)
  })

  it('undo 후 redo하면 래핑이 다시 적용된다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '새 텍스트' })
    store.getState().undo()
    store.getState().redo()

    const doc = store.getState().iframeRef.current.contentDocument
    const container = doc.querySelector('[data-editor-id="fe-1"]')
    // 래퍼가 다시 존재
    const wrapper = container.children[0]
    expect(wrapper.getAttribute('data-editor-type')).toBe('container')
    expect(wrapper.children.length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════
//  wrapAndInsert — flex-row 부모에서 cross-axis (column)
// ═══════════════════════════════════════════════════════════════
describe('wrapAndInsert — flex-row 부모 cross-axis', () => {
  let store

  beforeEach(async () => {
    store = await setupStore(`
      <div data-editor-id="fe-1" data-editor-type="container" style="display:flex;flex-direction:row;">
        <div data-editor-id="fe-2" data-editor-type="container">박스A</div>
        <div data-editor-id="fe-3" data-editor-type="container">박스B</div>
      </div>
    `)()
  })

  it('flex-row 부모의 cross-axis 래퍼는 flex-direction:column이다', () => {
    store.getState().wrapAndInsert('fe-2', 'after', 'p', { textContent: '아래쪽' })

    const doc = store.getState().iframeRef.current.contentDocument
    const wrapper = doc.querySelector('[data-editor-id="fe-2"]').parentElement
    expect(wrapper.style.flexDirection).toBe('column')
  })
})
