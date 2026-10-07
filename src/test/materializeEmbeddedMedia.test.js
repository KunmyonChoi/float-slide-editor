import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../core/BlobStore', () => {
  let n = 0
  const BlobStore = {
    put: vi.fn(async () => `k${++n}`),
    toRef: (k) => `idb://${k}`,
    isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
    parseRef: (s) => s.slice(6),
    getUrl: async () => null,
  }
  return { BlobStore, default: BlobStore }
})

const { useFlatStore } = await import('../store/flatStore')

describe('가져온 덱의 data: 오디오·영상 → 내부 저장소', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['bytes']) })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('오디오·영상의 data: URL은 idb 참조로 바뀌고, 이미지 data: URL은 그대로', async () => {
    const song = 'data:audio/mpeg;base64,SUQzBAAAAA=='
    const clip = 'data:video/mp4;base64,AAAAIGZ0eXA='
    const pic = 'data:image/png;base64,iVBORw0KGgo='
    useFlatStore.setState({
      flatElements: [
        { id: 'a', type: 'audio', content: song },
        { id: 'a2', type: 'audio', content: song }, // 같은 곡은 한 번만 저장
        { id: 'v', type: 'video', content: clip },
        { id: 'i', type: 'image', content: pic },
      ],
    })
    await useFlatStore.getState().materializeRemoteAssets()
    const els = useFlatStore.getState().flatElements
    const by = Object.fromEntries(els.map(e => [e.id, e.content]))
    expect(by.a).toMatch(/^idb:\/\//)
    expect(by.a2).toBe(by.a)
    expect(by.v).toMatch(/^idb:\/\//)
    expect(by.i).toBe(pic)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('저장에 실패하면 data: URL을 그대로 둔다(재생은 된다)', async () => {
    fetch.mockImplementation(async () => { throw new Error('nope') })
    const song = 'data:audio/mpeg;base64,AAAA'
    useFlatStore.setState({ flatElements: [{ id: 'a', type: 'audio', content: song }] })
    await useFlatStore.getState().materializeRemoteAssets()
    expect(useFlatStore.getState().flatElements[0].content).toBe(song)
  })
})
