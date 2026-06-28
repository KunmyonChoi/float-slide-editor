import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'

/**
 * lipsyncRunner — 립싱크 생성 작업을 전역 aiJobStore에 시작하고, 인증된 Worker SPA 팝업과
 * postMessage로 통신해 결과 영상을 받는다. (project_ai_job_model Phase 4 / project_lipsync_integration)
 *
 * 왜 팝업인가: Worker는 Cloudflare Access(JWT)로 보호되고 R2 CORS가 worker 오리진만 허용 →
 * Genitor(netlify, 크로스오리진)가 직접 호출 불가. 팝업(=Worker SPA, same-origin)에서 사용자가
 * Access 로그인 후 업로드/생성/폴링을 수행하고, 결과 영상 blob을 opener(Genitor)에 회신한다.
 *
 * Worker SPA가 아래 프로토콜을 구현하며 E2E 검증 완료. origin/session 검증 필수.
 * 로그인 단계(=ready 수신 전)엔 짧은 타임아웃으로 팝업을 닫지 말 것 — CF Access OTP 로그인이
 * 끝나기 전엔 SPA가 ready를 보낼 수 없으므로(LOGIN_SAFETY_MS 참고).
 *   Genitor → 팝업: `${WORKER}?mode=popup&origin=<genitor>&session=<sid>`
 *   팝업 → opener: genitor-lipsync:ready
 *   Genitor → 팝업: genitor-lipsync:input { sessionId, audio:Blob, audioName, video:Blob, videoName }
 *   팝업 → opener: genitor-lipsync:progress { sessionId, progress, statusText }
 *   팝업 → opener: genitor-lipsync:result { sessionId, blob:Blob, filename }
 *   팝업 → opener: genitor-lipsync:error { sessionId, message } | :cancelled { sessionId }
 */

const DEFAULT_WORKER_URL = 'https://lipsync-worker.skt-ent-ai.workers.dev'
const MSG = 'genitor-lipsync'
// 로그인 단계 안전망. CF Access 로그인 화면은 SPA보다 먼저 떠서 로그인이 끝나기 전엔 `ready`를
// 받을 수 없다. 이메일 OTP 입력(코드 받기→메일 확인→타이핑)이 30초~2분 걸리므로 짧은 타임아웃은
// 사용자가 코드를 입력하기도 전에 팝업을 닫아버린다. 넉넉히 5분. (취소는 popup.closed 폴링이 담당.)
const LOGIN_SAFETY_MS = 5 * 60 * 1000

function workerBase() {
  try { return localStorage.getItem('lipsync-worker-url') || DEFAULT_WORKER_URL } catch { return DEFAULT_WORKER_URL }
}
function workerOrigin() {
  try { return new URL(workerBase()).origin } catch { return DEFAULT_WORKER_URL }
}

/** idb:// 참조나 blob:/data:/http URL → Blob */
async function resolveBlob(ref) {
  if (!ref) return null
  if (BlobStore.isIdbRef(ref)) return await BlobStore.get(BlobStore.parseRef(ref))
  const r = await fetch(ref)
  return await r.blob()
}

/** 결과 적용 — mode 'replace'(원본 교체, 기본) | 'add'(새 요소). 트레이 '적용 ▾'이 호출.
 * noteDriven=true(오디오 소스가 노트 음성)면: 영상은 소리를 내고(autoplay) 대신 그 슬라이드
 * 노트 음성 볼륨을 0으로 자동 설정 → 발표 시 영상이 소리·입 완벽 동기, 노트는 무음 재생으로
 * 자동진행만 담당(에코·싱크 어긋남 회피). */
async function applyResult(job, mode, audioKind) {
  const blob = job?.result?.blob
  if (!blob) return
  const st = useFlatStore.getState()
  const key = await BlobStore.put(blob)
  const ref = BlobStore.toRef(key)
  const noteDriven = audioKind === 'note'
  // 노트 음성 기반: 그 슬라이드 노트 음성 볼륨을 0으로(영상이 소리 담당)
  if (noteDriven) st.setPageNotesAudioVolume(0, job.targetPageKey)
  if (mode !== 'add' && job.targetElementId) {
    // 원본 구동 영상 요소의 내용을 결과로 교체(같은 위치·크기, objectFit 유지, 되돌리기 가능)
    const ok = st.applyToElementOnPage(job.targetPageKey, job.targetElementId, {
      content: ref, isRich: false, type: 'video',
      ...(noteDriven ? { autoplay: true, muted: false } : {}),
    })
    if (ok) return
    // 대상이 삭제됐으면 새 요소 추가로 폴백
  }
  await insertResultVideo(job, key, noteDriven)
}

/** 결과 영상 → 대상 페이지에 새 비디오 요소로 삽입(원본 보존). key 재사용.
 * noteDriven이면 autoplay+소리 on(노트 음성은 볼륨0으로 따로 설정됨). */
async function insertResultVideo(job, key, noteDriven = false) {
  const blob = job?.result?.blob
  if (!blob) return
  const st = useFlatStore.getState()
  if (!key) key = await BlobStore.put(blob)
  const cs = st.canvasSize || { w: 1280, h: 720 }
  let w = cs.w * 0.5, h = cs.h * 0.5
  try {
    const url = await BlobStore.getUrl(key)
    const v = document.createElement('video'); v.preload = 'metadata'; v.src = url
    await new Promise(r => { v.onloadedmetadata = r; v.onerror = r })
    if (v.videoWidth) { w = v.videoWidth; h = v.videoHeight }
  } catch { /* 메타 측정 실패 시 캔버스 절반 */ }
  const maxW = cs.w * 0.6, maxH = cs.h * 0.6
  if (w > maxW || h > maxH) { const k = Math.min(maxW / w, maxH / h); w = Math.round(w * k); h = Math.round(h * k) }
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const el = {
    id: nextFlatId(), sourceId: null, type: 'video', width: Math.round(w), height: Math.round(h),
    content: BlobStore.toRef(key), isRich: false, merged: false,
    autoplay: noteDriven, loop: false, muted: false, hideControls: false,
    filename: job.result.filename || undefined,
    x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2),
    zIndex: maxZ + 1, styles: { backgroundColor: 'rgba(0,0,0,0)', borderRadius: '8px', opacity: '1' },
  }
  st.addElementToPage(job.targetPageKey, el)
}

/**
 * 립싱크 작업 시작 → jobId. 결과는 트레이에서 '적용'하면 대상 페이지에 삽입된다.
 * @param {{ videoEl, audioSource:{ref,label}, pageKey:string, now?:number }} args
 */
export function startLipsyncJob({ videoEl, audioSource, pageKey, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const sid = (globalThis.crypto?.randomUUID?.() || `genitor-${now}`)

  let win = null
  let readyTimer = null
  let closeTimer = null
  let pending = null // ready 수신 시 보낼 입력 blob

  const teardown = () => {
    window.removeEventListener('message', onMsg)
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
    if (closeTimer) { clearInterval(closeTimer); closeTimer = null }
    if (win && !win.closed) { try { win.close() } catch { /* noop */ } }
    win = null
  }
  const isRunning = () => {
    const j = useAiJobStore.getState().jobs.find(x => x.id === id)
    return !!j && j.status === 'running'
  }
  const fail = (m) => { teardown(); if (isRunning()) useAiJobStore.getState().failJob(id, m) }

  const id = store.startJob({
    kind: 'lipsync',
    label: `립싱크 — ${audioSource?.label || '음성'}`,
    targetPageKey: pageKey || null,
    targetElementId: videoEl?.id || null,
    createdAt: now,
    abort: teardown,
    apply: (job, opts) => { applyResult(job, opts?.mode || 'replace', audioSource?.kind).catch(() => {}) },
  })

  const onMsg = (e) => {
    if (e.origin !== workerOrigin()) return
    const d = e.data || {}
    if (d.sessionId && d.sessionId !== sid) return
    if (!isRunning()) return
    switch (d.type) {
      case `${MSG}:ready`:
        // 로그인 완료 → SPA 살아있음. 로그인 안전망 해제(이후엔 progress/result/close가 수명 관리).
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
        if (pending && win) {
          win.postMessage({
            type: `${MSG}:input`, sessionId: sid,
            audio: pending.audioBlob, audioName: 'note-audio',
            video: pending.videoBlob, videoName: 'driving.mp4',
          }, workerOrigin())
          useAiJobStore.getState().updateJob(id, { statusText: '업로드·생성 중…' })
        }
        break
      case `${MSG}:progress`:
        useAiJobStore.getState().updateJob(id, {
          progress: Math.max(1, Math.min(99, d.progress | 0)),
          statusText: d.statusText || '생성 중…',
        })
        break
      case `${MSG}:result`:
        teardown()
        if (d.blob) useAiJobStore.getState().completeJob(id, { blob: d.blob, filename: d.filename })
        else useAiJobStore.getState().failJob(id, '결과가 비어 있습니다.')
        break
      case `${MSG}:error`:
        fail(d.message || '생성 실패')
        break
      case `${MSG}:cancelled`:
        teardown(); if (isRunning()) useAiJobStore.getState().cancelJob(id)
        break
      default: break
    }
  }
  window.addEventListener('message', onMsg)

  // 입력 blob 준비 → 팝업 오픈
  Promise.all([resolveBlob(videoEl?.content), resolveBlob(audioSource?.ref)])
    .then(([videoBlob, audioBlob]) => {
      if (!isRunning()) return
      if (!videoBlob) return fail('구동 영상을 불러오지 못했습니다.')
      if (!audioBlob) return fail('오디오를 불러오지 못했습니다.')
      pending = { videoBlob, audioBlob }
      const params = new URLSearchParams({ mode: 'popup', origin: window.location.origin, session: sid })
      win = window.open(`${workerBase()}?${params}`, 'genitor-lipsync', 'width=1100,height=820,noopener=0')
      if (!win) return fail('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.')
      store.updateJob(id, { statusText: '팝업에서 로그인 대기 중…' })
      // 로그인 단계 안전망: ready를 끝까지 못 받으면(차단/장애) 실패 처리. 짧은 타임아웃으로 닫지
      // 말 것 — OTP 로그인 중 팝업이 닫힌다. ready 수신 시 위에서 해제됨. 사용자 취소는 closeTimer가 담당.
      readyTimer = setTimeout(() => {
        const j = useAiJobStore.getState().jobs.find(x => x.id === id)
        if (j && j.status === 'running' && (j.progress || 0) === 0) {
          fail('립싱크 팝업이 응답하지 않습니다. (로그인 미완료 또는 연동 오류)')
        }
      }, LOGIN_SAFETY_MS)
      // 사용자가 팝업을 직접 닫으면 취소 처리
      closeTimer = setInterval(() => {
        if (win && win.closed) { const running = isRunning(); teardown(); if (running) useAiJobStore.getState().failJob(id, '팝업이 닫혔습니다.') }
      }, 1500)
    })
    .catch(e => fail(e?.message || '입력 준비 실패'))

  return id
}
