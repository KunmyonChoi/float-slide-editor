import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'
import { matteVideo } from './VideoMatteBackendClient'

/**
 * videoMatteRunner — 영상 전경 분리(B2, 고품질) 작업을 전역 aiJobStore로 시작한다.
 * (lipsyncRunner/imagenRunner 패턴 — HTTP로 float-matte 서버 호출.)
 *
 * 결과는 사람만 남긴 **알파 WebM**(네이티브 투명). 적용 시 원본 영상 요소의 content를 결과로
 * 교체(또는 새 요소로 추가)하고 chroma를 해제한다(webm 자체가 투명이라 실시간 매트 불필요).
 */

/** idb:// 참조나 blob:/data:/http URL → Blob */
async function resolveBlob(ref) {
  if (!ref) return null
  if (BlobStore.isIdbRef(ref)) return await BlobStore.get(BlobStore.parseRef(ref))
  const r = await fetch(ref)
  return await r.blob()
}

/** 결과 알파 WebM → 새 비디오 요소로 삽입(원본 보존). */
async function insertResultVideo(job, key) {
  const st = useFlatStore.getState()
  const cs = st.canvasSize || { w: 1280, h: 720 }
  let w = cs.w * 0.5, h = cs.h * 0.5
  try {
    const url = await BlobStore.getUrl(key)
    const v = document.createElement('video'); v.preload = 'metadata'; v.src = url
    await new Promise(r => { v.onloadedmetadata = r; v.onerror = r })
    if (v.videoWidth) { w = v.videoWidth; h = v.videoHeight }
  } catch { /* 메타 실패 시 절반 */ }
  const maxW = cs.w * 0.6, maxH = cs.h * 0.6
  if (w > maxW || h > maxH) { const k = Math.min(maxW / w, maxH / h); w = Math.round(w * k); h = Math.round(h * k) }
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const el = {
    id: nextFlatId(), sourceId: null, type: 'video', width: Math.round(w), height: Math.round(h),
    content: BlobStore.toRef(key), isRich: false, merged: false,
    autoplay: false, loop: true, muted: true, hideControls: false,
    filename: job.result?.filename || undefined,
    x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2),
    zIndex: maxZ + 1, styles: { backgroundColor: 'rgba(0,0,0,0)', borderRadius: '8px', opacity: '1' },
  }
  st.addElementToPage(job.targetPageKey, el)
}

/** 결과 적용 — opts.mode 'replace'(기본, 원본 교체) | 'add'(새 요소). 트레이 '적용 ▾'이 호출. */
async function applyResult(job, opts = {}) {
  const blob = job?.result?.blob
  if (!blob) return
  const st = useFlatStore.getState()
  const key = job.result.key || await BlobStore.put(blob)
  const ref = BlobStore.toRef(key)
  if (opts.mode !== 'add' && job.targetElementId) {
    // 원본 교체: 결과는 네이티브 투명 webm → chroma(색/AI 매트) 해제
    const ok = st.applyToElementOnPage(job.targetPageKey, job.targetElementId, {
      content: ref, isRich: false, type: 'video', chroma: null,
    })
    if (ok) return
    // 대상이 삭제됐으면 새 요소로 폴백
  }
  await insertResultVideo(job, key)
}

/**
 * 영상 전경 분리 작업 시작 → jobId. 진행/결과는 작업 트레이(AiJobTray)에서 확인·적용.
 * @param {{ videoEl:object, pageKey?:string, now?:number }} args
 */
export function startVideoMatteJob({ videoEl, pageKey, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()

  const id = store.startJob({
    kind: 'videomatte',
    label: 'AI 전경 분리(영상)',
    targetPageKey: pageKey || null,
    targetElementId: videoEl.id,
    createdAt: now,
    abort: () => ctrl.abort(),
    apply: (job, opts) => applyResult(job, opts),
  })
  store.updateJob(id, { statusText: '영상 전경 분리 중… (길이에 비례)' })

  ;(async () => {
    const blob = await resolveBlob(videoEl.content)
    if (!blob) throw new Error('영상 데이터를 찾을 수 없습니다.')
    const { blob: out, serverMs } = await matteVideo(blob, { signal: ctrl.signal })
    const key = await BlobStore.put(out)
    useAiJobStore.getState().completeJob(id, { blob: out, key, serverMs, filename: 'matte.webm' })
  })().catch((e) => {
    const st = useAiJobStore.getState()
    const j = st.jobs.find(x => x.id === id)
    if (!j || j.status !== 'running') return
    if (e?.name === 'AbortError') st.cancelJob(id)
    else st.failJob(id, e?.message || '전경 분리 실패')
  })

  return id
}
