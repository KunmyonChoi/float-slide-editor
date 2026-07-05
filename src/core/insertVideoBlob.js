import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'

/**
 * 영상 Blob → 현재 슬라이드에 편집 가능한 비디오 요소로 삽입한다.
 * (AvatarRecorderButton·CameraCaptureModal 등 영상 삽입 경로 공용)
 *
 * @param {Blob} blob
 * @param {string} [filename]
 * @param {{autoplay?:boolean, loop?:boolean, muted?:boolean, hideControls?:boolean}} [opts]
 * @returns {Promise<string>} 생성된 요소 id
 */
export async function insertVideoBlob(blob, filename, opts = {}) {
  const st = useFlatStore.getState()
  const key = await BlobStore.put(blob)
  const blobUrl = await BlobStore.getUrl(key)
  // 메타데이터로 내재 해상도 측정 → 캔버스의 60% 이내로 축소 배치
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = blobUrl
  await new Promise(r => { video.onloadedmetadata = r; video.onerror = r })
  let w = video.videoWidth || 560
  let h = video.videoHeight || 315
  const cs = st.canvasSize || { w: 1920, h: 1080 }
  const maxW = cs.w * 0.6, maxH = cs.h * 0.6
  if (w > maxW || h > maxH) {
    const ratio = Math.min(maxW / w, maxH / h)
    w = Math.round(w * ratio); h = Math.round(h * ratio)
  }
  const els = st.flatElements
  const maxZ = els.length > 0 ? Math.max(...els.map(e => e.zIndex)) : 0
  const el = {
    id: nextFlatId(), sourceId: null,
    type: 'video', width: w, height: h,
    content: BlobStore.toRef(key),
    isRich: false, merged: false,
    autoplay: opts.autoplay ?? false,
    loop: opts.loop ?? false,
    muted: opts.muted ?? false,
    hideControls: opts.hideControls ?? false,
    filename: filename || undefined,
    x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2),
    zIndex: maxZ + 1,
    styles: { backgroundColor: 'rgba(0,0,0,0)', borderRadius: '8px', opacity: '1' },
  }
  st.addFlatElement(el)
  st.setSelectedFlat(el.id)
  return el.id
}
