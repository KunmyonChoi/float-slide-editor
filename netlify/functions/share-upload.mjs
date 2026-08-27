// 공유 링크 업로드 — .flatproj(ZIP) 바이너리를 청크 단위로 받아 Netlify Blobs에 저장.
// 서버리스 함수의 요청 본문 크기 제한을 피하기 위해 클라이언트가 청크로 나눠 순차 전송하고,
// 마지막 청크가 도착하면 이어붙여 최종 산출물을 저장한다.
import { getStore } from '@netlify/blobs'

const ID_RE = /^[A-Za-z0-9_-]{10,40}$/
const MAX_CHUNK_BYTES = 4 * 1024 * 1024 // 청크당 4MB
const MAX_CHUNKS = 8 // 총 업로드 상한 ~32MB
const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000 // 30일

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  const id = url.searchParams.get('id') || ''
  const chunkIndex = Number(url.searchParams.get('chunkIndex'))
  const totalChunks = Number(url.searchParams.get('totalChunks'))

  if (!ID_RE.test(id)) return json({ error: 'invalid_id' }, 400)
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return json({ error: 'invalid_chunk_index' }, 400)
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
    return json({ error: 'invalid_total_chunks', maxChunks: MAX_CHUNKS }, 400)
  }
  if (chunkIndex >= totalChunks) return json({ error: 'chunk_index_out_of_range' }, 400)

  const body = await req.arrayBuffer()
  if (body.byteLength === 0) return json({ error: 'empty_chunk' }, 400)
  if (body.byteLength > MAX_CHUNK_BYTES) return json({ error: 'chunk_too_large', maxBytes: MAX_CHUNK_BYTES }, 413)

  const chunkStore = getStore('genitor-share-chunks')
  await chunkStore.set(`${id}:${chunkIndex}`, body, {
    metadata: { uploadedAt: Date.now() },
  })

  if (chunkIndex < totalChunks - 1) {
    return json({ done: false, received: chunkIndex + 1, totalChunks })
  }

  // 마지막 청크 도착 — 순서대로 이어붙여 최종 산출물로 저장
  const parts = []
  let totalSize = 0
  for (let i = 0; i < totalChunks; i++) {
    const part = await chunkStore.get(`${id}:${i}`, { type: 'arrayBuffer' })
    if (!part) return json({ error: 'missing_chunk', chunkIndex: i }, 409)
    parts.push(new Uint8Array(part))
    totalSize += part.byteLength
  }
  const combined = new Uint8Array(totalSize)
  let offset = 0
  for (const part of parts) { combined.set(part, offset); offset += part.byteLength }

  const expiresAt = Date.now() + EXPIRE_MS
  const shareStore = getStore('genitor-shares')
  await shareStore.set(id, combined, {
    metadata: { expiresAt, size: totalSize, createdAt: Date.now() },
  })

  // 임시 청크 정리 (실패해도 스케줄 정리 작업이 나중에 수거)
  await Promise.all(
    Array.from({ length: totalChunks }, (_, i) => chunkStore.delete(`${id}:${i}`).catch(() => {})),
  )

  return json({ done: true, id, expiresAt: new Date(expiresAt).toISOString() })
}
