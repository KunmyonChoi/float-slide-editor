import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import KaraokeCaptions from '../components/KaraokeCaptions'

const WORDS = [
  { word: '안녕하세요', start: 0, end: 0.8 },
  { word: '반갑습니다.', start: 1.0, end: 1.8 },
]

function fakeAudio(t) { return { currentTime: t } }

describe('KaraokeCaptions 배치', () => {
  it('여백이 없으면 슬라이드 위에 덮는다(종전 동작)', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(0.1)} words={WORDS} spaceBelow={0} />)
    const box = await screen.findByTestId('karaoke-captions')
    expect(box).toHaveAttribute('data-placement', 'overlay')
    expect(box).toHaveStyle({ bottom: '6%' })
  })

  it('spaceBelow를 주지 않으면 덮는 쪽이 기본값', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(0.1)} words={WORDS} />)
    expect(await screen.findByTestId('karaoke-captions')).toHaveAttribute('data-placement', 'overlay')
  })

  it('여백이 넉넉하면 슬라이드 아래로 내려간다', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(0.1)} words={WORDS} spaceBelow={400} />)
    const box = await screen.findByTestId('karaoke-captions')
    expect(box).toHaveAttribute('data-placement', 'below')
    // 캔버스 바깥으로 내려 그린다
    expect(box).toHaveStyle({ top: '100%' })
    // 검은 여백 위에서는 대비용 패널을 쓰지 않는다
    expect(box).toHaveStyle({ background: 'transparent' })
  })

  it('아래로 내려가도 단어 하이라이트는 그대로 동작한다', async () => {
    render(<KaraokeCaptions audioEl={fakeAudio(1.2)} words={WORDS} spaceBelow={400} />)
    await waitFor(() => {
      expect(screen.getByText('반갑습니다.')).toHaveStyle({ color: '#facc15' })
    })
    expect(screen.getByTestId('karaoke-captions')).toHaveAttribute('data-placement', 'below')
  })
})
