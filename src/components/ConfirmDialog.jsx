import { create } from 'zustand'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * 커스텀 확인 다이얼로그 — 시스템 confirm() 대체.
 *
 *   const ok = await confirmDialog({ title, message, confirmText, cancelText, danger })
 *
 * App에 <ConfirmHost />를 한 번 마운트하면 어디서든 호출 가능하다.
 */

let resolver = null

const useConfirmStore = create(() => ({
  open: false,
  title: '',
  message: '',
  confirmText: '확인',
  cancelText: '취소',
  danger: false,
}))

export function confirmDialog({ title = '', message = '', confirmText = '확인', cancelText = '취소', danger = false } = {}) {
  if (resolver) { const r = resolver; resolver = null; r(false) } // 이전 미해결은 취소 처리
  return new Promise(resolve => {
    resolver = resolve
    useConfirmStore.setState({ open: true, title, message, confirmText, cancelText, danger })
  })
}

function close(value) {
  if (!useConfirmStore.getState().open) return
  useConfirmStore.setState({ open: false })
  const r = resolver
  resolver = null
  if (r) r(value)
}

export function ConfirmHost() {
  const { open, title, message, confirmText, cancelText, danger } = useConfirmStore()
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => confirmRef.current?.focus())
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      else if (e.key === 'Enter') { e.preventDefault(); close(true) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { cancelAnimationFrame(id); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      onMouseDown={() => close(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(420px, 92vw)',
          background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        {title && <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>}
        {message && <div style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{message}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => close(false)}
            style={{
              padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
            }}
          >{cancelText}</button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => close(true)}
            style={{
              padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
              border: 'none', fontWeight: 600, color: '#fff',
              background: danger ? 'rgba(239,68,68,0.9)' : 'rgba(99,102,241,0.9)',
            }}
          >{confirmText}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
