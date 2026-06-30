import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'
import { generateLayoutImage } from './ImagenBackendClient'

/**
 * imagenRunner — Ideogram 4 레이아웃 이미지 생성을 전역 aiJobStore에 시작한다.
 * (lipsyncRunner 패턴 — 단, 팝업 없이 imgen-server HTTP 직접 호출.)
 *
 * 선택한 텍스트 박스들의 위치/내용을 0–1000 bbox JSON 캡션으로 만들어(buildCaption) 보내고,
 * 결과 PNG는 캔버스 전체를 덮는 이미지 요소로 삽입한다(캡션 bbox가 전체 캔버스 기준이므로
 * 원래 텍스트 위치와 정합). 생성이 28~127s라 트레이에서 진행/적용.
 */

/** 캔버스 비율에 맞춘 생성 크기 — 긴 변 ~1024, 64 배수, 512–1536 클램프(모델 patch 제약 안전). */
export function pickGenSize(cs) {
  const w0 = (cs && cs.w) || 1024
  const h0 = (cs && cs.h) || 1024
  const scale = 1024 / Math.max(w0, h0)
  const fit = (v) => Math.max(512, Math.min(1536, Math.round((v * scale) / 64) * 64))
  return { width: fit(w0), height: fit(h0) }
}

/** 결과 PNG → 대상 페이지에 캔버스 전체 크기 이미지 요소로 삽입(원래 레이아웃과 정합). */
async function applyResult(job) {
  const blob = job?.result?.blob
  if (!blob) return
  const st = useFlatStore.getState()
  const key = job.result.key || (await BlobStore.put(blob))
  const cs = job.result.canvasSize || st.canvasSize || { w: 1280, h: 720 }
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const el = {
    id: nextFlatId(), sourceId: null, type: 'image',
    content: BlobStore.toRef(key), isRich: false, merged: false,
    x: 0, y: 0, width: cs.w, height: cs.h, zIndex: maxZ + 1,
    styles: {
      backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none',
      borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', objectFit: 'cover',
    },
  }
  st.addElementToPage(job.targetPageKey, el)
}

/**
 * 레이아웃 이미지 생성 작업 시작 → jobId. 결과는 트레이에서 '적용'하면 대상 페이지에 삽입.
 * @param {{ caption:object, canvasSize:{w,h}, preset?:string, pageKey?:string, label?:string, now?:number }} args
 */
export function startImagenJob({ caption, canvasSize, preset, pageKey, label, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()
  const { width, height } = pickGenSize(canvasSize)

  const id = store.startJob({
    kind: 'imagen',
    label: label || 'AI 레이아웃 이미지',
    targetPageKey: pageKey || null,
    targetElementId: null,         // 새 이미지로 삽입(교체 대상 없음)
    createdAt: now,
    abort: () => ctrl.abort(),
    apply: (job) => applyResult(job),
  })
  store.updateJob(id, { statusText: '레이아웃 이미지 생성 중… (수십 초~분)' })

  generateLayoutImage(caption, { width, height, preset, signal: ctrl.signal })
    .then(async ({ blob, url, serverMs }) => {
      if (url) URL.revokeObjectURL(url) // 트레이가 blob에서 자체 미리보기 URL 생성 → 여기 URL은 미사용
      const key = await BlobStore.put(blob)
      useAiJobStore.getState().completeJob(id, { blob, key, canvasSize, serverMs })
    })
    .catch((e) => {
      const st = useAiJobStore.getState()
      const j = st.jobs.find(x => x.id === id)
      if (!j || j.status !== 'running') return
      if (e?.name === 'AbortError') st.cancelJob(id)
      else st.failJob(id, e?.message || '이미지 생성 실패')
    })

  return id
}
