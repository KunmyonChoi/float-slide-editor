import { describe, it, expect, beforeEach, vi } from 'vitest'

// 네트워크·캔버스 의존을 끊고 러너의 배선만 본다.
const calls = { analyze: [], generate: [] }
vi.mock('../core/OpenAIClient', () => ({
  hasApiKey: () => true,
  generateImagePrompt: vi.fn(),
  generateImage: vi.fn(async (prompt, opts) => { calls.generate.push({ prompt, opts }); return 'data:image/png;base64,AAA' }),
  generateIdeogramCaption: vi.fn(),
  analyzeImageForInfographic: vi.fn(),
  editImage: vi.fn(),
  analyzeImageForRemix: vi.fn(async (cap, opts) => { calls.analyze.push({ cap, opts }); return 'EN PROMPT' }),
  embedPngMetadata: (u) => u,
  flexSize: () => ({ width: 1024, height: 1024 }),
}))
vi.mock('../core/captureCanvasRegion', () => ({
  captureElementRegion: vi.fn(async () => 'data:image/png;base64,CAPTURE'),
  composeContainFit: vi.fn(),
}))
vi.mock('../core/BlobStore', () => ({
  BlobStore: { put: vi.fn(async () => 'k'), get: vi.fn(), getUrl: vi.fn(), toRef: (k) => `idb://${k}`, isIdbRef: () => false, parseRef: (r) => r },
}))

const { startImageRemixJob } = await import('../core/imageJobRunner')
const { useAiJobStore } = await import('../store/aiJobStore')

const image = (over = {}) => ({
  id: 'img-1', type: 'image', content: 'data:image/png;base64,AAA',
  x: 10, y: 20, width: 400, height: 300, zIndex: 1, styles: { objectFit: 'cover' }, ...over,
})

// 원본 픽셀을 고치는 편집과 달리, 리믹스는 '설명 → 새 이미지' 경로여야 한다.
describe('리믹스 작업', () => {
  beforeEach(() => {
    calls.analyze.length = 0
    calls.generate.length = 0
    useAiJobStore.setState({ jobs: [] })
  })

  it('캡처를 분석해 얻은 프롬프트로 새 이미지를 생성한다', async () => {
    startImageRemixJob({ element: image(), direction: '바다 풍경으로', pageKey: '0-0' })
    await vi.waitFor(() => expect(calls.generate.length).toBe(1))

    expect(calls.analyze[0].cap).toBe('data:image/png;base64,CAPTURE')
    expect(calls.analyze[0].opts.direction).toBe('바다 풍경으로')
    expect(calls.generate[0].prompt).toBe('EN PROMPT')          // 분석 결과로 생성
    expect(calls.generate[0].opts).toMatchObject({ width: 400, height: 300 })
  })

  it('방향을 비워도 실행된다(스타일·구도만 이어받아 재창조)', async () => {
    startImageRemixJob({ element: image(), pageKey: '0-0' })
    await vi.waitFor(() => expect(calls.generate.length).toBe(1))
    expect(calls.analyze[0].opts.direction).toBe('')
  })

  it('트레이에 적용 선택지(원본 교체·새로 추가)와 함께 등록된다', async () => {
    const id = startImageRemixJob({ element: image(), direction: '밝게', pageKey: '0-0' })
    const job = useAiJobStore.getState().jobs.find(j => j.id === id)
    expect(job.kind).toBe('image-edit')            // 트레이 미리보기·전후비교 공용
    expect(job.label).toContain('리믹스')
    expect(job.targetElementId).toBe('img-1')
    expect(job.applyOptions.map(o => o.mode)).toEqual(['replace', 'add'])
  })

  it('결과에 전후 비교용 원본과 영역을 함께 남긴다', async () => {
    const id = startImageRemixJob({ element: image(), pageKey: '0-0' })
    await vi.waitFor(() => {
      const job = useAiJobStore.getState().jobs.find(j => j.id === id)
      expect(job.status).toBe('ready')   // 완료 = 트레이에서 적용 대기
    })
    const { result } = useAiJobStore.getState().jobs.find(j => j.id === id)
    expect(result.beforeBlob).toBeTruthy()
    expect(result.prompt).toBe('EN PROMPT')
    expect(result.area).toMatchObject({ x: 10, y: 20, w: 400, h: 300 })
    expect(result.fit).toBe('cover')     // 원본 맞춤을 이어받는다
  })
})
