import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'
import { savePending, updatePending, removePending, listPending, countRecoverable } from './lipsyncRecovery'

export { countRecoverable }

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
 *   팝업 → opener: genitor-lipsync:ready { sessionId, multiJob }
 *   Genitor → 팝업: genitor-lipsync:input { sessionId, jobId, audio:Blob, audioName, video:Blob, videoName }
 *   팝업 → opener: genitor-lipsync:progress { sessionId, jobId, progress, statusText }
 *   팝업 → opener: genitor-lipsync:result { sessionId, jobId, blob:Blob, filename }
 *   팝업 → opener: genitor-lipsync:error { sessionId, jobId, message } | :cancelled { sessionId }
 *
 * 다건: 팝업 하나(popupHub)를 공유해 여러 잡을 jobId로 멀티플렉싱 → 동시 실행. jobId는 aiJobStore
 * 잡 id를 사용. 실제 GPU 병렬은 백엔드(RunPod 큐/워커)가 담당. (POPUP_INTEGRATION_GUIDE.md §5.1·§6.1)
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
 * popupHub — 인증된 Worker SPA 팝업 **하나**를 열어두고 여러 립싱크 잡을 jobId로 멀티플렉싱한다.
 * 잡마다 창을 새로 열면 팝업 차단(제스처당 1창) + 창 N개 UX 문제가 있으므로, 첫 잡이 팝업을 열고
 * 이후 잡은 같은 창으로 input을 흘려보낸다. ready 전 도착분은 큐잉했다가 로그인 완료 시 일괄 전송.
 * 실제 GPU 병렬은 백엔드(RunPod 큐/워커)가 담당. 프로토콜: POPUP_INTEGRATION_GUIDE.md §5.1·§6.1.
 */
const popupHub = (() => {
  let win = null, ready = false, sid = null, loginTimer = null, closeTimer = null, bound = false, seq = 0
  const jobs = new Map()   // jobId → { onReady, onProgress, onResult, onError }
  const queue = []         // ready 전 대기 입력: { jobId, audioBlob, videoBlob }

  const send = (i) => {
    if (!win || win.closed) return
    if (i.recover) {
      // 복구: 업로드·생성 없이 기존 Worker 잡(providerJobId) 결과만 회수.
      win.postMessage({ type: `${MSG}:recover`, sessionId: sid, jobId: i.jobId, providerJobId: i.providerJobId }, workerOrigin())
    } else {
      win.postMessage({
        type: `${MSG}:input`, sessionId: sid, jobId: i.jobId,
        audio: i.audioBlob, audioName: 'note-audio',
        video: i.videoBlob, videoName: 'driving.mp4',
      }, workerOrigin())
    }
    jobs.get(i.jobId)?.onReady?.()
  }

  const onMsg = (e) => {
    if (e.origin !== workerOrigin()) return
    const d = e.data || {}
    if (sid && d.sessionId && d.sessionId !== sid) return
    if (d.type === `${MSG}:ready`) {
      ready = true
      if (loginTimer) { clearTimeout(loginTimer); loginTimer = null }
      while (queue.length) send(queue.shift())
      return
    }
    const h = d.jobId ? jobs.get(d.jobId) : null
    if (!h) return
    switch (d.type) {
      case `${MSG}:submitted`: h.onSubmitted?.(d.providerJobId); break // 복구용 provider 잡 id 통지
      case `${MSG}:progress`: h.onProgress?.(d); break
      case `${MSG}:result`:   jobs.delete(d.jobId); h.onResult?.(d); teardownIfIdle(); break
      case `${MSG}:error`:    jobs.delete(d.jobId); h.onError?.(d.message || '생성 실패'); teardownIfIdle(); break
      default: break
    }
  }

  const failAll = (msg) => { const hs = [...jobs.values()]; jobs.clear(); queue.length = 0; teardown(); hs.forEach(h => h.onError?.(msg)) }
  const teardownIfIdle = () => { if (jobs.size === 0) teardown() }
  function teardown() {
    if (loginTimer) { clearTimeout(loginTimer); loginTimer = null }
    if (closeTimer) { clearInterval(closeTimer); closeTimer = null }
    if (win && !win.closed) { try { win.close() } catch { /* noop */ } }
    win = null; ready = false; sid = null
  }
  function open() {   // ← 반드시 사용자 제스처(클릭) 안에서 호출되어야 팝업 차단을 피함
    sid = (globalThis.crypto?.randomUUID?.() || `genitor-${Date.now()}-${seq++}`)
    ready = false
    const params = new URLSearchParams({ mode: 'popup', origin: window.location.origin, session: sid })
    win = window.open(`${workerBase()}?${params}`, 'genitor-lipsync', 'width=1100,height=820,noopener=0')
    if (!win) return false
    if (!bound) { window.addEventListener('message', onMsg); bound = true }
    // 로그인 안전망: ready를 끝까지 못 받으면 대기 중인 모든 잡 실패. 짧은 타임아웃 금지(OTP 중 닫힘).
    loginTimer = setTimeout(() => { if (!ready) failAll('립싱크 팝업이 응답하지 않습니다. (로그인 미완료 또는 연동 오류)') }, LOGIN_SAFETY_MS)
    // 사용자가 팝업을 직접 닫으면 진행 중 잡 모두 실패 처리
    closeTimer = setInterval(() => { if (win && win.closed) failAll('팝업이 닫혔습니다.') }, 1500)
    return true
  }
  return {
    submit(job) {   // { jobId, audioBlob, videoBlob, onReady, onSubmitted, onProgress, onResult, onError }
      const { jobId, audioBlob, videoBlob, ...cb } = job
      jobs.set(jobId, cb)
      if (!win || win.closed) { if (!open()) { jobs.delete(jobId); cb.onError?.('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.'); return } }
      const input = { jobId, audioBlob, videoBlob }
      ready ? send(input) : queue.push(input)
    },
    recover(jobId, providerJobId, handlers) {   // 이전 세션에 제출됐던 잡 결과만 회수
      jobs.set(jobId, handlers)
      if (!win || win.closed) { if (!open()) { jobs.delete(jobId); handlers.onError?.('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.'); return } }
      const item = { jobId, providerJobId, recover: true }
      ready ? send(item) : queue.push(item)
    },
    cancel(jobId) { jobs.delete(jobId); const i = queue.findIndex(q => q.jobId === jobId); if (i >= 0) queue.splice(i, 1); teardownIfIdle() },
  }
})()

/**
 * 립싱크 작업 시작 → jobId. 결과는 트레이에서 '적용'하면 대상 페이지에 삽입된다.
 * 여러 번 호출하면 팝업 하나를 공유해 동시 실행된다(popupHub).
 * @param {{ videoEl, audioSource:{ref,label}, pageKey:string, now?:number }} args
 */
export function startLipsyncJob({ videoEl, audioSource, pageKey, now = Date.now() }) {
  const store = useAiJobStore.getState()

  const isRunning = () => {
    const j = useAiJobStore.getState().jobs.find(x => x.id === id)
    return !!j && j.status === 'running'
  }
  const fail = (m) => { popupHub.cancel(id); if (isRunning()) useAiJobStore.getState().failJob(id, m) }

  const id = store.startJob({
    kind: 'lipsync',
    label: `립싱크 — ${audioSource?.label || '음성'}`,
    targetPageKey: pageKey || null,
    targetElementId: videoEl?.id || null,
    createdAt: now,
    abort: () => popupHub.cancel(id),
    // Promise 반환 → applyJob이 성공 시에만 applied 처리, 실패 시 트레이에 다시 노출(결과 유실 방지)
    apply: (job, opts) => applyResult(job, opts?.mode || 'replace', audioSource?.kind),
  })

  // 입력 blob 준비 → 허브에 제출(팝업 공유)
  Promise.all([resolveBlob(videoEl?.content), resolveBlob(audioSource?.ref)])
    .then(([videoBlob, audioBlob]) => {
      if (!isRunning()) return
      if (!videoBlob) return fail('구동 영상을 불러오지 못했습니다.')
      if (!audioBlob) return fail('오디오를 불러오지 못했습니다.')
      store.updateJob(id, { statusText: '팝업에서 로그인 대기 중…' })
      // 탭 폐기 대비 durable 기록(제출 시점). providerJobId는 submitted 수신 시 채운다.
      savePending({
        jobId: id, providerJobId: null,
        label: `립싱크 — ${audioSource?.label || '음성'}`,
        targetPageKey: pageKey || null, targetElementId: videoEl?.id || null,
        audioKind: audioSource?.kind || null, createdAt: now,
      })
      popupHub.submit({
        jobId: id, audioBlob, videoBlob,
        onReady: () => { if (isRunning()) useAiJobStore.getState().updateJob(id, { statusText: '업로드·생성 중…' }) },
        onSubmitted: (providerJobId) => { if (providerJobId) updatePending(id, { providerJobId }) },
        onProgress: (d) => {
          if (!isRunning()) return
          useAiJobStore.getState().updateJob(id, {
            progress: Math.max(1, Math.min(99, d.progress | 0)),
            statusText: d.statusText || '생성 중…',
          })
        },
        onResult: (d) => {
          removePending(id) // 결과 수령 완료 → durable 기록 정리
          if (d.blob) useAiJobStore.getState().completeJob(id, { blob: d.blob, filename: d.filename })
          else if (isRunning()) useAiJobStore.getState().failJob(id, '결과가 비어 있습니다.')
        },
        onError: (m) => { removePending(id); if (isRunning()) useAiJobStore.getState().failJob(id, m) },
      })
    })
    .catch(e => { removePending(id); fail(e?.message || '입력 준비 실패') })

  return id
}

/**
 * recoverPendingLipsyncJobs — 이전 세션(탭 폐기/새로고침)에 제출됐던 립싱크 결과를 회수한다.
 * durable 기록의 providerJobId로 팝업에 recover를 보내 결과 Blob만 받아 트레이에 'ready'로 올린다.
 * **반드시 사용자 제스처(클릭) 안에서 호출** — 팝업을 열기 때문(차단 회피). 회수된 건수를 반환.
 */
export function recoverPendingLipsyncJobs() {
  const pending = listPending().filter(e => e.providerJobId)
  let started = 0
  for (const e of pending) {
    // 이미 이 세션에 같은 대상의 살아있는 잡이 있으면(중복) 건너뜀
    const dup = useAiJobStore.getState().jobs.find(
      j => j.kind === 'lipsync' && j.targetElementId === e.targetElementId &&
        (j.status === 'running' || j.status === 'ready'))
    if (dup) continue
    const store = useAiJobStore.getState()
    const rid = store.startJob({
      kind: 'lipsync',
      label: (e.label || '립싱크') + ' (복구)',
      targetPageKey: e.targetPageKey || null,
      targetElementId: e.targetElementId || null,
      createdAt: e.createdAt || now(),
      abort: () => popupHub.cancel(rid),
      apply: (job, opts) => applyResult(job, opts?.mode || 'replace', e.audioKind),
    })
    const isRunning = () => {
      const j = useAiJobStore.getState().jobs.find(x => x.id === rid)
      return !!j && j.status === 'running'
    }
    store.updateJob(rid, { statusText: '이전 작업 복구 중…' })
    popupHub.recover(rid, e.providerJobId, {
      onReady: () => { if (isRunning()) useAiJobStore.getState().updateJob(rid, { statusText: '결과 회수 중…' }) },
      onProgress: (d) => {
        if (!isRunning()) return
        useAiJobStore.getState().updateJob(rid, {
          progress: Math.max(1, Math.min(99, d.progress | 0)),
          statusText: d.statusText || '복구 중…',
        })
      },
      onResult: (d) => {
        removePending(e.jobId)
        if (d.blob) useAiJobStore.getState().completeJob(rid, { blob: d.blob, filename: d.filename })
        else if (isRunning()) useAiJobStore.getState().failJob(rid, '결과가 비어 있습니다.')
      },
      onError: (m) => { removePending(e.jobId); if (isRunning()) useAiJobStore.getState().failJob(rid, m) },
    })
    started++
  }
  return started
}

// startJob은 createdAt 주입을 요구 — 복구 기본값용 시각(테스트 결정성은 저장된 createdAt 우선).
function now() { return Date.now() }
