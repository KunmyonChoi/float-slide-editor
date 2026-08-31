import { describe, it, expect, vi, beforeEach } from 'vitest'

// 실제 IndexedDB가 이 테스트 환경(jsdom)에 없어 BlobStore를 메모리 Map으로 대체한다.
// put(blob, key)는 실제 BlobStore와 동일하게 key를 주면 그 값을 그대로 쓴다
// (ProjectSerializer._loadZipProject가 media/파일명을 key로 넘기는 것과 동일한 동작).
vi.mock('../core/BlobStore', () => {
  const store = new Map()
  return {
    BlobStore: {
      isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
      parseRef: (r) => r.slice(6),
      toRef: (k) => `idb://${k}`,
      put: async (blob, key) => {
        const k = key || `auto-${store.size}`
        store.set(k, blob)
        return k
      },
      get: async (key) => store.get(key) || null,
      getUrl: async () => null,
      contentUrl: async (c) => c,
      remove: async (key) => { store.delete(key) },
      keys: async () => [...store.keys()],
    },
  }
})

const { BlobStore } = await import('../core/BlobStore')
const { serializeProject, loadProjectFile } = await import('../core/ProjectSerializer')

describe('ProjectSerializer — 자막(notesCaptions) 저장/공유 라운드트립', () => {
  beforeEach(async () => {
    // 원본 브라우저 세션에서 쓰던 임의의 blobKey(예: 업로드 시 자동 발급된 키)에 오디오를 심어둔다.
    await BlobStore.put(new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' }), 'orig-session-key-abc123')
  })

  const CAPTIONS = {
    text: '안녕하세요, 자막 테스트입니다.',
    words: [{ word: '안녕하세요,', start: 0, end: 0.6 }, { word: '자막', start: 0.7, end: 1.0 }],
    forRef: 'idb://orig-session-key-abc123',
  }

  const makeStore = () => {
    const pages = {
      '0-0': {
        elements: [],
        canvasSize: { w: 1280, h: 720 },
        fontImports: [],
        notes: '안녕하세요, 자막 테스트입니다.',
        notesAudio: 'idb://orig-session-key-abc123',
        notesAudioHash: 'h0',
        notesCaptions: CAPTIONS,
      },
    }
    return {
      getAllPagesAsync: async () => ({ pages, currentPageKey: '0-0' }),
      getAllPages: () => ({ pages, currentPageKey: '0-0' }),
    }
  }

  it('저장(zip) → 로드 후 notesCaptions.forRef가 새로 발급된 notesAudio 키와 계속 짝이 맞는다', async () => {
    const blob = await serializeProject(makeStore())
    const data = await loadProjectFile(blob)
    const page = data.pages['0-0']

    // 원본 세션의 blobKey는 그대로 남아있지 않다(공유 링크를 받은 다른 브라우저에는 그 키가 없으므로
    // media/ 파일명 기반의 새 키로 재발급된다) — 이 값이 그대로면 remap이 안 된 것.
    expect(page.notesAudio).not.toBe('idb://orig-session-key-abc123')
    expect(page.notesAudio).toMatch(/^idb:\/\//)

    // 핵심: forRef가 notesAudio와 여전히 정확히 일치해야 "음성 교체 안 됨"으로 올바르게 판정된다.
    expect(page.notesCaptions.forRef).toBe(page.notesAudio)
    // 자막 내용(단어/텍스트) 자체는 그대로 보존.
    expect(page.notesCaptions.text).toBe(CAPTIONS.text)
    expect(page.notesCaptions.words).toEqual(CAPTIONS.words)
  })

  it('오디오 blob을 못 찾으면(예: 브라우저에서 이미 지워짐) notesAudio/forRef 둘 다 원래 값 그대로 남는다(같이 깨짐, 불일치 없음)', async () => {
    const store = makeStore()
    store.getAllPagesAsync = async () => ({
      pages: {
        '0-0': {
          ...store.getAllPages().pages['0-0'],
          notesAudio: 'idb://missing-key-not-in-store',
          notesCaptions: { ...CAPTIONS, forRef: 'idb://missing-key-not-in-store' },
        },
      },
      currentPageKey: '0-0',
    })
    const blob = await serializeProject(store)
    const data = await loadProjectFile(blob)
    const page = data.pages['0-0']
    expect(page.notesAudio).toBe('idb://missing-key-not-in-store')
    expect(page.notesCaptions.forRef).toBe(page.notesAudio) // 여전히 서로 일치(둘 다 안 바뀜)
  })

  it('notesCaptions이 없는 페이지는 에러 없이 그대로 undefined/없음', async () => {
    const store = makeStore()
    store.getAllPagesAsync = async () => ({
      pages: { '0-0': { elements: [], canvasSize: { w: 1280, h: 720 }, fontImports: [] } },
      currentPageKey: '0-0',
    })
    const blob = await serializeProject(store)
    const data = await loadProjectFile(blob)
    expect(data.pages['0-0'].notesCaptions).toBeUndefined()
  })
})
