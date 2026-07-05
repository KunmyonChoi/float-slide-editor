import { openCameraCapture } from './CameraCaptureModal'

/**
 * 웹캠 녹화 버튼 — 인앱 카메라로 자신을 촬영해 현재 슬라이드에 비디오 요소로 삽입.
 * (셀프 아바타 파이프라인: 녹화 → 립싱크 → 배경 제거의 입력)
 */
export default function CameraCaptureButton() {
  return (
    <button
      onClick={openCameraCapture}
      title="웹캠 녹화 → 현재 슬라이드에 삽입 (립싱크·배경 제거용 구동 영상)"
      className="flex items-center px-2.5 py-1.5 rounded-lg text-sm transition-colors text-slate-300 hover:text-white hover:bg-white/10"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
      <span className="text-xs ml-1 tb-label">웹캠 녹화</span>
    </button>
  )
}
