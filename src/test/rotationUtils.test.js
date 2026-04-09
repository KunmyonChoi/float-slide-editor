import { describe, it, expect } from 'vitest'
import {
  computeRotationAngle,
  snapRotation,
  normalizeAngle,
  rotatePoint,
  getRotatedAABB,
  canvasDeltaToLocal,
} from '../core/RotationUtils'

describe('computeRotationAngle', () => {
  it('마우스가 중심 바로 위 → 0°', () => {
    const angle = computeRotationAngle(100, 100, 100, 50)
    expect(angle).toBeCloseTo(0, 1)
  })

  it('마우스가 중심 오른쪽 → 90°', () => {
    const angle = computeRotationAngle(100, 100, 150, 100)
    expect(angle).toBeCloseTo(90, 1)
  })

  it('마우스가 중심 아래 → 180°', () => {
    const angle = computeRotationAngle(100, 100, 100, 150)
    expect(angle).toBeCloseTo(180, 1)
  })

  it('마우스가 중심 왼쪽 → 270° (또는 -90°)', () => {
    const angle = computeRotationAngle(100, 100, 50, 100)
    // atan2 결과에 +90 오프셋 → 270°
    expect(normalizeAngle(angle)).toBeCloseTo(270, 1)
  })
})

describe('snapRotation', () => {
  it('0° 근처 스냅', () => {
    expect(snapRotation(3)).toBe(0)
    expect(snapRotation(-3)).toBe(0) // -3 → 357 → snaps to 0 (within 360 wrap)
  })

  it('45° 근처 스냅', () => {
    expect(snapRotation(43)).toBe(45)
    expect(snapRotation(47)).toBe(45)
  })

  it('threshold 밖이면 원래 값', () => {
    expect(snapRotation(30)).toBe(30)
    expect(snapRotation(60)).toBe(60)
  })

  it('360° 근처 → 0°으로 스냅', () => {
    expect(snapRotation(358)).toBe(0)
  })
})

describe('normalizeAngle', () => {
  it('양수 유지', () => {
    expect(normalizeAngle(45)).toBe(45)
  })

  it('음수 → 양수 변환', () => {
    expect(normalizeAngle(-90)).toBe(270)
  })

  it('360 이상 → 정규화', () => {
    expect(normalizeAngle(450)).toBe(90)
  })
})

describe('rotatePoint', () => {
  it('0° 회전 → 원래 위치', () => {
    const p = rotatePoint(150, 100, 100, 100, 0)
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(100)
  })

  it('90° 회전', () => {
    // (150, 100) 을 (100, 100) 기준으로 90° → (100, 150)
    const p = rotatePoint(150, 100, 100, 100, 90)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(150)
  })

  it('180° 회전', () => {
    const p = rotatePoint(150, 100, 100, 100, 180)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(100)
  })
})

describe('getRotatedAABB', () => {
  it('0° → 원래 rect', () => {
    const r = getRotatedAABB(100, 100, 200, 100, 0)
    expect(r).toEqual({ x: 100, y: 100, width: 200, height: 100 })
  })

  it('null/undefined → 원래 rect', () => {
    const r = getRotatedAABB(100, 100, 200, 100, null)
    expect(r).toEqual({ x: 100, y: 100, width: 200, height: 100 })
  })

  it('90° → 가로세로 교환', () => {
    const r = getRotatedAABB(0, 0, 200, 100, 90)
    // 중심: (100, 50), 회전 후 AABB
    expect(r.width).toBeCloseTo(100)
    expect(r.height).toBeCloseTo(200)
  })

  it('45° → 대각선 확장', () => {
    const r = getRotatedAABB(0, 0, 100, 100, 45)
    // 정사각형 45° 회전 → 대각선 길이 = 100√2 ≈ 141.4
    expect(r.width).toBeCloseTo(141.42, 0)
    expect(r.height).toBeCloseTo(141.42, 0)
  })
})

describe('canvasDeltaToLocal', () => {
  it('0° → delta 유지', () => {
    const d = canvasDeltaToLocal(10, 5, 0)
    expect(d.dx).toBeCloseTo(10)
    expect(d.dy).toBeCloseTo(5)
  })

  it('null → delta 유지', () => {
    const d = canvasDeltaToLocal(10, 5, null)
    expect(d.dx).toBe(10)
    expect(d.dy).toBe(5)
  })

  it('90° 회전 → dx/dy 교환', () => {
    // 요소가 90° 회전된 상태에서 캔버스 오른쪽(dx=10) → 로컬 위쪽(dy=-10)
    const d = canvasDeltaToLocal(10, 0, 90)
    expect(d.dx).toBeCloseTo(0)
    expect(d.dy).toBeCloseTo(-10)
  })

  it('역변환 검증: rotate → inverse rotate 원복', () => {
    const d1 = canvasDeltaToLocal(10, 5, 30)
    const d2 = canvasDeltaToLocal(d1.dx, d1.dy, -30)
    expect(d2.dx).toBeCloseTo(10)
    expect(d2.dy).toBeCloseTo(5)
  })
})
