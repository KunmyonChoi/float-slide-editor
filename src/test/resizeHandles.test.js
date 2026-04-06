import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ResizeHandles, HANDLE_CLASS } from '../core/ResizeHandles'

describe('ResizeHandles', () => {
  let rsh, el

  beforeEach(() => {
    rsh = new ResizeHandles()

    el = document.createElement('div')
    el.setAttribute('data-editor-id', 'r1')
    el.setAttribute('data-editor-type', 'container')
    el.style.width = '200px'
    el.style.height = '150px'
    el.getBoundingClientRect = () => ({
      top: 50, bottom: 200, left: 100, right: 300,
      width: 200, height: 150,
    })
    document.body.appendChild(el)

    // jsdom에서 scrollY, getComputedStyle 모의
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true })
  })

  afterEach(() => {
    rsh.clear(document)
    el.remove()
  })

  const noop = { previewStyle: () => {}, applyStyle: () => {} }

  it('선택 요소 주변에 8개 핸들을 생성한다', () => {
    rsh.update(document, 'r1', noop)
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    expect(handles.length).toBe(8)
  })

  it('각 핸들에 올바른 data-resize-dir 속성이 있다', () => {
    rsh.update(document, 'r1', noop)
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    const dirs = [...handles].map(h => h.getAttribute('data-resize-dir')).sort()
    expect(dirs).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
  })

  it('각 핸들에 올바른 cursor가 설정된다', () => {
    rsh.update(document, 'r1', noop)
    const handles = document.querySelectorAll(`.${HANDLE_CLASS}`)
    const cursorMap = {}
    handles.forEach(h => {
      cursorMap[h.getAttribute('data-resize-dir')] = h.style.cursor
    })
    expect(cursorMap.nw).toBe('nwse-resize')
    expect(cursorMap.n).toBe('ns-resize')
    expect(cursorMap.ne).toBe('nesw-resize')
    expect(cursorMap.e).toBe('ew-resize')
    expect(cursorMap.se).toBe('nwse-resize')
    expect(cursorMap.s).toBe('ns-resize')
    expect(cursorMap.sw).toBe('nesw-resize')
    expect(cursorMap.w).toBe('ew-resize')
  })

  it('clear()가 모든 핸들을 제거한다', () => {
    rsh.update(document, 'r1', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(8)
    rsh.clear(document)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('update() 재호출 시 이전 핸들이 정리된다', () => {
    rsh.update(document, 'r1', noop)
    rsh.update(document, 'r1', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(8)
  })

  it('존재하지 않는 요소에 대해 핸들을 생성하지 않는다', () => {
    rsh.update(document, 'nonexistent', noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('selectedId가 없으면 핸들을 생성하지 않는다', () => {
    rsh.update(document, null, noop)
    expect(document.querySelectorAll(`.${HANDLE_CLASS}`).length).toBe(0)
  })

  it('핸들 스타일이 주입된다', () => {
    rsh.update(document, 'r1', noop)
    const style = document.getElementById('__fe-resize-handle-style')
    expect(style).not.toBeNull()
    expect(style.textContent).toContain(HANDLE_CLASS)
  })
})
