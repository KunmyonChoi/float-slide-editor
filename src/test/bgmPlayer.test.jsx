import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../core/BlobStore', () => {
  const BlobStore = {
    isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
    parseRef: (s) => s.slice(6),
    getUrl: async (k) => `blob:${k}`,
  }
  return { BlobStore, default: BlobStore }
})

const { default: BgmPlayer, BGM_FADE_MS, BGM_DUCK_GAIN } = await import('../components/BgmPlayer')

// 재생 상태만 흉내 내는 가짜 Audio
const made = []
class FakeAudio {
  constructor() { this.src = ''; this.loop = false; this.volume = 1; this.paused = true; made.push(this) }
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
}

const bgm = (id, over = {}) => ({ id, type: 'audio', content: `idb://${id}`, bgmSpan: 0, ...over })
const flush = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('BgmPlayer — 여러 장에 걸친 배경 음악', () => {
  beforeEach(() => {
    made.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(() => fn(performance.now()), 16))
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('같은 BGM이면 장이 바뀌어도(다시 그려져도) 새로 만들지 않고 이어서 재생한다', async () => {
    const { rerender } = render(<BgmPlayer element={bgm('a')} />)
    await flush(BGM_FADE_MS + 100)
    expect(made).toHaveLength(1)
    expect(made[0].src).toBe('blob:a')
    expect(made[0].paused).toBe(false)
    expect(made[0].volume).toBeCloseTo(1)

    rerender(<BgmPlayer element={{ ...bgm('a') }} />)
    await flush(200)
    expect(made).toHaveLength(1)
    expect(made[0].paused).toBe(false)
  })

  it('다른 BGM으로 바뀌면 앞의 것을 줄이며 멈추고 새것을 키운다', async () => {
    const { rerender } = render(<BgmPlayer element={bgm('a')} />)
    await flush(BGM_FADE_MS + 100)
    rerender(<BgmPlayer element={bgm('b')} />)
    await flush(BGM_FADE_MS + 200)
    expect(made).toHaveLength(2)
    expect(made[0].paused).toBe(true)
    expect(made[1].src).toBe('blob:b')
    expect(made[1].volume).toBeCloseTo(1)
  })

  it('BGM 범위가 끝나면(null) 줄이며 멈춘다', async () => {
    const { rerender } = render(<BgmPlayer element={bgm('a')} />)
    await flush(BGM_FADE_MS + 100)
    rerender(<BgmPlayer element={null} />)
    await flush(BGM_FADE_MS + 200)
    expect(made[0].paused).toBe(true)
  })

  it('나레이션이 흐르는 동안은 소리를 줄인다(덕킹)', async () => {
    const { rerender } = render(<BgmPlayer element={bgm('a', { volume: 0.8 })} duck={false} />)
    await flush(BGM_FADE_MS + 100)
    expect(made[0].volume).toBeCloseTo(0.8)
    rerender(<BgmPlayer element={bgm('a', { volume: 0.8 })} duck />)
    await flush(BGM_FADE_MS + 100)
    expect(made[0].volume).toBeCloseTo(0.8 * BGM_DUCK_GAIN)
    rerender(<BgmPlayer element={bgm('a', { volume: 0.8 })} duck={false} />)
    await flush(BGM_FADE_MS + 100)
    expect(made[0].volume).toBeCloseTo(0.8)
  })

  it('발표를 끝내면 모두 정지', async () => {
    const { unmount } = render(<BgmPlayer element={bgm('a')} />)
    await flush(BGM_FADE_MS)
    unmount()
    expect(made[0].paused).toBe(true)
  })
})
