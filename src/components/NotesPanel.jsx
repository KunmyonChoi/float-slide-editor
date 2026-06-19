import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

/**
 * NotesPanel — 프리뷰 화면 하단의 발표자 노트 작성 영역.
 * 페이지별로 저장되며(접고 열 수 있음), 현재 페이지의 노트를 편집한다.
 */
export default function NotesPanel() {
  const mode = useEditorStore(s => s.mode)
  const notes = useFlatStore(s => s.pageNotes)
  const collapsed = useFlatStore(s => s.notesCollapsed)
  const toggle = useFlatStore(s => s.toggleNotesCollapsed)
  const setNotes = useFlatStore(s => s.setPageNotes)

  // 발표 모드에서는 숨김(편집/미리보기 화면 전용)
  if (mode === 'present') return null

  return (
    <div style={{
      flexShrink: 0,
      background: '#0f172a',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <button
        onClick={toggle}
        title={collapsed ? '발표자 노트 열기' : '발표자 노트 접기'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          height: 28, padding: '0 12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#94a3b8', fontSize: 12, textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-block', transition: 'transform 0.15s',
          transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        }}>▶</span>
        <span style={{ fontWeight: 600 }}>발표자 노트</span>
        {collapsed && notes.trim() && (
          <span style={{ color: '#475569', fontSize: 11, marginLeft: 4 }}>
            — {notes.trim().slice(0, 60)}{notes.trim().length > 60 ? '…' : ''}
          </span>
        )}
      </button>
      {!collapsed && (
        <div style={{ padding: '0 12px 10px' }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="이 슬라이드의 발표자 노트를 입력하세요…"
            spellCheck={false}
            style={{
              width: '100%', height: 96, resize: 'vertical',
              boxSizing: 'border-box', padding: '8px 10px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
              color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      )}
    </div>
  )
}
