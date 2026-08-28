import SlideCanvas, { InsertPopup } from './components/SlideCanvas'
import FloatingToolbar from './components/FloatingToolbar'
import EditToolbar from './components/EditToolbar'
import PropertyPanel from './components/PropertyPanel'
import SlideListPanel from './components/SlideListPanel'
import FlatCanvas from './components/FlatCanvas'
import FlatPresenter from './components/FlatPresenter'
import ComparePanel from './components/ComparePanel'
import DebugElementsPanel from './components/DebugElementsPanel'
import PageBar from './components/PageBar'
import NotesPanel from './components/NotesPanel'
import SlideDeleteToast from './components/SlideDeleteToast'
import InstallAppBanner from './components/InstallAppBanner'
import { UrlPromptHost } from './components/UrlPrompt'
import { AiSettingsHost } from './components/AiSettingsModal'
import AiJobTray from './components/AiJobTray'
import { CapabilitiesHost } from './components/CapabilitiesModal'
import { GenitorSkillHost } from './components/GenitorSkillModal'
import { CameraCaptureHost } from './components/CameraCaptureModal'
import { LetteringHost } from './components/LetteringModal'
import { InfographicHost } from './components/InfographicModal'
import { ImagenLayoutHost } from './components/ImagenLayoutModal'
import { ConfirmHost } from './components/ConfirmDialog'
import { ShareLinkHost } from './components/ShareLinkModal'
import { fetchSharedProject } from './core/ShareLink'
import { useFlatStore } from './store/flatStore'
import { useEditorStore } from './store/editorStore'
import { useEffect, useState } from 'react'

// 공유 링크(File > 공유 링크 만들기)로 들어온 경우 `?share=<id>` 쿼리로 진입한다.
function getShareIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('share')
  } catch { return null }
}

// Claude(특히 Desktop — 파일 저장/드래그&드롭이 마땅치 않은 환경)가 생성한 슬라이드 덱을
// 곧바로 가져올 수 있도록 `#import=<encodeURIComponent(html)>` 해시로 진입하는 경로.
// 해시는 서버로 전송되지 않으므로 별도 백엔드 없이(=공유 링크와 달리 네트워크 요청 없이)
// 그 자리에서 동기적으로 디코드해 로드한다.
const IMPORT_HASH_PREFIX = '#import='
function getImportHtmlFromUrl() {
  try {
    const hash = window.location.hash
    if (!hash || !hash.startsWith(IMPORT_HASH_PREFIX)) return null
    const encoded = hash.slice(IMPORT_HASH_PREFIX.length)
    return encoded ? decodeURIComponent(encoded) : null
  } catch { return null }
}

export default function App() {
  const rawViewMode = useFlatStore(s => s.viewMode)
  const debugMode = useFlatStore(s => s.debugMode)
  const mode = useEditorStore(s => s.mode)

  const [shareState, setShareState] = useState(() => (getShareIdFromUrl() ? 'loading' : 'none'))
  const [shareError, setShareError] = useState(null)

  // 최초 실행: 공유 링크로 들어왔으면 원격 프로젝트를 불러오고, 아니면 빈 프로젝트를 제목 슬라이드로 시작
  // (PowerPoint 식, 바로 편집 가능). 콘텐츠 있으면 유지.
  useEffect(() => {
    const fs = useFlatStore.getState()
    const es = useEditorStore.getState()
    const shareId = getShareIdFromUrl()

    if (shareId) {
      (async () => {
        try {
          const { applyLoadedProject } = await import('./core/ProjectLoader.js')
          const data = await fetchSharedProject(shareId)
          applyLoadedProject(data)
          // 새로고침 시 재로딩되지 않도록 주소창에서 공유 파라미터 제거
          window.history.replaceState(null, '', window.location.pathname)
          setShareState('ready')
        } catch (err) {
          setShareError(err.message || '공유 링크를 불러오지 못했습니다')
          setShareState('error')
          if (fs.flatPageCount === 0 && !es.slideHtml) fs.startScratchProject('title')
        }
      })()
      return
    }

    // 새로고침/북마크 시 재로딩되지 않도록, 또 대용량 콘텐츠가 주소창에 남지 않도록
    // (성공/실패와 무관하게) 해시를 즉시 제거한다.
    const importHtml = getImportHtmlFromUrl()
    if (importHtml) window.history.replaceState(null, '', window.location.pathname + window.location.search)

    // 해시 자체가 URL 최대 길이를 넘겨 잘려 들어왔을 수 있으므로 최소 형태 검증 후 로드.
    // (공유 링크와 달리 서버 호출이 없어 동기적으로 즉시 반영된다.)
    if (importHtml && /<!doctype\s+html|<html[\s>]/i.test(importHtml)) {
      fs.clearPageCache()
      fs.setProjectFile(null, null)
      es.loadHtml(importHtml, { imported: true })
      return
    }
    if (importHtml) {
      console.warn('[import] URL 해시의 HTML이 불완전해 보여 가져오기를 건너뜁니다')
    }

    if (fs.flatPageCount === 0 && !es.slideHtml) {
      fs.startScratchProject('title')
    }
  }, [])

  // 버튼을 마우스/터치로 누르면 클릭 후에도 포커스가 남아 ①포커스 링이 보이고
  // ②Space(캔버스 팬·발표 넘김) 같은 키가 그 버튼을 재활성화한다. 포인터로 활성화한
  // 버튼은 손을 뗄 때 blur해 포커스를 캔버스로 돌려준다. (키보드 Tab 포커스는 pointerup이
  // 없으므로 그대로 유지 → :focus-visible 링도 정상 동작.)
  useEffect(() => {
    const onPointerUp = (e) => {
      const active = document.activeElement
      if (!active || active.tagName !== 'BUTTON') return
      // 방금 손을 뗀 그 버튼일 때만 걷어낸다(다른 곳의 포커스는 건드리지 않음).
      const released = e.target?.closest?.('button')
      if (released === active) active.blur()
    }
    window.addEventListener('pointerup', onPointerUp)
    return () => window.removeEventListener('pointerup', onPointerUp)
  }, [])

  // 전체화면이 해제됐는데 발표 중이면(ESC로 전체화면만 빠져나온 경우) 발표도 종료
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && useEditorStore.getState().mode === 'present') {
        useEditorStore.getState().exitPresentation()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 디버그 꺼짐이면 html/split는 노출하지 않고 항상 flat (진단 뷰는 디버그 전용)
  const viewMode = debugMode ? rawViewMode : 'flat'

  const isSplit = viewMode === 'split'
  const showSlide = viewMode === 'html' || isSplit
  const showFlat  = viewMode === 'flat' || isSplit

  // flat/split 모드에서 발표 → FlatPresenter 사용
  const useFlatPresenter = mode === 'present' && (viewMode === 'flat' || viewMode === 'split')

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <FloatingToolbar />
      <EditToolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측 슬라이드 목록 패널 (flat/split 편집 모드 전용) */}
        {mode !== 'present' && (viewMode === 'flat' || viewMode === 'split') && <SlideListPanel />}
        {/* SlideCanvas + FlatCanvas 래퍼 — split 시 화면비에 따라 배치 전환:
            세로로 길면(portrait) 상하 스택, 가로로 길면(landscape) 좌우 분할.
            (속성 패널은 바깥 row에 그대로 두어 항상 우측) */}
        <div className={`flex flex-1 min-w-0 min-h-0 ${isSplit ? 'portrait:flex-col landscape:flex-row' : 'flex-row'}`}>
          {/* SlideCanvas는 항상 마운트 유지 — iframe 재로드 방지 */}
          {/* 숨길 때도 원래 크기 유지 (flat 추출 시 정확한 레이아웃 필요) */}
          <div
            className={isSplit
              ? 'flex flex-col flex-1 min-w-0 min-h-0 portrait:border-b landscape:border-r border-white/10'
              : 'flex flex-col flex-1 min-w-0 min-h-0'}
            style={showSlide ? undefined : { position: 'fixed', left: -9999, top: 0, width: '100vw', height: '100vh', overflow: 'hidden', pointerEvents: 'none' }}
          >
            <SlideCanvas />
          </div>
          {showFlat && (
            <div className="flex flex-col flex-1 min-w-0 min-h-0">
              <FlatCanvas />
            </div>
          )}
        </div>
        {/* 통합 PropertyPanel — 도킹 시 flex row 마지막, 플로팅 시 fixed */}
        <PropertyPanel />
      </div>
      <NotesPanel />
      <PageBar />
      <SlideDeleteToast />
      <InstallAppBanner />
      <UrlPromptHost />
      <AiSettingsHost />
      <CapabilitiesHost />
      <GenitorSkillHost />
      <CameraCaptureHost />
      <LetteringHost />
      <InfographicHost />
      <ImagenLayoutHost />
      <ConfirmHost />
      <ShareLinkHost />
      {shareState === 'loading' && <ShareLoadingOverlay />}
      {shareState === 'ready' && (
        <ShareReadyBanner
          onStart={() => { useEditorStore.getState().enterPresentation(); setShareState('none') }}
          onDismiss={() => setShareState('none')}
        />
      )}
      {shareState === 'error' && (
        <ShareErrorBanner message={shareError} onDismiss={() => setShareState('none')} />
      )}
      {debugMode && <ComparePanel />}
      {debugMode && <DebugElementsPanel />}
      <InsertPopup />
      {/* 전역 AI 작업 트레이 — 선택/페이지 무관 진행·결과 (발표 모드에선 숨김) */}
      {mode !== 'present' && <AiJobTray />}
      {/* flat 모드 발표 — fixed 전체화면 오버레이 */}
      {useFlatPresenter && <FlatPresenter />}
    </div>
  )
}

// 공유 링크 진입 시 원격 프로젝트를 불러오는 동안 표시(로드 완료 전까지 편집 화면을 가림)
function ShareLoadingOverlay() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(15,23,42,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
      color: '#e2e8f0',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(99,102,241,0.9)',
        animation: 'genitor-spin 0.8s linear infinite',
      }} />
      <div style={{ fontSize: 13.5 }}>공유된 프로젝트를 불러오는 중…</div>
      <style>{'@keyframes genitor-spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  )
}

// 공유 링크로 불러온 프로젝트가 준비되면 발표(재생) 시작을 안내
// (브라우저 자동재생 정책상 나레이션 음성 재생에는 사용자 제스처가 필요해 자동 진입하지 않는다)
function ShareReadyBanner({ onStart, onDismiss }) {
  const btn = { border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 13, padding: '5px 10px', color: '#fff' }
  return (
    <div style={{
      position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px 8px 14px', borderRadius: 10,
      background: 'rgba(15,23,42,0.95)', color: '#e2e8f0',
      border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
      fontSize: 13, backdropFilter: 'blur(8px)',
    }}>
      <span>공유된 프로젝트를 불러왔습니다</span>
      <button onClick={onStart} style={{ ...btn, background: 'rgba(99,102,241,0.85)' }}>▶ 발표 시작</button>
      <button onClick={onDismiss} title="닫기" style={{ ...btn, background: 'transparent', color: '#94a3b8', padding: '5px 6px' }}>✕</button>
    </div>
  )
}

function ShareErrorBanner({ message, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px 8px 14px', borderRadius: 10,
      background: 'rgba(69,10,10,0.95)', color: '#fecaca',
      border: '1px solid rgba(239,68,68,0.35)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
      fontSize: 13, backdropFilter: 'blur(8px)',
    }}>
      <span>{message}</span>
      <button onClick={onDismiss} title="닫기" style={{
        border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 13, padding: '5px 6px',
        background: 'transparent', color: '#fca5a5',
      }}>✕</button>
    </div>
  )
}
