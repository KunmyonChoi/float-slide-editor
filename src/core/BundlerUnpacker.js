/**
 * BundlerUnpacker
 *
 * 일부 슬라이드 덱은 "standalone bundle" 포맷으로 내보내진다. 이 경우 실제 덱 HTML은
 * <body>에 직접 있지 않고 <script type="__bundler/template">에 이스케이프된 문자열로,
 * 에셋(폰트·이미지·영상·JS)은 <script type="__bundler/manifest">에 base64(+gzip)로 들어있다.
 * 런타임에 인라인 스크립트가 DOMContentLoaded 시점에 documentElement를 통째로 교체하며
 * 복원한다.
 *
 * 에디터 입장에서 이 포맷을 그대로 iframe에 넣으면 두 가지 문제가 생긴다:
 *  1) prepareHtmlForEditor가 <body>를 walk할 때 실제 슬라이드가 없어(템플릿 문자열 안)
 *     data-editor-id가 실제 콘텐츠에 부여되지 않는다 → flat 추출이 빈 결과를 낸다.
 *  2) 런타임의 documentElement.replaceWith가 주입한 에디터 에이전트/스타일을 날린다.
 *
 * 그래서 로드 시점에 번들을 미리 풀어(에셋을 data: URL로 인라인) 평범한 standalone HTML로
 * 변환한다. 그러면 prepareHtmlForEditor가 실제 DOM을 보고, 런타임 replaceWith도 일어나지 않는다.
 */

/** 이 HTML이 번들러 포맷인지 (저렴한 문자열 검사) */
export function isBundlerHtml(html) {
  return typeof html === 'string' && html.indexOf('__bundler/template') >= 0
}

/** <script type="__bundler/<type>">…</script> 내용을 추출 (속성 순서/공백에 관대).
 *  주의: 번들러 런타임 JS 안에도 '__bundler/manifest' 문자열이 등장하므로 단순 indexOf는
 *  안 된다. 반드시 실제 <script ...> 여는 태그를 매칭한다. */
function extractBundlerScript(html, type) {
  const re = new RegExp(`<script[^>]*type=["']__bundler/${type}["'][^>]*>`, 'i')
  const m = re.exec(html)
  if (!m) return null
  const start = m.index + m[0].length
  const end = html.indexOf('</script>', start)
  if (end < 0) return null
  return html.slice(start, end)
}

/** base64 → Uint8Array */
function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Uint8Array → base64 (대용량 대비 청크 처리) */
function bytesToBase64(bytes) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

/** gzip 해제 (DecompressionStream 미지원 환경에선 원본 반환) */
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') return bytes
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(bytes)
  writer.close()
  const reader = ds.readable.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

/** manifest 한 항목 → data: URL */
async function assetToDataUrl(entry) {
  let bytes = base64ToBytes(entry.data)
  if (entry.compressed) bytes = await gunzip(bytes)
  return `data:${entry.mime};base64,${bytesToBase64(bytes)}`
}

/**
 * 번들러 HTML을 풀어 평범한 standalone HTML 문자열로 반환한다.
 * 번들러 포맷이 아니거나 필수 스크립트가 없으면 null.
 * @param {string} fullHtml
 * @returns {Promise<string|null>}
 */
export async function unpackBundlerHtml(fullHtml) {
  if (!isBundlerHtml(fullHtml)) return null

  const manifestRaw = extractBundlerScript(fullHtml, 'manifest')
  const templateRaw = extractBundlerScript(fullHtml, 'template')
  if (!manifestRaw || !templateRaw) return null

  let manifest, template, extResources
  try {
    manifest = JSON.parse(manifestRaw)
    template = JSON.parse(templateRaw)
    const extRaw = extractBundlerScript(fullHtml, 'ext_resources')
    extResources = extRaw ? JSON.parse(extRaw) : []
  } catch (e) {
    console.warn('[BundlerUnpacker] bundle JSON parse 실패:', e.message)
    return null
  }

  const uuids = Object.keys(manifest)
  // 에셋 디코드 (병렬)
  const dataUrls = {}
  await Promise.all(uuids.map(async (uuid) => {
    try {
      dataUrls[uuid] = await assetToDataUrl(manifest[uuid])
    } catch (e) {
      console.warn(`[BundlerUnpacker] 에셋 ${uuid.slice(0, 8)} 디코드 실패:`, e.message)
      dataUrls[uuid] = `data:${manifest[uuid].mime || 'application/octet-stream'};base64,`
    }
  }))

  // 1) 템플릿 안에 직접 박힌 uuid(폰트 url(), <script src> 등)를 data: URL로 치환.
  for (const uuid of uuids) {
    if (template.indexOf(uuid) >= 0) template = template.split(uuid).join(dataUrls[uuid])
  }

  // blob:null(file://) + SRI 충돌 회피용으로 런타임이 벗기는 속성을 동일하게 제거.
  template = template
    .replace(/\s+integrity="[^"]*"/gi, '')
    .replace(/\s+crossorigin="[^"]*"/gi, '')

  // 2) data-res-id로 참조되는 미디어(영상·이미지)는 id→data:URL 매핑(window.__resources)으로 해결.
  const resourceMap = {}
  for (const entry of extResources) {
    if (dataUrls[entry.uuid]) resourceMap[entry.id] = dataUrls[entry.uuid]
  }

  // </script>가 JSON 안에서 조기 종료시키지 않도록 이스케이프.
  const resourceScript = '<script>window.__resources=' +
    JSON.stringify(resourceMap).split('</').join('<\\/') +
    ';</script>'

  // <head> 바로 뒤에 __resources 주입 (DOCTYPE를 앞에 두어 quirks 모드 방지).
  const headOpen = template.match(/<head[^>]*>/i)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    template = template.slice(0, at) + resourceScript + template.slice(at)
  } else {
    template = resourceScript + template
  }

  // 3) data-res-id 요소에 src를 실제로 설정하는 미디어 세터 주입 (원본 번들러 런타임과 동일 동작).
  const mediaSetter = `<script>(function(){
    var R=window.__resources||{};
    document.querySelectorAll('[data-res-id]').forEach(function(el){
      var u=R[el.dataset.resId];
      if(!u)return;
      el.src=u;
      if(el.tagName==='VIDEO'){try{el.load();el.play&&el.play().catch(function(){});}catch(e){}}
    });
  })();</script>`
  const bodyClose = template.lastIndexOf('</body>')
  if (bodyClose >= 0) {
    template = template.slice(0, bodyClose) + mediaSetter + template.slice(bodyClose)
  } else {
    template += mediaSetter
  }

  return template
}
