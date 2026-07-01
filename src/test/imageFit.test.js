import { describe, it, expect } from 'vitest'
import { containFitRect } from '../core/imageFit'

describe('containFitRect — object-fit:contain 표시 사각형', () => {
  it('이미지가 박스보다 넓으면 상하 레터박스(가로 꽉, 세로 축소·중앙)', () => {
    // 박스 100x100, 이미지 200x100(2:1) → w=100, h=50, y=25
    expect(containFitRect(100, 100, 200, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })
  it('이미지가 박스보다 좁으면 좌우 필러박스(세로 꽉, 가로 축소·중앙)', () => {
    // 박스 100x100, 이미지 100x200(1:2) → h=100, w=50, x=25
    expect(containFitRect(100, 100, 100, 200)).toEqual({ x: 25, y: 0, w: 50, h: 100 })
  })
  it('비율이 같으면 박스 전체를 채움', () => {
    expect(containFitRect(200, 100, 400, 200)).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  })
})
