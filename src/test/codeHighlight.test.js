import { describe, it, expect } from 'vitest'
import { highlightCode, detectLang } from '../core/codeHighlight'

describe('codeHighlight', () => {
  it('인라인 색 span 출력 (export 호환)', () => {
    const { html } = highlightCode('const x = 1', 'js')
    expect(html).toContain('<span style="color:')
    expect(html).toContain('const')
  })

  it('키워드/문자열/숫자/주석 색 구분', () => {
    const { html } = highlightCode('const s = "hi" // c', 'js')
    // 키워드 const, 문자열 "hi", 주석 // c 각각 span
    expect((html.match(/<span/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(html).toContain('"hi"')
    expect(html).toContain('// c')
  })

  it('HTML 특수문자 이스케이프', () => {
    const { html } = highlightCode('a < b && c > d', 'js')
    expect(html).toContain('&lt;')
    expect(html).toContain('&gt;')
    expect(html).toContain('&amp;')
  })

  it('함수 호출은 func 색 (이름 뒤 괄호)', () => {
    const { html } = highlightCode('greet(name)', 'js')
    expect(html).toContain('greet')
    expect(html).toContain('<span') // greet → func span
  })

  it('python: # 주석 + def 키워드', () => {
    const { html } = highlightCode('def f():\n    # note\n    return 1', 'python')
    expect(html).toContain('# note')
    expect(html).toContain('def')
  })

  it('공백/줄바꿈 보존', () => {
    const { html } = highlightCode('a\n  b', 'js')
    expect(html).toContain('\n')
    expect(html).toContain('  b')
  })

  it('detectLang: python/json/js', () => {
    expect(detectLang('def f():\n  return 1')).toBe('python')
    expect(detectLang('{ "a": 1, "b": [2,3] }')).toBe('json')
    expect(detectLang('const a = () => 1')).toBe('js')
  })

  it('auto면 감지 언어 반환', () => {
    expect(highlightCode('def f(): pass', 'auto').lang).toBe('python')
  })
})
