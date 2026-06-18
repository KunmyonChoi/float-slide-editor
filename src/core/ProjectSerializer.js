/**
 * ProjectSerializer — .flatproj 프로젝트 파일 직렬화/역직렬화
 *
 * v1: 단순 JSON
 * v2: ZIP 패키지 (project.json + media/ 폴더)
 *     IndexedDB blob 참조(idb://)를 media/ 파일로 변환하여 포함
 */
import JSZip from 'jszip'
import { BlobStore } from './BlobStore'

const CURRENT_VERSION = 2

/**
 * 옛 프로젝트 호환 마이그레이션 — 배경 판정이 '크기 추론'에서 '명시 플래그(isBackground)'로
 * 바뀌기 전에 저장된 프로젝트엔 배경 요소에 플래그가 없다. 로드 시 1회, 전체화면(0,0~캔버스크기)
 * 요소에 isBackground를 부여해 '일반 요소로 둔갑해 선택/간섭되고 배경 목록에도 안 뜨던' 문제를 고친다.
 * - 빈 전체화면 shape: 옛 단색/그래디언트 배경
 * - 전체화면 image/video: 배경 이미지/영상(옛 휴리스틱은 shape만 봐서 일반 요소로 남았음)
 * 오판(전면 사진 1장이 본문)이어도 배경 패널의 '일반 요소로 변환'으로 되돌릴 수 있어 안전.
 */
function migrateLegacyBackgrounds(pages) {
  for (const page of Object.values(pages || {})) {
    const cs = page.canvasSize
    if (!cs || !Array.isArray(page.elements)) continue
    for (const el of page.elements) {
      if (el.isBackground || el.sourceId === '__bg') continue // 이미 명시 배경
      const fullCanvas = Math.abs(el.width - cs.w) < 2 && Math.abs(el.height - cs.h) < 2
        && Math.abs(el.x) < 2 && Math.abs(el.y) < 2
      if (!fullCanvas) continue
      const isLegacyBg = (el.type === 'shape' && !el.content) // 빈 전체화면 도형(단색/그래디언트)
        || el.type === 'image' || el.type === 'video'          // 전체화면 이미지/영상
      if (isLegacyBg) el.isBackground = true
    }
  }
  return pages
}

/**
 * 이미 '명시 플래그(isBackground)' 모델을 쓰는 프로젝트인지 판별.
 * 그렇다면 배경은 플래그가 권위이므로 크기 기반 추론(migrateLegacyBackgrounds)을 건너뛴다
 * — 전체화면이어도 일반 요소일 수 있고, 저장→로드만으로 배경으로 둔갑하면 안 됨.
 * 판별: 저장 마커(bgFlagModel) 또는 isBackground 속성이 존재하는 요소가 하나라도 있으면 신모델.
 */
function _usesBgFlagModel(data) {
  if (data?.bgFlagModel === true) return true
  for (const page of Object.values(data?.pages || {})) {
    for (const el of (page.elements || [])) {
      if (el.isBackground === true || el.isBackground === false) return true
    }
  }
  return false
}

/**
 * store 상태를 .flatproj ZIP 패키지로 직렬화
 * @returns {Promise<Blob>} ZIP Blob
 */
export async function serializeProject(store) {
  const { pages, currentPageKey } = await store.getAllPagesAsync()

  const zip = new JSZip()
  const mediaFolder = zip.folder('media')
  let mediaIdx = 0
  const refMap = {}  // idb://key → media/filename

  // 모든 페이지의 idb:// 참조를 수집하여 media/에 저장
  for (const page of Object.values(pages)) {
    for (const el of (page.elements || [])) {
      const content = el.content || ''
      if (BlobStore.isIdbRef(content)) {
        if (!refMap[content]) {
          const key = BlobStore.parseRef(content)
          const blob = await BlobStore.get(key)
          if (blob) {
            const ext = _guessExtension(blob.type)
            const filename = `media_${mediaIdx++}${ext}`
            mediaFolder.file(filename, blob)
            refMap[content] = `media/${filename}`
          }
        }
      }
      // 배경 이미지의 url(data:...) 이 큰 경우도 media로 분리
      const bgImg = el.styles?.backgroundImage || ''
      if (bgImg.startsWith('url(data:') && bgImg.length > 100000) {
        const dataUrl = bgImg.slice(4, -1) // 'url(' ... ')'
        const blob = _dataUrlToBlob(dataUrl)
        if (blob) {
          const ext = _guessExtension(blob.type)
          const filename = `media_${mediaIdx++}${ext}`
          mediaFolder.file(filename, blob)
          refMap[`__bgimg__${el.id}`] = `media/${filename}`
        }
      }
    }
  }

  // pages 데이터에서 idb:// 참조를 media/ 경로로 변환
  const pagesClone = JSON.parse(JSON.stringify(pages))
  for (const page of Object.values(pagesClone)) {
    for (const el of (page.elements || [])) {
      if (el.content && refMap[el.content]) {
        el.content = refMap[el.content]
      }
      const bgKey = `__bgimg__${el.id}`
      if (refMap[bgKey] && el.styles?.backgroundImage) {
        el.styles.backgroundImage = `media-ref:${refMap[bgKey]}`
      }
    }
  }

  const project = {
    version: CURRENT_VERSION,
    bgFlagModel: true, // 명시 배경 플래그 모델 — 로드 시 크기 기반 배경 추론을 건너뛰게 하는 마커
    pages: pagesClone,
    currentPageKey,
    themeId: store.themeId,
    customTheme: store.customTheme,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  }
  zip.file('project.json', JSON.stringify(project))

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/**
 * .flatproj ZIP 또는 JSON 파일에서 프로젝트 데이터 로드
 * @param {File} file
 * @returns {Promise<{pages, currentPageKey, metadata}>}
 */
export async function loadProjectFile(file) {
  // ZIP인지 JSON인지 감지
  const header = await _readFileHead(file, 4)
  const isZip = header[0] === 0x50 && header[1] === 0x4B // PK

  if (isZip) {
    return _loadZipProject(file)
  } else {
    // v1 호환: 단순 JSON
    const text = await _readFileText(file)
    return deserializeProject(text)
  }
}

/**
 * ZIP 프로젝트 로드
 */
async function _loadZipProject(file) {
  const zip = await JSZip.loadAsync(file)
  const projectJson = await zip.file('project.json')?.async('string')
  if (!projectJson) throw new Error('project.json을 찾을 수 없습니다')

  const data = JSON.parse(projectJson)
  if (!data.pages) throw new Error('페이지 데이터가 없습니다')

  // media/ 파일을 IndexedDB에 저장하고, 참조를 idb://로 변환
  const mediaMap = {} // 'media/filename' → 'idb://key'
  const bgImgMap = {} // 'media/filename' → data URL

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (path.startsWith('media/') && !zipEntry.dir) {
      const blob = await zipEntry.async('blob')
      const key = await BlobStore.put(blob, path.replace('media/', ''))
      mediaMap[path] = BlobStore.toRef(key)

      // 배경 이미지용 data URL도 준비
      const dataUrl = await _blobToDataUrl(blob)
      bgImgMap[path] = dataUrl
    }
  }

  // pages의 media/ 참조를 idb://로 변환
  for (const page of Object.values(data.pages)) {
    for (const el of (page.elements || [])) {
      if (el.content && mediaMap[el.content]) {
        el.content = mediaMap[el.content]
      }
      if (el.styles?.backgroundImage?.startsWith('media-ref:')) {
        const mediaPath = el.styles.backgroundImage.slice('media-ref:'.length)
        if (bgImgMap[mediaPath]) {
          el.styles.backgroundImage = `url(${bgImgMap[mediaPath]})`
        }
      }
    }
  }

  return {
    pages: _usesBgFlagModel(data) ? data.pages : migrateLegacyBackgrounds(data.pages),
    currentPageKey: data.currentPageKey || Object.keys(data.pages)[0],
    themeId: data.themeId || null,
    customTheme: data.customTheme || null,
    metadata: data.metadata || {},
  }
}

/**
 * v1 JSON 역직렬화 (하위 호환)
 */
export function deserializeProject(jsonString) {
  const data = JSON.parse(jsonString)
  if (!data.version) throw new Error('프로젝트 버전 정보가 없습니다')
  if (data.version > CURRENT_VERSION) throw new Error(`지원하지 않는 프로젝트 버전입니다 (v${data.version})`)
  if (!data.pages || Object.keys(data.pages).length === 0) throw new Error('페이지 데이터가 없습니다')

  for (const [key, page] of Object.entries(data.pages)) {
    if (!Array.isArray(page.elements)) throw new Error(`페이지 ${key}에 elements 배열이 없습니다`)
    if (!page.canvasSize || typeof page.canvasSize.w !== 'number') throw new Error(`페이지 ${key}에 canvasSize가 없습니다`)
  }

  return {
    pages: _usesBgFlagModel(data) ? data.pages : migrateLegacyBackgrounds(data.pages),
    currentPageKey: data.currentPageKey || Object.keys(data.pages)[0],
    themeId: data.themeId || null,
    customTheme: data.customTheme || null,
    metadata: data.metadata || {},
  }
}

/**
 * Blob을 다운로드
 */
export function downloadProject(blob, filename = 'project.flatproj') {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}


// ── 유틸 ──

function _guessExtension(mimeType) {
  const map = {
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg',
  }
  return map[mimeType] || '.bin'
}

function _dataUrlToBlob(dataUrl) {
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) return null
    const bytes = atob(m[2])
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    return new Blob([arr], { type: m[1] })
  } catch { return null }
}

function _blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

function _readFileHead(file, bytes) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => resolve(new Uint8Array(bytes))
    reader.readAsArrayBuffer(file.slice(0, bytes))
  })
}

function _readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
    reader.readAsText(file)
  })
}
