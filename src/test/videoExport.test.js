import { describe, it, expect } from 'vitest'
import {
  pickRecorderMime, videoExtension, videoOutputSize, captureCropRect,
  videoFileName, formatElapsed, captureErrorMessage, VIDEO_MIME_CANDIDATES,
} from '../core/videoExport'

describe('영상 내보내기 — 녹화 형식 선택', () => {
  it('MP4(H.264/AAC)를 먼저 고른다', () => {
    expect(pickRecorderMime(() => true)).toBe(VIDEO_MIME_CANDIDATES[0])
  })
  it('MP4가 안 되면 WebM VP9 → VP8 순', () => {
    expect(pickRecorderMime(m => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
    expect(pickRecorderMime(m => m === 'video/webm;codecs=vp8,opus' || m === 'video/webm')).toBe('video/webm;codecs=vp8,opus')
    expect(pickRecorderMime(m => m === 'video/mp4')).toBe('video/mp4')
  })
  it('아무것도 안 되거나 판정 함수가 없거나 던지면 빈 문자열', () => {
    expect(pickRecorderMime(() => false)).toBe('')
    expect(pickRecorderMime(undefined)).toBe('')
    expect(pickRecorderMime(() => { throw new Error('x') })).toBe('')
  })
  it('확장자', () => {
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4')
    expect(videoExtension('video/webm;codecs=vp9')).toBe('webm')
    expect(videoExtension('')).toBe('webm')
  })
})

describe('영상 내보내기 — 출력 크기(덱 비율 유지)', () => {
  it('원본 캔버스 크기는 그대로(짝수로)', () => {
    expect(videoOutputSize({ w: 1280, h: 720 }, 'canvas')).toEqual({ w: 1280, h: 720 })
    expect(videoOutputSize({ w: 1081, h: 1351 }, 'canvas')).toEqual({ w: 1082, h: 1352 })
  })
  it('1080p·720p는 짧은 변 기준', () => {
    expect(videoOutputSize({ w: 1280, h: 720 }, '1080p')).toEqual({ w: 1920, h: 1080 })
    expect(videoOutputSize({ w: 1080, h: 1920 }, '720p')).toEqual({ w: 720, h: 1280 })
    expect(videoOutputSize({ w: 1080, h: 1350 }, '1080p')).toEqual({ w: 1080, h: 1350 })
    expect(videoOutputSize({ w: 800, h: 800 }, '720p')).toEqual({ w: 720, h: 720 })
  })
  it('캔버스 크기가 없으면 1280×720', () => {
    expect(videoOutputSize(null, 'canvas')).toEqual({ w: 1280, h: 720 })
  })
})

describe('영상 내보내기 — 탭 캡처에서 잘라낼 슬라이드 영역', () => {
  it('CSS px → 영상 px 배율(기기 배율 2)', () => {
    const r = captureCropRect({ left: 100, top: 0, width: 1080, height: 607.5 },
      { w: 1280, h: 652 }, { w: 2560, h: 1304 })
    expect(r).toEqual({ sx: 200, sy: 0, sw: 2160, sh: 1215 })
  })
  it('캡처가 축소된 경우(배율 < 1)', () => {
    const r = captureCropRect({ left: 0, top: 50, width: 1000, height: 500 },
      { w: 1000, h: 600 }, { w: 500, h: 300 })
    expect(r).toEqual({ sx: 0, sy: 25, sw: 500, sh: 250 })
  })
  it('프레임 밖으로 나간 부분은 잘라낸다', () => {
    const r = captureCropRect({ left: -10, top: -10, width: 120, height: 120 },
      { w: 100, h: 100 }, { w: 100, h: 100 })
    expect(r).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 })
  })
  it('그릴 수 없으면 null', () => {
    expect(captureCropRect(null, { w: 1, h: 1 }, { w: 1, h: 1 })).toBeNull()
    expect(captureCropRect({ left: 0, top: 0, width: 10, height: 10 }, { w: 0, h: 0 }, { w: 1, h: 1 })).toBeNull()
    expect(captureCropRect({ left: 200, top: 0, width: 10, height: 10 }, { w: 100, h: 100 }, { w: 100, h: 100 })).toBeNull()
  })
})

describe('영상 내보내기 — 파일 이름·시간·오류 문구', () => {
  it('프로젝트 이름 + 형식 확장자, 없으면 slide-export', () => {
    expect(videoFileName('발표 자료', 'video/mp4')).toBe('발표 자료.mp4')
    expect(videoFileName('a/b:c', 'video/webm')).toBe('abc.webm')
    expect(videoFileName('', 'video/mp4')).toBe('slide-export.mp4')
  })
  it('경과 시간', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7900)).toBe('0:07')
    expect(formatElapsed(754000)).toBe('12:34')
    expect(formatElapsed(3723000)).toBe('1:02:03')
  })
  it('권한 거부·미지원은 한국어 안내', () => {
    expect(captureErrorMessage({ name: 'NotAllowedError' })).toMatch(/화면 공유/)
    expect(captureErrorMessage({ name: 'NotSupportedError' })).toMatch(/지원하지 않습니다/)
    expect(captureErrorMessage(new Error('boom'))).toMatch(/boom/)
  })
})
