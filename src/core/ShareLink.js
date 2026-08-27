/**
 * ShareLink — 프로젝트(.flatproj)를 링크로 공유
 *
 * 서버는 Netlify Functions + Netlify Blobs(netlify/functions/share-*.mjs)이며 별도 백엔드가 없다.
 * 업로드는 청크로 나눠 순차 전송해 서버리스 함수의 요청 본문 크기 제한을 피한다.
 */
const CHUNK_BYTES = 4 * 1024 * 1024 // 청크당 4MB — netlify/functions/share-upload.mjs의 한도와 일치
const MAX_CHUNKS = 8 // 총 업로드 상한 ~32MB

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 현재 프로젝트를 직렬화해 서버에 업로드하고 공유 링크를 발급
 * @param {object} store useFlatStore.getState()
 * @param {(progress: number) => void} [onProgress] 0~1
 * @returns {Promise<{ id: string, url: string, expiresAt: string }>}
 */
export async function createShareLink(store, onProgress) {
  const { serializeProject } = await import('./ProjectSerializer.js')
  const blob = await serializeProject(store)
  const totalChunks = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES))
  if (blob.size === 0) throw new Error('공유할 프로젝트 내용이 없습니다')
  if (totalChunks > MAX_CHUNKS) {
    const maxMb = Math.floor((CHUNK_BYTES * MAX_CHUNKS) / (1024 * 1024))
    throw new Error(`프로젝트가 너무 큽니다(최대 약 ${maxMb}MB). 이미지/영상 용량을 줄이거나 파일로 저장해 전달하세요.`)
  }

  const id = randomId()
  let last = null
  for (let i = 0; i < totalChunks; i++) {
    const chunk = blob.slice(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, blob.size))
    const params = new URLSearchParams({ id, chunkIndex: String(i), totalChunks: String(totalChunks) })
    const res = await fetch(`/.netlify/functions/share-upload?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json())?.error || '' } catch { /* 무시 */ }
      throw new Error(`공유 링크 업로드에 실패했습니다${detail ? ` (${detail})` : ` (HTTP ${res.status})`}`)
    }
    last = await res.json()
    onProgress?.((i + 1) / totalChunks)
  }

  if (!last?.done) throw new Error('공유 링크 생성에 실패했습니다')
  const url = `${location.origin}${location.pathname}?share=${id}`
  return { id, url, expiresAt: last.expiresAt }
}

/**
 * 공유 링크(id)로 프로젝트 데이터를 가져와 ProjectSerializer 결과 형태로 반환
 * @param {string} id
 * @returns {Promise<{pages, currentPageKey, themeId, customTheme, metadata}>}
 */
export async function fetchSharedProject(id) {
  const res = await fetch(`/.netlify/functions/share-get?id=${encodeURIComponent(id)}`)
  if (res.status === 404) {
    let reason = ''
    try { reason = (await res.json())?.error || '' } catch { /* 무시 */ }
    throw new Error(reason === 'expired' ? '이 공유 링크는 만료되었습니다' : '공유 링크를 찾을 수 없습니다')
  }
  if (!res.ok) throw new Error(`공유 프로젝트를 불러오지 못했습니다 (HTTP ${res.status})`)
  const blob = await res.blob()
  const { loadProjectFile } = await import('./ProjectSerializer.js')
  return loadProjectFile(blob)
}
