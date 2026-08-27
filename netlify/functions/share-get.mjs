// 공유 링크 조회 — id로 저장된 .flatproj(ZIP) 바이너리를 반환.
// 만료된 항목은 조회 시점에 지연 삭제(lazy delete)하고 404를 반환한다.
import { getStore } from '@netlify/blobs'

const ID_RE = /^[A-Za-z0-9_-]{10,40}$/

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  const id = url.searchParams.get('id') || ''
  if (!ID_RE.test(id)) return json({ error: 'invalid_id' }, 400)

  const store = getStore('genitor-shares')
  const result = await store.getWithMetadata(id, { type: 'arrayBuffer' })
  if (!result) return json({ error: 'not_found' }, 404)

  const expiresAt = Number(result.metadata?.expiresAt) || 0
  if (!expiresAt || Date.now() > expiresAt) {
    await store.delete(id).catch(() => {})
    return json({ error: 'expired' }, 404)
  }

  return new Response(result.data, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'cache-control': 'no-store',
    },
  })
}
