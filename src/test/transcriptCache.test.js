import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getCachedTranscript, setCachedTranscript, clearTranscriptCache, getOrFetchTranscript } from '../core/transcriptCache'

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

describe('getOrFetchTranscript', () => {
  beforeEach(() => { localStorage.clear() })

  it('캐시 히트면 fetchFn을 호출하지 않고 캐시값을 반환', async () => {
    setCachedTranscript('k1', { text: '캐시됨', words: [] })
    const fetchFn = vi.fn()
    const out = await getOrFetchTranscript('k1', fetchFn)
    expect(out.text).toBe('캐시됨')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('캐시 미스면 fetchFn을 호출하고 결과를 캐시에 저장', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ text: '새로 전사됨', words: [] })
    const out = await getOrFetchTranscript('k2', fetchFn)
    expect(out.text).toBe('새로 전사됨')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(getCachedTranscript('k2').text).toBe('새로 전사됨')
  })

  it('같은 키를 동시에 여러 번 요청해도 fetchFn은 한 번만 호출(in-flight 재사용)', async () => {
    let resolveFetch
    const fetchFn = vi.fn(() => new Promise(r => { resolveFetch = r }))

    const p1 = getOrFetchTranscript('k3', fetchFn)
    const p2 = getOrFetchTranscript('k3', fetchFn)
    const p3 = getOrFetchTranscript('k3', fetchFn)
    await Promise.resolve() // fetchFn 호출은 마이크로태스크 한 틱 뒤(내부 Promise.resolve().then(fetchFn))
    expect(fetchFn).toHaveBeenCalledTimes(1) // 동시 요청은 진행 중인 하나를 공유

    resolveFetch({ text: '동시 요청 결과', words: [] })
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.text).toBe('동시 요청 결과')
    expect(r2).toBe(r1) // 같은 객체(같은 Promise) 재사용
    expect(r3).toBe(r1)
  })

  it('fetchFn이 실패하면 in-flight 항목을 정리해 다음 호출은 재시도한다', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('일시 오류'))
      .mockResolvedValueOnce({ text: '재시도 성공', words: [] })

    await expect(getOrFetchTranscript('k4', fetchFn)).rejects.toThrow('일시 오류')
    const out = await getOrFetchTranscript('k4', fetchFn)
    expect(out.text).toBe('재시도 성공')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
