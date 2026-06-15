import { describe, it, expect } from 'vitest'
import { buildRegeneratedCache } from '../store/flatStore'

describe('buildRegeneratedCache — 재생성 시 flat-only 페이지 보존', () => {
  // htmlSlideIndex는 route id 문자열("h-v") — 수직 서브슬라이드 출처까지 인코딩
  const snap = [
    { htmlSlideIndex: '0-0', entry: { tag: 'html0-old' } },
    { htmlSlideIndex: null, entry: { tag: 'FLAT-ONLY' } },
    { htmlSlideIndex: '1-0', entry: { tag: 'html1-old' } },
    { htmlSlideIndex: '2-0', entry: { tag: 'html2-old-removed' } },
  ]
  const fresh = { '0-0': { tag: 'fresh0' }, '1-0': { tag: 'fresh1' }, '3-0': { tag: 'fresh3-new' } }
  const cache = buildRegeneratedCache(snap, fresh)
  const keys = Object.keys(cache).sort((a, b) => parseInt(a) - parseInt(b))

  it('원래 순서를 유지하며 html-backed는 새 데이터로 교체', () => {
    expect(cache['0-0'].tag).toBe('fresh0')
    expect(cache['0-0'].htmlSlideIndex).toBe('0-0')
    expect(cache['2-0'].tag).toBe('fresh1')
    expect(cache['2-0'].htmlSlideIndex).toBe('1-0')
  })

  it('flat-only 페이지가 원래 위치에 보존됨', () => {
    expect(cache['1-0'].tag).toBe('FLAT-ONLY')
    expect(cache['1-0'].htmlSlideIndex).toBeUndefined()
  })

  it('사라진 HTML 슬라이드(2-0)는 제외', () => {
    expect(keys.some(k => cache[k].htmlSlideIndex === '2-0')).toBe(false)
  })

  it('스냅샷에 없던 새 HTML 슬라이드(3-0)는 끝에 추가', () => {
    const last = keys[keys.length - 1]
    expect(cache[last].tag).toBe('fresh3-new')
    expect(cache[last].htmlSlideIndex).toBe('3-0')
  })

  it('키가 0부터 순차적으로 재할당됨', () => {
    expect(keys).toEqual(['0-0', '1-0', '2-0', '3-0'])
  })
})
