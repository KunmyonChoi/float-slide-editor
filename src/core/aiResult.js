import { BlobStore } from './BlobStore'

/**
 * AI 생성 이미지 URL(dataURL 등) → idb ref로 보관.
 * 큰 dataURL을 요소 content에 그대로 넣으면 실행취소 히스토리/저장 스냅샷이 비대해지고
 * structuredClone로 OOM 위험이 있어 IndexedDB(BlobStore)로 옮긴다. 실패 시 원본 URL 유지.
 * @param {string} url data:/blob:/http URL
 * @returns {Promise<string>} idb:// ref 또는 원본 url
 */
export async function storeResultRef(url) {
  try {
    const blob = await fetch(url).then(r => r.blob())
    return BlobStore.toRef(await BlobStore.put(blob))
  } catch {
    return url
  }
}
