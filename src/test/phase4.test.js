import { describe, it, expect, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════
//  editorStore — previewAttribute
// ═══════════════════════════════════════════════════════════════
describe('editorStore — previewAttribute 실시간 미리보기', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <img data-editor-id="fe-1" data-editor-type="image" src="old.png" alt="원래 설명" />
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([['fe-1', { id: 'fe-1', tag: 'img', type: 'image' }]]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('previewAttribute가 iframe DOM 속성을 즉시 업데이트한다', () => {
    store.getState().previewAttribute('fe-1', 'src', 'preview.png')
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('preview.png')
  })

  it('previewAttribute는 히스토리에 기록하지 않는다', () => {
    store.getState().previewAttribute('fe-1', 'src', 'preview.png')
    expect(store.getState().canUndo).toBe(false)
  })

  it('previewAttribute 후 applyAttribute는 원래 값 기준으로 oldValue를 기록한다', () => {
    store.getState().previewAttribute('fe-1', 'src', 'preview.png')
    store.getState().applyAttribute('fe-1', 'src', 'final.png')
    store.getState().undo()
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('old.png')
  })

  it('동일 값으로 applyAttribute해도 히스토리에 기록되지 않는다', () => {
    store.getState().applyAttribute('fe-1', 'src', 'old.png')
    expect(store.getState().canUndo).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  editorStore — 이미지 교체 워크플로
// ═══════════════════════════════════════════════════════════════
describe('editorStore — 이미지 교체 워크플로', () => {
  let store

  beforeEach(async () => {
    const mod = await import('../store/editorStore')
    store = mod.useEditorStore

    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<html><body>
      <img data-editor-id="fe-1" data-editor-type="image" src="photo.png" alt="사진" />
      <img data-editor-id="fe-2" data-editor-type="image" src="logo.svg" alt="로고" />
    </body></html>`)
    doc.close()

    store.setState({
      slideHtml: '<html></html>',
      elements: new Map([
        ['fe-1', { id: 'fe-1', tag: 'img', type: 'image' }],
        ['fe-2', { id: 'fe-2', tag: 'img', type: 'image' }],
      ]),
      selectedId: 'fe-1',
      iframeRef: { current: iframe },
      mode: 'edit',
    })
    store.getState().clearHistory()
  })

  it('src 교체 → undo → 원래 src 복원', () => {
    store.getState().applyAttribute('fe-1', 'src', 'new-photo.jpg')
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('new-photo.jpg')
    store.getState().undo()
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('photo.png')
  })

  it('alt 텍스트 교체 → undo → 원래 alt 복원', () => {
    store.getState().applyAttribute('fe-1', 'alt', '새 설명')
    expect(store.getState().readAttribute('fe-1', 'alt')).toBe('새 설명')
    store.getState().undo()
    expect(store.getState().readAttribute('fe-1', 'alt')).toBe('사진')
  })

  it('src + alt 동시 교체 → undo 2번으로 모두 복원', () => {
    store.getState().applyAttribute('fe-1', 'src', 'replaced.webp')
    store.getState().applyAttribute('fe-1', 'alt', '교체된 이미지')
    store.getState().undo()
    store.getState().undo()
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('photo.png')
    expect(store.getState().readAttribute('fe-1', 'alt')).toBe('사진')
  })

  it('여러 이미지를 독립적으로 교체하고 undo할 수 있다', () => {
    store.getState().applyAttribute('fe-1', 'src', 'a.png')
    store.getState().applyAttribute('fe-2', 'src', 'b.png')
    store.getState().undo() // fe-2 복원
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('a.png')
    expect(store.getState().readAttribute('fe-2', 'src')).toBe('logo.svg')
  })

  it('data URL 형태의 이미지도 교체 가능하다', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    store.getState().applyAttribute('fe-1', 'src', dataUrl)
    expect(store.getState().readAttribute('fe-1', 'src')).toBe(dataUrl)
    store.getState().undo()
    expect(store.getState().readAttribute('fe-1', 'src')).toBe('photo.png')
  })
})
