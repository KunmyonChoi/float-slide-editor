import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePwaInstall, promptInstall } from '../core/pwaInstall'

// "나중에"로 닫으면 이 기간 동안 자동 배너를 다시 띄우지 않는다.
const DISMISS_DAYS = 14
const DISMISS_KEY = 'genitor-install-dismissed'
const ENGAGE_DELAY = 4000 // 접속 직후가 아니라 살짝 사용한 뒤 노출

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return t && (Date.now() - t) < DISMISS_DAYS * 86400_000
  } catch { return false }
}

/**
 * InstallAppBanner — "앱으로 설치(홈 화면에 추가)" 안내.
 * - 안드로이드/크로미움: 가로챈 beforeinstallprompt로 네이티브 설치창 호출
 * - iOS 사파리: 네이티브 호출 불가 → "공유 → 홈 화면에 추가" 안내 시트
 * - 이미 설치/데스크톱/인앱웹뷰: 표시 안 함
 * 메뉴의 "앱 설치" 항목은 window 'genitor:open-install' 이벤트로 이 컴포넌트를 깨운다.
 */
export default function InstallAppBanner() {
  const { canInstall, canPrompt, iosSafari, standalone } = usePwaInstall()
  const [showBanner, setShowBanner] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState(false)

  // 인게이지먼트 지연 후 자동 배너 노출(닫은 적 없고 설치 가능할 때만).
  // 숨김은 렌더 게이트(canInstall·standalone)로 처리 — 이펙트에서 동기 setState 안 함.
  useEffect(() => {
    if (!canInstall || dismissedRecently()) return
    const t = setTimeout(() => setShowBanner(true), ENGAGE_DELAY)
    return () => clearTimeout(t)
  }, [canInstall])

  const doInstall = useCallback(async () => {
    if (canPrompt) {
      const outcome = await promptInstall()
      setShowBanner(false)
      if (outcome === 'accepted') { setToast(true); setTimeout(() => setToast(false), 2500) }
    } else if (iosSafari) {
      setSheetOpen(true)       // iOS: 안내 시트
      setShowBanner(false)
    }
  }, [canPrompt, iosSafari])

  // 메뉴의 "앱 설치" 항목에서 깨우기 (자동 배너가 꺼져 있어도 동작)
  useEffect(() => {
    const onOpen = () => doInstall()
    window.addEventListener('genitor:open-install', onOpen)
    return () => window.removeEventListener('genitor:open-install', onOpen)
  }, [doInstall])

  const dismiss = useCallback(() => {
    setShowBanner(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* 무시 */ }
  }, [])

  return (
    <>
      {showBanner && canInstall && !standalone && createPortal(
        <div style={bannerWrap}>
          <div style={banner}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>🏠</span>
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.3 }}>
              {iosSafari && !canPrompt
                ? '홈 화면에 추가하면 앱처럼 빠르게 쓸 수 있어요'
                : 'Genitor를 홈 화면에 추가하기'}
            </span>
            <button onClick={doInstall} style={installBtn}>설치</button>
            <button onClick={dismiss} aria-label="닫기" style={closeBtn}>✕</button>
          </div>
        </div>,
        document.body
      )}

      {sheetOpen && !standalone && createPortal(
        <div style={sheetBackdrop} onClick={() => setSheetOpen(false)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>홈 화면에 추가</p>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: '#cbd5e1' }}>
              <li>사파리 하단의 <b>공유 버튼 <span style={{ fontSize: 15 }}>􀈂</span> ⬆️</b> 을 누르세요</li>
              <li><b>‘홈 화면에 추가’</b> 를 선택하세요</li>
              <li><b>‘추가’</b> 를 누르면 끝!</li>
            </ol>
            <button onClick={() => setSheetOpen(false)} style={sheetClose}>확인</button>
          </div>
        </div>,
        document.body
      )}

      {toast && createPortal(
        <div style={toastStyle}>설치됐어요 ✓</div>,
        document.body
      )}
    </>
  )
}

// ── 스타일 ── 하단 줌/팬 컨트롤과 겹치지 않게 bottom 오프셋 + safe-area
const bannerWrap = {
  position: 'fixed', left: 0, right: 0, zIndex: 10055,
  bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', justifyContent: 'center', padding: '0 12px', pointerEvents: 'none',
}
const banner = {
  pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', maxWidth: 420, padding: '8px 10px 8px 12px',
  background: 'rgba(15,23,42,0.97)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
  boxShadow: '0 8px 28px rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)',
}
const installBtn = {
  flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer',
  padding: '6px 12px', borderRadius: 8, border: '0 none',
  background: 'linear-gradient(135deg,#a855f7,#6366f1)',
}
const closeBtn = {
  flexShrink: 0, width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
  color: '#94a3b8', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
}
const sheetBackdrop = {
  position: 'fixed', inset: 0, zIndex: 10070, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
}
const sheet = {
  width: '100%', maxWidth: 460, margin: 12,
  marginBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
  background: 'rgba(15,23,42,0.99)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 18,
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
}
const sheetClose = {
  marginTop: 14, width: '100%', padding: '10px', borderRadius: 10, cursor: 'pointer',
  fontSize: 14, fontWeight: 600, color: '#fff', border: '0 none',
  background: 'linear-gradient(135deg,#a855f7,#6366f1)',
}
const toastStyle = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 10070,
  bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
  background: 'rgba(15,23,42,0.97)', color: '#e2e8f0', fontSize: 13,
  padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
}
