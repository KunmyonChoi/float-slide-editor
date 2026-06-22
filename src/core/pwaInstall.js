// PWA 설치 코어 — beforeinstallprompt를 "조기"에 가로채 보관하고,
// 플랫폼별 설치 가능성을 판단한다. main.jsx에서 가장 먼저 import해 이벤트를 놓치지 않게 한다.
import { useState, useEffect } from 'react'

let deferredPrompt = null            // 안드로이드/크로미움: 가로챈 beforeinstallprompt
let installed = false                // appinstalled 또는 standalone 실행
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true // iOS 홈화면 실행
}

export function detectPlatform() {
  if (typeof navigator === 'undefined') return {}
  const ua = navigator.userAgent || ''
  const isIOS = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS 데스크톱 UA
  const isAndroid = /android/i.test(ua)
  // 인앱 웹뷰(카카오톡·인스타·페북·라인 등): 설치 불가 → 배너 숨김 대상
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER|DaumApps/i.test(ua)
  // iOS는 사파리에서만 "홈 화면에 추가" 공유 메뉴가 있다(크롬/파폭 iOS 제외)
  const iosSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const mobile = isIOS || isAndroid || !!coarse
  return { isIOS, isAndroid, inApp, iosSafari, mobile }
}

if (typeof window !== 'undefined') {
  if (isStandalone()) installed = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()      // 브라우저 기본 미니인포바 억제 → 우리 UI로 제어
    deferredPrompt = e
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installed = true
    emit()
  })
}

/** 안드로이드/크로미움 네이티브 설치창 호출. 결과 outcome('accepted'|'dismissed') 반환, 없으면 null */
export async function promptInstall() {
  if (!deferredPrompt) return null
  deferredPrompt.prompt()
  let outcome = null
  try { outcome = (await deferredPrompt.userChoice)?.outcome ?? null } catch { /* 무시 */ }
  deferredPrompt = null
  emit()
  return outcome
}

export function getInstallState() {
  const p = detectPlatform()
  const standalone = installed || isStandalone()
  const canPrompt = !!deferredPrompt          // 안드로이드: 즉시 설치 가능
  // 설치 진입점을 보여줄지: 모바일 + 이미 설치/인앱웹뷰 제외 + (네이티브 프롬프트 가능 or iOS 사파리 안내)
  // (데스크톱 크롬도 beforeinstallprompt가 뜨지만, 요청대로 모바일에서만 노출)
  const canInstall = !!p.mobile && !standalone && !p.inApp && (canPrompt || p.iosSafari)
  return { ...p, standalone, canPrompt, canInstall }
}

/** 설치 상태를 구독하는 React 훅 (프롬프트 등장/설치/standalone 변화 시 갱신) */
export function usePwaInstall() {
  const [state, setState] = useState(getInstallState)
  useEffect(() => {
    const update = () => setState(getInstallState())
    listeners.add(update)
    update()
    const mq = window.matchMedia?.('(display-mode: standalone)')
    mq?.addEventListener?.('change', update)
    return () => { listeners.delete(update); mq?.removeEventListener?.('change', update) }
  }, [])
  return state
}
