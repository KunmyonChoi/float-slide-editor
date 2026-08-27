import { create } from 'zustand'
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createShareLink } from '../core/ShareLink'
import { useFlatStore } from '../store/flatStore'

/**
 * 공유 링크 만들기 모달 — 파일 메뉴에서 openShareLinkModal()로 연다.
 * 현재 프로젝트(발표자노트 나레이션 포함)를 업로드해 링크를 발급한다.
 */
const useStore = create(() => ({ open: false }))
// eslint-disable-next-line react-refresh/only-export-components -- 모달 오프너(CapabilitiesModal와 동일 패턴)
export function openShareLinkModal() { useStore.setState({ open: true }) }
function close() { useStore.setState({ open: false }) }

export function ShareLinkHost() {
  const open = useStore(s => s.open)
  if (!open) return null
  return <Dialog />
}

function Dialog() {
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    setError(null); setResult(null); setProgress(0); setCopied(false)
    try {
      const r = await createShareLink(useFlatStore.getState(), setProgress)
      setResult(r)
    } catch (err) {
      setError(err.message || '공유 링크 생성에 실패했습니다')
    }
  }, [])

  // 모달이 열리면 바로 업로드 시작 — rAF로 지연시켜 effect 본문에서 동기 setState를 피한다(CapabilitiesModal과 동일 패턴)
  useEffect(() => {
    const id = requestAnimationFrame(run)
    return () => cancelAnimationFrame(id)
  }, [run])

  const copy = useCallback(async () => {
    if (!result?.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [result])

  const expiresLabel = result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString('ko-KR') : null

  return createPortal(
    <div onMouseDown={close} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>공유 링크 만들기</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>
          발표자노트 나레이션(음성) 포함 현재 프로젝트를 링크로 공유합니다.
          받는 사람이 링크를 열면 Genitor 슬라이드에서 바로 이 프로젝트가 열립니다.
        </div>

        {!result && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.round(progress * 100)}%`,
                background: 'rgba(99,102,241,0.9)', transition: 'width 0.15s',
              }} />
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>업로드 중… {Math.round(progress * 100)}%</div>
          </div>
        )}

        {error && (
          <div style={{
            fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                readOnly
                value={result.url}
                onFocus={e => e.target.select()}
                style={{
                  flex: 1, minWidth: 0, fontSize: 12.5, padding: '7px 10px', borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0',
                }}
              />
              <button type="button" onClick={copy} style={primaryBtn}>{copied ? '복사됨' : '복사'}</button>
            </div>
            {expiresLabel && (
              <div style={{ fontSize: 11.5, color: '#64748b' }}>이 링크는 {expiresLabel}까지 유효합니다(30일).</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {error && <button type="button" onClick={run} style={ghostBtn}>다시 시도</button>}
          <button type="button" onClick={close} style={primaryBtn}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(440px, 94vw)', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }
const ghostBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1' }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
