import { describe, it, expect } from 'vitest'
import { mergedTextStyles } from '../core/FlatExtractor'

/**
 * 배경이 있는 div 안에 글자가 직접 들어 있으면 '컨테이너+글자 병합' 경로를 탄다.
 * 이 경로가 스타일 목록을 따로 들고 있다가 그라데이션 글자 속성을 빠뜨렸다 —
 * 전시 포스터의 "HUMAN"(주황→파랑 그라데이션 글자)이 Genitor에서 글자는 투명하고
 * 그라데이션만 사각형으로 칠해진 채 나왔다.
 */
function fakeCs(over = {}) {
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'linear-gradient(90deg, rgb(255, 138, 76) 0%, rgb(75, 147, 255) 100%)',
    backgroundClip: 'text', webkitBackgroundClip: 'text',
    webkitTextFillColor: 'rgba(0, 0, 0, 0)',
    color: 'rgba(0, 0, 0, 0)', fontSize: '336px', fontFamily: 'Archivo Black', fontWeight: '900',
    lineHeight: '342px', textAlign: 'left', letterSpacing: '-10px', whiteSpace: 'nowrap',
    textShadow: '0px 4px 12px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'none', webkitBackdropFilter: 'none',
    webkitTextStrokeWidth: '0px', borderRadius: '0px', padding: '0px', opacity: '1',
    display: 'block', alignItems: 'normal', justifyContent: 'normal',
    ...over,
  }
}
const el = { closest: () => null, style: {}, parentElement: null, getAttribute: () => null }

describe('병합된 텍스트의 스타일', () => {
  it('그라데이션 글자 속성이 살아남는다 — 빠지면 배경 사각형이 된다', () => {
    const s = mergedTextStyles(fakeCs(), el, {})
    expect(s.webkitBackgroundClip).toBe('text')
    expect(s.backgroundClip).toBe('text')
    expect(s.webkitTextFillColor).toBe('rgba(0, 0, 0, 0)')
    expect(s.backgroundImage).toContain('linear-gradient')
  })

  it('글자 그림자 · nowrap도 살아남는다 — 예전 목록엔 없었다', () => {
    const s = mergedTextStyles(fakeCs(), el, {})
    expect(s.textShadow).toContain('rgba(0, 0, 0, 0.5)')
    expect(s.whiteSpace).toBe('nowrap')
  })

  it('유리 효과(backdrop-filter)도 살아남는다', () => {
    const s = mergedTextStyles(fakeCs({ backdropFilter: 'blur(14px) saturate(1.4)' }), el, {})
    expect(s.backdropFilter).toBe('blur(14px) saturate(1.4)')
  })

  it('글자 외곽선도 살아남는다', () => {
    const s = mergedTextStyles(fakeCs({ webkitTextStrokeWidth: '3px', webkitTextStrokeColor: 'rgb(47, 123, 255)' }), el, {})
    expect(s.textStroke).toBe('3px rgb(47, 123, 255)')
  })

  it('레이아웃은 병합이 정한 값으로 덮고, display는 넣지 않는다(종전과 같다)', () => {
    const s = mergedTextStyles(fakeCs({ display: 'block' }), el,
      { isFlex: true, justifyContent: 'center', alignItems: 'center' })
    expect(s.isFlex).toBe(true)
    expect(s.justifyContent).toBe('center')
    expect(s.alignItems).toBe('center')
    expect('display' in s).toBe(false)
  })
})
