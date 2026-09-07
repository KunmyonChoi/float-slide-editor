/* eslint-disable react-refresh/only-export-components -- 앱 진입점: HMR 컴포넌트 모듈 아님 */
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './core/pwaInstall' // beforeinstallprompt를 가장 먼저 가로채도록 조기 로드
import App from './App.jsx'

// 개발용 확인 페이지(피사체 분리 서버 검증). `/?cutoutdev=1`로만 진입.
const isCutoutDev = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('cutoutdev')
const CutoutDevPage = lazy(() => import('./dev/CutoutDevPage.jsx'))

// 듀얼 모니터 발표의 청중 창. `/?audience=<sessionId>`로 발표자 창이 직접 연다.
// 편집기(App)를 아예 띄우지 않는다 — 청중 화면에 빈 프로젝트가 잠깐이라도 보이면 안 되고,
// 이 창은 발표자 창이 보내주는 스냅샷만 그리면 되기 때문이다.
const audienceSession = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('audience')
  : null
const AudienceView = lazy(() => import('./components/AudienceView.jsx'))

function Root() {
  if (audienceSession) {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#000' }} />}>
        <AudienceView sessionId={audienceSession} />
      </Suspense>
    )
  }
  if (isCutoutDev) {
    return <Suspense fallback={<div style={{ padding: 24 }}>로딩 중…</div>}><CutoutDevPage /></Suspense>
  }
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// PWA 서비스워커 등록(설치 조건 충족). 실패해도 앱 동작엔 영향 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 무시 */ })
  })
}
