// Genitor 최소 서비스워커.
// 목적: PWA "설치(홈 화면에 추가)" 조건 충족을 위한 fetch 핸들러 보유.
// 일부러 캐싱하지 않는다 — Vite 해시 자산을 캐시하면 배포 후 stale 위험이 크다.
// (오프라인 캐싱이 필요해지면 그때 app-shell 전략을 별도 도입)
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* 네트워크 통과 — 핸들러 존재 자체가 설치 조건 */ })
