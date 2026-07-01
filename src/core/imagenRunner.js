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
 * 결과 PNG는 **선택 영역(frame)** 자리에 그 크기의 이미지 요소로 삽입한다(캡션 bbox가 선택 묶음
 * 기준으로 정규화되므로 선택 영역과 정합 — OpenAI 인포그래픽과 동일한 프레이밍). 트레이에서 진행/적용.
 */

/** 프레임 비율에 맞춘 생성 크기 — 긴 변 1024, 16 배수(모델 patch=16), 256–1536 클램프. */
export function pickGenSize(rect) {
  const w0 = (rect && rect.w) || 1024
  const h0 = (rect && rect.h) || 1024
  const longEdge = 1024
  const r = w0 / h0
  const f = (v) => Math.max(256, Math.min(1536, Math.round(v / 16) * 16))
  let W, H
  if (r >= 1) { W = longEdge; H = f(longEdge / r) } else { H = longEdge; W = f(longEdge * r) }
  return { width: f(W), height: f(H) }
}

/** 결과 PNG → 대상 페이지에 **선택 영역(frame)** 위치·크기로 이미지 요소 삽입(선택 레이아웃과 정합). */
async function applyResult(job) {
  const blob = job?.result?.blob
  if (!blob) return
  const st = useFlatStore.getState()
  const key = job.result.key || (await BlobStore.put(blob))
  const cs = st.canvasSize || { w: 1280, h: 720 }
  // frame(선택 묶음 bbox) 우선, 없으면 캔버스 전체(하위호환)
  const frame = job.result.frame || { x: 0, y: 0, w: cs.w, h: cs.h }
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const el = {
    id: nextFlatId(), sourceId: null, type: 'image',
    content: BlobStore.toRef(key), isRich: false, merged: false,
    x: Math.round(frame.x || 0), y: Math.round(frame.y || 0),
    width: Math.round(frame.w), height: Math.round(frame.h), zIndex: maxZ + 1,
    styles: {
      backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none',
      borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1', objectFit: 'cover',
    },
  }
  st.addElementToPage(job.targetPageKey, el)
}

/**
 * 레이아웃 이미지 생성 작업 시작 → jobId. 결과는 트레이에서 '적용'하면 선택 영역 자리에 삽입.
 * @param {{ caption:object, frame:{x,y,w,h}, preset?:string, pageKey?:string, label?:string, now?:number }} args
 *   frame = 선택 요소 묶음 bbox(px). 캡션 bbox가 이 프레임 기준으로 정규화돼 있어야 정합.
 */
export function startImagenJob({ caption, frame, preset, pageKey, label, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()
  const { width, height } = pickGenSize(frame)

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
      useAiJobStore.getState().completeJob(id, { blob, key, frame, serverMs })
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
