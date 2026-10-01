import { describe, it, expect } from 'vitest'
import {
  captionSpaceBelow, fitsBelow,
  BOTTOM_CHROME_PX, CAPTION_GAP, CAPTION_FALLBACK_H,
} from '../core/captionPlacement'

const CANVAS = { w: 1280, h: 720 }
const fit = (vp) => Math.min(vp.w / CANVAS.w, vp.h / CANVAS.h)

describe('captionSpaceBelow', () => {
  it('화면과 슬라이드 비율이 같으면 여백이 없다', () => {
    const vp = { w: 1920, h: 1080 } // 정확히 16:9
    expect(captionSpaceBelow(vp, CANVAS, fit(vp))).toBe(0)
  })

  it('세로로 긴 화면에서는 아래 여백이 생긴다', () => {
    // 스크린샷과 같은 상황: 16:9 슬라이드를 세로로 긴 모니터에 띄운 경우
    const vp = { w: 1920, h: 1800 }
    const scale = fit(vp) // 폭이 제약 → 1.5
    const space = captionSpaceBelow(vp, CANVAS, scale)
    // 남는 세로 = 1800 − 720×1.5 = 720 → 위아래 360씩. 크롬 84를 빼고 배율로 나눈다.
    expect(space).toBeCloseTo((360 - BOTTOM_CHROME_PX) / scale, 6)
    expect(space).toBeGreaterThan(CAPTION_FALLBACK_H)
  })

  it('여백이 하단 크롬보다 좁으면 쓰지 않는다', () => {
    // 남는 세로가 위아래 40px씩 — 크롬(84)이 이미 다 먹는다
    const vp = { w: 1920, h: 1080 + 80 }
    expect(captionSpaceBelow(vp, CANVAS, fit(vp))).toBe(0)
  })

  it('좌우로만 남는 화면(가로로 긴)에는 아래 여백이 없다', () => {
    const vp = { w: 3000, h: 1080 } // 높이가 제약 → 세로는 꽉 참
    expect(captionSpaceBelow(vp, CANVAS, fit(vp))).toBe(0)
  })

  it('화면 px이 아니라 캔버스 단위로 돌려준다 — 배율이 작을수록 같은 여백이 더 크게 잡힌다', () => {
    // 같은 화면(1920×1800), 같은 16:9 비율, 캔버스만 2배.
    // 화면에 남는 띠는 둘 다 360px로 같지만 배율이 1.5 대 0.75로 절반이라
    // 캔버스 단위로 환산하면 두 배가 된다. 자막 폰트가 캔버스 단위로 고정돼 있으니
    // 이 환산을 빠뜨리면 큰 캔버스에서 들어갈 자막을 못 들어간다고 판단하게 된다.
    const vp = { w: 1920, h: 1800 }
    const small = captionSpaceBelow(vp, CANVAS, fit(vp)) // scale 1.5
    const large = captionSpaceBelow(vp, { w: 2560, h: 1440 }, Math.min(1920 / 2560, 1800 / 1440)) // scale 0.75
    expect(large).toBeCloseTo(small * 2, 6)
  })

  it('하단 크롬은 배율과 무관한 화면 px이라 나누기 전에 뺀다', () => {
    const vp = { w: 1920, h: 1800 }
    const scale = fit(vp)
    // 화면 띠 360px에서 크롬 84px을 먼저 빼고 배율로 나눈 값이어야 한다.
    expect(captionSpaceBelow(vp, CANVAS, scale)).toBeCloseTo((360 - BOTTOM_CHROME_PX) / scale, 6)
    // 배율로 나눈 뒤에 뺐다면 이 값이 나왔을 것 — 그게 아님을 못박는다.
    expect(captionSpaceBelow(vp, CANVAS, scale)).not.toBeCloseTo(360 / scale - BOTTOM_CHROME_PX, 6)
  })

  it('값이 없거나 배율이 0이면 0', () => {
    expect(captionSpaceBelow(null, CANVAS, 1)).toBe(0)
    expect(captionSpaceBelow({ w: 1920, h: 1800 }, null, 1)).toBe(0)
    expect(captionSpaceBelow({ w: 1920, h: 1800 }, CANVAS, 0)).toBe(0)
    expect(captionSpaceBelow({ w: 0, h: 0 }, CANVAS, 1)).toBe(0)
  })
})

describe('fitsBelow', () => {
  it('실측 높이 + 위아래 간격이 여백에 들어가면 참', () => {
    expect(fitsBelow(100 + CAPTION_GAP * 2, 100)).toBe(true)
    expect(fitsBelow(100 + CAPTION_GAP * 2 - 1, 100)).toBe(false)
  })

  it('아직 못 쟀으면(0) 보수적 추정값으로 판단한다', () => {
    expect(fitsBelow(CAPTION_FALLBACK_H + CAPTION_GAP * 2, 0)).toBe(true)
    expect(fitsBelow(CAPTION_FALLBACK_H, 0)).toBe(false)
  })

  it('여백이 없으면 언제나 거짓', () => {
    expect(fitsBelow(0, 10)).toBe(false)
    expect(fitsBelow(0, 0)).toBe(false)
  })
})
