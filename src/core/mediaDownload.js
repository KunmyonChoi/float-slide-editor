/**
 * mediaDownload — 이미지·비디오·오디오 요소 다운로드 파일 이름 결정(순수 로직).
 * 컨텍스트 메뉴 '… 다운로드'가 쓴다. 확장자는 실제 Blob MIME을 우선한다.
 */

const DEFAULT_EXT = { image: 'png', video: 'mp4', audio: 'mp3' }
const BASE_NAME = { image: 'image', video: 'video', audio: 'audio' }
// MIME 하위 타입 → 흔히 쓰는 확장자
const SUBTYPE_EXT = {
  mpeg: 'mp3', mp3: 'mp3', 'x-mpeg': 'mp3',
  'x-wav': 'wav', wave: 'wav', 'vnd.wave': 'wav',
  'x-flac': 'flac', 'x-m4a': 'm4a', aac: 'aac',
  quicktime: 'mov', 'x-matroska': 'mkv',
  jpeg: 'jpg', 'svg+xml': 'svg',
}

/** 다운로드할 수 있는 요소 종류인가. */
export function isDownloadableMedia(el) {
  return !!el && !!el.content && (el.type === 'image' || el.type === 'video' || el.type === 'audio')
}

/** Blob MIME → 확장자. 종류(image/video/audio)가 다르거나 비어 있으면 기본 확장자. */
export function mediaExt(type, mime) {
  const [major, rest = ''] = String(mime || '').split('/')
  if (major !== type || !rest) return DEFAULT_EXT[type]
  const sub = rest.split(';')[0].trim().toLowerCase()
  // 오디오 전용 mp4 컨테이너는 m4a로
  if (type === 'audio' && sub === 'mp4') return 'm4a'
  return SUBTYPE_EXT[sub] || sub.split('+')[0] || DEFAULT_EXT[type]
}

/** 저장 파일 이름 — 요소에 filename이 있으면 우선, 생성한 음악은 작업 id로. */
export function mediaDownloadName(el, mime) {
  if (el.filename) return el.filename
  const ext = mediaExt(el.type, mime)
  if (el.type === 'audio' && el.musicJobId) return `genitor-music-${el.musicJobId}.${ext}`
  return `${BASE_NAME[el.type] || 'media'}.${ext}`
}
