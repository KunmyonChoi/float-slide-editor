import { describe, it, expect, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════
//  editorStore — previewStyle
// ═══════════════════════════════════════════════════════════════
describe('editorStore — previewStyle 실시간 미리보기', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <h1 data-editor-id="fe-1" data-editor-type="text"
          style="color: red; font-size: 24px; background-color: white; padding: 10px; border-radius: 4px;">
        제목
      </h1>
      <div data-editor-id="fe-2" data-editor-type="container"
           style="margin: 20px; background: #f0f0f0;">
        컨테이너
      </div>
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([
        ['fe-1', { id: 'fe-1', tag: 'h1', type: 'text' }],
        ['fe-2', { id: 'fe-2', tag: 'div', type: 'container' }],
      ]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('previewStyle이 iframe DOM 스타일을 즉시 업데이트한다', () => {
    store.getState().previewStyle('fe-1', 'color', 'blue')
    expect(store.getState().readStyle('fe-1', 'color')).toBe('blue')
  })

  it('previewStyle은 히스토리에 기록하지 않는다', () => {
    store.getState().previewStyle('fe-1', 'color', 'blue')
    expect(store.getState().canUndo).toBe(false)
  })

  it('previewStyle 후 applyStyle은 원래 값 기준으로 oldValue를 기록한다', () => {
    store.getState().previewStyle('fe-1', 'color', 'green')
    store.getState().applyStyle('fe-1', 'color', 'blue')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'color')).toBe('red')
  })

  it('동일 값으로 applyStyle해도 히스토리에 기록되지 않는다', () => {
    store.getState().applyStyle('fe-1', 'color', 'red')
    expect(store.getState().canUndo).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  editorStore — 스타일 편집 워크플로
// ═══════════════════════════════════════════════════════════════
describe('editorStore — 스타일 편집 워크플로', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <p data-editor-id="fe-1" data-editor-type="text"
         style="color: black; font-size: 16px; font-weight: normal; text-align: left; padding: 0px; border-radius: 0px; background-color: transparent;">
        텍스트
      </p>
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([['fe-1', { id: 'fe-1', tag: 'p', type: 'text' }]]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('color 변경 → undo → 원래 color 복원', () => {
    store.getState().applyStyle('fe-1', 'color', 'blue')
    expect(store.getState().readStyle('fe-1', 'color')).toBe('blue')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'color')).toBe('black')
  })

  it('fontSize 변경 → undo → 원래 fontSize 복원', () => {
    store.getState().applyStyle('fe-1', 'fontSize', '24px')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'fontSize')).toBe('16px')
  })

  it('fontWeight 변경 → undo → 원래 fontWeight 복원', () => {
    store.getState().applyStyle('fe-1', 'fontWeight', 'bold')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'fontWeight')).toBe('normal')
  })

  it('textAlign 변경 후 redo가 정상 동작한다', () => {
    store.getState().applyStyle('fe-1', 'textAlign', 'center')
    store.getState().undo()
    store.getState().redo()
    expect(store.getState().readStyle('fe-1', 'textAlign')).toBe('center')
  })

  it('여러 속성을 연속 변경하고 순서대로 undo할 수 있다', () => {
    store.getState().applyStyle('fe-1', 'color', 'red')
    store.getState().applyStyle('fe-1', 'fontSize', '32px')
    store.getState().applyStyle('fe-1', 'fontWeight', 'bold')

    store.getState().undo() // fontWeight
    store.getState().undo() // fontSize
    expect(store.getState().readStyle('fe-1', 'color')).toBe('red')
    expect(store.getState().readStyle('fe-1', 'fontSize')).toBe('16px')
    expect(store.getState().readStyle('fe-1', 'fontWeight')).toBe('normal')
  })

  it('padding 변경 → undo', () => {
    store.getState().applyStyle('fe-1', 'padding', '20px')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'padding')).toBe('0px')
  })

  it('borderRadius 변경 → undo', () => {
    store.getState().applyStyle('fe-1', 'borderRadius', '12px')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'borderRadius')).toBe('0px')
  })

  it('backgroundColor 변경 → undo', () => {
    store.getState().applyStyle('fe-1', 'backgroundColor', '#ff0000')
    store.getState().undo()
    expect(store.getState().readStyle('fe-1', 'backgroundColor')).toBe('transparent')
  })
})

// ═══════════════════════════════════════════════════════════════
//  STYLE_SECTIONS 구조 검증
// ═══════════════════════════════════════════════════════════════
describe('STYLE_SECTIONS — 스타일 섹션 정의', () => {
  let STYLE_SECTIONS

  beforeEach(async () => {
    ;({ STYLE_SECTIONS } = await import('../components/StyleEditor'))
  })

  it('섹션이 하나 이상 정의되어 있다', () => {
    expect(STYLE_SECTIONS.length).toBeGreaterThan(0)
  })

  it('각 섹션에 label과 props 배열이 있다', () => {
    for (const section of STYLE_SECTIONS) {
      expect(section).toHaveProperty('label')
      expect(section).toHaveProperty('props')
      expect(Array.isArray(section.props)).toBe(true)
    }
  })

  it('각 prop에 key, label, type 필드가 있다', () => {
    for (const section of STYLE_SECTIONS) {
      for (const prop of section.props) {
        expect(prop).toHaveProperty('key')
        expect(prop).toHaveProperty('label')
        expect(prop).toHaveProperty('type')
      }
    }
  })

  it('color 타입 prop이 하나 이상 존재한다', () => {
    const colorProps = STYLE_SECTIONS.flatMap(s => s.props).filter(p => p.type === 'color')
    expect(colorProps.length).toBeGreaterThan(0)
  })

  it('text 타입 prop이 하나 이상 존재한다', () => {
    const textProps = STYLE_SECTIONS.flatMap(s => s.props).filter(p => p.type === 'text')
    expect(textProps.length).toBeGreaterThan(0)
  })

  it('select 타입 prop이 하나 이상 존재한다', () => {
    const selectProps = STYLE_SECTIONS.flatMap(s => s.props).filter(p => p.type === 'select')
    expect(selectProps.length).toBeGreaterThan(0)
  })

  it('모든 prop key가 고유하다', () => {
    const keys = STYLE_SECTIONS.flatMap(s => s.props).map(p => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
