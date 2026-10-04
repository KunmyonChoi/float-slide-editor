import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../core/BlobStore', () => ({
  BlobStore: {
    isIdbRef: (r) => String(r).startsWith('idb://'),
    parseRef: (r) => String(r).slice(6),
    getUrl: vi.fn(async (k) => `blob:test/${k}`),
  },
}))
const { default: MediaPreview } = await import('../components/MediaPreview')

describe('속성 패널 미리보기/미리듣기', () => {
  it('오디오는 컨트롤 있는 <audio>로 미리듣기 (idb 참조를 blob URL로 푼다)', async () => {
    const { container } = render(<MediaPreview el={{ type: 'audio', content: 'idb://song' }} />)
    await vi.waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    const audio = container.querySelector('audio')
    expect(audio.getAttribute('src')).toBe('blob:test/song')
    expect(audio.hasAttribute('controls')).toBe(true)
  })

  it('비디오는 컨트롤 있는 <video>로 미리보기', () => {
    const { container } = render(<MediaPreview el={{ type: 'video', content: 'data:video/mp4;base64,AAAA' }} />)
    const video = container.querySelector('video')
    expect(video.getAttribute('src')).toBe('data:video/mp4;base64,AAAA')
    expect(video.hasAttribute('controls')).toBe(true)
  })

  it('임베드 영상은 재생기 대신 안내', () => {
    const { container } = render(<MediaPreview el={{ type: 'video', content: 'https://www.youtube.com/embed/abc' }} />)
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText(/임베드 영상/)).toBeTruthy()
  })
})
