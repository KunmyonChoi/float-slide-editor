import { create } from 'zustand'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 커스텀 URL 입력 팝업 — 시스템 prompt() 대체.
 *
 * prompt()처럼 쓰도록 Promise 기반 API를 제공한다:
 *   const url = await promptUrl({ title, placeholder, initialValue })  // 취소 시 null
 *
 * 앱 어딘가에 <UrlPromptHost />를 한 번만 마운트하면 된다.
 * contenteditable 선택영역 보존이 필요한 호출부(링크)는, promptUrl 호출 전에 Range를
 * 저장해 두고 resolve 후 복원하면 된다(동기 prompt와 동일한 흐름).
 */

let resolver = null

const useUrlPromptStore = create(() => ({
  open: false,
  title: 'URL 입력',
  placeholder: 'https://',
  initialValue: '',
}))

export function promptUrl({ title = 'URL 입력', placeholder = 'https://', initialValue = '' } = {}) {
  // 이전 팝업이 떠 있으면 취소 처리
  if (resolver) { const r = resolver; resolver = null; r(null) }
  return new Promise((resolve) => {
    resolver = resolve
    useUrlPromptStore.setState({ open: true, title, placeholder, initialValue })
  })
}

function close(value) {
  if (!useUrlPromptStore.getState().open) return
  useUrlPromptStore.setState({ open: false })
  const r = resolver
  resolver = null
  if (r) r(value)
}

export function UrlPromptHost() {
  const { open, title, placeholder, initialValue } = useUrlPromptStore()
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open, initialValue])

  if (!open) return null

  const submit = () => close(value.trim() || null)
  const cancel = () => close(null)

  return createPortal(
    <div
      onMouseDown={cancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 90vw)',
          background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '9px 11px', fontSize: 14,
            background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={cancel}
            style={{
              padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
            }}
          >취소</button>
          <button
            onClick={submit}
            style={{
              padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
              border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
            }}
          >적용</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
