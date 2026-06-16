import { useState, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { THEMES, getTheme } from '../core/themes'
import ColorPicker from './ColorPicker'

// 테마 배경 → 미리보기 타일 배경 스타일
function tileBg(theme) {
  return theme.bg.type === 'gradient'
    ? { backgroundImage: theme.bg.value }
    : { backgroundColor: theme.bg.value }
}

// 화면 픽셀 스포이드 (지원 브라우저만)
async function pickScreenColor() {
  if (typeof window === 'undefined' || !window.EyeDropper) return null
  try {
    const { sRGBHex } = await new window.EyeDropper().open()
    return sRGBHex
  } catch { return null }
}

/** 상단 툴바의 테마 선택 드롭다운 — 프리셋 + 사용자정의(스포이드) */
export default function ThemeMenu() {
  const themeId = useFlatStore(s => s.themeId)
  const customTheme = useFlatStore(s => s.customTheme)
  const setTheme = useFlatStore(s => s.setTheme)
  const updateCustomTheme = useFlatStore(s => s.updateCustomTheme)
  const applyThemeToDeck = useFlatStore(s => s.applyThemeToDeck)
  const applyThemeToCurrentPage = useFlatStore(s => s.applyThemeToCurrentPage)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = themeId === 'custom' ? customTheme : getTheme(themeId)
  const hasEyeDropper = typeof window !== 'undefined' && !!window.EyeDropper

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // 사용자정의 토큰 편집 — 변경 후 현재 테마가 custom이면 즉시 재적용(라이브)
  const editRole = (role, color) => {
    updateCustomTheme({ role, style: { color } })
    if (themeId === 'custom') applyThemeToCurrentPage()
  }
  const editBg = (value) => {
    updateCustomTheme({ bg: { type: 'color', value } })
    if (themeId === 'custom') applyThemeToCurrentPage()
  }

  const SLOTS = [
    { key: 'bg', label: '배경', value: customTheme.bg?.value || '#ffffff', onChange: editBg },
    { key: 'title', label: '제목', value: customTheme.roles.title.color, onChange: (c) => editRole('title', c) },
    { key: 'body', label: '본문', value: customTheme.roles.body.color, onChange: (c) => editRole('body', c) },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="테마 선택 (현재 슬라이드에 적용)"
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
      >
        <span className="w-4 h-4 rounded-sm border border-white/20 shrink-0" style={tileBg(current)} />
        <span>{current.name}</span>
        <span className="text-slate-500">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-[10060] p-2 rounded-xl bg-slate-900/97 border border-white/10 shadow-xl"
          style={{ width: 300, backdropFilter: 'blur(8px)' }}
        >
          <p className="text-[10px] text-slate-500 mb-1.5 px-0.5">테마 — 현재 슬라이드에 적용</p>
          <div className="grid grid-cols-4 gap-1.5">
            {THEMES.map(t => (
              <ThemeTile key={t.id} theme={t} active={t.id === themeId} onClick={() => { setTheme(t.id); setOpen(false) }} />
            ))}
            <ThemeTile theme={customTheme} active={themeId === 'custom'} onClick={() => { setTheme('custom'); setOpen(false) }} />
          </div>

          {/* 사용자정의 — 스포이드로 채취 */}
          <div className="mt-2 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] text-slate-500 px-0.5">사용자정의 — import 색을 채취</p>
              <button
                onClick={() => { setTheme('custom'); }}
                className="text-[10px] text-indigo-300 hover:text-indigo-200"
              >적용</button>
            </div>
            <div className="space-y-1">
              {SLOTS.map(slot => (
                <div key={slot.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-7 shrink-0">{slot.label}</span>
                  <div className="flex-1 min-w-0"><ColorPicker value={slot.value} onChange={slot.onChange} /></div>
                  {hasEyeDropper && (
                    <button
                      title="스포이드로 화면 색 채취"
                      onClick={async () => { const c = await pickScreenColor(); if (c) slot.onChange(c) }}
                      className="shrink-0 w-7 h-7 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
                    >💧</button>
                  )}
                </div>
              ))}
            </div>
            {!hasEyeDropper && (
              <p className="text-[9px] text-slate-600 mt-1 px-0.5">이 브라우저는 화면 스포이드 미지원 — 색상 칸으로 직접 지정</p>
            )}
          </div>

          <button
            onClick={() => { applyThemeToDeck(); setOpen(false) }}
            className="mt-2 w-full text-xs text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg py-1.5 transition-colors"
          >
            현재 테마를 모든 슬라이드에 적용
          </button>
        </div>
      )}
    </div>
  )
}

function ThemeTile({ theme, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={theme.name}
      className={`rounded-lg overflow-hidden border transition-colors ${
        active ? 'border-indigo-400 ring-1 ring-indigo-400/50' : 'border-white/10 hover:border-white/30'
      }`}
    >
      <span
        className="flex items-center justify-center h-10 text-sm font-bold"
        style={{ ...tileBg(theme), color: theme.roles.title.color, textShadow: theme.roles.title.textShadow }}
      >Aa</span>
      <span className="block text-[9px] text-slate-400 py-0.5 truncate px-0.5">{theme.name}</span>
    </button>
  )
}
