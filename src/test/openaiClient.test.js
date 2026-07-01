import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getApiKey, setApiKey, hasApiKey, getModel, setModel,
  getImageModel, setImageModel, pickImageSize, flexSize, generationSize,
  generateImage, editImage,
  chat, generateImagePrompt, analyzeImageForInfographic, editSlideText,
  buildImageEnhancePrompt, generateSpeakerNotes,
  synthesizeSpeech, getTtsVoice, setTtsVoice, getTtsModel, setTtsModel,
  getTtsInstructions, setTtsInstructions, voicesForModel, TTS_VOICES,
  DEFAULT_MODEL, DEFAULT_IMAGE_MODEL,
} from '../core/OpenAIClient'
import {
  setLocalLlmEnabled, setLocalLlmModel, setLocalLlmUrl,
  setLocalVisionEnabled, setLocalVisionModel, setLocalVisionUrl,
} from '../core/LlmBackendClient'

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

describe('flexSize / generationSize (gpt-image-2 정확 종횡비)', () => {
  it('flexSize: 16배수로 종횡비 맞춤', () => {
    expect(flexSize(1280, 720)).toBe('1536x864')   // 16:9
    expect(flexSize(720, 1280)).toBe('864x1536')   // 세로
    expect(flexSize(1000, 1000)).toBe('1536x1536') // 정사각
  })
  it('generationSize: 유연 모델은 flex, 그 외는 프리셋', () => {
    expect(generationSize('gpt-image-2', 1280, 720)).toBe('1536x864')
    expect(generationSize('gpt-image-1.5', 1280, 720)).toBe('1536x864')
    expect(generationSize('gpt-image-1', 1600, 900)).toBe('1536x1024')
    expect(generationSize('dall-e-3', 1600, 900)).toBe('1792x1024')
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

describe('editImage (image-to-image edits)', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('빈 이미지/프롬프트는 호출 없이 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(editImage('', 'p')).rejects.toThrow(/입력 이미지/)
    await expect(editImage('data:image/png;base64,AAAA', '  ')).rejects.toThrow(/비어/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edits: gpt-image-2는 유연 크기(정확 종횡비) + input_fidelity 미전송', async () => {
    setImageModel('gpt-image-2')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'RURJVA==' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await editImage('data:image/png;base64,AAAA', 'make infographic', { width: 1600, height: 900 })
    expect(out).toBe('data:image/png;base64,RURJVA==')

    expect(fetchMock).toHaveBeenCalledTimes(1) // 성공 → 폴백 없음
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('images/edits')
    expect(init.body instanceof FormData).toBe(true)
    expect(init.body.get('model')).toBe('gpt-image-2')
    expect(init.body.get('size')).toBe('1536x864') // gpt-image-2 edits는 유연 크기(16:9 정확)
    expect(init.body.get('input_fidelity')).toBeNull() // gpt-image-2엔 보내지 않음(자동 high)
    expect(init.body.get('quality')).toBe('high')
    expect(init.body.get('prompt')).toBe('make infographic')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
  })

  it('edits: gpt-image-2가 모델 미지원이면 gpt-image-1.5(프리셋+input_fidelity)로 폴백', async () => {
    setImageModel('gpt-image-2')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ // 1차: 모델 미지원 오류
        ok: false, status: 400,
        json: async () => ({ error: { message: "model 'gpt-image-2' does not support image edits" } }),
      })
      .mockResolvedValueOnce({ // 2차: 폴백 성공
        ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'RkInfA==' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const out = await editImage('data:image/png;base64,AAAA', 'x', { width: 500, height: 500 })
    expect(out).toBe('data:image/png;base64,RkInfA==')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 1차: gpt-image-2 (유연 크기, input_fidelity 없음)
    expect(fetchMock.mock.calls[0][1].body.get('model')).toBe('gpt-image-2')
    expect(fetchMock.mock.calls[0][1].body.get('input_fidelity')).toBeNull()
    // 2차: 폴백 gpt-image-1.5 (프리셋 크기 + input_fidelity high)
    expect(fetchMock.mock.calls[1][1].body.get('model')).toBe('gpt-image-1.5')
    expect(fetchMock.mock.calls[1][1].body.get('size')).toBe('1024x1024')
    expect(fetchMock.mock.calls[1][1].body.get('input_fidelity')).toBe('high')
  })

  it('edits: 모델 무관 오류(권한 등)는 폴백 없이 즉시 전파', async () => {
    setImageModel('gpt-image-2')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: { message: 'must be verified' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(editImage('data:image/png;base64,AAAA', 'x', { width: 500, height: 500 })).rejects.toThrow(/권한/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 폴백 안 함
  })
})

describe('analyzeImageForInfographic (vision)', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('빈 캡처는 호출 없이 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(analyzeImageForInfographic('')).rejects.toThrow(/캡처/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('캡처 이미지를 vision content(image_url)로 첨부', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('infographic prompt'))
    vi.stubGlobal('fetch', fetchMock)
    const out = await analyzeImageForInfographic('data:image/png;base64,AAA')
    expect(out).toBe('infographic prompt')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const userMsg = body.messages[1]
    expect(Array.isArray(userMsg.content)).toBe(true)
    expect(userMsg.content[0].type).toBe('text')
    expect(userMsg.content[1].type).toBe('image_url')
    expect(userMsg.content[1].image_url.url).toBe('data:image/png;base64,AAA')
  })

  it('화풍(style) directive를 user 텍스트에 주입', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await analyzeImageForInfographic('data:image/png;base64,AAA', { style: 'soft watercolor illustration' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const text = body.messages[1].content[0].text
    expect(text).toContain('Required visual style')
    expect(text).toContain('soft watercolor illustration')
  })

  it('style 미지정이면 directive 절을 넣지 않음', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await analyzeImageForInfographic('data:image/png;base64,AAA')
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content[0].text
    expect(text).not.toContain('Required visual style')
  })
})

describe('editSlideText (AI 텍스트 편집)', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('맞춤법 동작: 시스템 프롬프트에 proofreader, 낮은 temperature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('교정된 문장'))
    vi.stubGlobal('fetch', fetchMock)
    const out = await editSlideText('교정할 문장', { action: 'spelling' })
    expect(out).toBe('교정된 문장')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toMatch(/proofreader/i)
    expect(body.temperature).toBe(0.2)
    expect(body.messages[1].content).toContain('교정할 문장')
  })

  it('프롬프트 동작: 지시문을 user 메시지에 포함', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('요약본'))
    vi.stubGlobal('fetch', fetchMock)
    await editSlideText('긴 원문', { action: 'prompt', instruction: '3문장으로 요약' })
    const user = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content
    expect(user).toContain('3문장으로 요약')
    expect(user).toContain('긴 원문')
  })

  it('프롬프트 동작에 지시문 없으면 호출 전 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(editSlideText('원문', { action: 'prompt' })).rejects.toThrow(/지시문/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('빈 텍스트/알 수 없는 동작은 호출 전 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(editSlideText('   ', { action: 'spelling' })).rejects.toThrow(/편집할 텍스트/)
    await expect(editSlideText('원문', { action: 'nope' })).rejects.toThrow(/알 수 없는/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('코드펜스/감싼 따옴표 제거(내부 내용 보존)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('```markdown\n# 제목\n- 항목\n```')))
    expect(await editSlideText('x', { action: 'markdown' })).toBe('# 제목\n- 항목')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('"따옴표로 감싼 결과"')))
    expect(await editSlideText('x', { action: 'formal' })).toBe('따옴표로 감싼 결과')
    // 내부에 따옴표가 있으면 벗기지 않음
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('"인용" 포함 문장')))
    expect(await editSlideText('x', { action: 'formal' })).toBe('"인용" 포함 문장')
  })
})

describe('buildImageEnhancePrompt (이미지 디자인 향상)', () => {
  it('텍스트·요소 위치 보존 지시를 포함한다', () => {
    const p = buildImageEnhancePrompt('')
    expect(p).toMatch(/verbatim/i)        // 텍스트 원문 유지
    expect(p).toMatch(/position/i)        // 위치 유지
    expect(p).toMatch(/do not move|do not redraw/i)
  })

  it('directive가 있으면 Style 절을 덧붙인다', () => {
    const p = buildImageEnhancePrompt('soft watercolor illustration')
    expect(p).toContain('Style: soft watercolor illustration')
  })

  it('directive가 없으면 Style 절을 넣지 않는다', () => {
    expect(buildImageEnhancePrompt('')).not.toContain('Style:')
    expect(buildImageEnhancePrompt('   ')).not.toContain('Style:')
    expect(buildImageEnhancePrompt()).not.toContain('Style:')
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

describe('OpenAIClient — chat 텍스트/비전 라우팅', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.restoreAllMocks() })

  it('이미지 없음 + 로컬 텍스트 ON → 텍스트 엔드포인트/모델', async () => {
    setLocalLlmEnabled(true); setLocalLlmModel('qwen2.5:3b'); setLocalLlmUrl('http://text:1')
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'U' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://text:1/v1/chat/completions')
    expect(JSON.parse(init.body).model).toBe('qwen2.5:3b')
  })

  it('이미지 있음 + 로컬 비전 ON → 비전 엔드포인트/모델, image_url 포함', async () => {
    setLocalVisionEnabled(true); setLocalVisionModel('qwen3-vl:30b-a3b-thinking'); setLocalVisionUrl('http://vis:2')
    const fetchMock = vi.fn().mockResolvedValue(okResponse('seen'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'describe', images: ['data:image/png;base64,AAAA'] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://vis:2/v1/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen3-vl:30b-a3b-thinking')
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
  })

  it('비전 URL 미지정 → 텍스트 URL로 폴백', async () => {
    setLocalVisionEnabled(true); setLocalVisionModel('qwen3-vl:x'); setLocalLlmUrl('http://shared:3')
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'd', images: ['data:image/png;base64,AAAA'] })
    expect(fetchMock.mock.calls[0][0]).toBe('http://shared:3/v1/chat/completions')
  })

  it('이미지 있음 + 로컬 비전 OFF + 키 있음 → OpenAI(비전 모델)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'd', images: ['data:image/png;base64,AAAA'] })
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com')
  })

  it('이미지 있음 + 로컬 비전 OFF + 키 없음 → 비전 모델 필요 에러', async () => {
    setApiKey('')
    await expect(chat({ user: 'd', images: ['data:image/png;base64,AAAA'] })).rejects.toThrow(/비전 모델/)
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

describe('generateSpeakerNotes', () => {
  beforeEach(() => { localStorage.clear(); setApiKey('sk-test') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('슬라이드 텍스트→JSON 노트 맵, index별 매핑', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse('{"notes":[{"index":0,"text":"안녕하세요"},{"index":1,"text":"다음으로"}]}'))
    vi.stubGlobal('fetch', fetchMock)
    const out = await generateSpeakerNotes({
      slides: [{ index: 0, title: '인트로', text: '소개' }, { index: 1, title: '본론', text: '내용' }],
      tone: 'formal', length: 'short',
    })
    expect(out).toEqual({ 0: '안녕하세요', 1: '다음으로' })
    // JSON 모드 + 시스템/유저 메시지 구성
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('speaker notes')
    expect(body.messages[1].content).toContain('Slide 1: 인트로')
  })

  it('슬라이드 없으면 호출 전 에러', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateSpeakerNotes({ slides: [] })).rejects.toThrow(/슬라이드/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('빈 notes 결과는 에러', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"notes":[]}')))
    await expect(generateSpeakerNotes({ slides: [{ index: 0, text: 'x' }] })).rejects.toThrow(/비어/)
  })
})

describe('TTS — 설정/합성', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('voice/model 기본값·저장', () => {
    expect(getTtsVoice()).toBe('alloy')
    setTtsVoice('nova'); expect(getTtsVoice()).toBe('nova')
    setTtsModel('tts-1'); expect(getTtsModel()).toBe('tts-1')
  })

  it('synthesizeSpeech: 텍스트→오디오 Blob, body 구성', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['audio'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob })
    vi.stubGlobal('fetch', fetchMock)
    const out = await synthesizeSpeech('안녕하세요', { voice: 'echo' })
    expect(out).toBe(blob)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/audio/speech')
    const body = JSON.parse(opts.body)
    expect(body.voice).toBe('echo')
    expect(body.input).toBe('안녕하세요')
    expect(body.response_format).toBe('mp3')
  })

  it('voicesForModel: tts-1 계열은 부분집합, gpt-4o-mini-tts는 전체', () => {
    expect(voicesForModel('gpt-4o-mini-tts')).toEqual(TTS_VOICES)
    const tts1 = voicesForModel('tts-1').map(v => v.id)
    expect(tts1).toContain('alloy')
    expect(tts1).not.toContain('ballad') // tts-1 미지원 음성
    expect(tts1).not.toContain('marin')
    expect(voicesForModel('tts-1-hd').map(v => v.id)).not.toContain('cedar')
  })

  it('instructions: 기본값·저장', () => {
    expect(getTtsInstructions()).toBe('')
    setTtsInstructions('  밝게 ')
    expect(getTtsInstructions()).toBe('밝게') // trim 저장
    setTtsInstructions('')
    expect(getTtsInstructions()).toBe('')
  })

  it('synthesizeSpeech: instructions는 gpt-4o-mini-tts에만 포함, tts-1엔 제외', async () => {
    setApiKey('sk-test')
    const blob = new Blob(['a'], { type: 'audio/mpeg' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob })
    vi.stubGlobal('fetch', fetchMock)

    await synthesizeSpeech('안녕', { model: 'gpt-4o-mini-tts', instructions: '밝고 빠르게' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).instructions).toBe('밝고 빠르게')

    await synthesizeSpeech('안녕', { model: 'tts-1', instructions: '밝고 빠르게' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).instructions).toBeUndefined()
  })

  it('빈 텍스트는 호출 전 에러', async () => {
    setApiKey('sk-test')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(synthesizeSpeech('   ')).rejects.toThrow(/노트/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('키 없으면 에러', async () => {
    await expect(synthesizeSpeech('x')).rejects.toThrow(/키/)
  })
})
