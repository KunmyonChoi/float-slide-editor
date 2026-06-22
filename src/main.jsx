import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './core/pwaInstall' // beforeinstallprompt를 가장 먼저 가로채도록 조기 로드
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA 서비스워커 등록(설치 조건 충족). 실패해도 앱 동작엔 영향 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 무시 */ })
  })
}
