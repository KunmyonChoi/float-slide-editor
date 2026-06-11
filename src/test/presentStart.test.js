import { describe, it, expect, afterEach } from 'vitest'
import { useEditorStore } from '../store/editorStore'

afterEach(() => useEditorStore.getState().exitPresentation())

describe('enterPresentation startIndex (F5 vs Shift+F5)', () => {
  it('인자 없으면 0 (F5: 처음부터)', () => {
    useEditorStore.getState().enterPresentation()
    expect(useEditorStore.getState().presentStartIndex).toBe(0)
    expect(useEditorStore.getState().mode).toBe('present')
  })

  it('startIndex 전달 시 반영 (Shift+F5: 현재부터)', () => {
    useEditorStore.getState().enterPresentation({ startIndex: 3 })
    expect(useEditorStore.getState().presentStartIndex).toBe(3)
  })
})
