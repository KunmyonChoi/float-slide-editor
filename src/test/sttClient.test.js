import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { transcribeSpeech, STT_MODEL, MAX_FILE_BYTES } from '../core/SttClient'
import { setApiKey } from '../core/OpenAIClient'

function verboseJsonResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      task: 'transcribe',
      language: 'korean',
      duration: 2.4,
      text: '안녕하세요 반갑습니다',
      words: [
        { word: '안녕하세요', start: 0.0, end: 0.9 },
        { word: '반갑습니다', start: 1.0, end: 1.9 },
      ],
      ...overrides,
    }),
  }
}

describe('transcribeSpeech', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('키 없으면 호출 전 에러', async () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toThrow(/키/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('빈 오디오는 호출 전 에러', async () => {
    setApiKey('sk-test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(null)).rejects.toThrow(/음성 파일/)
    await expect(transcribeSpeech(new Blob([]))).rejects.toThrow(/음성 파일/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('25MB 초과 오디오는 호출 전 에러', async () => {
    setApiKey('sk-test')
    const big = { size: MAX_FILE_BYTES + 1, type: 'audio/mpeg' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(big)).rejects.toThrow(/25MB/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('성공: whisper-1 + verbose_json + word 타임스탬프 요청, 결과 파싱', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['audio-bytes'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue(verboseJsonResponse())
    vi.stubGlobal('fetch', fetchMock)

    const out = await transcribeSpeech(blob, { language: 'ko' })

    expect(out.text).toBe('안녕하세요 반갑습니다')
    expect(out.words).toEqual([
      { word: '안녕하세요', start: 0, end: 0.9 },
      { word: '반갑습니다', start: 1, end: 1.9 },
    ])
    expect(out.language).toBe('korean')
    expect(out.duration).toBe(2.4)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/audio/transcriptions')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
    expect(opts.headers['Content-Type']).toBeUndefined() // multipart: 브라우저가 boundary 포함해 설정
    const form = opts.body
    expect(form.get('model')).toBe(STT_MODEL)
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('timestamp_granularities[]')).toBe('word')
    expect(form.get('language')).toBe('ko')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('language 미지정 시 폼에 포함하지 않음', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/webm' })
    const fetchMock = vi.fn().mockResolvedValue(verboseJsonResponse())
    vi.stubGlobal('fetch', fetchMock)
    await transcribeSpeech(blob)
    const form = fetchMock.mock.calls[0][1].body
    expect(form.get('language')).toBeNull()
  })

  it('words가 없어도 text가 있으면 성공', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue(verboseJsonResponse({ words: undefined, text: '텍스트만' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await transcribeSpeech(blob)
    expect(out.text).toBe('텍스트만')
    expect(out.words).toEqual([])
  })

  it('text/words 모두 비어있으면 에러', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue(verboseJsonResponse({ words: [], text: '' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toThrow(/인식된 텍스트/)
  })

  it('빈 단어(공백 word)는 걸러낸다', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue(verboseJsonResponse({
      words: [{ word: '  ', start: 0, end: 0.1 }, { word: '유효', start: 0.1, end: 0.5 }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await transcribeSpeech(blob)
    expect(out.words).toEqual([{ word: '유효', start: 0.1, end: 0.5 }])
  })

  it('401 → 키 오류 메시지', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toThrow(/키/)
  })

  it('429 → 한도 초과 메시지', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toThrow(/한도/)
  })

  it('네트워크 오류 → 연결 안내 메시지', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toThrow(/연결할 수 없습니다/)
  })

  it('AbortError는 그대로 전파', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const abortErr = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortErr)
    vi.stubGlobal('fetch', fetchMock)
    await expect(transcribeSpeech(blob)).rejects.toBe(abortErr)
  })
})
