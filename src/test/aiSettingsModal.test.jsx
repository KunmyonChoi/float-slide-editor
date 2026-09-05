import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AiSettingsHost, openAiSettings } from '../components/AiSettingsModal'
import { isLocalLlmEnabled, getLocalLlmModel, getVisionSelection } from '../core/LlmBackendClient'

// 콤보 순서: 텍스트 / 이미지 생성 / 비전
const combos = () => screen.getAllByRole('combobox')
const textCombo = () => combos()[0]
const imageCombo = () => combos()[1]
const visionCombo = () => combos()[2]

function stubBackends({ models = [], ollamaOk = true } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) return { ok: true, json: async () => ({ ready: true, device: 'cuda' }) }
    if (!ollamaOk) throw new TypeError('Failed to fetch')
    if (u.includes('/api/version')) return { ok: true, json: async () => ({ version: '0.5.0' }) }
    if (u.includes('/api/tags')) return { ok: true, json: async () => ({ models: models.map(name => ({ name })) }) }
    throw new Error(`unexpected fetch: ${u}`)
  }))
}

/** 로컬 모델 목록 조회가 끝날 때까지 대기(콤보 열기 전 350ms 디바운스 + fetch). */
const waitForLocalList = () => waitFor(() => expect(screen.queryAllByText('로컬 (확인 중…)')).toHaveLength(0))

describe('AiSettingsModal — 작업별 모델 콤보', () => {
  beforeEach(() => { localStorage.clear(); openAiSettings() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('한 콤보 안에 OpenAI 모델과 로컬 모델이 함께 나열된다', async () => {
    stubBackends({ models: ['qwen2.5:7b', 'llama3.2:3b'] })
    render(<AiSettingsHost />)
    await waitForLocalList()

    const groups = [...textCombo().querySelectorAll('optgroup')].map(g => g.label)
    expect(groups[0]).toBe('OpenAI')
    expect(groups[1]).toContain('로컬')
    const values = [...textCombo().querySelectorAll('option')].map(o => o.value)
    expect(values).toContain('openai:gpt-4o')
    expect(values).toContain('local:qwen2.5:7b')
    expect(values).toContain('local:llama3.2:3b')
  })

  it('서버 미연결이면 로컬 항목을 숨기지 않고 비활성 항목 + 이유를 보여준다', async () => {
    stubBackends({ ollamaOk: false })
    render(<AiSettingsHost />)
    await waitFor(() => expect(screen.queryAllByText('로컬 (서버 미연결)').length).toBeGreaterThan(0))

    expect(screen.getAllByText('로컬 (서버 미연결)')[0].disabled).toBe(true)
    expect(screen.getAllByText(/로컬 모델 목록을 불러오지 못했습니다/)[0]).toBeInTheDocument()
    // 저장돼 있던(기본) 모델은 조회 실패와 무관하게 항목으로 남아 선택 가능
    const values = [...textCombo().querySelectorAll('option')].map(o => o.value)
    expect(values).toContain('local:qwen2.5:3b')
  })

  it('로컬을 고르면 콤보 바로 아래에 로컬 설정이 나타나고, 저장하면 반영된다', async () => {
    stubBackends({ models: ['qwen2.5:7b'] })
    render(<AiSettingsHost />)
    await waitForLocalList()

    expect(screen.queryByText('서버 URL')).toBeNull() // OpenAI 선택 중엔 숨김

    // 미설치 모델을 고르면 설치 안내(ollama pull)까지 그 자리에서 보인다
    fireEvent.change(textCombo(), { target: { value: 'local:qwen2.5:3b' } })
    expect(screen.getByText('서버 URL')).toBeInTheDocument()
    expect(screen.getByText(/설치 안내/)).toBeInTheDocument()
    expect(screen.getByText(/ollama pull qwen2\.5:3b/)).toBeInTheDocument()

    fireEvent.change(textCombo(), { target: { value: 'local:qwen2.5:7b' } })
    expect(screen.queryByText(/설치 안내/)).toBeNull() // 설치돼 있으면 안내 불필요
    fireEvent.click(screen.getByText('저장'))
    expect(isLocalLlmEnabled()).toBe(true)
    expect(getLocalLlmModel()).toBe('qwen2.5:7b')
  })

  it('비전 기본값은 "텍스트 모델과 동일" — 저장해도 로컬 비전으로 바뀌지 않는다', async () => {
    stubBackends({ models: ['qwen3-vl:8b'] })
    render(<AiSettingsHost />)
    await waitForLocalList()

    expect(visionCombo().value).toBe('inherit')
    fireEvent.click(screen.getByText('저장'))
    expect(getVisionSelection()).toEqual({ provider: 'inherit', model: '' })
  })

  it('이미지 생성은 로컬 항목에 "생성 전용"을 밝히고, 저장 시 러너와 공유하는 키를 쓴다', async () => {
    stubBackends({ models: [] })
    render(<AiSettingsHost />)
    await waitForLocalList()

    const localOpt = [...imageCombo().querySelectorAll('option')].find(o => o.value.startsWith('local:'))
    expect(localOpt.textContent).toContain('생성 전용')

    const changed = vi.fn()
    window.addEventListener('ai-image-backend-change', changed)
    fireEvent.change(imageCombo(), { target: { value: localOpt.value } })
    expect(screen.getByText(/편집 계열은 항상 OpenAI/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('저장'))
    window.removeEventListener('ai-image-backend-change', changed)

    expect(localStorage.getItem('ai-image-backend')).toBe('local')
    expect(changed).toHaveBeenCalled()
  })
})
