import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * 상대 경로 import가 파일 이름의 대소문자까지 정확히 맞는지.
 * macOS는 대소문자를 가리지 않아 './cssColor'로 'CssColor.js'를 불러도 개발·테스트가 통과하지만,
 * Netlify(Linux) 빌드는 'Could not resolve'로 실패한다(QR 스니펫 배포 때 실제로 두 번 실패).
 */
const ROOTS = ['src', 'netlify/functions']
const EXTS = ['', '.js', '.jsx', '.mjs', '.json', '.css']

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

// 경로의 모든 마디가 디렉터리 목록에 정확한 대소문자로 있는지
function existsExact(p) {
  const parts = path.normalize(p).split(path.sep)
  let dir = '.'
  for (const part of parts) {
    if (!fs.readdirSync(dir).includes(part)) return false
    dir = path.join(dir, part)
  }
  return fs.statSync(dir).isFile()
}

describe('import 경로 대소문자', () => {
  it('상대 경로 import는 실제 파일 이름과 대소문자까지 같다', () => {
    const bad = []
    for (const f of ROOTS.flatMap(r => walk(r))) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        const spec = m[1] || m[2]
        const base = path.join(path.dirname(f), spec)
        const cands = [...EXTS.map(x => base + x), path.join(base, 'index.js'), path.join(base, 'index.jsx')]
        const loose = cands.some(c => fs.existsSync(c) && fs.statSync(c).isFile())
        if (loose && !cands.some(existsExact)) bad.push(`${f} → ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })
})
