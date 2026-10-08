import { create } from 'zustand'
import { useFlatStore } from '../store/flatStore'

/**
 * 영상으로 내보내기 대화창의 상태·명령 — 화면 조각(VideoExport.jsx)과 갈라 둔다
 * (컴포넌트 파일이 함수도 내보내면 Fast Refresh가 깨진다).
 */

// view: null(닫힘) | 'options'(옵션) | 'result'(끝난 뒤 안내)
export const useVideoExportStore = create(() => ({ view: null, busy: false, error: '', result: null }))

export function openVideoExport() {
  useVideoExportStore.setState({ view: 'options', busy: false, error: '', result: null })
}
export function closeVideoExport() {
  if (useVideoExportStore.getState().busy) return
  useVideoExportStore.setState({ view: null, error: '', result: null })
}

export async function startExport(opts) {
  const st = useVideoExportStore.getState()
  if (st.busy) return
  useVideoExportStore.setState({ busy: true, error: '' })
  const startIndex = opts.range === 'current' ? (useFlatStore.getState().flatCurrentPage || 0) : 0
  // 사용자 클릭 안에서 곧바로 화면 공유를 요청해야 한다 — 모듈은 대화창이 열릴 때 미리 불러 둔다(VideoExportHost).
  const { runVideoExport } = await recorderModule()
  const res = await runVideoExport({
    resolution: opts.resolution, fps: opts.fps, quality: opts.quality, startIndex,
    // 공유를 허락받는 즉시 대화창을 걷는다 — 녹화 화면에 비치지 않게
    onShared: () => useVideoExportStore.setState({ view: null }),
  })
  if (res.ok) {
    useVideoExportStore.setState({ busy: false, view: 'result', result: res, error: '' })
  } else if (res.error) {
    useVideoExportStore.setState({ busy: false, view: 'options', error: res.error })
  } else {
    useVideoExportStore.setState({ busy: false, view: null }) // 시작 전에 사용자가 멈춤
  }
}

let recorderPromise = null
export function recorderModule() {
  if (!recorderPromise) recorderPromise = import('../core/videoRecorder.js')
  return recorderPromise
}

