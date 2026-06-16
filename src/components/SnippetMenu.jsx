import { useState, useRef, useEffect, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { SNIPPETS } from '../core/snippets'
import { SlideThumbnail } from './SlideListPanel'

// 스니펫 build 결과를 미리보기용으로 bbox에 맞춰 정렬(여백 포함) + id 부여
function previewOf(snippet, theme) {
  const specs = snippet.build({ w: 1280, h: 720 }, theme) || []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of specs) {
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y)
    maxX = Math.max(maxX, s.x + s.width); maxY = Math.max(maxY, s.y + s.height)
  }
  const pad = 16
  const cs = { w: Math.round(maxX - minX + pad * 2), h: Math.round(maxY - minY + pad * 2) }
  const els = specs.map((s, i) => ({
    ...s, id: `prev-${snippet.id}-${i}`, zIndex: i + 1,
    x: Math.round(s.x - minX + pad), y: Math.round(s.y - minY + pad),
  }))
  return { els, cs }
}

const GROUPS = [...new Set(SNIPPETS.map(s => s.group))]

/** EditToolbar 스니펫 드롭다운 — 섹션 그룹 + 미리보기 썸네일 + 설명 */
export default function SnippetMenu({ onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const theme = useFlatStore(s => s.themeId) // 테마 변경 시 미리보기 갱신 트리거
  const customTheme = useFlatStore(s => s.customTheme)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const resolved = theme === 'custom' ? customTheme : undefined
  const previews = useMemo(() => {
    const t = useFlatStore.getState()._currentTheme()
    const m = {}
    for (const s of SNIPPETS) m[s.id] = previewOf(s, t)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, resolved])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="스니펫(데코 요소) 삽입"
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-200 hover:bg-white/10 transition-colors"
      >
        <SnippetIcon /><span>스니펫</span><span className="text-slate-500">▾</span>
      </button>

      {open && (
        <div
          className="thin-scrollbar absolute left-0 mt-1 z-[10060] rounded-xl border border-white/10 shadow-xl overflow-y-auto"
          style={{ width: 300, maxHeight: 420, backgroundColor: '#1e293b' }}
        >
          {GROUPS.map(g => (
            <div key={g}>
              <p className="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-wide text-slate-500 sticky top-0 bg-slate-800/95">{g}</p>
              {SNIPPETS.filter(s => s.group === g).map(s => {
                const p = previews[s.id]
                return (
                  <button
                    key={s.id}
                    onClick={() => { onPick(s.id); setOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="shrink-0 rounded border border-white/10 overflow-hidden" style={{ width: 84 }}>
                      <SlideThumbnail elements={p.els} canvasSize={p.cs} width={84} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-200 truncate">{s.label}</span>
                      <span className="block text-[10px] text-slate-500 truncate">{s.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SnippetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="11" height="6" rx="3" />
      <circle cx="18" cy="16" r="3.5" />
    </svg>
  )
}
