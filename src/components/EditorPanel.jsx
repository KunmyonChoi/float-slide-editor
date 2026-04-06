import { useEditorStore } from '../store/editorStore'

const TYPE_LABEL = { text: '텍스트', image: '이미지', container: '컨테이너' }
const TYPE_COLOR = {
  text: 'bg-blue-100 text-blue-700',
  image: 'bg-green-100 text-green-700',
  container: 'bg-purple-100 text-purple-700',
}

/**
 * EditorPanel (Phase 1 — 요소 정보 표시 stub)
 * 선택된 요소의 메타데이터를 보여주는 플로팅 패널
 */
export default function EditorPanel() {
  const { selectedId, elements } = useEditorStore()
  const meta = selectedId ? elements.get(selectedId) : null

  return (
    <aside className="w-64 bg-white border-l border-slate-200 flex flex-col shadow-lg">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700">속성 패널</h2>
      </div>

      {meta ? (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${TYPE_COLOR[meta.type]}`}>
              {TYPE_LABEL[meta.type]}
            </span>
            <code className="text-xs text-slate-500">&lt;{meta.tag}&gt;</code>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">ID</p>
            <p className="text-xs font-mono text-slate-600 bg-slate-50 rounded px-2 py-1">{meta.id}</p>
          </div>
          <p className="text-xs text-slate-400">
            Phase 2 이후 편집 컨트롤이 여기에 추가됩니다.
          </p>
        </div>
      ) : (
        <div className="p-4 text-xs text-slate-400">
          요소를 클릭하면 속성이 표시됩니다.
        </div>
      )}
    </aside>
  )
}
