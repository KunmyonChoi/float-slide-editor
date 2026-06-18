/**
 * SystemClipboard — 캔버스 요소를 OS(시스템) 클립보드에도 복사한다.
 *
 * 내부 복사(Ctrl+C, store.clipboard)와 별개로, 단일 이미지/텍스트 요소를 선택해 복사하면
 * 다른 앱에도 붙여넣을 수 있도록 async Clipboard API로 OS 클립보드에 기록한다.
 * - 텍스트: navigator.clipboard.writeText
 * - 이미지: navigator.clipboard.write([ClipboardItem{'image/png': Promise<Blob>}])
 *   (ClipboardItem에 Promise를 넘기면 이미지 로딩이 끝나기 전에도 사용자 제스처가 유지된다)
 * 보안: https(보안 컨텍스트)에서만 동작, 권한/오염(cross-origin) 실패는 조용히 무시.
 */
import { BlobStore } from './BlobStore'

function htmlToPlain(content) {
  if (!content) return ''
  if (!/[<&]/.test(content)) return content.trim()
  const div = document.createElement('div')
  div.innerHTML = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

// 이미지 요소 → PNG Blob. data:/idb:/외부 URL 모두 처리(오염 시 예외 → null로 캐치).
async function imageElementToPngBlob(element) {
  let src = element.content
  if (!src) return null
  if (BlobStore.isIdbRef(src)) src = await BlobStore.getUrl(BlobStore.parseRef(src))
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  canvas.getContext('2d').drawImage(img, 0, 0)
  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

/**
 * 단일 요소를 OS 클립보드에 복사(텍스트/이미지만). 사용자 제스처(복사) 안에서 호출할 것.
 * @param {object} element  flat 요소
 */
export function copyElementToSystemClipboard(element) {
  try {
    if (!element || !navigator.clipboard) return
    if (element.type === 'text') {
      const text = htmlToPlain(element.content || '')
      if (text && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {})
    } else if (element.type === 'image') {
      if (navigator.clipboard.write && typeof window.ClipboardItem === 'function') {
        // Promise<Blob>를 ClipboardItem에 전달 → 제스처 유지한 채 비동기 변환
        navigator.clipboard
          .write([new window.ClipboardItem({ 'image/png': imageElementToPngBlob(element) })])
          .catch(() => { /* 권한/오염 실패 무시 */ })
      }
    }
  } catch { /* 보안 컨텍스트/권한 문제 무시 */ }
}
