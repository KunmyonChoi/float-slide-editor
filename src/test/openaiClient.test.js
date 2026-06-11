import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getApiKey, setApiKey, hasApiKey, getModel, setModel,
  getImageModel, setImageModel, pickImageSize, generateImage,
  chat, generateImagePrompt, DEFAULT_MODEL, DEFAULT_IMAGE_MODEL,
} from '../core/OpenAIClient'

function okResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }
}

describe('OpenAIClient — 키/모델 저장', () => {
  beforeEach(() => { localStorage.clear() })

  it('키 저장/조회/삭제', () => {
    expect(hasApiKey()).toBe(false)
    setApiKey('  sk-test  ')
    expect(getApiKey()).toBe('sk-test') // trim 됨
    expect(hasApiKey()).toBe(true)
    setApiKey('')
    expect(hasApiKey()).toBe(false)
  })

  it('모델 기본값/저장', () => {
    expect(getModel()).toBe(DEFAULT_MODEL)
    setModel('gpt-4o')
    expect(getModel()).toBe('gpt-4o')
  })

  it('이미지 모델 기본값/저장', () => {
    expect(getImageModel()).toBe(DEFAULT_IMAGE_MODEL)
    setImageModel('dall-e-3')
    expect(getImageModel()).toBe('dall-e-3')
  })
})

describe('pickImageSize — 종횡비별 지원 사이즈', () => {
  it('gpt-image-1', () => {
    expect(pickImageSize('gpt-image-1', 1600, 900)).toBe('1536x1024') // 가로
    expect(pickImageSize('gpt-image-1', 900, 1600)).toBe('1024x1536') // 세로
    expect(pickImageSize('gpt-image-1', 500, 500)).toBe('1024x1024')  // 정사각
  })
  it('dall-e-3', () => {
    expect(pickImageSize('dall-e-3', 1600, 900)).toBe('1792x1024')
    expect(pickImageSize('dall-e-3', 900, 1600)).toBe('1024x1792')
    expect(pickImageSize('dall-e-3', 500, 500)).toBe('1024x1024')
  })
})

describe('generateImage', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('빈 프롬프트는 호출 없이 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImage('   ')).rejects.toThrow(/비어/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gpt-image-1: 사이즈/quality를 담아 호출하고 b64를 data URL로 반환', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'QUJD' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await generateImage('a cat', { model: 'gpt-image-1', width: 1600, height: 900 })
    expect(out).toBe('data:image/png;base64,QUJD')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('images/generations')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-image-1')
    expect(body.size).toBe('1536x1024')
    expect(body.quality).toBe('medium')
    expect(body.response_format).toBeUndefined()
  })

  it('dall-e-3: response_format=b64_json 지정', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'WFla' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await generateImage('a dog', { model: 'dall-e-3', width: 500, height: 500 })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format).toBe('b64_json')
    expect(body.quality).toBeUndefined()
  })

  it('403 → 권한 안내 메시지', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: { message: 'must be verified' } }),
    }))
    await expect(generateImage('x', { width: 100, height: 100 })).rejects.toThrow(/권한/)
  })
})

describe('OpenAIClient — chat 요청 구성', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('Authorization 헤더와 messages를 담아 호출하고 응답을 trim해 반환', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('  hello  '))
    vi.stubGlobal('fetch', fetchMock)

    const out = await chat({ system: 'S', user: 'U', model: 'gpt-4o-mini' })
    expect(out).toBe('hello')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ])
  })

  it('키가 없으면 호출 전에 에러', async () => {
    setApiKey('')
    await expect(chat({ user: 'U' })).rejects.toThrow(/키/)
  })

  it('401 → 키 무효 메시지', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }),
    }))
    await expect(chat({ user: 'U' })).rejects.toThrow(/유효하지/)
  })

  it('네트워크 실패 → 연결 에러 메시지', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(chat({ user: 'U' })).rejects.toThrow(/연결할 수 없/)
  })
})

describe('generateImagePrompt', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('빈 텍스트는 호출 없이 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateImagePrompt('   ')).rejects.toThrow(/내용/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('텍스트를 user 메시지에 담아 영어 프롬프트를 반환', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('flat infographic of growth'))
    vi.stubGlobal('fetch', fetchMock)

    const out = await generateImagePrompt('매출 성장 추이')
    expect(out).toBe('flat infographic of growth')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toContain('매출 성장 추이')
  })

  it('화풍(style) directive를 user 메시지에 주입', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('isometric scene'))
    vi.stubGlobal('fetch', fetchMock)
    await generateImagePrompt('팀 협업', { style: 'isometric 3D vector illustration' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[1].content).toContain('Required visual style')
    expect(body.messages[1].content).toContain('isometric 3D vector illustration')
  })

  it('style 미지정이면 directive 절을 넣지 않음', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('x'))
    vi.stubGlobal('fetch', fetchMock)
    await generateImagePrompt('팀 협업')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[1].content).not.toContain('Required visual style')
  })
})
