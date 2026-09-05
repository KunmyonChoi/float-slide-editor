import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { isLocalLlmEnabled, isLocalVisionEnabled, getLocalLlmModel, getLocalVisionModel } from '../core/LlmBackendClient'
import { chat, setApiKey } from '../core/OpenAIClient'

/**
 * AI 설정 저장 형식 마이그레이션 회귀 테스트.
 *
 * 설정 화면을 콤보 3개로 통합하면서 진실의 원천이 "선택된 모델 id"로 바뀌었다. 기존 사용자는
 * 옛 불리언 키(local-llm-enabled 등)만 갖고 있으므로, 새 코드가 그 상태를 그대로 복원하지
 * 못하면 사용자의 로컬 모델 설정이 조용히 사라진다 — 이 작업의 최대 리스크라 여기서 잠근다.
 * 파생값(isLocal*Enabled)뿐 아니라 chat()의 실제 라우팅까지 종단으로 확인한다.
 */
const ok = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) })

describe('마이그레이션: 옛 키만 있는 기존 사용자', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('로컬 텍스트 켜짐 상태가 그대로 복원된다', () => {
    localStorage.setItem('local-llm-enabled', '1')
    localStorage.setItem('local-llm-model', 'qwen2.5:3b')
    expect(isLocalLlmEnabled()).toBe(true)
    expect(getLocalLlmModel()).toBe('qwen2.5:3b')
  })

  it('로컬 비전 켜짐 상태가 그대로 복원된다', () => {
    localStorage.setItem('local-vision-enabled', '1')
    localStorage.setItem('local-vision-model', 'qwen3-vl:30b')
    expect(isLocalVisionEnabled()).toBe(true)
    expect(getLocalVisionModel()).toBe('qwen3-vl:30b')
  })

  it('아무 키도 없으면 둘 다 꺼짐(=OpenAI)', () => {
    expect(isLocalLlmEnabled()).toBe(false)
    expect(isLocalVisionEnabled()).toBe(false)
  })

  it('명시적으로 꺼둔 상태도 유지된다', () => {
    localStorage.setItem('local-llm-enabled', '0')
    localStorage.setItem('local-vision-enabled', '0')
    expect(isLocalLlmEnabled()).toBe(false)
    expect(isLocalVisionEnabled()).toBe(false)
  })

  it('읽기가 쓰기를 유발하지 않는다(멱등 — 새 키가 생기지 않음)', () => {
    localStorage.setItem('local-llm-enabled', '1')
    localStorage.setItem('local-llm-model', 'qwen2.5:3b')
    isLocalLlmEnabled(); isLocalVisionEnabled()
    const keys = []
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i))
    expect(keys.sort()).toEqual(['local-llm-enabled', 'local-llm-model'])
  })

  it('라우팅 종단 확인: 옛 키만으로 비전 호출이 로컬 비전 서버로 간다', async () => {
    localStorage.setItem('local-vision-enabled', '1')
    localStorage.setItem('local-vision-model', 'qwen3-vl:30b')
    localStorage.setItem('local-vision-url', 'http://vis:9999')
    const fetchMock = vi.fn().mockResolvedValue(ok('결과'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'x', images: ['data:image/png;base64,AAA'] })
    expect(fetchMock.mock.calls[0][0]).toContain('http://vis:9999')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('qwen3-vl:30b')
  })

  it('라우팅 종단 확인: 옛 키만으로 텍스트 호출이 로컬 텍스트 서버로 간다', async () => {
    localStorage.setItem('local-llm-enabled', '1')
    localStorage.setItem('local-llm-model', 'qwen2.5:3b')
    localStorage.setItem('local-llm-url', 'http://txt:8888')
    const fetchMock = vi.fn().mockResolvedValue(ok('결과'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'x' })
    expect(fetchMock.mock.calls[0][0]).toContain('http://txt:8888')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('qwen2.5:3b')
  })

  it('allowLocal:false는 옛 키가 켜져 있어도 OpenAI로 간다', async () => {
    localStorage.setItem('local-llm-enabled', '1')
    setApiKey('sk-test')
    const fetchMock = vi.fn().mockResolvedValue(ok('결과'))
    vi.stubGlobal('fetch', fetchMock)
    await chat({ user: 'x', allowLocal: false })
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com')
  })
})
