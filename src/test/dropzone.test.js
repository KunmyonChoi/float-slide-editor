import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DropZoneManager, INDICATOR_ID_CONST } from '../core/DropZoneManager'

// ═══════════════════════════════════════════════════════════════
//  DropZoneManager — calcPosition (순수 위치 계산)
// ═══════════════════════════════════════════════════════════════
describe('DropZoneManager — calcPosition', () => {
  let dzm, container

  beforeEach(() => {
    dzm = new DropZoneManager()
    container = document.createElement('div')
    container.setAttribute('data-editor-id', 'c1')
    container.setAttribute('data-editor-type', 'container')

    const makeEl = (id, tag) => {
      const el = document.createElement(tag)
      el.setAttribute('data-editor-id', id)
      el.setAttribute('data-editor-type', tag === 'div' ? 'container' : 'text')
      // jsdom에서 getBoundingClientRect mock
      return el
    }

    const t1 = makeEl('t1', 'p')
    const t2 = makeEl('t2', 'p')
    const t3 = makeEl('t3', 'p')
    container.append(t1, t2, t3)
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  function mockRect(el, top, height) {
    el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, width: 400, height })
  }

  it('요소 상단 30% → before 반환', () => {
    const t2 = container.querySelector('[data-editor-id="t2"]')
    mockRect(t2, 100, 60)
    const result = dzm.calcPosition(t2, 110) // relY = 10/60 = 0.17
    expect(result.position).toBe('before')
    expect(result.parentId).toBe('c1')
    expect(result.index).toBe(1) // t2는 c1의 index 1
  })

  it('요소 하단 30% → after 반환', () => {
    const t2 = container.querySelector('[data-editor-id="t2"]')
    mockRect(t2, 100, 60)
    const result = dzm.calcPosition(t2, 155) // relY = 55/60 = 0.92
    expect(result.position).toBe('after')
    expect(result.index).toBe(2)
  })

  it('비컨테이너 요소 중앙 → after 반환', () => {
    const t2 = container.querySelector('[data-editor-id="t2"]')
    mockRect(t2, 100, 60)
    const result = dzm.calcPosition(t2, 130) // relY = 30/60 = 0.5
    expect(result.position).toBe('after')
  })

  it('컨테이너 요소 중앙 → inside 반환', () => {
    mockRect(container, 0, 300)
    const result = dzm.calcPosition(container, 150) // relY = 0.5
    expect(result.position).toBe('inside')
    expect(result.parentId).toBe('c1')
  })

  it('컨테이너 상단 30% → before 반환', () => {
    mockRect(container, 0, 300)
    const result = dzm.calcPosition(container, 50) // relY = 50/300 = 0.17
    expect(result.position).toBe('before')
  })

  it('컨테이너 하단 30% → after 반환', () => {
    mockRect(container, 0, 300)
    const result = dzm.calcPosition(container, 250) // relY = 250/300 = 0.83
    expect(result.position).toBe('after')
  })

  it('첫 번째 요소 before → index가 0', () => {
    const t1 = container.querySelector('[data-editor-id="t1"]')
    mockRect(t1, 0, 60)
    const result = dzm.calcPosition(t1, 5)
    expect(result.index).toBe(0)
  })

  it('마지막 요소 after → index가 children.length', () => {
    const t3 = container.querySelector('[data-editor-id="t3"]')
    mockRect(t3, 200, 60)
    const result = dzm.calcPosition(t3, 255)
    expect(result.position).toBe('after')
    expect(result.index).toBe(3)
  })

  it('inside 결과의 index가 자식 수와 같다', () => {
    mockRect(container, 0, 300)
    const result = dzm.calcPosition(container, 150)
    expect(result.index).toBe(container.children.length)
  })
})

// ═══════════════════════════════════════════════════════════════
//  DropZoneManager — 인디케이터
// ═══════════════════════════════════════════════════════════════
describe('DropZoneManager — 인디케이터', () => {
  let dzm

  beforeEach(() => { dzm = new DropZoneManager() })

  function makeTarget(top, height) {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, width: 400, height })
    document.body.appendChild(el)
    return el
  }

  it('showIndicator가 인디케이터 요소를 DOM에 추가한다', () => {
    const el = makeTarget(100, 60)
    dzm.showIndicator(document, { position: 'before', targetEl: el })
    expect(document.getElementById(INDICATOR_ID_CONST)).not.toBeNull()
    dzm.hideIndicator(document)
    el.remove()
  })

  it('hideIndicator가 인디케이터를 제거한다', () => {
    const el = makeTarget(0, 60)
    dzm.showIndicator(document, { position: 'after', targetEl: el })
    dzm.hideIndicator(document)
    expect(document.getElementById(INDICATOR_ID_CONST)).toBeNull()
    el.remove()
  })

  it('inside 위치에서 인디케이터가 dashed 테두리를 가진다', () => {
    const el = makeTarget(50, 200)
    dzm.showIndicator(document, { position: 'inside', targetEl: el })
    const indicator = document.getElementById(INDICATOR_ID_CONST)
    expect(indicator.style.height).toBe('200px')
    expect(indicator.style.border).toContain('dashed')
    dzm.hideIndicator(document)
    el.remove()
  })

  it('showIndicator(doc, null) → 인디케이터 제거', () => {
    const el = makeTarget(0, 60)
    dzm.showIndicator(document, { position: 'before', targetEl: el })
    dzm.showIndicator(document, null)
    expect(document.getElementById(INDICATOR_ID_CONST)).toBeNull()
    el.remove()
  })

  it('lastResult가 마지막 hitResult를 보존한다', () => {
    const el = makeTarget(0, 60)
    const result = { position: 'after', targetEl: el }
    dzm.showIndicator(document, result)
    expect(dzm.lastResult).toBe(result)
    dzm.hideIndicator(document)
    expect(dzm.lastResult).toBeNull()
    el.remove()
  })
})

// ═══════════════════════════════════════════════════════════════
//  DropZoneManager — mapCoords
// ═══════════════════════════════════════════════════════════════
describe('DropZoneManager — mapCoords', () => {
  let dzm
  beforeEach(() => { dzm = new DropZoneManager() })

  it('scale=1 → 좌표 그대로', () => {
    const iframe = { getBoundingClientRect: () => ({ left: 100, top: 50 }) }
    const result = dzm.mapCoords({ clientX: 250, clientY: 150 }, iframe, 1)
    expect(result.x).toBe(150)
    expect(result.y).toBe(100)
  })

  it('scale=0.5 → 좌표 2배', () => {
    const iframe = { getBoundingClientRect: () => ({ left: 100, top: 50 }) }
    const result = dzm.mapCoords({ clientX: 200, clientY: 100 }, iframe, 0.5)
    expect(result.x).toBe(200)
    expect(result.y).toBe(100)
  })

  it('scale=2 → 좌표 0.5배', () => {
    const iframe = { getBoundingClientRect: () => ({ left: 0, top: 0 }) }
    const result = dzm.mapCoords({ clientX: 100, clientY: 200 }, iframe, 2)
    expect(result.x).toBe(50)
    expect(result.y).toBe(100)
  })
})
