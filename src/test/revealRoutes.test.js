import { describe, it, expect } from 'vitest'
import { buildRevealRoutes, parseRouteId, buildRegeneratedCache } from '../store/flatStore'

describe('buildRevealRoutes — reveal (h,v) 경로 펼치기', () => {
  it('vCounts로 H×V를 좌우 선형 순서로 펼침', () => {
    const routes = buildRevealRoutes({ revealVCounts: [1, 3, 1, 2] })
    expect(routes.map(r => r.id)).toEqual(['0-0', '1-0', '1-1', '1-2', '2-0', '3-0', '3-1'])
    expect(routes.length).toBe(7) // 1+3+1+2
  })

  it('vCounts 항목이 0/누락이어도 최소 1개로 처리', () => {
    const routes = buildRevealRoutes({ revealVCounts: [0, 2] })
    expect(routes.map(r => r.id)).toEqual(['0-0', '1-0', '1-1'])
  })

  it('vCounts 없으면 totalPages 기준 수평만(기존 동작)', () => {
    expect(buildRevealRoutes({ totalPages: 3 }).map(r => r.id)).toEqual(['0-0', '1-0', '2-0'])
  })

  it('정보 없으면 최소 1페이지', () => {
    expect(buildRevealRoutes({}).map(r => r.id)).toEqual(['0-0'])
  })
})

describe('parseRouteId', () => {
  it('"h-v" 문자열 파싱', () => expect(parseRouteId('2-1')).toEqual({ h: 2, v: 1 }))
  it('"h-0" 파싱', () => expect(parseRouteId('5-0')).toEqual({ h: 5, v: 0 }))
  it('레거시 정수 → v:0', () => expect(parseRouteId(3)).toEqual({ h: 3, v: 0 }))
  it('null/빈값 → null', () => {
    expect(parseRouteId(null)).toBeNull()
    expect(parseRouteId('x')).toBeNull()
  })
})

describe('buildRegeneratedCache — route id 기반', () => {
  it('route id로 freshHtml 매핑, 순서 보존, flat-only 유지', () => {
    const snapshot = [
      { htmlSlideIndex: '0-0', entry: {} },
      { htmlSlideIndex: '1-0', entry: {} },
      { htmlSlideIndex: null, entry: { elements: ['flatonly'] } },
      { htmlSlideIndex: '1-1', entry: {} },
    ]
    const fresh = { '0-0': { a: 1 }, '1-0': { a: 2 }, '1-1': { a: 3 } }
    const cache = buildRegeneratedCache(snapshot, fresh)
    expect(Object.keys(cache)).toEqual(['0-0', '1-0', '2-0', '3-0']) // 선형 재인덱스
    expect(cache['0-0']).toMatchObject({ a: 1, htmlSlideIndex: '0-0' })
    expect(cache['2-0']).toEqual({ elements: ['flatonly'] }) // flat-only 보존
    expect(cache['3-0']).toMatchObject({ a: 3, htmlSlideIndex: '1-1' }) // 수직 출처 보존
  })

  it('재생성해도 페이지의 노트/노트음성/전환은 보존된다', () => {
    const snapshot = [{
      htmlSlideIndex: '0-0',
      entry: { notes: '직접 쓴 원고', notesAudio: 'idb://a1', notesAudioHash: 'h1', notesAudioVolume: 0.5, transition: { type: 'fade', durationMs: 400 } },
    }]
    const cache = buildRegeneratedCache(snapshot, { '0-0': { elements: ['new'], notes: 'HTML에 실린 노트' } })
    expect(cache['0-0'].elements).toEqual(['new'])       // 요소는 새로 추출한 것으로 교체
    expect(cache['0-0'].notes).toBe('직접 쓴 원고')       // 사용자 노트가 우선
    expect(cache['0-0'].notesAudio).toBe('idb://a1')
    expect(cache['0-0'].notesAudioVolume).toBe(0.5)
    expect(cache['0-0'].transition).toEqual({ type: 'fade', durationMs: 400 })
  })

  it('노트가 없던 페이지는 HTML에 선언된 노트를 받는다', () => {
    const cache = buildRegeneratedCache(
      [{ htmlSlideIndex: '0-0', entry: {} }],
      { '0-0': { elements: [], notes: 'HTML에 실린 노트', transition: { type: 'zoom', durationMs: 300 } } },
    )
    expect(cache['0-0'].notes).toBe('HTML에 실린 노트')
    expect(cache['0-0'].transition).toEqual({ type: 'zoom', durationMs: 300 })
  })

  it('스냅샷에 없던 새 경로는 (h,v) 순서로 뒤에 추가', () => {
    const cache = buildRegeneratedCache([], { '1-1': { a: 3 }, '0-0': { a: 1 }, '1-0': { a: 2 } })
    expect(Object.keys(cache)).toEqual(['0-0', '1-0', '2-0'])
    expect(cache['0-0'].htmlSlideIndex).toBe('0-0')
    expect(cache['1-0'].htmlSlideIndex).toBe('1-0')
    expect(cache['2-0'].htmlSlideIndex).toBe('1-1')
  })
})
