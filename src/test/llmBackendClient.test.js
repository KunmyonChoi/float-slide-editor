import { describe, it, expect, beforeEach } from 'vitest'
import {
  isLocalLlmEnabled, setLocalLlmEnabled, getLocalLlmModel, setLocalLlmModel,
  getLocalLlmUrl, setLocalLlmUrl, getLocalLlmChatEndpoint, ollamaInstall,
  ollamaServeWithOrigin, LLM_DEFAULT_MODEL, LLM_DEFAULT_URL,
  getTextSelection, setTextSelection, getVisionSelection, setVisionSelection,
  getVisionOpenAiModel, isLocalVisionEnabled, setLocalVisionModel, modelInList,
} from '../core/LlmBackendClient'

// 실제 Ollama 통신(probeOllama)은 로컬 서버 필요 → 설정/엔드포인트/안내 로직만 단위 테스트.

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

// 설정 화면의 콤보 하나가 저장하는 "선택된 모델"이 진실의 원천이고,
// isLocalLlmEnabled()/isLocalVisionEnabled()는 그 파생값이다.
describe('LlmBackendClient — 모델 선택(단일 진실의 원천)', () => {
  beforeEach(() => { localStorage.clear() })

  it('기본값: 텍스트=OpenAI, 비전=텍스트 모델과 동일', () => {
    expect(getTextSelection()).toEqual({ provider: 'openai', model: '' })
    expect(getVisionSelection()).toEqual({ provider: 'inherit', model: '' })
    expect(isLocalLlmEnabled()).toBe(false)
    expect(isLocalVisionEnabled()).toBe(false)
    expect(getVisionOpenAiModel()).toBe('')
  })

  it('(구) 체크박스 설정 자동 이관 — 기존 사용자는 설정을 잃지 않는다', () => {
    localStorage.setItem('local-llm-enabled', '1')
    localStorage.setItem('local-llm-model', 'qwen2.5:7b')
    localStorage.setItem('local-vision-enabled', '1')
    localStorage.setItem('local-vision-model', 'qwen3-vl:8b')
    expect(getTextSelection()).toEqual({ provider: 'local', model: 'qwen2.5:7b' })
    expect(isLocalLlmEnabled()).toBe(true)
    expect(getVisionSelection()).toEqual({ provider: 'local', model: 'qwen3-vl:8b' })
    expect(isLocalVisionEnabled()).toBe(true)
  })

  it('(구) 키가 꺼져 있으면 이관 결과도 OpenAI/동일', () => {
    localStorage.setItem('local-llm-enabled', '0')
    localStorage.setItem('local-vision-enabled', '0')
    expect(isLocalLlmEnabled()).toBe(false)
    expect(getVisionSelection().provider).toBe('inherit')
  })

  it('새 선택 값이 (구) 키보다 우선', () => {
    localStorage.setItem('local-llm-enabled', '1')
    setTextSelection('openai', 'gpt-4o')
    expect(isLocalLlmEnabled()).toBe(false)
    expect(getTextSelection()).toEqual({ provider: 'openai', model: 'gpt-4o' })
  })

  it("모델명의 ':'을 살려 복원 + 공급자별 마지막 모델 기억", () => {
    setTextSelection('local', 'hf.co/org/repo:Q4_K_M')
    expect(getTextSelection()).toEqual({ provider: 'local', model: 'hf.co/org/repo:Q4_K_M' })
    expect(getLocalLlmModel()).toBe('hf.co/org/repo:Q4_K_M')
    setTextSelection('openai', 'gpt-4o') // OpenAI로 바꿔도 로컬 모델 선택은 남는다
    expect(getLocalLlmModel()).toBe('hf.co/org/repo:Q4_K_M')
  })

  it('모델명을 바꾸면 선택 값도 따라간다(선택과 모델이 어긋나지 않음)', () => {
    setLocalLlmEnabled(true)
    setLocalLlmModel('qwen2.5:7b')
    expect(getTextSelection()).toEqual({ provider: 'local', model: 'qwen2.5:7b' })
    setVisionSelection('local', 'qwen3-vl:8b')
    setLocalVisionModel('qwen3-vl:32b')
    expect(getVisionSelection()).toEqual({ provider: 'local', model: 'qwen3-vl:32b' })
  })

  it('비전에 OpenAI 모델을 명시하면 그 모델을 쓴다(inherit이면 텍스트 모델)', () => {
    setVisionSelection('openai', 'gpt-4o')
    expect(getVisionOpenAiModel()).toBe('gpt-4o')
    expect(isLocalVisionEnabled()).toBe(false)
    setVisionSelection('inherit')
    expect(getVisionOpenAiModel()).toBe('')
  })

  it('modelInList: 태그 생략 시 :latest 허용', () => {
    expect(modelInList(['qwen2.5:latest'], 'qwen2.5')).toBe(true)
    expect(modelInList(['qwen2.5:7b'], 'qwen2.5:3b')).toBe(false)
    expect(modelInList([], 'qwen2.5:3b')).toBe(false)
  })
})
