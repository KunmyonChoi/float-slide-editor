import { describe, it, expect } from 'vitest'
import { exportFlatHtml } from '../core/FlatExporter'

// ── 테스트 헬퍼 ─────────────────────────────────────────────

/** 최소 FlatElement 생성 */
function makeEl(overrides = {}) {
  return {
    id: 'flat-1',
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    zIndex: 0,
    content: '',
    isRich: false,
    merged: false,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      color: '',
      fontSize: '',
      fontFamily: '',
      fontWeight: '',
      lineHeight: '',
      textAlign: '',
      borderRadius: '0px',
      border: '0px none',
      borderTop: '0px none',
      borderRight: '0px none',
      borderBottom: '0px none',
      borderLeft: '0px none',
      boxShadow: 'none',
      opacity: '1',
      padding: '0px',
      letterSpacing: 'normal',
      textTransform: 'none',
      textDecoration: 'none',
      objectFit: 'cover',
    },
    ...overrides,
  }
}

const CANVAS = { w: 1280, h: 800 }

// ═══════════════════════════════════════════════════════════════
//  기본 구조
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — 기본 구조', () => {
  it('유효한 HTML 문서 구조를 반환한다', () => {
    const html = exportFlatHtml([], CANVAS)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="ko">')
    expect(html).toContain('<meta charset="UTF-8">')
    expect(html).toContain('</html>')
  })

  it('body에 캔버스 크기가 반영된다', () => {
    const html = exportFlatHtml([], { w: 1920, h: 1080 })
    expect(html).toContain('width:1920px')
    expect(html).toContain('height:1080px')
  })
})

// ═══════════════════════════════════════════════════════════════
//  Shape 요소
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — shape 요소', () => {
  it('position:absolute 스타일이 적용된다', () => {
    const el = makeEl({ x: 56, y: 48, width: 200, height: 100, zIndex: 3 })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('position:absolute')
    expect(html).toContain('left:56px')
    expect(html).toContain('top:48px')
    expect(html).toContain('width:200px')
    expect(html).toContain('height:100px')
    expect(html).toContain('z-index:3')
  })

  it('배경색과 border-radius가 반영된다', () => {
    const el = makeEl({
      styles: {
        ...makeEl().styles,
        backgroundColor: 'rgb(248, 250, 252)',
        borderRadius: '12px',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('background-color:rgb(248, 250, 252)')
    expect(html).toContain('border-radius:12px')
  })

  it('gradient background-image가 반영된다', () => {
    const el = makeEl({
      styles: {
        ...makeEl().styles,
        backgroundImage: 'linear-gradient(135deg, rgb(5, 46, 22) 0%, rgb(22, 101, 52) 100%)',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('background-image:linear-gradient')
  })

  it('border 개별 side가 반영된다', () => {
    const el = makeEl({
      styles: {
        ...makeEl().styles,
        border: '0px none',
        borderLeft: '5px solid rgb(79, 70, 229)',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('border-left:5px solid')
  })
})

// ═══════════════════════════════════════════════════════════════
//  Text 요소
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — text 요소', () => {
  it('plain text는 HTML 이스케이프된다', () => {
    const el = makeEl({
      type: 'text',
      content: 'A & B < C',
      isRich: false,
      styles: { ...makeEl().styles, color: 'rgb(30, 41, 59)', fontSize: '13px' },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('A &amp; B &lt; C')
    // 이중 인코딩 없음
    expect(html).not.toContain('&amp;amp;')
  })

  it('rich text(isRich=true)는 HTML 그대로 출력된다', () => {
    const el = makeEl({
      type: 'text',
      content: '<strong style="color: #fff;">2배</strong> 증가',
      isRich: true,
      styles: { ...makeEl().styles, color: 'rgb(209, 250, 229)', fontSize: '11.5px' },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('<strong style="color: #fff;">2배</strong>')
    expect(html).toContain(' 증가')
  })

  it('텍스트 스타일(color, fontSize, fontFamily 등)이 적용된다', () => {
    const el = makeEl({
      type: 'text',
      content: 'GPU 스펙 비교',
      styles: {
        ...makeEl().styles,
        color: 'rgb(79, 70, 229)',
        fontSize: '13px',
        fontFamily: '"Segoe UI", Arial, sans-serif',
        fontWeight: '700',
        letterSpacing: '1px',
        textTransform: 'uppercase',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('color:rgb(79, 70, 229)')
    expect(html).toContain('font-size:13px')
    expect(html).toContain('font-weight:700')
    expect(html).toContain('letter-spacing:1px')
    expect(html).toContain('text-transform:uppercase')
  })

  it('-webkit-background-clip:text (그래디언트 텍스트)가 적용된다', () => {
    const el = makeEl({
      type: 'text',
      content: '그래디언트 텍스트',
      styles: {
        ...makeEl().styles,
        backgroundImage: 'linear-gradient(90deg, #f00, #00f)',
        webkitBackgroundClip: 'text',
        webkitTextFillColor: 'transparent',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('-webkit-background-clip:text')
    expect(html).toContain('-webkit-text-fill-color:transparent')
  })
})

// ═══════════════════════════════════════════════════════════════
//  Merged 요소 — flex 정렬
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — merged 요소 flex 정렬', () => {
  it('merged + isFlex → 원본 flex 정렬 사용', () => {
    const el = makeEl({
      type: 'text',
      content: '중앙 정렬 텍스트',
      merged: true,
      styles: {
        ...makeEl().styles,
        isFlex: true,
        justifyContent: 'center',
        alignItems: 'center',
      },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('display:flex')
    expect(html).toContain('align-items:center')
    expect(html).toContain('justify-content:center')
  })

  it('merged + 비flex → textAlign 기반 justify-content', () => {
    const el = makeEl({
      type: 'text',
      content: '우측 정렬',
      merged: true,
      styles: { ...makeEl().styles, isFlex: false, textAlign: 'right' },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('display:flex')
    expect(html).toContain('justify-content:flex-end')
  })

  it('merged + 비flex + textAlign:center → justify-content:center', () => {
    const el = makeEl({
      type: 'text',
      content: '중앙',
      merged: true,
      styles: { ...makeEl().styles, isFlex: false, textAlign: 'center' },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('justify-content:center')
  })

  it('비merged 요소에는 flex가 적용되지 않는다', () => {
    const el = makeEl({
      type: 'text',
      content: '일반 텍스트',
      merged: false,
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).not.toContain('display:flex')
  })
})

// ═══════════════════════════════════════════════════════════════
//  Image 요소
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — image 요소', () => {
  it('<img> 태그가 생성되고 src가 이스케이프된다', () => {
    const el = makeEl({
      type: 'image',
      content: 'photo.png',
      styles: { ...makeEl().styles, objectFit: 'contain', borderRadius: '8px' },
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain('<img src="photo.png"')
    expect(html).toContain('object-fit:contain')
    expect(html).toContain('border-radius:8px')
  })
})

// ═══════════════════════════════════════════════════════════════
//  SVG 요소
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — SVG 요소', () => {
  it('SVG content가 div로 감싸져 출력된다', () => {
    const svgContent = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
    const el = makeEl({
      type: 'svg',
      content: svgContent,
      x: 860,
      y: 250,
      width: 120,
      height: 120,
    })
    const html = exportFlatHtml([el], CANVAS)
    expect(html).toContain(svgContent)
    expect(html).toContain('position:absolute')
    expect(html).toContain('left:860px')
  })
})

// ═══════════════════════════════════════════════════════════════
//  z-index 순서
// ═══════════════════════════════════════════════════════════════
describe('exportFlatHtml — z-index 순서', () => {
  it('요소들이 zIndex 순서대로 출력된다', () => {
    const els = [
      makeEl({ id: 'flat-1', zIndex: 0, type: 'shape', content: '' }),
      makeEl({ id: 'flat-2', zIndex: 1, type: 'text', content: '뒤', styles: { ...makeEl().styles, color: 'red' } }),
      makeEl({ id: 'flat-3', zIndex: 2, type: 'text', content: '앞', styles: { ...makeEl().styles, color: 'blue' } }),
    ]
    const html = exportFlatHtml(els, CANVAS)
    const idx0 = html.indexOf('z-index:0')
    const idx1 = html.indexOf('z-index:1')
    const idx2 = html.indexOf('z-index:2')
    expect(idx0).toBeLessThan(idx1)
    expect(idx1).toBeLessThan(idx2)
  })
})
