import { useMemo } from 'react'
import { useEditorStore } from '../store/editorStore'

const TYPE_DOT = {
  text: 'bg-indigo-400',
  image: 'bg-emerald-400',
  container: 'bg-violet-400',
}

export default function Breadcrumb({ id }) {
  const { getAncestorChain, getChildren, setSelected, elements } = useEditorStore()
  const meta = elements.get(id)

  const ancestors = useMemo(() => getAncestorChain(id), [id, getAncestorChain])
  const children = useMemo(() => getChildren(id), [id, getChildren])

  if (!meta) return null

  return (
    <div className="space-y-1.5">
      {/* 조상 체인 */}
      <div className="flex items-center gap-0.5 flex-wrap text-xs">
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-0.5">
            <button
              onClick={() => setSelected(a.id)}
              className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              {a.tag}
            </button>
            <ChevronIcon />
          </span>
        ))}
        <span className="text-slate-200 font-semibold">{meta.tag}</span>
      </div>

      {/* 자식 목록 */}
      {children.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pl-2 border-l border-white/10">
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[c.type]}`} />
              {c.tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-600 shrink-0">
      <path d="M2.5 1.5L5.5 4L2.5 6.5" />
    </svg>
  )
}
