import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import KaraokeCaptions from '../components/KaraokeCaptions'

const WORDS = [
  { word: '안녕하세요', start: 0, end: 0.8 },
  { word: '반갑습니다.', start: 1.0, end: 1.8 },
]

function fakeAudio(t) { return { currentTime: t } }

describe('KaraokeCaptions', () => {
  it('단어가 없으면 아무것도 렌더링하지 않음', () => {
    const { container } = render(<KaraokeCaptions audioEl={fakeAudio(0)} words={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('audioEl이 없어도(아직 오디오 로드 전) 에러 없이 대기', () => {
    const { container } = render(<KaraokeCaptions audioEl={null} words={WORDS} />)
    // cue는 있지만 폴링을 시작할 오디오가 없어 time=0 기준으로만 렌더 — 크래시하지 않으면 통과
    expect(container.firstChild).not.toBeNull()
  })

  it('재생 시간에 맞는 단어를 하이라이트한다', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(1.2)} words={WORDS} />)
    await waitFor(() => {
      expect(screen.getByText('반갑습니다.')).toHaveStyle({ color: '#facc15' })
    })
    expect(screen.getByText('안녕하세요')).not.toHaveStyle({ color: '#facc15' })
  })

  it('cue의 모든 단어 텍스트가 화면에 표시된다', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(0.1)} words={WORDS} />)
    await waitFor(() => {
      expect(screen.getByText('안녕하세요')).toBeInTheDocument()
      expect(screen.getByText('반갑습니다.')).toBeInTheDocument()
    })
  })
})
