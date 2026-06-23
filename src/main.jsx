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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isCutoutDev
      ? <Suspense fallback={<div style={{ padding: 24 }}>로딩 중…</div>}><CutoutDevPage /></Suspense>
      : <App />}
  </StrictMode>,
)

// PWA 서비스워커 등록(설치 조건 충족). 실패해도 앱 동작엔 영향 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 무시 */ })
  })
}
