// 공유 링크 정리(스케줄) — 만료된 공유 산출물과, 업로드가 끝나지 않고 방치된 임시 청크를 매일 정리한다.
import { getStore } from '@netlify/blobs'

export const config = { schedule: '@daily' }

const ORPHAN_CHUNK_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24시간 이상 방치된 임시 청크는 실패한 업로드로 간주

export default async () => {
  const shareStore = getStore('genitor-shares')
  const { blobs } = await shareStore.list()
  let deletedShares = 0
  for (const { key } of blobs) {
    const info = await shareStore.getMetadata(key).catch(() => null)
    const expiresAt = Number(info?.metadata?.expiresAt) || 0
    if (!expiresAt || Date.now() > expiresAt) {
      await shareStore.delete(key).catch(() => {})
      deletedShares++
    }
  }

  const chunkStore = getStore('genitor-share-chunks')
  const { blobs: chunkBlobs } = await chunkStore.list()
  let deletedChunks = 0
  for (const { key } of chunkBlobs) {
    const info = await chunkStore.getMetadata(key).catch(() => null)
    const uploadedAt = Number(info?.metadata?.uploadedAt) || 0
    if (!uploadedAt || Date.now() - uploadedAt > ORPHAN_CHUNK_MAX_AGE_MS) {
      await chunkStore.delete(key).catch(() => {})
      deletedChunks++
    }
  }

  return new Response(JSON.stringify({ deletedShares, deletedChunks }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
