import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * skills/ (원본) 와 public/skills/ (앱이 서빙·zip으로 내려주는 사본)는 항상 같아야 한다.
 * 실제로 한쪽만 고쳐 두 사본이 벌어진 적이 있다(사용자는 낡은 규약을 받아 갔다).
 * 스킬을 고칠 때 사본 동기화를 잊지 못하게 잠가 둔다.
 */
const SRC = 'skills'
const PUB = 'public/skills'

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out.sort()
}

describe('스킬 사본 동기화 (skills/ ↔ public/skills/)', () => {
  const srcFiles = filesUnder(SRC).map(p => relative(SRC, p))

  it('원본의 모든 파일이 public에도 있다', () => {
    const pubFiles = filesUnder(PUB).map(p => relative(PUB, p))
    for (const f of srcFiles) expect(pubFiles).toContain(f)
  })

  it.each(srcFiles)('%s 내용이 동일하다', (f) => {
    expect(readFileSync(join(PUB, f), 'utf8')).toBe(readFileSync(join(SRC, f), 'utf8'))
  })
})
