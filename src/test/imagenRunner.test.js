import { describe, it, expect } from 'vitest'
import { pickGenSize } from '../core/imagenRunner'

describe('imagenRunner — pickGenSize', () => {
  it('16:9 캔버스 → 긴 변 ~1024, 64 배수', () => {
    const { width, height } = pickGenSize({ w: 1280, h: 720 })
    expect(width).toBe(1024)   // 1280*0.8=1024
    expect(height).toBe(576)   // 720*0.8=576
    expect(width % 64).toBe(0)
    expect(height % 64).toBe(0)
  })

  it('정사각 캔버스 → 1024x1024', () => {
    expect(pickGenSize({ w: 1000, h: 1000 })).toEqual({ width: 1024, height: 1024 })
  })

  it('작은/큰 값도 512–1536로 클램프', () => {
    const small = pickGenSize({ w: 200, h: 100 })
    expect(small.width).toBeGreaterThanOrEqual(512)
    expect(small.height).toBeGreaterThanOrEqual(512)
    const big = pickGenSize({ w: 8000, h: 8000 })
    expect(big.width).toBeLessThanOrEqual(1536)
  })

  it('canvasSize 누락 시 기본 1024 근방', () => {
    const { width, height } = pickGenSize(undefined)
    expect(width % 64).toBe(0)
    expect(height % 64).toBe(0)
  })
})
