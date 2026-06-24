import { useMemo, useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import {
  ICON_CATEGORIES, GROUP_CONTAINERS, awsIconDataUrl,
  AWS_ICON_MIME, AWS_GROUP_MIME,
} from '../core/awsIcons'

/**
 * 다이어그램 모드 아이콘 팔레트 — 속성 패널의 '아이콘' 탭 콘텐츠.
 * AWS 아키텍처 아이콘을 드래그(캔버스 드롭) 또는 클릭(중앙 삽입)으로 배치한다.
 * 하단에 그룹 컨테이너(VPC/Region 등 경계 박스) 섹션 포함.
 */
export default function DiagramIconPanel() {
  const insertAwsIcon = useFlatStore(s => s.insertAwsIcon)
  const insertAwsGroup = useFlatStore(s => s.insertAwsGroup)
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const cats = useMemo(() => {
    if (!query) return ICON_CATEGORIES
    return ICON_CATEGORIES
      .map(c => ({ ...c, icons: c.icons.filter(i =>
        i.label.toLowerCase().includes(query) || i.id.toLowerCase().includes(query)) }))
      .filter(c => c.icons.length > 0)
  }, [query])

  const groups = useMemo(() => {
    if (!query) return GROUP_CONTAINERS
    return GROUP_CONTAINERS.filter(g => g.label.toLowerCase().includes(query) || g.kind.includes(query))
  }, [query])

  const onIconDragStart = (e, id) => {
    e.dataTransfer.setData(AWS_ICON_MIME, id)
    e.dataTransfer.effectAllowed = 'copy'
  }
  const onGroupDragStart = (e, kind) => {
    e.dataTransfer.setData(AWS_GROUP_MIME, kind)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="p-3 space-y-3">
      <input
        type="text" value={q} onChange={e => setQ(e.target.value)}
        placeholder="아이콘 검색 (예: S3, lambda)"
        className="w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50"
      />
      <p className="text-[11px] text-slate-500 leading-relaxed">
        캔버스로 드래그하거나 클릭해서 배치. 배치한 아이콘끼리 연결점에서 끌어 커넥터로 연결됩니다.
      </p>

      {cats.map(cat => (
        <section key={cat.key}>
          <h4 className="text-[11px] font-semibold text-slate-400 mb-1.5">{cat.label}</h4>
          <div className="grid grid-cols-3 gap-1.5">
            {cat.icons.map(ic => (
              <button
                key={ic.id}
                type="button"
                draggable
                onDragStart={e => onIconDragStart(e, ic.id)}
                onClick={() => insertAwsIcon(ic.id)}
                title={`${ic.label} — 드래그 또는 클릭`}
                className="flex flex-col items-center gap-1 p-1.5 rounded-lg border border-white/5 bg-white/[0.03] hover:bg-white/10 hover:border-white/15 cursor-grab active:cursor-grabbing transition-colors"
              >
                <img src={awsIconDataUrl(ic.id)} alt={ic.label} draggable={false}
                  className="w-8 h-8 pointer-events-none select-none" />
                <span className="text-[9.5px] text-slate-300 leading-tight text-center truncate w-full">{ic.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {groups.length > 0 && (
        <section>
          <h4 className="text-[11px] font-semibold text-slate-400 mb-1.5 pt-1 border-t border-white/5">그룹 컨테이너</h4>
          <div className="flex flex-col gap-1.5">
            {groups.map(g => (
              <button
                key={g.kind}
                type="button"
                draggable
                onDragStart={e => onGroupDragStart(e, g.kind)}
                onClick={() => insertAwsGroup(g.kind)}
                title={`${g.label} 경계 박스 — 드래그 또는 클릭`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-white/5 bg-white/[0.03] hover:bg-white/10 hover:border-white/15 cursor-grab active:cursor-grabbing transition-colors"
              >
                <span className="w-6 h-5 rounded shrink-0"
                  style={{ border: `2px ${g.dashed ? 'dashed' : 'solid'} ${g.color}`, background: 'rgba(0,0,0,0)' }} />
                <span className="text-[11px] text-slate-300 truncate">{g.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {cats.length === 0 && groups.length === 0 && (
        <p className="text-xs text-slate-600 text-center py-4">일치하는 아이콘이 없습니다.</p>
      )}
    </div>
  )
}
