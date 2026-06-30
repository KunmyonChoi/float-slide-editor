import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getImagenBase, setImagenBase, imagenDockerRunCommand, generateLayoutImage,
  checkImagenBackend, isImagenReady, getImagenPresets, IMAGEN_DEFAULT_PORT,
} from '../core/ImagenBackendClient'

// 실제 생성은 GPU 추론이라 jsdom 검증 불가 → URL 해석/요청 본문/health 파싱만 단위 테스트.

describe('ImagenBackendClient — 베이스 URL 해석', () => {
  beforeEach(() => { setImagenBase(null) })

  it('기본은 localhost:8323', () => {
    expect(getImagenBase()).toBe(`http://localhost:${IMAGEN_DEFAULT_PORT}`)
  })

  it('localStorage 오버라이드가 우선, 끝 슬래시 제거', () => {
    setImagenBase('http://gpu.local:8323/')
    expect(getImagenBase()).toBe('http://gpu.local:8323')
    setImagenBase(null)
    expect(getImagenBase()).toBe(`http://localhost:${IMAGEN_DEFAULT_PORT}`)
  })

  it('docker run: --gpus all + HF_TOKEN + 캐시 볼륨 + 포트', () => {
    const cmd = imagenDockerRunCommand({ hfToken: 'hf_abc' })
    expect(cmd).toContain('--gpus all')
    expect(cmd).toContain('-e HF_TOKEN=hf_abc')
    expect(cmd).toContain('/app/.hf-cache')
    expect(cmd).toContain(`-p ${IMAGEN_DEFAULT_PORT}:${IMAGEN_DEFAULT_PORT}`)
    expect(cmd).toContain('dilly97/float-imgen')
  })
})

describe('ImagenBackendClient — health/generate', () => {
  beforeEach(() => { setImagenBase(null) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('checkImagenBackend: presets/ready 파싱', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ build: 'b1', device: 'cuda', presets: ['V4_TURBO_12'], ready: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const ok = await checkImagenBackend(true)
    expect(ok).toBe(true)
    expect(isImagenReady()).toBe(true)
    expect(getImagenPresets()).toEqual(['V4_TURBO_12'])
  })

  it('generateLayoutImage: JSON 본문 구성 + PNG Blob + serverMs', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, blob: async () => blob,
      headers: { get: (k) => (k === 'X-Inference-Ms' ? '28620' : null) },
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x' })

    const caption = { compositional_deconstruction: { background: '', elements: [] } }
    const out = await generateLayoutImage(caption, { width: 1280, height: 720, preset: 'V4_TURBO_12', seed: 7 })
    expect(out.blob).toBe(blob)
    expect(out.serverMs).toBe(28620)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/generate')
    const body = JSON.parse(opts.body)
    expect(body.caption).toEqual(caption)
    expect(body.width).toBe(1280)
    expect(body.height).toBe(720)
    expect(body.preset).toBe('V4_TURBO_12')
    expect(body.seed).toBe(7)
  })

  it('generateLayoutImage: 비2xx면 서버 error 메시지로 throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'CUDA out of memory' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateLayoutImage({}, {})).rejects.toThrow(/CUDA out of memory/)
  })
})
