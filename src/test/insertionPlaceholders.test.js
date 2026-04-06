import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InsertionPlaceholders, PLACEHOLDER_CLASS } from '../core/InsertionPlaceholders'

describe('InsertionPlaceholders', () => {
  let ipm, container

  beforeEach(() => {
    ipm = new InsertionPlaceholders()

    container = document.createElement('div')
    container.setAttribute('data-editor-id', 'c1')
    container.setAttribute('data-editor-type', 'container')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'

    const makeEl = (id, tag, type) => {
      const el = document.createElement(tag)
      el.setAttribute('data-editor-id', id)
      el.setAttribute('data-editor-type', type || 'text')
      el.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 400, width: 400, height: 60 })
      return el
    }

    container.append(makeEl('t1', 'p'), makeEl('t2', 'p'), makeEl('t3', 'p'))
    document.body.appendChild(container)
  })

  afterEach(() => {
    ipm.clear(document)
    document.body.removeChild(container)
  })

  it('선택된 요소 주변 4방향에 플레이스홀더를 생성한다', () => {
    ipm.update(document, 't2')
    const phs = document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)
    // flow before + flow after + cross before + cross after = 4
    expect(phs.length).toBe(4)
  })

  it('flow 방향 플레이스홀더에 올바른 data-insert-parent와 index가 설정된다', () => {
    ipm.update(document, 't2')
    const flowPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'flow'
    )
    expect(flowPhs.length).toBe(2)
    const beforePh = flowPhs.find(p => p.getAttribute('data-insert-index') === '1')
    const afterPh = flowPhs.find(p => p.getAttribute('data-insert-index') === '2')
    expect(beforePh).not.toBeNull()
    expect(afterPh).not.toBeNull()
    expect(beforePh.getAttribute('data-insert-parent')).toBe('c1')
  })

  it('cross-axis 플레이스홀더에 wrap 정보가 설정된다', () => {
    ipm.update(document, 't2')
    const crossPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'cross'
    )
    expect(crossPhs.length).toBe(2)
    crossPhs.forEach(ph => {
      expect(ph.getAttribute('data-wrap-target')).toBe('t2')
      expect(['before', 'after']).toContain(ph.getAttribute('data-wrap-side'))
    })
  })

  it('cross-axis 플레이스홀더에 --cross 클래스가 적용된다', () => {
    ipm.update(document, 't2')
    const crossPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.classList.contains('--cross')
    )
    expect(crossPhs.length).toBe(2)
  })

  it('첫 번째 요소 선택 시 flow before index가 0이다', () => {
    ipm.update(document, 't1')
    const flowPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'flow'
    )
    const beforePh = flowPhs.find(p => p.getAttribute('data-insert-index') === '0')
    expect(beforePh).not.toBeNull()
  })

  it('마지막 요소 선택 시 flow after index가 children count이다', () => {
    ipm.update(document, 't3')
    const flowPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'flow'
    )
    const afterPh = flowPhs.find(p => p.getAttribute('data-insert-index') === '3')
    expect(afterPh).not.toBeNull()
  })

  it('clear()가 모든 플레이스홀더를 제거한다', () => {
    ipm.update(document, 't2')
    expect(document.querySelectorAll(`.${PLACEHOLDER_CLASS}`).length).toBeGreaterThan(0)
    ipm.clear(document)
    expect(document.querySelectorAll(`.${PLACEHOLDER_CLASS}`).length).toBe(0)
  })

  it('update() 재호출 시 이전 플레이스홀더가 정리된다', () => {
    ipm.update(document, 't1')
    ipm.update(document, 't3')
    const phs = document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)
    // t3 주변 4방향 = 4
    expect(phs.length).toBe(4)
  })

  it('존재하지 않는 ID에 대해 플레이스홀더를 생성하지 않는다', () => {
    ipm.update(document, 'nonexistent')
    expect(document.querySelectorAll(`.${PLACEHOLDER_CLASS}`).length).toBe(0)
  })

  it('selectedId가 null이면 플레이스홀더를 생성하지 않는다', () => {
    ipm.update(document, null)
    expect(document.querySelectorAll(`.${PLACEHOLDER_CLASS}`).length).toBe(0)
  })

  it('컨테이너 요소 선택 시 inside 플레이스홀더도 생성된다', () => {
    container.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 400, width: 400, height: 200 })

    ipm.update(document, 'c1')
    const phs = document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)
    // flow 2 + cross 2 + inside 1 = 5
    expect(phs.length).toBe(5)

    const insidePh = [...phs].find(p =>
      p.getAttribute('data-insert-parent') === 'c1' && p.getAttribute('data-insert-axis') === 'flow'
    )
    expect(insidePh).not.toBeNull()
  })
})

describe('InsertionPlaceholders — 수평 레이아웃 감지', () => {
  let ipm, container

  beforeEach(() => {
    ipm = new InsertionPlaceholders()

    container = document.createElement('div')
    container.setAttribute('data-editor-id', 'row1')
    container.setAttribute('data-editor-type', 'container')
    container.style.display = 'flex'
    container.style.flexDirection = 'row'

    const makeEl = (id) => {
      const el = document.createElement('div')
      el.setAttribute('data-editor-id', id)
      el.setAttribute('data-editor-type', 'container')
      el.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 50, right: 150, width: 100, height: 100 })
      return el
    }

    container.append(makeEl('col1'), makeEl('col2'))
    document.body.appendChild(container)
  })

  afterEach(() => {
    ipm.clear(document)
    document.body.removeChild(container)
  })

  it('flex-row 부모의 컨테이너 요소에 5개 플레이스홀더 생성 (flow 2 + cross 2 + inside 1)', () => {
    // col1은 container이므로 inside 포함
    container.children[0].getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 50, right: 150, width: 100, height: 100 })
    ipm.update(document, 'col1')
    const phs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)]

    // flow 2 (before/after) + inside 1 = 3, cross 2 = total 5
    const flowPhs = phs.filter(p => p.getAttribute('data-insert-axis') === 'flow')
    const crossPhs = phs.filter(p => p.getAttribute('data-insert-axis') === 'cross')
    expect(flowPhs.length).toBe(3) // before + after + inside
    expect(crossPhs.length).toBe(2)
    expect(phs.length).toBe(5)
  })

  it('cross-axis에 wrap 정보가 올바르게 설정된다', () => {
    ipm.update(document, 'col1')
    const crossPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'cross'
    )
    expect(crossPhs[0].getAttribute('data-wrap-target')).toBe('col1')
  })

  it('cross-axis 플레이스홀더에 wrap 정보가 올바르게 설정된다', () => {
    ipm.update(document, 'col1')
    const crossPhs = [...document.querySelectorAll(`.${PLACEHOLDER_CLASS}`)].filter(
      p => p.getAttribute('data-insert-axis') === 'cross'
    )
    expect(crossPhs.length).toBe(2)
    expect(crossPhs[0].getAttribute('data-wrap-target')).toBe('col1')
  })
})
