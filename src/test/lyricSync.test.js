import { describe, it, expect } from 'vitest'
import { activeLyricIndex, centerTranslate, hasLyricSync, DEFAULT_LYRIC_OFFSET, LYRIC_LEAD_SEC } from '../core/lyricSync'

const lines = [
  { start: 16.75, end: 24.25, text: '눈을 감으면 바람이 불어와' },
  { start: 24.75, end: 32.25, text: '두 발은 어느새 땅을 떠나' },
  { start: 33.0, end: 40.25, text: '구름 사이로 숨을 쉬면' },
]

describe('가사 싱크 — 현재 줄', () => {
  it('첫 줄 전에는 -1, 줄이 시작되면 그 줄', () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1)
    expect(activeLyricIndex(lines, 16.75 + DEFAULT_LYRIC_OFFSET)).toBe(0)
  })
  it('부르기 직전(lead)에 미리 넘어가고, 간주에는 직전 줄을 유지한다', () => {
    const t = 24.75 + DEFAULT_LYRIC_OFFSET - LYRIC_LEAD_SEC
    expect(activeLyricIndex(lines, t - 0.01)).toBe(0)
    expect(activeLyricIndex(lines, t)).toBe(1)
    expect(activeLyricIndex(lines, 200)).toBe(2) // 마지막 줄 뒤에도 마지막 줄
  })
  it('offset만큼 밀린다(오디오가 악보보다 늦게 시작)', () => {
    expect(activeLyricIndex(lines, 17, 0, 0)).toBe(0)
    expect(activeLyricIndex(lines, 17, 1, 0)).toBe(-1)
  })
})

describe('가사 싱크 — 가운데 정렬', () => {
  it('현재 줄 중심이 박스 가운데에 오는 이동량', () => {
    // 박스 200px, 줄 높이 40px: 0번 줄 중심 20 → 80, 2번 줄 중심 100 → 0
    expect(centerTranslate(200, [0, 40, 80], [40, 40, 40], 0)).toBe(80)
    expect(centerTranslate(200, [0, 40, 80], [40, 40, 40], 2)).toBe(0)
    expect(centerTranslate(200, [0, 40, 80], [40, 40, 40], -1)).toBe(80) // 시작 전엔 첫 줄
  })
})

describe('가사 싱크 — 연결 유효성', () => {
  const text = { id: 't', type: 'text', lyricSync: { audioId: 'a', lines } }
  it('같은 슬라이드에 오디오가 있어야 한다', () => {
    expect(hasLyricSync(text, [text, { id: 'a', type: 'audio' }])).toBe(true)
    expect(hasLyricSync(text, [text])).toBe(false)
    expect(hasLyricSync({ ...text, lyricSync: { audioId: 'a', lines: [] } })).toBe(false)
  })
})
