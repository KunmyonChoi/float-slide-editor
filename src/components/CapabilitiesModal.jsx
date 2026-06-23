import { create } from 'zustand'
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  fileSystemAccessSupported, clipboardReadSupported, clipboardReadPermission, requestClipboardRead,
  fontsStatus, fontsReady, storageSupported, storagePersisted, requestStoragePersist, storageEstimate, formatBytes,
} from '../core/capabilities'
import { checkBackend, getBackendBuild } from '../core/PptxBackendClient'
import { checkCutoutBackend, getCutoutDevice } from '../core/CutoutBackendClient'

/**
 * 권한 및 기능 상태 모달 — 파일 메뉴에서 openCapabilities()로 연다.
 * 파일시스템·클립보드·폰트·저장소영속·로컬 백엔드 상태를 표시하고, 요청 가능한 것(클립보드·영속)은 버튼 제공.
 */
const useStore = create(() => ({ open: false }))
// eslint-disable-next-line react-refresh/only-export-components -- 모달 오프너(AiSettingsModal와 동일 패턴)
export function openCapabilities() { useStore.setState({ open: true }) }
function close() { useStore.setState({ open: false }) }

export function CapabilitiesHost() {
  const open = useStore(s => s.open)
  if (!open) return null
  return <Dialog />
}

function Dialog() {
  const [c, setC] = useState(null)
  const [busy, setBusy] = useState('')

  const refresh = useCallback(async () => {
    const [clipPerm, persisted, est, pptx, cutout] = await Promise.all([
      clipboardReadPermission(), storagePersisted(), storageEstimate(),
      checkBackend(true), checkCutoutBackend(true),
    ])
    setC({
      fsa: fileSystemAccessSupported(),
      clipSupported: clipboardReadSupported(), clipPerm,
      fonts: fontsStatus(),
      storageSupported: storageSupported(), persisted, est,
      pptx, pptxBuild: getBackendBuild(),
      cutout, cutoutDevice: getCutoutDevice(),
    })
  }, [])

  useEffect(() => { const id = requestAnimationFrame(refresh); return () => cancelAnimationFrame(id) }, [refresh])

  const act = async (kind, fn) => { setBusy(kind); try { await fn() } finally { setBusy(''); refresh() } }

  return createPortal(
    <div onMouseDown={close} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>권한 및 기능 상태</div>
        <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
          일부 기능은 브라우저 지원/권한에 의존합니다. ✅사용가능 · ⚠️요청/주의 · ❌미지원.
        </div>

        {!c ? <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>확인 중…</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row icon={c.fsa ? '✅' : '❌'} title="파일 시스템 접근"
              desc={c.fsa ? '직접 저장/열기 지원' : '미지원 — 다운로드 방식으로 동작 (Chrome/Edge 권장)'} />

            <Row
              icon={!c.clipSupported ? '❌' : c.clipPerm === 'granted' ? '✅' : c.clipPerm === 'denied' ? '❌' : '⚠️'}
              title="클립보드 읽기 (이미지 붙여넣기)"
              desc={!c.clipSupported ? '미지원' : c.clipPerm === 'granted' ? '허용됨'
                : c.clipPerm === 'denied' ? '차단됨 — 브라우저 사이트 설정에서 허용' : '권한 필요'}
              action={c.clipSupported && (c.clipPerm === 'prompt' || c.clipPerm === 'unknown')
                ? { label: '권한 요청', busy: busy === 'clip', onClick: () => act('clip', requestClipboardRead) } : null} />

            <Row icon={c.fonts === 'loaded' ? '✅' : '⚠️'} title="폰트 로딩"
              desc={c.fonts === 'loaded' ? '로드 완료' : '로딩 중 — 내보내기 전 완료 권장'}
              action={{ label: '다시 확인', busy: busy === 'font', onClick: () => act('font', fontsReady) }} />

            <Row
              icon={!c.storageSupported ? '❌' : c.persisted ? '✅' : '⚠️'}
              title="저장소 영속성 (프로젝트 미디어 보존)"
              desc={!c.storageSupported ? '미지원'
                : (c.persisted ? '영속 저장됨' : '임시 — 브라우저가 비울 수 있음')
                  + (c.est ? ` · 사용 ${formatBytes(c.est.usage)}` : '')}
              action={c.storageSupported && !c.persisted
                ? { label: '영속 저장 요청', busy: busy === 'persist', onClick: () => act('persist', requestStoragePersist) } : null} />

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Row icon={c.pptx ? '✅' : '⚠️'} title="PPT 변환 서버"
                desc={c.pptx ? `연결됨${c.pptxBuild ? ` (${c.pptxBuild})` : ''}` : '연결 안 됨 — 로컬 컨테이너 실행 시 고품질 PPT 변환'} />
              <Row icon={c.cutout ? '✅' : '⚠️'} title="피사체 분리 서버"
                desc={c.cutout ? `연결됨${c.cutoutDevice ? ` (${c.cutoutDevice})` : ''}` : '연결 안 됨 — "피사체 뒤 텍스트"에 필요'}
                action={{ label: '다시 확인', busy: busy === 'be', onClick: () => act('be', () => checkCutoutBackend(true)) }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={refresh} style={ghostBtn}>전체 새로고침</button>
          <button type="button" onClick={close} style={primaryBtn}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Row({ icon, title, desc, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#e2e8f0' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>{desc}</div>
      </div>
      {action && (
        <button type="button" disabled={action.busy} onClick={action.onClick}
          style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 7, border: 'none', whiteSpace: 'nowrap',
            background: 'rgba(99,102,241,0.85)', color: '#fff', cursor: action.busy ? 'default' : 'pointer', opacity: action.busy ? 0.6 : 1 }}>
          {action.busy ? '…' : action.label}
        </button>
      )}
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(500px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }
const ghostBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1' }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
