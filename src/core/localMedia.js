/**
 * localMedia — HTML 슬라이드가 상대 경로로 참조하는 로컬 미디어(audio/song1.mp3 등) 해석.
 *
 * HTML 파일만 읽으면 옆 폴더의 미디어를 열 수 없으므로, 함께 드롭된 파일이나 사용자가 고른
 * 폴더에서 경로를 찾아 오디오/영상은 BlobStore(idb://)에, 이미지는 data: URL로 바꿔 넣는다.
 * (이미지는 iframe 레이아웃 측정에 실제 픽셀이 필요해 data: URL, 오디오/영상은 크기가 커서 idb.)
 */
import { BlobStore } from './BlobStore'

const MEDIA_SELECTOR = 'audio[src], video[src], source[src], img[src]'

/** 스킴(data:/http:/blob:/idb: 등)·프로토콜 상대(//)·루트(/)·앵커(#)가 아닌 상대 경로 */
export function isRelativeRef(src) {
  const s = (src || '').trim()
  return !!s && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('/') && !s.startsWith('#')
}

/** 상대 경로 정규화 — ./ 제거, ../ 접기, 쿼리/해시 제거, %xx 해제. 폴더 밖(../)이면 null */
export function normalizeRelPath(src) {
  let s = src.trim().replace(/[?#].*$/, '')
  try { s = decodeURIComponent(s) } catch { /* 잘못된 % 인코딩은 그대로 */ }
  const out = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { if (!out.length) return null; out.pop() } else out.push(seg)
  }
  return out.length ? out.join('/') : null
}

/** HTML이 참조하는 로컬 미디어 상대 경로(정규화, 중복 제거) */
export function findLocalMediaRefs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const paths = new Set()
  for (const el of doc.querySelectorAll(MEDIA_SELECTOR)) {
    const src = el.getAttribute('src')
    if (!isRelativeRef(src)) continue
    const p = normalizeRelPath(src)
    if (p) paths.add(p)
  }
  return [...paths]
}

/**
 * 파일 목록 → 경로 조회 함수. 폴더 선택(webkitRelativePath = "폴더/audio/x.mp3")은 최상위
 * 폴더명을 떼고 비교하고, 낱개 드롭 파일은 파일명만으로 맞춘다(같은 이름이 여럿이면 첫 번째).
 */
export function lookupFromFiles(files) {
  const byPath = new Map(), byName = new Map()
  for (const f of files || []) {
    const rel = f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : ''
    if (rel) byPath.set(rel, f)
    if (!byName.has(f.name)) byName.set(f.name, f)
  }
  return async (path) => byPath.get(path) || byName.get(path.split('/').pop()) || null
}

/** 디렉터리 핸들 → 경로 조회 함수(File System Access API) */
function lookupFromDirHandle(dir) {
  return async (path) => {
    try {
      const segs = path.split('/')
      let h = dir
      for (const seg of segs.slice(0, -1)) h = await h.getDirectoryHandle(seg)
      return await (await h.getFileHandle(segs[segs.length - 1])).getFile()
    } catch { return null }
  }
}

/** HTML이 있는 폴더 선택 → 경로 조회 함수. 취소 시 null. */
export async function pickMediaFolder() {
  if (window.showDirectoryPicker) {
    try {
      return lookupFromDirHandle(await window.showDirectoryPicker({ mode: 'read' }))
    } catch (e) {
      if (e?.name === 'AbortError') return null
      // 그 외(보안 제한 등)는 input 폴백
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.style.display = 'none'
    input.onchange = () => {
      const files = [...(input.files || [])]
      input.remove()
      resolve(files.length ? lookupFromFiles(files) : null)
    }
    input.oncancel = () => { input.remove(); resolve(null) }
    document.body.appendChild(input)
    input.click()
  })
}

const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(file)
})

/**
 * 상대 경로 미디어를 lookup으로 찾아 src를 교체한다. 못 찾은 경로는 그대로 둔다.
 * @param {string} html
 * @param {(path:string) => Promise<File|null>} lookup
 * @returns {Promise<{ html: string, missing: string[] }>}
 */
export async function resolveLocalMedia(html, lookup) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const resolved = new Map() // 정규화 경로 → { ref, dataUrl } (같은 파일은 1회만 저장)
  const missing = new Set()
  let changed = false
  for (const el of doc.querySelectorAll(MEDIA_SELECTOR)) {
    const src = el.getAttribute('src')
    if (!isRelativeRef(src)) continue
    const path = normalizeRelPath(src)
    if (!path) continue
    let entry = resolved.get(path)
    if (!entry) {
      const file = await lookup(path)
      if (!file) { missing.add(path); continue }
      entry = { file }
      resolved.set(path, entry)
    }
    if (el.tagName === 'IMG') {
      entry.dataUrl ??= await readDataUrl(entry.file)
      el.setAttribute('src', entry.dataUrl)
    } else {
      entry.ref ??= BlobStore.toRef(await BlobStore.put(entry.file))
      el.setAttribute('src', entry.ref)
    }
    changed = true
  }
  if (!changed) return { html, missing: [...missing] }
  const doctype = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>\n' : ''
  return { html: doctype + doc.documentElement.outerHTML, missing: [...missing] }
}

/**
 * 가져오기 직전 단계 — 상대 경로 미디어가 있으면 함께 드롭된 파일로 먼저 맞추고, 남은 것은
 * 사용자 확인 후 폴더를 골라 찾는다. 건너뛰거나 실패해도 원본 HTML로 계속 진행한다.
 * @param {string} html
 * @param {{ files?: File[], confirm: (opts:object) => Promise<boolean> }} opts
 * @returns {Promise<string>} 미디어 참조가 교체된 HTML
 */
export async function attachLocalMedia(html, { files = [], confirm }) {
  if (!findLocalMediaRefs(html).length) return html
  let missing
  try {
    if (files.length) ({ html, missing } = await resolveLocalMedia(html, lookupFromFiles(files)))
    else missing = findLocalMediaRefs(html)
    if (!missing.length) return html
    const list = missing.slice(0, 5).join('\n') + (missing.length > 5 ? `\n… 외 ${missing.length - 5}개` : '')
    const ok = await confirm({
      title: '미디어 파일 불러오기',
      message: `이 HTML은 같은 폴더의 미디어 파일을 사용합니다.\n${list}\n\nHTML 파일이 있는 폴더를 선택하면 함께 불러옵니다.`,
      confirmText: '폴더 선택', cancelText: '건너뛰기',
    })
    if (!ok) return html
    const lookup = await pickMediaFolder()
    if (!lookup) return html
    ;({ html, missing } = await resolveLocalMedia(html, lookup))
    if (missing.length) console.warn('[localMedia] 찾지 못한 미디어:', missing)
  } catch (e) {
    console.warn('[localMedia] 미디어 해석 실패, 원본으로 진행:', e?.message)
  }
  return html
}
