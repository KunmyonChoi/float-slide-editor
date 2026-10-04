import { describe, it, expect } from 'vitest'
import { mediaExt, mediaDownloadName, isDownloadableMedia } from '../core/mediaDownload'

describe('미디어 다운로드 이름', () => {
  it('오디오도 다운로드 대상이다', () => {
    expect(isDownloadableMedia({ type: 'audio', content: 'idb://k' })).toBe(true)
    expect(isDownloadableMedia({ type: 'text', content: 'x' })).toBe(false)
    expect(isDownloadableMedia({ type: 'audio', content: '' })).toBe(false)
  })

  it('MIME으로 확장자를 정한다(흔한 확장자로)', () => {
    expect(mediaExt('audio', 'audio/mpeg')).toBe('mp3')
    expect(mediaExt('audio', 'audio/x-wav')).toBe('wav')
    expect(mediaExt('audio', 'audio/flac')).toBe('flac')
    expect(mediaExt('audio', 'audio/mp4')).toBe('m4a')
    expect(mediaExt('video', 'video/webm;codecs=vp9')).toBe('webm')
    expect(mediaExt('video', 'video/quicktime')).toBe('mov')
    expect(mediaExt('image', 'image/svg+xml')).toBe('svg')
  })

  it('MIME이 없거나 종류가 다르면 기본 확장자', () => {
    expect(mediaExt('audio', '')).toBe('mp3')
    expect(mediaExt('video', 'application/octet-stream')).toBe('mp4')
    expect(mediaExt('image', undefined)).toBe('png')
  })

  it('파일 이름: filename 우선, 생성한 음악은 작업 id', () => {
    expect(mediaDownloadName({ type: 'video', filename: 'rec.webm' }, 'video/webm')).toBe('rec.webm')
    expect(mediaDownloadName({ type: 'audio', musicJobId: '10b7e95e23d2' }, 'audio/mpeg')).toBe('genitor-music-10b7e95e23d2.mp3')
    expect(mediaDownloadName({ type: 'audio' }, 'audio/wav')).toBe('audio.wav')
  })
})
