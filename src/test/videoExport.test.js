import { describe, it, expect } from 'vitest'
import {
  pickRecorderMime, videoExtension, videoOutputSize, captureCropRect, cropBounds,
  videoFileName, formatElapsed, captureErrorMessage, VIDEO_MIME_CANDIDATES,
  expectedStagePixels, isUpscaled, upscaleNotice, VIDEO_ONLY_MIME_CANDIDATES, isRecordStopKey,
  calibrationMarkers, findMarkers, solveCaptureMapping, scaleMapping, calibrationFailedMessage,
} from '../core/videoExport'
import { paintCaptureFrame } from './fixtures/calibFrame'

describe('영상 내보내기 — 녹화 형식 선택', () => {
  it('MP4(H.264/AAC)를 먼저 고른다', () => {
    expect(pickRecorderMime(() => true)).toBe(VIDEO_MIME_CANDIDATES[0])
  })
  it('MP4가 안 되면 WebM VP9 → VP8 순', () => {
    expect(pickRecorderMime(m => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
    expect(pickRecorderMime(m => m === 'video/webm;codecs=vp8,opus' || m === 'video/webm')).toBe('video/webm;codecs=vp8,opus')
    expect(pickRecorderMime(m => m === 'video/mp4')).toBe('video/mp4')
  })
  it('오디오 트랙이 없으면 오디오 코덱 없는 형식만 — Firefox가 vp8,opus로 영상만 담다 멈추지 않게', () => {
    const firefox = m => m.startsWith('video/webm') && !m.includes('vp9')
    expect(pickRecorderMime(firefox)).toBe('video/webm;codecs=vp8,opus')
    expect(pickRecorderMime(firefox, { audio: false })).toBe('video/webm;codecs=vp8')
    expect(pickRecorderMime(() => true, { audio: false })).toBe('video/mp4;codecs=avc1.640028')
    for (const m of VIDEO_ONLY_MIME_CANDIDATES) expect(m).not.toMatch(/opus|mp4a/)
  })
  it('녹화 정지 키는 Esc(반복 입력 제외)', () => {
    expect(isRecordStopKey({ key: 'Escape' })).toBe(true)
    expect(isRecordStopKey({ key: 'Esc' })).toBe(true)
    expect(isRecordStopKey({ key: 'Escape', repeat: true })).toBe(false)
    expect(isRecordStopKey({ key: 'Enter' })).toBe(false)
    expect(isRecordStopKey(null)).toBe(false)
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
  // 잘라낼 사각형이 슬라이드(영상 px)의 온 픽셀 안쪽에 있고, 슬라이드 비율을 지키고, 1% 넘게 깎지 않았는지
  const expectInside = (r, [x0, y0, x1, y1]) => {
    expect(r.sx).toBeGreaterThanOrEqual(Math.ceil(x0 - 0.01) - 1e-9)
    expect(r.sy).toBeGreaterThanOrEqual(Math.ceil(y0 - 0.01) - 1e-9)
    expect(r.sx + r.sw).toBeLessThanOrEqual(Math.floor(x1 + 0.01) + 1e-9)
    expect(r.sy + r.sh).toBeLessThanOrEqual(Math.floor(y1 + 0.01) + 1e-9)
    expect(r.sw / r.sh).toBeCloseTo((x1 - x0) / (y1 - y0), 6)
    expect(r.sw).toBeGreaterThan((x1 - x0) * 0.99)
    expect(r.sh).toBeGreaterThan((y1 - y0) * 0.99)
  }
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
  it('가장자리가 픽셀 중간에 걸리면 안쪽 온 픽셀로 맞춘다(검정이 섞인 테두리 줄 방지)', () => {
    // 1600×900 창의 9:16 덱: 슬라이드 559.25..1040.75 × 0..856
    const r = captureCropRect({ left: 559.25, top: 0, width: 481.5, height: 856 },
      { w: 1600, h: 900 }, { w: 1600, h: 900 })
    expectInside(r, [559.25, 0, 1040.75, 856])
    expect(r.sx).toBe(560)
    expect(r.sw).toBe(480)
    // 중간 캔버스로 옮길 정수 범위 — 슬라이드 온 픽셀만(검정이 섞인 559·1040열 제외)
    expect(cropBounds(r)).toEqual({ x: 560, y: 1, w: 480, h: 854 }) // 비율 맞춤으로 위아래 ~1px
  })
  it('가장자리가 온 픽셀이면 하나도 깎지 않는다', () => {
    const r = captureCropRect({ left: 372, top: 0, width: 856, height: 856 },
      { w: 1600, h: 900 }, { w: 1600, h: 900 })
    expect(r).toEqual({ sx: 372, sy: 0, sw: 856, sh: 856 })
    expect(cropBounds(r)).toEqual({ x: 372, y: 0, w: 856, h: 856 })
  })
  it('배율이 소수인 기기(1.5배)에서도 안쪽 · 비율 유지', () => {
    const rect = { left: 64.96875, top: 0.1666666716337204, width: 770.0625, height: 1369 }
    const kx = 1350 / 900, ky = 2120 / 1413
    const r = captureCropRect(rect, { w: 900, h: 1413 }, { w: 1350, h: 2120 })
    expectInside(r, [rect.left * kx, rect.top * ky, (rect.left + rect.width) * kx, (rect.top + rect.height) * ky])
    const b = cropBounds(r)
    expect(b.x).toBeLessThanOrEqual(r.sx)
    expect(b.y).toBeLessThanOrEqual(r.sy)
    expect(b.x + b.w).toBeGreaterThanOrEqual(r.sx + r.sw)
    expect(b.y + b.h).toBeGreaterThanOrEqual(r.sy + r.sh)
    // 정수 범위도 슬라이드 온 픽셀 안
    expect(b.x).toBeGreaterThanOrEqual(Math.ceil(rect.left * kx))
    expect(b.x + b.w).toBeLessThanOrEqual(Math.floor((rect.left + rect.width) * kx))
  })
  it('부동소수 오차로 정수에서 살짝 벗어난 값은 한 픽셀을 통째로 깎지 않는다', () => {
    const r = captureCropRect({ left: 372.0000001, top: 0, width: 855.9999998, height: 856.0000001 },
      { w: 1600, h: 900 }, { w: 1600, h: 900 })
    expect(r.sx).toBe(372)
    expect(r.sw).toBeCloseTo(856, 4)
    expect(r.sh).toBeCloseTo(856, 4)
    expect(cropBounds(r)).toEqual({ x: 372, y: 0, w: 856, h: 856 })
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

describe('영상 내보내기 — 지금 창에서 담길 슬라이드 크기(늘어남 경고)', () => {
  it('덱 비율을 창(아래 REC 표시줄 제외)에 맞추고 기기 배율을 곱한다', () => {
    // 1280×764 창 → 슬라이드 영역 1280×720 → 16:9는 1280×720, 배율 2면 2560×1440
    expect(expectedStagePixels({ w: 1280, h: 720 }, { w: 1280, h: 764 }, 1)).toEqual({ w: 1280, h: 720 })
    expect(expectedStagePixels({ w: 1280, h: 720 }, { w: 1280, h: 764 }, 2)).toEqual({ w: 2560, h: 1440 })
    // 세로 9:16은 높이에 맞춘다
    expect(expectedStagePixels({ w: 1080, h: 1920 }, { w: 1920, h: 1004 }, 1)).toEqual({ w: 540, h: 960 })
  })
  it('표시줄 높이를 따로 줄 수 있고, 창 정보가 없으면 0', () => {
    expect(expectedStagePixels({ w: 100, h: 100 }, { w: 200, h: 100 }, 1, 0)).toEqual({ w: 100, h: 100 })
    expect(expectedStagePixels({ w: 100, h: 100 }, null, 1)).toEqual({ w: 0, h: 0 })
  })
  it('출력보다 작을 때만 늘어남으로 보고 안내한다', () => {
    expect(isUpscaled({ w: 1280, h: 720 }, { w: 1920, h: 1080 })).toBe(true)
    expect(isUpscaled({ w: 1919, h: 1079 }, { w: 1920, h: 1080 })).toBe(false) // 반올림 오차
    expect(isUpscaled({ w: 2560, h: 1440 }, { w: 1920, h: 1080 })).toBe(false)
    expect(isUpscaled(null, { w: 1920, h: 1080 })).toBe(false)
    expect(upscaleNotice({ w: 1280, h: 720 }, { w: 1920, h: 1080 }))
      .toBe('지금 창에서는 슬라이드가 1280×720으로 보여 1920×1080으로 늘어나 흐릴 수 있습니다 — 창을 최대화하거나 전체 화면(F11)으로 녹화하세요.')
    expect(upscaleNotice({ w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toBe('')
  })
})

describe('영상 내보내기 — 화면 위치 보정(창·화면 공유)', () => {
  const VP = { w: 1280, h: 720 }
  const solve = (frame, viewport = VP) => {
    const markers = calibrationMarkers(viewport)
    return solveCaptureMapping(markers, findMarkers(frame, markers), { w: frame.width, h: frame.height }, viewport)
  }
  const near = (m, want, eps = 0.6) => {
    expect(m).toBeTruthy()
    expect(Math.abs(m.sx - want.sx)).toBeLessThan(0.01)
    expect(Math.abs(m.sy - want.sy)).toBeLessThan(0.01)
    expect(Math.abs(m.ox - want.ox)).toBeLessThan(eps)
    expect(Math.abs(m.oy - want.oy)).toBeLessThan(eps)
  }

  it('표식은 네 귀퉁이 — 색이 서로 다르고 뷰포트 안', () => {
    const ms = calibrationMarkers(VP)
    expect(ms.map(m => m.id)).toEqual(['tl', 'tr', 'bl', 'br'])
    expect(new Set(ms.map(m => m.color.join())).size).toBe(4)
    for (const m of ms) {
      expect(m.left).toBeGreaterThan(0)
      expect(m.top).toBeGreaterThan(0)
      expect(m.left + m.size).toBeLessThan(VP.w)
      expect(m.top + m.size).toBeLessThan(VP.h)
    }
  })

  it('창 공유: 위 도구 막대(85px)·왼쪽 테두리(8px)만큼 밀린 자리를 찾는다', () => {
    const map = { sx: 1, sy: 1, ox: 8, oy: 85 }
    near(solve(paintCaptureFrame({ fw: 1296, fh: 813, viewport: VP, map })).map, map)
  })

  it('화면 공유: 배율 1.25 · 창이 화면 가운데쯤', () => {
    const vp = { w: 1200, h: 700 }
    const map = { sx: 1.25, sy: 1.25, ox: 100, oy: 150 }
    near(solve(paintCaptureFrame({ fw: 1920, fh: 1080, viewport: vp, map }), vp).map, map)
  })

  it('기기 배율 2(탭 공유와 같은 모양)', () => {
    const map = { sx: 2, sy: 2, ox: 0, oy: 0 }
    near(solve(paintCaptureFrame({ fw: 2560, fh: 1440, viewport: VP, map })).map, map)
  })

  it('표식 하나가 가려져도 대각선 둘 이상이면 잰다 · 한 줄만 남거나 하나뿐이면 실패', () => {
    const map = { sx: 1, sy: 1, ox: 8, oy: 85 }
    const frame = (drop) => paintCaptureFrame({ fw: 1296, fh: 813, viewport: VP, map, drop })
    near(solve(frame(['br'])).map, map)
    near(solve(frame(['tr', 'bl'])).map, map)
    expect(solve(frame(['tl', 'tr'])).map).toBe(null) // 아래 줄만 — 세로 배율을 알 수 없다
    expect(solve(frame(['tl', 'tr', 'bl'])).map).toBe(null)
  })

  it('표식이 없으면(페이지가 영상에 없음·가려짐) 실패', () => {
    const r = solve(paintCaptureFrame({ fw: 1296, fh: 813, viewport: VP, map: { sx: 1, sy: 1, ox: 8, oy: 85 }, markers: false }))
    expect(r.map).toBe(null)
    expect(r.reason).toBe('markers')
  })

  it('바탕화면에 같은 색이 있어 중심이 끌려가면 믿지 않는다', () => {
    const frame = paintCaptureFrame({
      fw: 1920, fh: 1080, viewport: VP, map: { sx: 1, sy: 1, ox: 300, oy: 200 },
      extra: [{ x: 10, y: 10, w: 120, h: 60, color: [255, 0, 0] }],
    })
    expect(solve(frame).map).toBe(null)
  })

  it('페이지가 영상 밖으로 나가면(화면 공유에서 창이 화면 끝에 걸침) 실패', () => {
    const markers = calibrationMarkers(VP)
    const found = markers.map(m => ({ id: m.id, x: m.x + 900, y: m.y, count: 784, w: 28, h: 28 }))
    expect(solveCaptureMapping(markers, found, { w: 1920, h: 1080 }, VP).reason).toBe('outside')
  })

  it('가로·세로 배율이 다르면 실패(표식을 잘못 짝지음)', () => {
    const markers = calibrationMarkers(VP)
    const found = markers.map(m => ({ id: m.id, x: m.x, y: m.y * 1.3, count: 784, w: 28, h: 36 }))
    expect(solveCaptureMapping(markers, found, { w: 1920, h: 1080 }, VP).reason).toBe('aspect')
  })

  it('줄여 읽은 버퍼에서 잰 대응을 원래 영상 크기로 늘린다', () => {
    expect(scaleMapping({ sx: 1, sy: 1, ox: 8, oy: 85 }, 2)).toEqual({ sx: 2, sy: 2, ox: 16, oy: 170 })
    // 3840×2160 화면을 1920 폭으로 줄여 잰 경우
    const map = { sx: 1, sy: 1, ox: 50, oy: 90 }
    const r = solve(paintCaptureFrame({ fw: 1920, fh: 1080, viewport: VP, map }))
    near(scaleMapping(r.map, 2), { sx: 2, sy: 2, ox: 100, oy: 180 }, 1.2)
  })

  it('대응이 있으면 잘라낼 사각형에 자리·배율을 그대로 쓴다', () => {
    const map = { sx: 1.25, sy: 1.25, ox: 10, oy: 90 }
    const crop = captureCropRect({ left: 0, top: 0, width: 1280, height: 720 }, VP, { w: 1620, h: 1000 }, map)
    expect(crop).toEqual({ sx: 10, sy: 90, sw: 1600, sh: 900 })
  })

  it('보정 실패 문구 — Firefox는 창 선택·가리지 않기', () => {
    expect(calibrationFailedMessage(true)).toMatch(/브라우저 창/)
    expect(calibrationFailedMessage(true)).toMatch(/가리지/)
    expect(calibrationFailedMessage(false)).toMatch(/이 탭/)
  })
})
