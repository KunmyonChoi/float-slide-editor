import { describe, it, expect } from 'vitest'
import { listAudioSources } from '../core/audioSources'

describe('listAudioSources — 립싱크 오디오 소스 열거', () => {
  it('오디오 요소 + 노트 음성을 한 목록으로', () => {
    const els = [
      { id: 'a1', type: 'audio', content: 'idb://1' },
      { id: 'v1', type: 'video', content: 'idb://2' }, // 비디오는 제외
      { id: 'a2', type: 'audio', content: 'idb://3', filename: 'bgm.mp3' },
    ]
    const out = listAudioSources(els, 'idb://note')
    expect(out.map(s => s.kind)).toEqual(['audio-element', 'audio-element', 'note'])
    expect(out[0].label).toBe('🎵 오디오 1')
    expect(out[1].label).toBe('🎵 bgm.mp3') // filename 있으면 사용
    expect(out[2]).toMatchObject({ kind: 'note', ref: 'idb://note', label: '🔊 노트 음성' })
  })

  it('content 없는 오디오 요소는 제외', () => {
    const out = listAudioSources([{ id: 'a1', type: 'audio' }], null)
    expect(out).toHaveLength(0)
  })

  it('노트 음성 없으면 오디오 요소만', () => {
    const out = listAudioSources([{ id: 'a1', type: 'audio', content: 'idb://1' }], null)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('audio-element')
  })

  it('빈 입력은 빈 배열', () => {
    expect(listAudioSources([], null)).toEqual([])
    expect(listAudioSources(null, null)).toEqual([])
  })
})
