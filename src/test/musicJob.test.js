import { describe, it, expect, beforeEach, vi } from 'vitest'

// 음악 서버(YuE2)·LLM 네트워크를 끊고 러너의 배선만 본다.
const calls = { create: [], chat: [], cancel: [] }
let llm = true
let timing = null
vi.mock('../core/OpenAIClient', () => ({
  hasApiKey: () => llm,
  chat: vi.fn(async (opts) => { calls.chat.push(opts); return 'Instrumental, bright electro-pop, 120 BPM\n' }),
}))
vi.mock('../core/LlmBackendClient', () => ({ isLocalLlmEnabled: () => false }))
vi.mock('../core/BlobStore', () => ({
  BlobStore: { put: vi.fn(async () => 'k'), toRef: (k) => `idb://${k}` },
}))
vi.mock('../core/MusicBackendClient', () => ({
  createMusicJob: vi.fn(async (params) => { calls.create.push(params); return { id: 'srv-1' } }),
  waitMusicJob: vi.fn(async (id, { onUpdate }) => {
    onUpdate({ status: 'running', stage: '음악 생성 중…', progress: 40 })
    return { status: 'done', result: { seconds: 47.1, style: 'STYLE', truncated: false, lyrics_timing: timing } }
  }),
  fetchMusicAudio: vi.fn(async () => new Blob(['mp3'], { type: 'audio/mpeg' })),
  cancelMusicJob: vi.fn(async (id) => { calls.cancel.push(id) }),
}))

const { startMusicJob, refineMusicStyle } = await import('../core/musicJobRunner')
const { useAiJobStore } = await import('../store/aiJobStore')

const text = (over = {}) => ({
  id: 'txt-1', type: 'text', content: '<p>밝은 홍보 영상 음악</p>',
  x: 100, y: 50, width: 400, height: 80, zIndex: 1, styles: {}, ...over,
})
const jobOf = (id) => useAiJobStore.getState().jobs.find(j => j.id === id)

describe('음악 생성 작업', () => {
  beforeEach(() => {
    calls.create.length = 0; calls.chat.length = 0; calls.cancel.length = 0
    llm = true
    useAiJobStore.setState({ jobs: [] })
  })

  it('연주곡: LLM으로 다듬은 스타일과 길이를 서버에 보내고, 결과를 오디오로 보관한다', async () => {
    const id = startMusicJob({ element: text(), description: '밝은 홍보 영상 음악', length: 'short', pageKey: '0-0' })
    await vi.waitFor(() => expect(jobOf(id).status).toBe('ready'))
    expect(calls.create[0]).toEqual({ mode: 'instrumental', style: 'Instrumental, bright electro-pop, 120 BPM', length: 'short' })
    const job = jobOf(id)
    expect(job.kind).toBe('music-gen')
    expect(job.result.blob.type).toBe('audio/mpeg')
    expect(job.result.seconds).toBe(47.1)
    expect(job.applyOptions.map(o => o.mode)).toEqual(['add'])
  })

  it('노래: 텍스트 박스 내용이 가사로, 입력이 스타일로 간다', async () => {
    const id = startMusicJob({
      element: text(), mode: 'song', description: 'warm piano pop', lyrics: '[Verse]\n가사', refine: false, pageKey: '0-0',
    })
    await vi.waitFor(() => expect(jobOf(id).status).toBe('ready'))
    expect(calls.chat.length).toBe(0) // 다듬기 꺼짐
    expect(calls.create[0]).toEqual({ mode: 'song', style: 'warm piano pop', lyrics: '[Verse]\n가사' })
  })

  it('텍스트 모델이 없으면 원문 그대로 보낸다', async () => {
    llm = false
    expect(await refineMusicStyle('잔잔한 피아노')).toBe('잔잔한 피아노')
    expect(calls.chat.length).toBe(0)
  })

  it('빈 지시문·빈 가사는 시작 전에 거절한다', () => {
    expect(() => startMusicJob({ element: text(), description: '  ' })).toThrow()
    expect(() => startMusicJob({ element: text(), mode: 'song', description: 'pop', lyrics: '' })).toThrow()
    expect(useAiJobStore.getState().jobs.length).toBe(0)
  })

  it('취소하면 서버 작업도 취소한다', async () => {
    const id = startMusicJob({ element: text(), description: '음악', refine: false, pageKey: '0-0' })
    await vi.waitFor(() => expect(calls.create.length).toBe(1))
    useAiJobStore.getState().cancelJob(id)
    expect(jobOf(id).status).toBe('cancelled')
    expect(calls.cancel).toEqual(['srv-1'])
  })
})

describe('음악 작업 복구 기록', () => {
  const pending = () => JSON.parse(localStorage.getItem('music-pending-jobs') || '[]')
  beforeEach(() => { localStorage.clear(); useAiJobStore.setState({ jobs: [] }) })

  it('서버에 보낸 뒤 기록하고, 완료돼도 적용 전까지는 남긴다', async () => {
    const id = startMusicJob({ element: text(), description: '음악', refine: false, pageKey: '0-0' })
    await vi.waitFor(() => expect(jobOf(id).status).toBe('ready'))
    expect(pending().map(e => e.serverId)).toEqual(['srv-1'])
    useAiJobStore.getState().removeJob(id) // 트레이에서 닫기
    expect(pending()).toEqual([])
  })

  it('새로고침 후 남은 기록을 트레이에 (복구)로 올려 이어 받는다', async () => {
    localStorage.setItem('music-pending-jobs', JSON.stringify([{
      serverId: 'srv-9', label: '배경음악 생성 · 보통', targetPageKey: '0-0', targetElementId: 'gone',
      anchor: { x: 0, y: 0 }, createdAt: Date.now(),
    }]))
    const { recoverPendingMusicJobs } = await import('../core/musicJobRunner')
    expect(recoverPendingMusicJobs()).toBe(1)
    expect(recoverPendingMusicJobs()).toBe(0) // 한 번만
    const job = useAiJobStore.getState().jobs[0]
    expect(job.label).toContain('(복구)')
    await vi.waitFor(() => expect(useAiJobStore.getState().jobs[0].status).toBe('ready'))
  })
})

describe('노래 → 가사 싱크 자동 연결', () => {
  beforeEach(() => { localStorage.clear(); useAiJobStore.setState({ jobs: [] }); timing = null })

  it('오디오 요소로 추가하면 가사 텍스트 박스가 그 오디오에 연결된다', async () => {
    const { useFlatStore } = await import('../store/flatStore')
    const el = text({ content: '[Verse]\n가사' })
    useFlatStore.setState({ flatElements: [el], canvasSize: { w: 1920, h: 1080 } })
    timing = [{ start: 1, end: 3, text: '가사', section: 'verse' }]
    const id = startMusicJob({ element: el, mode: 'song', description: 'pop', lyrics: '[Verse]\n가사', refine: false })
    await vi.waitFor(() => expect(jobOf(id).status).toBe('ready'))
    await useAiJobStore.getState().jobs.find(j => j.id === id).apply(jobOf(id), { mode: 'add' })
    const els = useFlatStore.getState().flatElements
    const audio = els.find(e => e.type === 'audio')
    const linked = els.find(e => e.id === 'txt-1')
    expect(audio.musicJobId).toBe('srv-1')
    expect(linked.lyricSync).toMatchObject({ audioId: audio.id, jobId: 'srv-1', lines: timing })
  })

  it('연주곡(타이밍 없음)은 연결하지 않는다', async () => {
    const { useFlatStore } = await import('../store/flatStore')
    const el = text()
    useFlatStore.setState({ flatElements: [el], canvasSize: { w: 1920, h: 1080 } })
    const id = startMusicJob({ element: el, description: '음악', refine: false })
    await vi.waitFor(() => expect(jobOf(id).status).toBe('ready'))
    await jobOf(id).apply(jobOf(id), { mode: 'add' })
    expect(useFlatStore.getState().flatElements.find(e => e.id === 'txt-1').lyricSync).toBeUndefined()
  })
})
