import { describe, it, expect } from 'vitest'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'

describe('유리 효과(backdrop-filter)', () => {
  // 가져오기(backdrop-filter → styles.backdropFilter)는 jsdom이 이 속성을 계산하지 않아 브라우저 E2E로 확인한다.

  it('내보내면 backdrop-filter와 웹킷 접두어가 남는다', () => {
    const out = exportFlatHtmlAllPages({ '0-0': { canvasSize: { w: 1920, h: 1080 }, elements: [{
      id: 'flat-1', type: 'shape', content: '', x: 0, y: 0, width: 600, height: 400, zIndex: 1,
      styles: { backgroundColor: 'rgba(255, 255, 255, 0.18)', backdropFilter: 'blur(18px) saturate(1.4)' } }] } })
    expect(out).toContain('backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4)')
  })

  it('없으면 아무것도 남기지 않는다', () => {
    const out = exportFlatHtmlAllPages({ '0-0': { canvasSize: { w: 1920, h: 1080 }, elements: [{
      id: 'flat-1', type: 'shape', content: '', x: 0, y: 0, width: 600, height: 400, zIndex: 1, styles: { backgroundColor: '#fff', backdropFilter: 'none' } }] } })
    expect(out).not.toContain('backdrop-filter')
  })
})
