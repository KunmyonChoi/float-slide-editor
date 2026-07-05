/**
 * videoMatte — MediaPipe Selfie Segmentation으로 사람 전경 매트(alpha)를 실시간 생성.
 *
 * 셀프 아바타 배경 제거(B1): 그린스크린 없이 임의 배경에서 사람만 남긴다.
 * @mediapipe/tasks-vision는 동적 import로 메인 번들에서 제외. WASM/모델은 v1에서 CDN 로드
 * (추후 self-host 가능 — [[project_self_avatar]]). 세그멘터는 세션 싱글턴(모델 1회 로드).
 */

const VER = '0.10.35'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

let _promise = null

/** 싱글턴 ImageSegmenter(VIDEO 모드, 전경 confidence 마스크). 실패 시 재시도 가능하도록 캐시 해제. */
export function getSegmenter() {
  if (!_promise) {
    _promise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
      // GPU 우선, 미지원 환경(headless·구형 GPU)은 CPU로 폴백
      try { return await ImageSegmenter.createFromOptions(fileset, opts('GPU')) }
      catch { return await ImageSegmenter.createFromOptions(fileset, opts('CPU')) }
    })().catch(err => { _promise = null; throw err })
  }
  return _promise
}
