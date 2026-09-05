import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'
import {
  hasApiKey, generateImagePrompt, generateImage, generateIdeogramCaption,
  analyzeImageForInfographic, editImage,
} from './OpenAIClient'
import { generateLayoutImage, checkImagenBackend } from './ImagenBackendClient'
import { isLocalLlmEnabled } from './LlmBackendClient'
import { IMAGE_STYLES, INFOGRAPHIC_STYLES } from './aiImageStyles'
import { captureElementRegion } from './captureCanvasRegion'
import { htmlToPlain } from './slideTextDigest'
import { segmentImage, checkCutoutBackend } from './CutoutBackendClient'
import { containFitRect } from './imageFit'
import { embedPngMetadata } from './pngMeta'

/**
 * imageJobRunner — 이미지 계열 AI 작업을 전역 aiJobStore(작업 트레이)로 시작한다.
 * (lipsyncRunner/videoMatteRunner와 동일한 패턴 — 생성이 컴포넌트 수명에서 분리되므로
 *  사용자는 생성 중에도 캔버스를 계속 편집할 수 있고, 결과는 트레이에서 확인·적용한다.)
 *
 * 모든 러너는 완료 시 result에 { blob }을 담는다(트레이 미리보기는 blob을 쓴다).
 * apply는 opts.mode('replace'|'add'|러너별 커스텀)를 해석해 대상 페이지에 반영한다.
 *
 * 입력 이미지가 있는 작업(편집·여백 채우기·인포그래픽)은 result에 캔버스 전후 비교용으로
 * { beforeBlob, area, fit }을 함께 담는다 — 트레이가 그 영역 위에 비교 슬라이더를 띄운다.
 * (before는 원본 content가 아니라 '편집에 실제 넣은 입력'이어야 전후 프레이밍이 같다.
 *  dataURL 문자열을 그대로 들고 있으면 슬라이드 전체 캡처가 수 MB씩 전역 스토어에 남으므로
 *  Blob으로 바꿔 담고, 표시용 object URL은 트레이가 만들고 해제한다.)
 */

const IMG_BACKEND_KEY = 'ai-image-backend' // 'openai' | 'local'
const readBackend = () => { try { return localStorage.getItem(IMG_BACKEND_KEY) || 'openai' } catch { return 'openai' } }

/** 텍스트 박스 비율에 맞춘 생성 크기 — 16배수, 긴변 ~1024, 256–1536 클램프(로컬 ideogram용). */
function genSizeForBox(w, h, longEdge = 1024) {
  const r = (w || 1) / (h || 1)
  const f = (v) => Math.max(256, Math.min(1536, Math.round(v / 16) * 16))
  let W, H
  if (r >= 1) { W = longEdge; H = f(longEdge / r) } else { H = longEdge; W = f(longEdge * r) }
  return { width: f(W), height: f(H) }
}

/** data:/blob:/http URL → Blob (트레이 미리보기·BlobStore 보관 공통) */
async function urlToBlob(url) {
  return await fetch(url).then(r => r.blob())
}

/** data URL 이미지의 실제 픽셀 크기 */
export function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('이미지 크기를 읽지 못했습니다.'))
    img.src = dataUrl
  })
}

/** 이미지 요소의 원본 소스(content) → Blob. idb 참조면 BlobStore, 아니면 직접 fetch.
 * (박스 캡처가 아니라 원본을 분리해야 컷아웃 종횡비=원본과 같아 그룹 리사이즈에 어긋나지 않음) */
async function elementImageBlob(content) {
  if (!content) throw new Error('이미지 소스를 찾을 수 없습니다.')
  if (BlobStore.isIdbRef(content)) {
    const b = await BlobStore.get(BlobStore.parseRef(content))
    if (!b) throw new Error('이미지 데이터를 불러오지 못했습니다.')
    return b
  }
  return await urlToBlob(content)
}

/**
 * 이미지를 박스 크기(elementW×elementH) 캔버스에 contain-fit 위치로 그리고,
 * 빈 letterbox/pillarbox 영역은 투명으로 둔다.
 * → OpenAI image edit API가 투명 영역을 자연스럽게 채울 수 있다(아웃페인팅).
 */
async function composeContainFit(content, elementW, elementH) {
  let imgUrl = content
  let revokeOnDone = false
  if (BlobStore.isIdbRef(content)) {
    const blob = await BlobStore.get(BlobStore.parseRef(content))
    if (!blob) throw new Error('이미지 데이터를 불러오지 못했습니다.')
    imgUrl = URL.createObjectURL(blob)
    revokeOnDone = true
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (revokeOnDone) URL.revokeObjectURL(imgUrl)
      const r = containFitRect(elementW, elementH, img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = elementW; canvas.height = elementH
      canvas.getContext('2d').drawImage(img, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      if (revokeOnDone) URL.revokeObjectURL(imgUrl)
      reject(new Error('이미지를 불러오지 못했습니다.'))
    }
    img.src = imgUrl
  })
}

/** 잡 실행 래퍼 — 성공/취소/실패를 aiJobStore 상태로 일관되게 반영. */
function runJob(id, fn) {
  fn().catch((e) => {
    const st = useAiJobStore.getState()
    const j = st.jobs.find(x => x.id === id)
    if (!j || j.status !== 'running') return
    if (e?.name === 'AbortError') st.cancelJob(id)
    else st.failJob(id, e?.message || 'AI 작업에 실패했습니다.')
  })
}

/** 결과 blob을 idb에 넣고 ref 반환(요소 content에 dataURL을 직접 넣지 않기 위함). */
async function resultRef(job) {
  const key = job.result?.key || await BlobStore.put(job.result.blob)
  return BlobStore.toRef(key)
}

/**
 * 대상 사각형(rect) 자리에 결과 이미지를 새 요소로 추가한다.
 * @param {object} opts
 *  - styles: 결과 요소에 덮어쓸 스타일
 *  - offset: true면 원본에서 24px 비껴 놓는다(캔버스 안으로 클램프). '새로 추가'는 원본을 덮으면
 *    교체와 구분이 안 되고 아래 원본을 클릭할 수도 없게 되므로 반드시 비껴 놓는다.
 *    ('원본 위에 삽입'처럼 정확히 같은 자리가 의도인 경우만 false.)
 *  - base: 원본 요소(있으면 테두리·그림자 등 스타일을 승계). 그룹/레이아웃 역할은 상속하지 않는다.
 */
async function addImageElement(job, rect, { styles, offset = false, base = null } = {}) {
  const st = useFlatStore.getState()
  const ref = await resultRef(job)
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const cs = st.canvasSize
  let { x, y } = rect
  if (offset) {
    const OFF = 24
    x = Math.max(0, Math.min(rect.x + OFF, (cs?.w || rect.x + rect.w) - rect.w))
    y = Math.max(0, Math.min(rect.y + OFF, (cs?.h || rect.y + rect.h) - rect.h))
  }
  const el = {
    id: nextFlatId(), sourceId: null, type: 'image',
    x: Math.round(x), y: Math.round(y),
    width: Math.round(rect.w), height: Math.round(rect.h),
    content: ref, isRich: false, merged: false, zIndex: maxZ + 1,
    groupId: undefined, layoutRole: undefined,
    styles: {
      ...(base?.styles || {}),
      objectFit: 'contain', objectPosition: 'center center',
      backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none',
      ...(styles || {}),
    },
  }
  const ok = st.addElementToPage(job.targetPageKey, el)
  // 추가한 결과를 바로 다룰 수 있게 선택(다른 페이지면 선택은 의미 없음)
  if (ok && onCurrent) st.setSelectedFlat(el.id)
  return ok
}

/** 적용 시점의 대상 요소 — 생성 중 옮겼을 수 있으므로 현재 위치를 우선한다(없으면 시작 시점 사각형). */
function liveTarget(job, fallbackRect) {
  const live = job.targetElementId
    ? useFlatStore.getState().flatElements.find(e => e.id === job.targetElementId)
    : null
  return {
    el: live || null,
    rect: live ? { x: live.x, y: live.y, w: live.width, h: live.height } : fallbackRect,
  }
}

// ── 1. 텍스트 박스 → 이미지 생성 ───────────────────────────────────
/**
 * 텍스트 박스 내용을 분석해 어울리는 이미지를 생성한다.
 * 적용: 'replace'=텍스트 박스를 이미지 요소로 교체 / 'add'=새 이미지 요소 추가(기본).
 * @returns {string|null} jobId (키 미설정 등으로 시작 못 하면 null)
 */
export function startTextToImageJob({ element, styleId = 'flat', pageKey, now = Date.now() }) {
  const backend = readBackend()
  // OpenAI 백엔드는 이미지 API에 키 필수. 로컬 백엔드는 캡션 LLM에 OpenAI 키 또는 로컬 LLM 중 하나 필요.
  if ((backend === 'openai' || !isLocalLlmEnabled()) && !hasApiKey()) return null
  const text = htmlToPlain(element.content)
  if (!text) throw new Error('텍스트 박스에 분석할 내용이 없습니다.')

  const store = useAiJobStore.getState()
  const ctrl = new AbortController()
  const style = IMAGE_STYLES.find(s => s.id === styleId)
  const rect = { x: element.x, y: element.y, w: element.width, h: element.height }

  const id = store.startJob({
    kind: 'image-gen',
    label: `이미지 생성 · ${style?.label || styleId}`,
    targetPageKey: pageKey || null,
    targetElementId: element.id,
    createdAt: now,
    abort: () => ctrl.abort(),
    // 텍스트 박스를 이미지로 바꾸면 되돌리기 외에는 텍스트로 복구할 수 없다 → 첫 항목(주버튼)이 '새로 추가'.
    applyOptions: [
      { mode: 'add', label: '새 이미지로 추가' },
      { mode: 'replace', label: '텍스트 박스 교체' },
    ],
    apply: async (job, opts) => {
      const st = useFlatStore.getState()
      const { rect: at } = liveTarget(job, rect)
      if (opts.mode === 'replace') {
        const ok = st.applyToElementOnPage(job.targetPageKey, job.targetElementId, {
          type: 'image', content: await resultRef(job), isRich: false,
          styles: {
            objectFit: 'cover', objectPosition: 'center center',
            backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
          },
        })
        if (ok) return
      }
      // 텍스트 박스를 덮지 않도록 비껴 놓는다(덮으면 교체와 구분이 안 된다)
      await addImageElement(job, at, { styles: { objectFit: 'cover' }, offset: true })
    },
  })

  runJob(id, async () => {
    const j = () => useAiJobStore.getState()
    const directive = style?.directive || ''
    let url
    if (backend === 'local') {
      j().updateJob(id, { statusText: '이미지 서버 확인 중…', progress: 5 })
      if (!(await checkImagenBackend(true))) throw new Error('로컬 이미지 생성 서버에 연결할 수 없습니다.')
      j().updateJob(id, { statusText: '장면 설명 작성 중… (LLM)', progress: 20 })
      const caption = await generateIdeogramCaption(text, { style: directive, signal: ctrl.signal })
      j().updateJob(id, { statusText: '이미지 생성 중… (로컬)', progress: 50 })
      const size = genSizeForBox(element.width, element.height)
      const out = await generateLayoutImage(caption, { ...size, preset: 'V4_TURBO_12', signal: ctrl.signal })
      URL.revokeObjectURL(out.url)
      j().completeJob(id, { blob: out.blob, prompt: JSON.stringify(caption) })
      return
    }
    j().updateJob(id, { statusText: '내용 분석 중…', progress: 15 })
    const p = await generateImagePrompt(text, { style: directive, signal: ctrl.signal })
    j().updateJob(id, { statusText: '이미지 생성 중…', progress: 45 })
    url = await generateImage(p, { width: element.width, height: element.height, signal: ctrl.signal })
    const withMeta = embedPngMetadata(url, { description: text, prompt: p })
    j().completeJob(id, { blob: await urlToBlob(withMeta), prompt: p })
  })

  return id
}

// ── 2. 이미지 설명으로 편집 / 여백까지 그림 채우기 ──────────────────
/** 캡처 기반 image-to-image 편집. mask를 주면 그 영역만 편집(인페인팅). */
export function startImageEditJob({ element, prompt, mask, pageKey, now = Date.now() }) {
  if (!hasApiKey()) return null
  const p = (prompt || '').trim()
  if (!p) throw new Error('편집 지시를 입력하세요.')
  return startCaptureEditJob({
    element, pageKey, now,
    kind: 'image-edit', label: '이미지 편집',
    fit: element?.styles?.objectFit || 'contain',
    prepare: async (ctrl) => {
      const cap = await captureElementRegion(
        { x: element.x, y: element.y, w: element.width, h: element.height },
        { signal: ctrl.signal },
      )
      let m
      if (mask) {
        const { w, h } = await imageSize(cap)
        m = mask(w, h) || undefined
      }
      return { input: cap, prompt: p, mask: m }
    },
  })
}

/** 아웃페인팅 — contain 상태 이미지의 letterbox/pillarbox 영역을 AI로 채운다. */
export function startOutpaintJob({ element, pageKey, now = Date.now() }) {
  if (!hasApiKey()) return null
  const p = 'Seamlessly fill the transparent letterbox/pillarbox areas by naturally extending the existing scene. Match the exact colors, lighting, textures, mood, and visual style of the original image. The result must look like the image was always this size — no visible seams or transitions.'
  return startCaptureEditJob({
    element, pageKey, now,
    kind: 'image-edit', label: '여백까지 그림 채우기',
    fit: 'cover', // 결과가 박스를 꽉 채우도록
    prepare: async () => ({ input: await composeContainFit(element.content, element.width, element.height), prompt: p }),
  })
}

/** 캡처/합성 입력 → editImage 공통 러너. */
function startCaptureEditJob({ element, pageKey, now, kind, label, fit, prepare }) {
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()
  const rect = { x: element.x, y: element.y, w: element.width, h: element.height }

  const id = store.startJob({
    kind, label,
    targetPageKey: pageKey || null,
    targetElementId: element.id,
    createdAt: now,
    abort: () => ctrl.abort(),
    applyOptions: [
      { mode: 'replace', label: '원본 교체' },
      { mode: 'add', label: '새로 추가' },
    ],
    apply: async (job, opts) => {
      const st = useFlatStore.getState()
      const { el: live, rect: at } = liveTarget(job, rect)
      if (opts.mode !== 'add') {
        const ok = st.applyToElementOnPage(job.targetPageKey, job.targetElementId, {
          content: await resultRef(job), isRich: false, styles: { objectFit: fit },
        })
        if (ok) return
      }
      await addImageElement(job, at, { styles: { objectFit: fit }, offset: true, base: live })
    },
  })

  runJob(id, async () => {
    const j = () => useAiJobStore.getState()
    j().updateJob(id, { statusText: '입력 이미지 준비 중…', progress: 10 })
    const { input, prompt: p, mask } = await prepare(ctrl)
    j().updateJob(id, { statusText: '이미지 편집 중…', progress: 40 })
    const url = await editImage(input, p, { width: element.width, height: element.height, mask, signal: ctrl.signal })
    j().completeJob(id, { blob: await urlToBlob(url), prompt: p, beforeBlob: await urlToBlob(input), area: rect, fit })
  })

  return id
}

// ── 3. 피사체 뒤에 글자 넣기(컷아웃) ────────────────────────────────
/** 피사체를 분리해 원본 + 타이틀 텍스트 + 전경 3층을 만든다(적용 방식 단일). */
export function startCutoutJob({ element, pageKey, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()

  const id = store.startJob({
    kind: 'image-cutout',
    label: '피사체 뒤에 글자 넣기',
    targetPageKey: pageKey || null,
    targetElementId: element.id,
    createdAt: now,
    abort: () => ctrl.abort(),
    applyOptions: [{ mode: 'replace', label: '적용' }],
    apply: async (job) => {
      // 3층 구성은 현재 페이지 기준 API — 트레이가 대상 페이지로 이동한 뒤 호출한다.
      const key = job.result.key || await BlobStore.put(job.result.blob)
      const made = useFlatStore.getState().applyTextBehindSubject(job.targetElementId, BlobStore.toRef(key))
      // 대상이 사라졌으면 null — 던져야 트레이가 'ready'를 유지하고 결과가 유실되지 않는다.
      if (!made) throw new Error('원본 이미지를 찾을 수 없습니다(삭제됐거나 다른 페이지). 결과는 그대로 두었습니다.')
    },
  })

  runJob(id, async () => {
    const j = () => useAiJobStore.getState()
    j().updateJob(id, { statusText: '분리 서버 확인 중…', progress: 5 })
    if (!(await checkCutoutBackend(true))) throw new Error('피사체 분리 서버에 연결할 수 없습니다. 한 번만 설치하면 됩니다.')
    j().updateJob(id, { statusText: '이미지 불러오는 중…', progress: 20 })
    const inputBlob = await elementImageBlob(element.content)
    j().updateJob(id, { statusText: '피사체 분리 중…', progress: 45 })
    const r = await segmentImage(inputBlob, { signal: ctrl.signal })
    URL.revokeObjectURL(r.url)
    j().completeJob(id, { blob: r.blob })
  })

  return id
}

// ── 4. 선택 영역 / 슬라이드 전체 → 인포그래픽 이미지 ────────────────
/**
 * 선택 요소들의 bbox(또는 페이지 전체)를 캡처·분석해 인포그래픽 이미지를 만든다.
 * @param {{ mode:'selection'|'page', ids?:string[], styleId?:string, pageKey?:string }} args
 */
export function startInfographicJob({ mode = 'page', ids = [], styleId = 'auto', pageKey, now = Date.now() }) {
  if (!hasApiKey()) return null
  const store = useAiJobStore.getState()
  const ctrl = new AbortController()
  const style = INFOGRAPHIC_STYLES.find(s => s.id === styleId)

  // 대상 사각형은 시작 시점에 고정(생성 중 요소가 움직여도 결과 자리가 흔들리지 않게)
  const st0 = useFlatStore.getState()
  let rect
  if (mode === 'selection') {
    const els = st0.flatElements.filter(e => ids.includes(e.id))
    if (!els.length) throw new Error('선택된 요소를 찾을 수 없습니다.')
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const e of els) {
      minX = Math.min(minX, e.x); minY = Math.min(minY, e.y)
      maxX = Math.max(maxX, e.x + e.width); maxY = Math.max(maxY, e.y + e.height)
    }
    rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    if (rect.w < 2 || rect.h < 2) throw new Error('선택 영역이 너무 작습니다.')
  } else {
    const cs = st0.canvasSize
    rect = { x: 0, y: 0, w: cs.w, h: cs.h }
  }

  const id = store.startJob({
    kind: 'image-gen',
    label: `이미지 생성 · ${mode === 'selection' ? '선택 영역' : '슬라이드 전체'}`,
    targetPageKey: pageKey || null,
    targetElementId: null, // 단일 대상이 아님 → 적용 옵션으로 분기
    createdAt: now,
    abort: () => ctrl.abort(),
    applyOptions: mode === 'selection'
      ? [{ mode: 'replace', label: '원본 교체' }, { mode: 'add', label: '원본 위에 삽입' }]
      : [{ mode: 'add', label: '현재 페이지에 추가' }, { mode: 'next-slide', label: '다음 슬라이드로' }],
    apply: async (job, opts) => {
      const st = useFlatStore.getState()
      if (opts.mode === 'next-slide') {
        st.addPage()
        const cs = useFlatStore.getState().canvasSize
        const ref = await resultRef(job)
        useFlatStore.getState().addFlatElement({
          id: nextFlatId(), sourceId: null, type: 'image',
          x: 0, y: 0, width: cs.w, height: cs.h, content: ref, isRich: false, merged: false, zIndex: 1,
          styles: { objectFit: 'contain', objectPosition: 'center center', backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none' },
        })
        return
      }
      if (opts.mode === 'replace' && mode === 'selection') {
        st.setSelectedFlats(ids)
        st.removeSelectedElements() // batch_remove (undo 1회)
      }
      // '원본 위에 삽입'·'현재 페이지에 추가'는 그 자리가 의도된 위치라 비껴 놓지 않는다.
      await addImageElement(job, rect)
    },
  })

  runJob(id, async () => {
    const j = () => useAiJobStore.getState()
    j().updateJob(id, { statusText: mode === 'selection' ? '선택 영역 캡처 중…' : '현재 페이지 캡처 중…', progress: 10 })
    let input
    if (mode === 'selection') {
      input = await captureElementRegion(rect, { signal: ctrl.signal })
    } else {
      const canvasNode = useFlatStore.getState()._canvasRef?.current
      if (!canvasNode) throw new Error('캔버스를 찾을 수 없습니다.')
      const { exportAsImage } = await import('./ImageExporter.js')
      // offscreen=true: 복제본에서 캡처해 살아있는 캔버스를 건드리지 않는다.
      input = await exportAsImage(canvasNode, { format: 'png', scale: 2, offscreen: true })
    }
    j().updateJob(id, { statusText: '내용 분석 중…', progress: 30 })
    const p = await analyzeImageForInfographic(input, { style: style?.directive || '', signal: ctrl.signal })
    j().updateJob(id, { statusText: '이미지 편집 중…', progress: 55 })
    const url = await editImage(input, p, { width: rect.w, height: rect.h, signal: ctrl.signal })
    j().completeJob(id, { blob: await urlToBlob(url), prompt: p, beforeBlob: await urlToBlob(input), area: rect, fit: 'contain' })
  })

  return id
}
