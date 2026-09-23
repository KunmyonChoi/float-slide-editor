import { describe, it, expect } from 'vitest'
import { stripSvgSelfPositioning } from '../core/svgContent'

/**
 * 관계선처럼 잘라 쓴 svg가 화면 아래로 쏟아지던 회귀를 잠근다.
 * flat 요소는 상자(x/y/w/h)와 마크업을 따로 들고 가므로, 마크업에 자기 위치가 남으면
 * 렌더 때 상자 위치에 한 번 더 더해진다(실제 덱에서 곡선이 +237,+438만큼 밀렸다).
 */
describe('stripSvgSelfPositioning', () => {
  it('루트 svg의 자기 배치 선언만 지운다', () => {
    const html = '<svg width="400" height="120" viewBox="0 0 400 120" '
      + 'style="position:absolute;left:760px;top:700px;width:400px;height:120px;">'
      + '<path d="M 10 110 Q 200 10 390 110"/></svg>'
    const out = stripSvgSelfPositioning(html)

    expect(out).not.toMatch(/position\s*:/)
    expect(out).not.toMatch(/left\s*:/)
    expect(out).not.toMatch(/top\s*:/)
    expect(out).toContain('width:400px')   // 크기는 남는다
    expect(out).toContain('viewBox="0 0 400 120"')
    expect(out).toContain('<path d="M 10 110 Q 200 10 390 110"/>')
  })

  it('회전 등 다른 transform은 건드리지 않는다', () => {
    const out = stripSvgSelfPositioning('<svg style="position:absolute;left:10px;transform:rotate(8deg);"></svg>')
    expect(out).toContain('transform:rotate(8deg)')
    expect(out).not.toMatch(/left\s*:/)
  })

  it('남는 선언이 없으면 style 속성을 통째로 뺀다', () => {
    const out = stripSvgSelfPositioning('<svg width="10" height="10" style="position:absolute;left:0;top:0;"><g/></svg>')
    expect(out).toBe('<svg width="10" height="10"><g/></svg>')
  })

  it('안쪽 자식의 style은 그대로 둔다', () => {
    const html = '<svg style="position:absolute;left:5px;"><rect style="position:absolute;left:9px;"/></svg>'
    expect(stripSvgSelfPositioning(html)).toBe('<svg><rect style="position:absolute;left:9px;"/></svg>')
  })

  it('style이 없거나 svg가 아니면 그대로 돌려준다', () => {
    expect(stripSvgSelfPositioning('<svg width="10"></svg>')).toBe('<svg width="10"></svg>')
    expect(stripSvgSelfPositioning('<div style="left:1px"></div>')).toBe('<div style="left:1px"></div>')
    expect(stripSvgSelfPositioning('')).toBe('')
    expect(stripSvgSelfPositioning(null)).toBe(null)
  })

  it('margin으로 밀어 놓은 것도 뗀다', () => {
    const out = stripSvgSelfPositioning('<svg style="margin-left:40px;margin-top:10px;opacity:.75;"></svg>')
    expect(out).toContain('opacity:.75')
    expect(out).not.toMatch(/margin/)
  })
})
