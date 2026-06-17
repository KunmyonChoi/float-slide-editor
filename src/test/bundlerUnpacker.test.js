import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { isBundlerHtml, unpackBundlerHtml } from '../core/BundlerUnpacker'
import { prepareHtmlForEditor } from '../core/ElementRegistry'

// 합성 미니 번들 (비압축) — 핵심 언팩 로직을 항상 검증
function makeMiniBundle() {
  const manifest = {
    'uuid-img-0001-0001-0001-000000000001': { data: btoa('FAKEPNGBYTES'), mime: 'image/png', compressed: false },
    'uuid-fnt-0002-0002-0002-000000000002': { data: btoa('FAKEWOFF2'), mime: 'font/woff2', compressed: false },
  }
  const extResources = [{ id: 'pic', uuid: 'uuid-img-0001-0001-0001-000000000001' }]
  const template = '<!DOCTYPE html><html><head>' +
    '<style>@font-face{font-family:X;src:url("uuid-fnt-0002-0002-0002-000000000002")}</style>' +
    '</head><body><deck-stage width="1920" height="1080">' +
    '<section>A</section><section>B</section></deck-stage>' +
    '<img data-res-id="pic" data-asset="assets/x.png"></body></html>'
  return '<!DOCTYPE html><html><head></head><body>' +
    '<div id="__bundler_loading">Loading</div>' +
    '<script>document.querySelector(\'script[type="__bundler/manifest"]\')</script>' +
    `<script type="__bundler/manifest">${JSON.stringify(manifest)}</script>` +
    `<script type="__bundler/ext_resources">${JSON.stringify(extResources)}</script>` +
    `<script type="__bundler/template">${JSON.stringify(template)}</script>` +
    '</body></html>'
}

describe('BundlerUnpacker', () => {
  it('isBundlerHtml: 번들/일반 구분', () => {
    expect(isBundlerHtml(makeMiniBundle())).toBe(true)
    expect(isBundlerHtml('<!DOCTYPE html><html><body><p>hi</p></body></html>')).toBe(false)
    expect(isBundlerHtml(null)).toBe(false)
  })

  it('일반 HTML은 null 반환(언팩 대상 아님)', async () => {
    expect(await unpackBundlerHtml('<html><body><p>x</p></body></html>')).toBeNull()
  })

  it('런타임 JS 안의 __bundler/manifest 문자열에 속지 않고 실제 태그를 추출', async () => {
    // 합성 번들은 manifest 문자열이 든 런타임 <script>를 실제 태그보다 앞에 둔다.
    const out = await unpackBundlerHtml(makeMiniBundle())
    expect(out).toBeTruthy()
    expect(out).not.toBeNull()
  })

  it('에셋을 data: URL로 인라인하고 번들 마커를 제거', async () => {
    const out = await unpackBundlerHtml(makeMiniBundle())
    // 직접 uuid 참조(폰트)는 data:로 치환
    expect(out).toContain('data:font/woff2;base64,')
    expect(out).not.toContain('uuid-fnt-0002')
    // data-res-id 미디어는 window.__resources로 해결
    expect(out).toContain('window.__resources=')
    expect(out).toContain('data:image/png;base64,')
    expect(out).not.toContain('uuid-img-0001')
    // 미디어 세터 + 실제 슬라이드 보존
    expect(out).toContain('data-res-id')
    expect(out).toContain('<deck-stage')
    expect((out.match(/<section/g) || []).length).toBe(2)
    // 번들 스크립트는 사라져야 함
    expect(out).not.toContain('__bundler/template')
    expect(out).not.toContain('__bundler/manifest')
  })

  it('언팩 결과를 prepareHtmlForEditor가 실제 슬라이드로 태깅', async () => {
    const out = await unpackBundlerHtml(makeMiniBundle())
    const { elements } = prepareHtmlForEditor(out)
    // section(컨테이너) + img(이미지)에 data-editor-id가 부여돼야 한다
    const types = [...elements.values()].map(e => e.type)
    expect(types.filter(t => t === 'container').length).toBeGreaterThanOrEqual(2) // 2 sections
    expect(types).toContain('image')
  })
})

// 실제 번들 파일이 로컬에 있으면 엔드투엔드 검증 (CI에선 자동 skip)
const REAL = '/home/kunmyon/Downloads/True Trace - standalone.html'
describe.skipIf(!existsSync(REAL))('BundlerUnpacker — 실제 True Trace 번들', () => {
  it('10개 section + deck-stage를 풀고 모든 에셋 인라인', async () => {
    const out = await unpackBundlerHtml(readFileSync(REAL, 'utf8'))
    expect(out).toContain('<deck-stage')
    expect((out.match(/<section/g) || []).length).toBe(10)
    expect(out).not.toContain('__bundler/template')
    // 남은 bare uuid 없음
    expect(out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)).toBeNull()
    expect((out.match(/data:video\/mp4/g) || []).length).toBe(4)
  })
})
