/**
 * codeHighlight — 경량 코드 신택스 하이라이터.
 * 토큰을 인라인 스타일 <span style="color:..">으로 출력 → 화면 + PPTX/이미지 export 모두 색 유지.
 * 지원: js/ts/python/bash/json (+ auto 감지). 다크 코드 윈도우에 맞춘 토큰 색.
 */

const THEME = {
  comment: '#7c8694',
  string: '#9ece6a',
  number: '#ff9e64',
  keyword: '#bb9af7',
  func: '#7aa2f7',
  def: '#c0caf5',
}

const KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new class extends super import export from default async await try catch finally throw typeof instanceof in of this null true false undefined yield delete void',
  ts: 'const let var function return if else for while do switch case break continue new class extends super import export from default async await try catch finally throw typeof instanceof in of this null true false undefined yield delete void interface type enum implements public private protected readonly as namespace declare keyof',
  python: 'def return if elif else for while import from as class try except finally with lambda None True False and or not in is pass break continue global nonlocal yield raise async await assert del',
  bash: 'if then fi else elif for while do done case esac function in then echo export local return source alias unset',
  json: 'true false null',
}

const HASH_LANGS = new Set(['python', 'bash'])

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 간단 언어 감지 */
export function detectLang(code) {
  const c = code || ''
  if (/^\s*[[{]/.test(c) && /[:,]/.test(c) && !/\bfunction\b|=>/.test(c)) return 'json'
  if (/\bdef\s+\w+\s*\(|\bimport\s+\w+|\bprint\(|:\s*$/m.test(c)) return 'python'
  if (/^#!.*sh|\becho\b|\bfi\b|\bdone\b|\$\{?\w/.test(c)) return 'bash'
  if (/\b(interface|type|enum|: \w+\s*[=)])/.test(c)) return 'ts'
  return 'js'
}

/**
 * 코드 → 하이라이트 HTML (인라인 span). 공백·줄바꿈은 그대로 보존.
 * @returns {{ html: string, lang: string }}
 */
export function highlightCode(code, lang = 'auto') {
  const src = code || ''
  const language = lang === 'auto' ? detectLang(src) : lang
  const kw = new Set((KEYWORDS[language] || KEYWORDS.js).split(/\s+/))
  const useHash = HASH_LANGS.has(language)
  const span = (color, text) => `<span style="color:${color}">${esc(text)}</span>`

  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    // 줄 주석
    if (!useHash && ch === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n
      out += span(THEME.comment, src.slice(i, j)); i = j; continue
    }
    if (useHash && ch === '#') {
      let j = src.indexOf('\n', i); if (j < 0) j = n
      out += span(THEME.comment, src.slice(i, j)); i = j; continue
    }
    // 블록 주석 /* */
    if (!useHash && ch === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i); j = j < 0 ? n : j + 2
      out += span(THEME.comment, src.slice(i, j)); i = j; continue
    }
    // 문자열 (', ", `)
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < n) { if (src[j] === '\\') { j += 2; continue } if (src[j] === ch) { j++; break } j++ }
      out += span(THEME.string, src.slice(i, j)); i = j; continue
    }
    // 숫자
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < n && /[0-9._a-fA-FxX]/.test(src[j])) j++
      out += span(THEME.number, src.slice(i, j)); i = j; continue
    }
    // 식별자/키워드/함수
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++
      const word = src.slice(i, j)
      if (kw.has(word)) out += span(THEME.keyword, word)
      else if (src[j] === '(') out += span(THEME.func, word)
      else out += esc(word)
      i = j; continue
    }
    // 그 외 문자
    out += esc(ch); i++
  }
  return { html: out, lang: language }
}

/** 코드 모드 켤 때 적용할 기본 스타일(모노스페이스 + 공백 보존) */
export const CODE_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
