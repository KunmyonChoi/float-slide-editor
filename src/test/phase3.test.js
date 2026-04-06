import { describe, it, expect, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════
//  editorStore — readText / readStyle / readAttribute
// ═══════════════════════════════════════════════════════════════
describe('editorStore — DOM 읽기 헬퍼', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <h1 data-editor-id="fe-1" data-editor-type="text" style="color: red; font-size: 24px;">제목 텍스트</h1>
      <p data-editor-id="fe-2" data-editor-type="text" style="font-weight: bold;">본문 단락</p>
      <img data-editor-id="fe-3" data-editor-type="image" src="photo.png" alt="사진" />
      <div data-editor-id="fe-4" data-editor-type="container"><span>내부</span></div>
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([
        ['fe-1', { id: 'fe-1', tag: 'h1', type: 'text' }],
        ['fe-2', { id: 'fe-2', tag: 'p', type: 'text' }],
        ['fe-3', { id: 'fe-3', tag: 'img', type: 'image' }],
        ['fe-4', { id: 'fe-4', tag: 'div', type: 'container' }],
      ]),
      selectedId: null,
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('readText(id)가 요소의 textContent를 반환한다', () => {
    expect(store.getState().readText('fe-1')).toBe('제목 텍스트')
    expect(store.getState().readText('fe-2')).toBe('본문 단락')
  })

  it('readText — 존재하지 않는 id에 대해 빈 문자열을 반환한다', () => {
    expect(store.getState().readText('fe-999')).toBe('')
  })

  it('readStyle(id, prop)이 요소의 인라인 스타일 값을 반환한다', () => {
    expect(store.getState().readStyle('fe-1', 'color')).toBe('red')
    expect(store.getState().readStyle('fe-2', 'fontWeight')).toBe('bold')
  })

  it('readStyle — 존재하지 않는 스타일에 대해 빈 문자열을 반환한다', () => {
    expect(store.getState().readStyle('fe-1', 'margin')).toBe('')
  })

  it('readAttribute(id, attr)가 요소의 속성 값을 반환한다', () => {
    expect(store.getState().readAttribute('fe-3', 'src')).toBe('photo.png')
    expect(store.getState().readAttribute('fe-3', 'alt')).toBe('사진')
  })

  it('readAttribute — 존재하지 않는 속성에 대해 빈 문자열을 반환한다', () => {
    expect(store.getState().readAttribute('fe-1', 'data-foo')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════
//  editorStore — 텍스트 편집 + Undo/Redo 통합
// ═══════════════════════════════════════════════════════════════
describe('editorStore — 텍스트 편집 워크플로', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <h1 data-editor-id="fe-1" data-editor-type="text">원래 제목</h1>
      <p data-editor-id="fe-2" data-editor-type="text">원래 본문</p>
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([
        ['fe-1', { id: 'fe-1', tag: 'h1', type: 'text' }],
        ['fe-2', { id: 'fe-2', tag: 'p', type: 'text' }],
      ]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('readText → applyText → readText 순환이 정확하다', () => {
    expect(store.getState().readText('fe-1')).toBe('원래 제목')
    store.getState().applyText('fe-1', '새 제목')
    expect(store.getState().readText('fe-1')).toBe('새 제목')
  })

  it('applyText → undo → readText가 원래 값을 반환한다', () => {
    store.getState().applyText('fe-1', '변경된 제목')
    store.getState().undo()
    expect(store.getState().readText('fe-1')).toBe('원래 제목')
  })

  it('applyText → undo → redo → readText가 변경 값을 반환한다', () => {
    store.getState().applyText('fe-1', '변경된 제목')
    store.getState().undo()
    store.getState().redo()
    expect(store.getState().readText('fe-1')).toBe('변경된 제목')
  })

  it('여러 요소를 독립적으로 편집하고 undo할 수 있다', () => {
    store.getState().applyText('fe-1', '제목 수정')
    store.getState().applyText('fe-2', '본문 수정')
    store.getState().undo() // 본문 수정 취소
    expect(store.getState().readText('fe-1')).toBe('제목 수정')
    expect(store.getState().readText('fe-2')).toBe('원래 본문')
  })

  it('같은 값으로 applyText해도 히스토리에 기록되지 않는다', () => {
    store.getState().applyText('fe-1', '원래 제목') // 동일 값
    expect(store.getState().canUndo).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  editorStore — previewText (실시간 미리보기)
// ═══════════════════════════════════════════════════════════════
describe('editorStore — previewText 실시간 미리보기', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <h1 data-editor-id="fe-1" data-editor-type="text">원래 텍스트</h1>
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([['fe-1', { id: 'fe-1', tag: 'h1', type: 'text' }]]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('previewText가 iframe DOM을 즉시 업데이트한다', () => {
    store.getState().previewText('fe-1', '미리보기 중')
    expect(store.getState().readText('fe-1')).toBe('미리보기 중')
  })

  it('previewText는 히스토리에 기록하지 않는다', () => {
    store.getState().previewText('fe-1', '미리보기 중')
    expect(store.getState().canUndo).toBe(false)
  })

  it('previewText 후 applyText는 원래 값 기준으로 oldValue를 기록한다', () => {
    store.getState().previewText('fe-1', '미리보기 중')
    store.getState().applyText('fe-1', '최종 값')
    store.getState().undo()
    expect(store.getState().readText('fe-1')).toBe('원래 텍스트')
  })
})
