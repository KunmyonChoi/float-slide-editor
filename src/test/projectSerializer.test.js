import { describe, it, expect } from 'vitest'
import { serializeProject, deserializeProject } from '../core/ProjectSerializer'

const mockPages = {
  '0-0': {
    elements: [
      { id: 'el1', type: 'text', content: 'Hello', x: 10, y: 20, width: 100, height: 40, zIndex: 1, styles: {} },
      { id: 'el2', type: 'shape', content: '', x: 50, y: 50, width: 200, height: 100, zIndex: 2, styles: { backgroundColor: '#e2e8f0' } },
    ],
    canvasSize: { w: 1280, h: 720 },
    fontImports: ['@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+KR")'],
  },
  '1-0': {
    elements: [
      { id: 'el3', type: 'image', content: 'data:image/png;base64,abc', x: 0, y: 0, width: 300, height: 200, zIndex: 1, styles: {} },
    ],
    canvasSize: { w: 1280, h: 720 },
    fontImports: [],
  },
}

const makeMockStore = () => ({
  getAllPagesAsync: async () => ({
    pages: mockPages,
    currentPageKey: '0-0',
  }),
  getAllPages: () => ({
    pages: mockPages,
    currentPageKey: '0-0',
  }),
})

describe('ProjectSerializer', () => {
  describe('serializeProject', () => {
    it('직렬화된 JSON에 version, pages, currentPageKey, metadata 포함', async () => {
      const json = await serializeProject(makeMockStore())
      const data = JSON.parse(json)
      expect(data.version).toBe(1)
      expect(data.pages).toBeDefined()
      expect(Object.keys(data.pages)).toEqual(['0-0', '1-0'])
      expect(data.currentPageKey).toBe('0-0')
      expect(data.metadata.createdAt).toBeDefined()
    })

    it('각 페이지에 elements, canvasSize, fontImports 포함', async () => {
      const json = await serializeProject(makeMockStore())
      const data = JSON.parse(json)
      const page0 = data.pages['0-0']
      expect(page0.elements).toHaveLength(2)
      expect(page0.canvasSize).toEqual({ w: 1280, h: 720 })
      expect(page0.fontImports).toHaveLength(1)
    })
  })

  describe('deserializeProject', () => {
    it('유효한 JSON 역직렬화 성공', async () => {
      const json = await serializeProject(makeMockStore())
      const data = deserializeProject(json)
      expect(data.pages['0-0'].elements).toHaveLength(2)
      expect(data.currentPageKey).toBe('0-0')
    })

    it('version 누락 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({ pages: {} }))).toThrow('버전')
    })

    it('미래 version 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({ version: 999, pages: { '0-0': { elements: [], canvasSize: { w: 1280, h: 720 } } } }))).toThrow('지원하지 않는')
    })

    it('pages 누락 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({ version: 1 }))).toThrow('페이지')
    })

    it('빈 pages 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({ version: 1, pages: {} }))).toThrow('페이지')
    })

    it('elements 배열 누락 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({
        version: 1, pages: { '0-0': { canvasSize: { w: 100, h: 100 } } },
      }))).toThrow('elements')
    })

    it('canvasSize 누락 시 에러', () => {
      expect(() => deserializeProject(JSON.stringify({
        version: 1, pages: { '0-0': { elements: [] } },
      }))).toThrow('canvasSize')
    })
  })

  describe('라운드트립', () => {
    it('serialize → deserialize 후 데이터 동일', async () => {
      const store = makeMockStore()
      const json = await serializeProject(store)
      const data = deserializeProject(json)
      const original = store.getAllPages()
      expect(data.pages['0-0'].elements).toEqual(original.pages['0-0'].elements)
      expect(data.pages['1-0'].elements).toEqual(original.pages['1-0'].elements)
      expect(data.currentPageKey).toBe(original.currentPageKey)
    })
  })
})
