import { describe, it, expect, vi, beforeEach } from 'vitest'

// 실제 IndexedDB가 없는 환경이라 BlobStore를 메모리 Map으로 대체한다.
vi.mock('../core/BlobStore', () => {
  const store = new Map()
  return {
    BlobStore: {
      isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
      parseRef: (r) => r.slice(6),
      toRef: (k) => `idb://${k}`,
      put: async (blob, key) => { const k = key || `auto-${store.size}`; store.set(k, blob); return k },
      get: async (key) => store.get(key) || null,
      remove: async (key) => { store.delete(key) },
      keys: async () => [...store.keys()],
      _store: store,
    },
  }
})

const { BlobStore } = await import('../core/BlobStore')
const { runBlobGc, makeLivePredicate } = await import('../core/BlobGc')
const { setCachedTranscript, getCachedTranscript, clearTranscriptCache } = await import('../core/transcriptCache')

const blob = () => new Blob(['x'])

async function seed(keys) {
  BlobStore._store.clear()
  for (const k of keys) await BlobStore.put(blob(), k)
}

describe('BlobGc — 고아 미디어 회수', () => {
  beforeEach(() => { clearTranscriptCache() })

  it('참조된 blob은 남기고 참조 없는 것만 지운다', async () => {
    await seed(['img-live', 'audio-live', 'img-orphan'])
    const pages = {
      '0-0': {
        elements: [{ id: 'e1', type: 'image', content: 'idb://img-live' }],
        notesAudio: 'idb://audio-live',
      },
    }

    const res = await runBlobGc([pages])
    expect(res.removed).toBe(1)
    expect(res.orphans).toEqual(['img-orphan'])
    expect(await BlobStore.keys()).toEqual(['img-live', 'audio-live'])
  })

  it('실행취소 히스토리·삭제 스태시·AI 작업 결과의 참조도 살린다', async () => {
    await seed(['in-history', 'in-stash', 'in-job', 'nobody'])
    const pages = {
      '0-0': {
        elements: [],
        history: { stack: [[{ id: 'e1', content: 'idb://in-history' }]], pointer: 0 },
      },
    }
    const stash = { index: 1, entry: { elements: [{ id: 'e2', content: 'idb://in-stash' }] } }
    const jobs = [{ id: 'j1', status: 'ready', result: { key: 'in-job', blob: blob() }, abort: () => {} }]

    const res = await runBlobGc([pages, stash, jobs])
    expect(res.orphans).toEqual(['nobody'])
    expect(await BlobStore.keys()).toEqual(['in-history', 'in-stash', 'in-job'])
  })

  it('배경 이미지 url(idb://…)처럼 문자열 안에 박힌 참조와 공백·한글 키도 매칭한다', async () => {
    await seed(['내 사진 1.png-123-abc', 'orphan.png'])
    const pages = {
      '0-0': {
        elements: [{ id: 'e1', styles: { backgroundImage: 'url(idb://내 사진 1.png-123-abc)' } }],
      },
    }

    const res = await runBlobGc([pages])
    expect(res.orphans).toEqual(['orphan.png'])
  })

  it('자막 캐시는 죽은 음성 것만 지운다', async () => {
    await seed(['audio-live'])
    setCachedTranscript('audio-live', { text: '살아있음', words: [] })
    setCachedTranscript('audio-gone', { text: '지워진 음성', words: [] })

    const res = await runBlobGc([{ '0-0': { notesAudio: 'idb://audio-live' } }])
    expect(res.cachePruned).toBe(1)
    expect(getCachedTranscript('audio-live')).toBeTruthy()
    expect(getCachedTranscript('audio-gone')).toBeNull()
  })

  it('dryRun은 세기만 하고 지우지 않는다', async () => {
    await seed(['live', 'orphan'])
    setCachedTranscript('orphan', { text: '', words: [] })

    const res = await runBlobGc([{ '0-0': { notesAudio: 'idb://live' } }], { dryRun: true })
    expect(res.removed).toBe(1)
    expect(res.cachePruned).toBe(1)
    expect(await BlobStore.keys()).toEqual(['live', 'orphan'])
    expect(getCachedTranscript('orphan')).toBeTruthy()
  })

  it('참조가 하나도 안 보이면 아무것도 지우지 않는다(안전장치)', async () => {
    await seed(['a', 'b'])
    const res = await runBlobGc([{ '0-0': { elements: [] } }])
    expect(res.skipped).toBe(true)
    expect(res.removed).toBe(0)
    expect(await BlobStore.keys()).toEqual(['a', 'b'])
  })

  it('순환 참조가 있어도 훑기가 끝난다', () => {
    const a = { content: 'idb://k1' }
    a.self = a
    const isLive = makeLivePredicate([a])
    expect(isLive('k1')).toBe(true)
    expect(isLive('k2')).toBe(false)
  })
})
