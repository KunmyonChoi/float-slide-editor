import { useState, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { THEMES, getTheme } from '../core/themes'

// 테마 배경 → 미리보기 타일 배경 스타일
function tileBg(theme) {
  return theme.bg.type === 'gradient'
    ? { backgroundImage: theme.bg.value }
    : { backgroundColor: theme.bg.value }
}

/** 상단 툴바의 테마 선택 드롭다운 — 현재 페이지에 배경+역할 텍스트 서식 적용 */
export default function ThemeMenu() {
  const themeId = useFlatStore(s => s.themeId)
  const setTheme = useFlatStore(s => s.setTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = getTheme(themeId)

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
        <span
          className="w-4 h-4 rounded-sm border border-white/20 shrink-0"
          style={tileBg(current)}
        />
        <span>{current.name}</span>
        <span className="text-slate-500">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-[10060] p-2 rounded-xl bg-slate-900/97 border border-white/10 shadow-xl"
          style={{ width: 280, backdropFilter: 'blur(8px)' }}
        >
          <p className="text-[10px] text-slate-500 mb-1.5 px-0.5">테마 — 현재 슬라이드에 적용</p>
          <div className="grid grid-cols-4 gap-1.5">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false) }}
                title={t.name}
                className={`rounded-lg overflow-hidden border transition-colors ${
                  t.id === themeId ? 'border-indigo-400 ring-1 ring-indigo-400/50' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <span
                  className="flex items-center justify-center h-10 text-sm font-bold"
                  style={{ ...tileBg(t), color: t.roles.title.color, textShadow: t.roles.title.textShadow }}
                >Aa</span>
                <span className="block text-[9px] text-slate-400 py-0.5 truncate px-0.5">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
