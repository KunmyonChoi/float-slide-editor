import { describe, it, expect } from 'vitest'
import { encode } from 'uqr'
import { qrPayload, qrSvg, qrChanges, qrColorWarning, svgDataUrl, QR_DEFAULT } from '../core/qrCode'
import { SNIPPETS } from '../core/snippets'

describe('qrPayload — 입력을 QR에 실을 내용으로', () => {
  it('형식을 갖춘 입력은 그대로', () => {
    expect(qrPayload('https://genitor.netlify.app/?a=1')).toEqual({ kind: 'url', payload: 'https://genitor.netlify.app/?a=1' })
    expect(qrPayload('mailto:a@b.com')).toEqual({ kind: 'mail', payload: 'mailto:a@b.com' })
    expect(qrPayload('tel:+821012345678')).toEqual({ kind: 'tel', payload: 'tel:+821012345678' })
  })

  it('메일 주소는 mailto:, 전화번호는 tel:(구분 기호 제거)', () => {
    expect(qrPayload(' guixiang.jin@sk.com ')).toEqual({ kind: 'mail', payload: 'mailto:guixiang.jin@sk.com' })
    expect(qrPayload('010-1234-5678')).toEqual({ kind: 'tel', payload: 'tel:01012345678' })
    expect(qrPayload('+82 (10) 1234 5678')).toEqual({ kind: 'tel', payload: 'tel:+821012345678' })
  })

  it('도메인만 쓴 주소는 https://를 붙인다', () => {
    expect(qrPayload('genitor.netlify.app')).toEqual({ kind: 'url', payload: 'https://genitor.netlify.app' })
    expect(qrPayload('www.sk.com/ai?x=1')).toEqual({ kind: 'url', payload: 'https://www.sk.com/ai?x=1' })
  })

  it('그 밖의 글은 텍스트 그대로', () => {
    expect(qrPayload('부스 B-12에서 만나요')).toEqual({ kind: 'text', payload: '부스 B-12에서 만나요' })
    expect(qrPayload('v1.2')).toEqual({ kind: 'text', payload: 'v1.2' })   // 버전 번호는 도메인이 아님
    expect(qrPayload('123')).toEqual({ kind: 'text', payload: '123' })     // 7자리 미만 숫자는 전화가 아님
    expect(qrPayload('   ')).toEqual({ kind: 'empty', payload: '' })
  })
})

// SVG path(M x y h n v1 h-n z)를 모듈 격자로 되돌린다 — 이어 그리기가 모듈을 빠뜨리지 않는지
function gridFromSvg(svg) {
  const size = Number(svg.match(/viewBox="0 0 (\d+) /)[1])
  const g = Array.from({ length: size }, () => Array(size).fill(false))
  for (const [, x, y, n] of svg.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    for (let i = 0; i < +n; i++) g[+y][+x + i] = true
  }
  return g
}

describe('qrSvg', () => {
  it('uqr 행렬과 모듈 하나까지 같고, 둘레에 4칸 여백', () => {
    const svg = qrSvg('https://example.com')
    const ref = encode('https://example.com', { ecc: 'M', border: 4 })
    expect(gridFromSvg(svg)).toEqual(ref.data)
    expect(ref.data[3].every(v => !v)).toBe(true) // 여백 줄은 비어 있다
  })

  it('한글 텍스트도 만든다', () => {
    expect(qrSvg('사업 담당자 메일로 연락 주세요')).toMatch(/^<svg /)
  })

  it('색을 쓰고, 속성값은 이스케이프한다', () => {
    const svg = qrSvg('hi', { fg: '#1d4ed8', bg: 'x"><script>' })
    expect(svg).toContain('fill="#1d4ed8"')
    expect(svg).not.toContain('<script>')
  })

  it('빈 내용·용량 초과는 null', () => {
    expect(qrSvg('')).toBeNull()
    expect(qrSvg('x'.repeat(3000))).toBeNull()
  })
})

describe('qrChanges · 스니펫', () => {
  it('요소 변경 = SVG 데이터 URL + 기본값을 채운 qr', () => {
    const ch = qrChanges({ text: 'a@b.com' })
    expect(ch.content.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(ch.qr).toEqual({ ...QR_DEFAULT, text: 'a@b.com' })
    expect(qrChanges({ text: '' })).toBeNull()
  })

  it('QR 스니펫은 화면 가운데 정사각 image 요소', () => {
    const snip = SNIPPETS.find(s => s.id === 'qrCode')
    const [el] = snip.build({ w: 1920, h: 1080 })
    expect(el.type).toBe('image')
    expect(el.width).toBe(el.height)
    expect(el.x + el.width / 2).toBeCloseTo(960, 0)
    expect(el.qr.text).toBe(QR_DEFAULT.text)
    expect(el.content).toBe(svgDataUrl(qrSvg('https://example.com')))
  })
})

describe('qrColorWarning — 스캔에 위험한 색', () => {
  it('검정/흰색, 진한 테마색/흰색은 경고 없음', () => {
    expect(qrColorWarning('#000000', '#ffffff')).toBeNull()
    expect(qrColorWarning('#1d4ed8', '#ffffff')).toBeNull()
  })
  it('대비가 낮으면 경고', () => {
    expect(qrColorWarning('#999999', '#ffffff')).toMatch(/대비가 낮습니다/)
  })
  it('반전(밝은 모듈 + 어두운 바탕)·투명 바탕은 경고', () => {
    expect(qrColorWarning('#ffffff', '#000000')).toMatch(/반전/)
    expect(qrColorWarning('#000000', 'rgba(0, 0, 0, 0)')).toMatch(/투명/)
  })
})
