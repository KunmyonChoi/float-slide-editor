import { useState, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { THEMES, getTheme } from '../core/themes'
import AnchoredMenu from './AnchoredMenu'

// 테마 배경 → 미리보기 타일 배경 스타일
function tileBg(theme) {
  return theme.bg.type === 'gradient'
    ? { backgroundImage: theme.bg.value }
    : { backgroundColor: theme.bg.value }
}

/**
 * 상단 툴바의 테마 선택 드롭다운 — 프리셋 + 사용자정의.
 * 사용자정의 색은 캔버스에서 텍스트/배경 우클릭 → "사용자 테마 색 지정"으로 채취.
 */
export default function ThemeMenu() {
  const themeId = useFlatStore(s => s.themeId)
  const customTheme = useFlatStore(s => s.customTheme)
  const setTheme = useFlatStore(s => s.setTheme)
  const applyThemeToDeck = useFlatStore(s => s.applyThemeToDeck)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = themeId === 'custom' ? customTheme : getTheme(themeId)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

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

      <AnchoredMenu anchorRef={ref} open={open} z={10060}>
        <div
          className="p-2 rounded-xl bg-slate-900/97 border border-white/10 shadow-xl"
          style={{ width: 300, maxWidth: 'calc(100vw - 16px)', backdropFilter: 'blur(8px)' }}
        >
          <p className="text-[10px] text-slate-500 mb-1.5 px-0.5">테마 — 현재 슬라이드에 적용</p>
          <div className="grid grid-cols-4 gap-1.5">
            {THEMES.map(t => (
              <ThemeTile key={t.id} theme={t} active={t.id === themeId} onClick={() => { setTheme(t.id); setOpen(false) }} />
            ))}
            <ThemeTile theme={customTheme} active={themeId === 'custom'} onClick={() => { setTheme('custom'); setOpen(false) }} />
          </div>

          <p className="text-[9px] text-slate-600 mt-1.5 px-0.5">
            사용자정의: 캔버스에서 텍스트/배경 우클릭 → "사용자 테마 색 지정"으로 색을 채취하세요.
          </p>

          <button
            onClick={() => { applyThemeToDeck(); setOpen(false) }}
            className="mt-2 w-full text-xs text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg py-1.5 transition-colors"
          >
            현재 테마를 모든 슬라이드에 적용
          </button>
        </div>
      </AnchoredMenu>
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
