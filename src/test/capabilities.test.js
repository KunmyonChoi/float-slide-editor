import { describe, it, expect, afterEach } from 'vitest'
import { fileSystemAccessSupported, clipboardReadSupported, storageSupported, formatBytes } from '../core/capabilities'

describe('capabilities — 감지/포맷', () => {
  const origPicker = Object.getOwnPropertyDescriptor(window, 'showOpenFilePicker')
  afterEach(() => {
    if (origPicker) Object.defineProperty(window, 'showOpenFilePicker', origPicker)
    else delete window.showOpenFilePicker
  })

  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('fileSystemAccessSupported: window.showOpenFilePicker 함수 여부', () => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: () => {}, configurable: true })
    expect(fileSystemAccessSupported()).toBe(true)
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    expect(fileSystemAccessSupported()).toBe(false)
  })

  it('clipboardReadSupported / storageSupported: navigator API 존재 여부(불리언 반환)', () => {
    expect(typeof clipboardReadSupported()).toBe('boolean')
    expect(typeof storageSupported()).toBe('boolean')
  })
})
