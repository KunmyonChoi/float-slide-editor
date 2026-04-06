import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FlexResizeHandle, HANDLE_CLASS } from '../core/FlexResizeHandle'

describe('FlexResizeHandle', () => {
  let frh, container

  beforeEach(() => {
    frh = new FlexResizeHandle()

    container = document.createElement('div')
    container.setAttribute('data-editor-id', 'c1')
    container.setAttribute('data-editor-type', 'container')
    container.style.display = 'flex'
    container.style.flexDirection = 'row'

    const makeEl = (id) => {
      const el = document.createElement('div')
      el.setAttribute('data-editor-id', id)
      el.setAttribute('data-editor-type', 'container')
      el.style.flex = '1'
      el.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100 })
      return el
    }

    container.append(makeEl('a1'), makeEl('a2'), makeEl('a3'))
    container.getBoundingClientRect = () => ({ width: 600, height: 100 })
    document.body.appendChild(container)
  })

  afterEach(() => {
    frh.clear(document)
    document.body.removeChild(container)
  })

  const noop = { previewStyle: () => {}, applyStyle: () => {} }

  it('flex 컨테이너의 자식 사이에 핸들을 생성한다', () => {
    frh.update(document, 'a1', noop)
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    // 3개 자식 사이 2개 핸들
    expect(handles.length).toBe(2)
  })

  it('flex-row 부모에서 col-resize 핸들이 생성된다', () => {
    frh.update(document, 'a1', noop)
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    expect(handles[0].classList.contains('--h')).toBe(true)
  })

  it('clear()가 모든 핸들을 제거한다', () => {
    frh.update(document, 'a1', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(2)
    frh.clear(document)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('자식이 1개인 경우 핸들을 생성하지 않는다', () => {
    // a2, a3 제거
    container.children[2].remove()
    container.children[1].remove()
    frh.update(document, 'a1', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('flex가 아닌 컨테이너에서는 핸들을 생성하지 않는다', () => {
    container.style.display = 'block'
    frh.update(document, 'a1', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('update() 재호출 시 이전 핸들이 정리된다', () => {
    frh.update(document, 'a1', noop)
    frh.update(document, 'a2', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(2)
  })
})

describe('FlexResizeHandle — flex-column', () => {
  let frh, container

  beforeEach(() => {
    frh = new FlexResizeHandle()

    container = document.createElement('div')
    container.setAttribute('data-editor-id', 'c1')
    container.setAttribute('data-editor-type', 'container')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'

    const makeEl = (id) => {
      const el = document.createElement('div')
      el.setAttribute('data-editor-id', id)
      el.setAttribute('data-editor-type', 'text')
      el.style.flex = '1'
      el.getBoundingClientRect = () => ({ top: 0, bottom: 50, left: 0, right: 400, width: 400, height: 50 })
      return el
    }

    container.append(makeEl('b1'), makeEl('b2'))
    container.getBoundingClientRect = () => ({ width: 400, height: 100 })
    document.body.appendChild(container)
  })

  afterEach(() => {
    frh.clear(document)
    document.body.removeChild(container)
  })

  it('flex-column 부모에서 row-resize 핸들이 생성된다', () => {
    frh.update(document, 'b1', { previewStyle: () => {}, applyStyle: () => {} })
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    expect(handles.length).toBe(1)
    expect(handles[0].classList.contains('--v')).toBe(true)
  })
})
