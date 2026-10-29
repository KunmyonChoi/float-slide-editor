/**
 * QR 코드 요소 — 스니펫 'QR 코드'와 속성 패널의 QR 섹션이 쓴다.
 *
 * QR은 SVG 데이터 URL을 content로 가진 image 요소다. 그래서 렌더·썸네일·PPTX(SVG→PNG)·PDF가
 * 그대로 동작한다. 원래 입력은 el.qr = { text, fg, bg }에 두고, 바뀔 때마다 SVG를 다시 만든다.
 * (코드 블록이 el.code를 두고 색칠된 content를 다시 만드는 것과 같은 방식)
 */
import { encode } from 'uqr'
import { cssColorToRgba } from './cssColor'

export const QR_DEFAULT = { text: 'https://example.com', fg: '#000000', bg: '#ffffff' }
const QUIET = 4 // 둘레 빈 칸(모듈) — 스캐너가 QR 경계를 찾는 데 필요한 표준 여백
const ECC = 'M' // 약 15% 손상 복구

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s().-]+$/
const SCHEME_RE = /^(https?|mailto|tel|sms|smsto|geo|wifi|matmsg|mecard|ftp):|^[a-z][a-z0-9+.-]*:\/\//i
const DOMAIN_RE = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i

/**
 * 입력 → QR에 실을 내용. 메일 주소는 mailto:, 전화번호는 tel:, 도메인만 쓴 주소는 https://를 붙인다.
 * 이미 형식(https:, mailto:, tel: …)을 갖춘 입력과 그 밖의 글은 그대로.
 * @returns {{ kind: 'url'|'mail'|'tel'|'text'|'empty', payload: string }}
 */
export function qrPayload(input) {
  const s = String(input ?? '').trim()
  if (!s) return { kind: 'empty', payload: '' }
  if (SCHEME_RE.test(s)) {
    if (/^mailto:/i.test(s)) return { kind: 'mail', payload: s }
    if (/^tel:/i.test(s)) return { kind: 'tel', payload: s }
    return { kind: /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? 'url' : 'text', payload: s }
  }
  if (EMAIL_RE.test(s)) return { kind: 'mail', payload: 'mailto:' + s }
  if (PHONE_RE.test(s) && s.replace(/\D/g, '').length >= 7) {
    return { kind: 'tel', payload: 'tel:' + s.replace(/[\s().-]/g, '') }
  }
  if (DOMAIN_RE.test(s)) return { kind: 'url', payload: 'https://' + s }
  return { kind: 'text', payload: s }
}

/**
 * QR SVG 문자열. 내용이 비었거나 QR 용량(약 2.3KB, 오류 보정 M)을 넘으면 null.
 * 어두운 모듈을 가로로 이어 한 path로 그린다(모듈 사이 실선 틈 방지 + 크기 절약).
 */
export function qrSvg(payload, { fg = QR_DEFAULT.fg, bg = QR_DEFAULT.bg } = {}) {
  if (!payload) return null
  let qr
  try { qr = encode(payload, { ecc: ECC, border: QUIET }) } catch { return null }
  const { size, data } = qr
  let d = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y][x]) continue
      let run = 1
      while (x + run < size && data[y][x + run]) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="${attr(bg)}"/><path d="${d}" fill="${attr(fg)}"/></svg>`
}

const attr = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function svgDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/**
 * el.qr 설정 → 요소에 반영할 변경 { content, qr }. 만들 수 없으면(빈 내용·너무 김) null.
 */
export function qrChanges(qr) {
  const q = { ...QR_DEFAULT, ...qr }
  const svg = qrSvg(qrPayload(q.text).payload, q)
  return svg ? { content: svgDataUrl(svg), qr: q } : null
}

/** 상대 휘도(WCAG) */
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * 색 조합이 스캔에 안전한지. 대비가 낮거나, 밝은 모듈 + 어두운 바탕(반전)이면 경고를 돌려준다.
 * 반전 QR은 일부 카메라 앱이 읽지 못한다.
 * @returns {string|null} 경고 문구
 */
export function qrColorWarning(fg, bg) {
  const a = cssColorToRgba(fg), b = cssColorToRgba(bg)
  if (!a || !b) return null
  if (b[3] < 1) return '바탕이 투명하면 슬라이드 색에 따라 읽히지 않을 수 있습니다.'
  const lf = luminance(a), lb = luminance(b)
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
  if (lf > lb) return '모듈이 바탕보다 밝으면(반전) 일부 카메라가 읽지 못합니다.'
  if (ratio < 4) return `대비가 낮습니다(${ratio.toFixed(1)}:1). 4:1 이상을 권장합니다.`
  return null
}
