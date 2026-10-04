/**
 * MusicBackendClient — 음악 생성 서버(genitor-music, YuE2) 클라이언트.
 *
 * CutoutBackendClient와 같은 패턴: 절대 URL(기본 http://localhost:8326)로 직접 호출
 * (서버가 CORS 전체 허용 + Private Network Access 처리).
 * URL 오버라이드: localStorage['music-backend-url'] > VITE_MUSIC_BACKEND_URL > 기본.
 *
 * 생성은 Apple M1 기준 수 분이 걸려 작업(job) 방식이다: 작업 생성 → 상태 폴링 → 오디오 다운로드.
 */
export const MUSIC_DEFAULT_PORT = 8326
const MUSIC_URL_KEY = 'music-backend-url'

const GH_REPO = 'KunmyonChoi/float-slide-editor'
export const MUSIC_DOWNLOADS = {
  mac: `https://github.com/${GH_REPO}/releases/latest/download/genitor-music-mac.zip`,
}

/** 백엔드 베이스 URL (localStorage > 빌드 env > 기본 localhost:8326). */
export function getMusicBase() {
  try {
    const o = localStorage.getItem(MUSIC_URL_KEY)
    if (o !== null) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  const env = import.meta.env?.VITE_MUSIC_BACKEND_URL
  if (env) return String(env).replace(/\/+$/, '')
  return `http://localhost:${MUSIC_DEFAULT_PORT}`
}

/**
 * 헬스체크 → { ok, ready, device, detail }.
 * ok=서버 응답, ready=설치·모델 준비 완료(모델을 받는 중이면 false).
 */
export async function checkMusicHealth() {
  try {
    const res = await fetch(`${getMusicBase()}/api/health`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false, ready: false }
    const j = await res.json()
    return { ok: true, ready: !!j.ready, device: j.device || null, detail: j.detail || null, running: j.running || null }
  } catch {
    return { ok: false, ready: false }
  }
}

async function jsonOrThrow(res) {
  let body = null
  try { body = await res.json() } catch { /* 본문 없음 */ }
  if (!res.ok) throw new Error(body?.error || `음악 서버 오류 (${res.status})`)
  return body
}

/**
 * 생성 작업 등록.
 * @param {{ mode: 'instrumental'|'song', style: string, lyrics?: string, length?: 'short'|'medium'|'long', seed?: number }} params
 * @returns {Promise<{ id: string }>}
 */
export async function createMusicJob(params, { signal } = {}) {
  const res = await fetch(`${getMusicBase()}/api/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params), signal,
  })
  return jsonOrThrow(res)
}

/** 작업 상태 → { status: queued|running|done|failed|cancelled, stage, progress, error, result } */
export async function getMusicJob(id, { signal } = {}) {
  return jsonOrThrow(await fetch(`${getMusicBase()}/api/jobs/${encodeURIComponent(id)}`, { signal }))
}

export async function cancelMusicJob(id) {
  try {
    await fetch(`${getMusicBase()}/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  } catch { /* 서버가 내려갔으면 취소할 것도 없다 */ }
}

/** 완료된 작업의 오디오 Blob (기본 mp3). */
export async function fetchMusicAudio(id, { format = 'mp3', signal } = {}) {
  const res = await fetch(`${getMusicBase()}/api/jobs/${encodeURIComponent(id)}/audio?format=${format}`, { signal })
  if (!res.ok) throw new Error(`오디오를 받지 못했습니다 (${res.status})`)
  return res.blob()
}

/**
 * 작업이 끝날 때까지 폴링. onUpdate(job)로 진행 상황을 전달한다.
 * 완료면 job 반환, 실패/취소면 throw(취소는 AbortError).
 */
export async function waitMusicJob(id, { onUpdate, signal, intervalMs = 2000 } = {}) {
  for (;;) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    const job = await getMusicJob(id, { signal })
    onUpdate?.(job)
    if (job.status === 'done') return job
    if (job.status === 'failed') throw new Error(job.error || '음악 생성에 실패했습니다.')
    if (job.status === 'cancelled') throw new DOMException('cancelled', 'AbortError')
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelled', 'AbortError')) }, { once: true })
    })
  }
}

/** 최근 작업 목록(새 것부터). mode='song'이면 노래만. → [{ id, status, result, created, preview }] */
export async function listMusicJobs({ mode, signal } = {}) {
  const q = mode ? `?mode=${encodeURIComponent(mode)}` : ''
  const body = await jsonOrThrow(await fetch(`${getMusicBase()}/api/jobs${q}`, { signal }))
  return body.jobs || []
}

/**
 * 노래 작업의 가사 줄 타이밍 → { lines: [{ start, end, text, section }], offset, source }.
 * source='vocal'이면 서버가 보컬 분리 + 강제 정렬로 소리에 맞춘 오디오 시각(offset 0),
 * 'score'면 악보 기반(offset 기본 0.4). 아직 정렬 전인 노래는 이 요청에서 정렬해 수십 초 걸린다.
 */
export async function fetchLyricsTiming(id, { signal } = {}) {
  const body = await jsonOrThrow(await fetch(`${getMusicBase()}/api/jobs/${encodeURIComponent(id)}/lyrics`, { signal }))
  return { lines: body.lines || [], offset: body.offset, source: body.source || 'score', busy: !!body.busy }
}
