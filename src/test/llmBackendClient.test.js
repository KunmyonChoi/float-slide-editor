import { describe, it, expect, beforeEach } from 'vitest'
import {
  isLocalLlmEnabled, setLocalLlmEnabled, getLocalLlmModel, setLocalLlmModel,
  getLocalLlmUrl, setLocalLlmUrl, getLocalLlmChatEndpoint, ollamaInstall,
  ollamaServeWithOrigin, LLM_DEFAULT_MODEL, LLM_DEFAULT_URL,
} from '../core/LlmBackendClient'

// 실제 Ollama 통신(checkOllama/hasLocalModel)은 로컬 서버 필요 → 설정/엔드포인트/안내 로직만 단위 테스트.

describe('LlmBackendClient — 설정/엔드포인트', () => {
  beforeEach(() => {
    setLocalLlmEnabled(false); setLocalLlmModel(null); setLocalLlmUrl(null)
  })

  it('기본값: 비활성 · 기본 URL/모델', () => {
    expect(isLocalLlmEnabled()).toBe(false)
    expect(getLocalLlmUrl()).toBe(LLM_DEFAULT_URL)
    expect(getLocalLlmModel()).toBe(LLM_DEFAULT_MODEL)
  })

  it('활성/모델/URL 설정·복원', () => {
    setLocalLlmEnabled(true)
    setLocalLlmModel('qwen2.5:7b')
    setLocalLlmUrl('http://192.168.0.5:11434/')
    expect(isLocalLlmEnabled()).toBe(true)
    expect(getLocalLlmModel()).toBe('qwen2.5:7b')
    expect(getLocalLlmUrl()).toBe('http://192.168.0.5:11434') // 끝 슬래시 제거
  })

  it('OpenAI 호환 chat 엔드포인트', () => {
    expect(getLocalLlmChatEndpoint()).toBe(`${LLM_DEFAULT_URL}/v1/chat/completions`)
  })

  it('OS별 설치 안내', () => {
    expect(ollamaInstall('linux')).toEqual({ type: 'cmd', text: 'curl -fsSL https://ollama.com/install.sh | sh' })
    expect(ollamaInstall('mac').type).toBe('download')
    expect(ollamaInstall('win').type).toBe('download')
  })

  it('OLLAMA_ORIGINS 실행 명령', () => {
    expect(ollamaServeWithOrigin('https://genitor.netlify.app')).toBe('OLLAMA_ORIGINS=https://genitor.netlify.app ollama serve')
  })
})
