import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedTranscript, setCachedTranscript, clearTranscriptCache } from '../core/transcriptCache'

describe('transcriptCache', () => {
  beforeEach(() => { localStorage.clear() })

  it('없는 키는 null', () => {
    expect(getCachedTranscript('nope')).toBeNull()
    expect(getCachedTranscript('')).toBeNull()
  })

  it('저장 후 조회', () => {
    const t = { text: '안녕', words: [{ word: '안녕', start: 0, end: 0.5 }] }
    setCachedTranscript('blob-1', t)
    expect(getCachedTranscript('blob-1')).toEqual(t)
  })

  it('다른 키는 서로 영향 없음', () => {
    setCachedTranscript('a', { text: 'A', words: [] })
    setCachedTranscript('b', { text: 'B', words: [] })
    expect(getCachedTranscript('a').text).toBe('A')
    expect(getCachedTranscript('b').text).toBe('B')
  })

  it('clearTranscriptCache로 전체 삭제', () => {
    setCachedTranscript('a', { text: 'A', words: [] })
    clearTranscriptCache()
    expect(getCachedTranscript('a')).toBeNull()
  })

  it('MAX_ENTRIES 초과 시 가장 오래된 항목부터 정리', () => {
    for (let i = 0; i < 205; i++) setCachedTranscript(`k${i}`, { text: String(i), words: [] })
    expect(getCachedTranscript('k0')).toBeNull()       // 가장 오래된 항목은 정리됨
    expect(getCachedTranscript('k204')).not.toBeNull() // 최근 항목은 유지
  })

  it('blobKey 없으면 저장하지 않음', () => {
    setCachedTranscript('', { text: 'x', words: [] })
    setCachedTranscript(null, { text: 'x', words: [] })
    expect(localStorage.getItem('stt-transcript-cache-v1')).toBeNull()
  })
})
