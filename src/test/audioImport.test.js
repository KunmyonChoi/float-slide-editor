import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements, vizColorOn } from '../core/FlatExtractor'
import { findLocalMediaRefs, normalizeRelPath, isRelativeRef, resolveLocalMedia, lookupFromFiles, attachLocalMedia } from '../core/localMedia'

vi.mock('../core/BlobStore', () => {
  let n = 0
  const BlobStore = {
    put: vi.fn(async () => `k${++n}`),
    toRef: (k) => `idb://${k}`,
    isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
    parseRef: (s) => s.slice(6),
  }
  return { BlobStore, default: BlobStore }
})

// jsdom은 레이아웃이 없으므로 인라인 left/top/width/height로 사각형을 흉내 낸다(부모 오프셋 누적).
function fakeRect() {
  let x = 0, y = 0
  for (let n = this.parentElement; n && n.tagName !== 'BODY'; n = n.parentElement) {
    x += parseFloat(n.style.left) || 0; y += parseFloat(n.style.top) || 0
  }
  x += parseFloat(this.style.left) || 0; y += parseFloat(this.style.top) || 0
  const w = this.tagName === 'BODY' ? 1920 : parseFloat(this.style.width) || 0
  const h = this.tagName === 'BODY' ? 1080 : parseFloat(this.style.height) || 0
  return { left: x, top: y, x, y, width: w, height: h, right: x + w, bottom: y + h }
}

function extract(html) {
  const { html: prepared } = prepareHtmlForEditor(html)
  const doc = document.implementation.createHTMLDocument('')
  doc.documentElement.innerHTML = new DOMParser().parseFromString(prepared, 'text/html').documentElement.innerHTML
  return extractFlatElements(doc, window).elements
}

describe('오디오 HTML 가져오기', () => {
  let orig
  beforeEach(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = fakeRect })
  afterEach(() => { Element.prototype.getBoundingClientRect = orig })

  it('<audio controls>는 플레이어 자리의 비주얼라이저 요소가 된다', () => {
    const els = extract(`<!DOCTYPE html><html><body>
      <div style="position:absolute;left:840px;top:900px;width:960px;height:54px;overflow:hidden;">
        <audio controls src="audio/song1.mp3" style="display:block;width:960px;height:54px;border-radius:27px;background:#2a4157;"></audio>
      </div></body></html>`)
    const a = els.find(e => e.type === 'audio')
    expect(a).toBeTruthy()
    expect(a).toMatchObject({ content: 'audio/song1.mp3', x: 840, y: 900, width: 960, height: 54, autoplay: true, loop: false })
    expect(a.viz.color).toBe(vizColorOn('rgb(42, 65, 87)'))
    expect(a.viz.shape).toBe('bars')
  })

  it('Genitor 내보내기(.fe-audioviz)는 data-cfg를 복원하고 중복 요소를 만들지 않는다', () => {
    const cfg = JSON.stringify({ viz: { shape: 'mirror', color: '#ff0000', barWidth: 4, barGap: 2 }, autoplay: false, muted: true })
      .replace(/"/g, '&quot;')
    const els = extract(`<!DOCTYPE html><html><body>
      <div class="fe-audioviz" data-cfg="${cfg}" style="position:absolute;left:10px;top:20px;width:400px;height:120px;">
        <canvas style="width:100%;height:100%;display:block"></canvas>
        <audio src="idb://abc" preload="auto" loop style="display:none"></audio>
      </div></body></html>`)
    const audios = els.filter(e => e.type === 'audio')
    expect(audios).toHaveLength(1)
    expect(audios[0]).toMatchObject({ content: 'idb://abc', width: 400, height: 120, autoplay: false, muted: true, loop: true })
    expect(audios[0].viz).toMatchObject({ shape: 'mirror', color: '#ff0000', barWidth: 4 })
  })

  it('vizColorOn — 밝은 배경은 어둡게, 어두운 배경은 밝게, 투명은 null', () => {
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 }
    expect(lum(vizColorOn('rgb(242, 217, 174)'))).toBeLessThan(140)
    expect(lum(vizColorOn('rgb(35, 43, 82)'))).toBeGreaterThan(150)
    expect(vizColorOn('rgba(0, 0, 0, 0)')).toBeNull()
    expect(vizColorOn('')).toBeNull()
  })
})

describe('localMedia — 상대 경로 미디어', () => {
  it('상대 경로 판별/정규화', () => {
    expect(isRelativeRef('audio/a.mp3')).toBe(true)
    expect(isRelativeRef('./a.mp3')).toBe(true)
    for (const s of ['data:audio/mp3;base64,x', 'https://x/a.mp3', 'blob:x', 'idb://k', '/abs.mp3', '//cdn/a.mp3', '', '#x']) {
      expect(isRelativeRef(s)).toBe(false)
    }
    expect(normalizeRelPath('./audio/../audio/%EB%85%B8%EB%9E%98.mp3?v=1')).toBe('audio/노래.mp3')
    expect(normalizeRelPath('../outside.mp3')).toBeNull()
  })

  it('미디어 참조 수집(중복 제거, 원격 제외)', () => {
    const html = `<audio src="audio/a.mp3"></audio><audio src="./audio/a.mp3"></audio>
      <video><source src="v/b.mp4"></video><img src="img/c.png"><img src="https://x/d.png">`
    expect(findLocalMediaRefs(html).sort()).toEqual(['audio/a.mp3', 'img/c.png', 'v/b.mp4'])
  })

  it('찾은 파일은 idb/data URL로 교체, 못 찾은 경로는 missing으로 남긴다', async () => {
    const mp3 = new File(['abc'], 'a.mp3', { type: 'audio/mpeg' })
    const png = new File(['png'], 'c.png', { type: 'image/png' })
    const html = '<!DOCTYPE html><html><body><audio src="audio/a.mp3"></audio><audio src="audio/a.mp3"></audio><img src="img/c.png"><audio src="audio/zz.mp3"></audio></body></html>'
    const files = { 'audio/a.mp3': mp3, 'img/c.png': png }
    const out = await resolveLocalMedia(html, async (p) => files[p] || null)
    expect(out.missing).toEqual(['audio/zz.mp3'])
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    const srcs = [...doc.querySelectorAll('audio')].map(a => a.getAttribute('src'))
    expect(srcs[0]).toMatch(/^idb:\/\//)
    expect(srcs[1]).toBe(srcs[0]) // 같은 파일은 1회만 저장
    expect(srcs[2]).toBe('audio/zz.mp3')
    expect(doc.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(out.html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('lookupFromFiles — 폴더 상대 경로 우선, 없으면 파일명', async () => {
    const inDir = new File(['1'], 'a.mp3'); Object.defineProperty(inDir, 'webkitRelativePath', { value: 'deck/audio/a.mp3' })
    const loose = new File(['2'], 'b.mp3')
    const lookup = lookupFromFiles([inDir, loose])
    expect(await lookup('audio/a.mp3')).toBe(inDir)
    expect(await lookup('audio/b.mp3')).toBe(loose)
    expect(await lookup('audio/none.mp3')).toBeNull()
  })

  it('attachLocalMedia — 드롭 파일로 모두 맞추면 묻지 않고, 참조 없으면 그대로', async () => {
    const confirm = vi.fn(async () => false)
    const html = '<html><body><audio src="audio/a.mp3"></audio></body></html>'
    const out = await attachLocalMedia(html, { files: [new File(['x'], 'a.mp3')], confirm })
    expect(out).toMatch(/idb:\/\//)
    expect(confirm).not.toHaveBeenCalled()
    const plain = '<html><body><p>hi</p></body></html>'
    expect(await attachLocalMedia(plain, { confirm })).toBe(plain)
    // 못 찾으면 묻고, 건너뛰면 원본 유지
    expect(await attachLocalMedia(html, { confirm })).toBe(html)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
