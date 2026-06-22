import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../core/markdown'

describe('renderMarkdown', () => {
  it('기본 문법 렌더', () => {
    const html = renderMarkdown('# 제목\n\n**굵게** 와 *기울임*\n\n- 하나\n- 둘')
    expect(html).toMatch(/<h1[^>]*>제목<\/h1>/)
    expect(html).toContain('<strong>굵게</strong>')
    expect(html).toContain('<em>기울임</em>')
    expect(html).toMatch(/<ul>[\s\S]*<li>하나<\/li>/)
  })

  it('링크는 새 탭 + 안전 rel', () => {
    const html = renderMarkdown('[link](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('위험 HTML 새니타이즈 — script 제거', () => {
    const html = renderMarkdown('정상\n\n<script>alert(1)</script><img src=x onerror="alert(2)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('인용/코드/구분선', () => {
    const html = renderMarkdown('> 인용\n\n`코드`\n\n---')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<code>코드</code>')
    expect(html).toContain('<hr>')
  })

  it('빈 입력은 빈 문자열', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
    expect(renderMarkdown(null)).toBe('')
  })
})
