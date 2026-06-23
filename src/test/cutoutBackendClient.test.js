import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCutoutBase, setCutoutBase, cutoutDockerRunCommand, CUTOUT_DEFAULT_PORT,
} from '../core/CutoutBackendClient'

// 실제 분리(segmentImage)는 서버 추론이라 jsdom 검증 불가 → URL 해석/명령 로직만 단위 테스트.

describe('CutoutBackendClient — 베이스 URL 해석', () => {
  beforeEach(() => { setCutoutBase(null) })

  it('기본은 localhost:8322', () => {
    expect(getCutoutBase()).toBe(`http://localhost:${CUTOUT_DEFAULT_PORT}`)
  })

  it('localStorage 오버라이드가 우선, 끝 슬래시 제거', () => {
    setCutoutBase('http://192.168.0.5:9000/')
    expect(getCutoutBase()).toBe('http://192.168.0.5:9000')
    setCutoutBase(null)
    expect(getCutoutBase()).toBe(`http://localhost:${CUTOUT_DEFAULT_PORT}`)
  })

  it('docker run 명령은 --gpus all + 포트 매핑 포함', () => {
    const cmd = cutoutDockerRunCommand()
    expect(cmd).toContain('--gpus all')
    expect(cmd).toContain(`-p ${CUTOUT_DEFAULT_PORT}:${CUTOUT_DEFAULT_PORT}`)
    expect(cmd).toContain('dilly97/float-cutout')
  })
})
