import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

/**
 * NotesPanel — 프리뷰 하단 발표자 노트 작성 영역.
 * 토글은 PageBar(페이지번호 라인) 좌측에 있고, 접히면 이 영역은 완전히 사라져 공간을 차지하지 않는다.
 * 펼치면 라운드 텍스트박스가 바깥 컨테이너를 패딩 없이 채운다.
 */
export default function NotesPanel() {
  const mode = useEditorStore(s => s.mode)
  const notes = useFlatStore(s => s.pageNotes)
  const collapsed = useFlatStore(s => s.notesCollapsed)
  const setNotes = useFlatStore(s => s.setPageNotes)

  // 발표 모드이거나 접힌 상태면 렌더 안 함(공간 0)
  if (mode === 'present' || collapsed) return null

  return (
    <div style={{ flexShrink: 0, background: '#0f172a', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="이 슬라이드의 발표자 노트를 입력하세요…"
        autoFocus
        spellCheck={false}
        style={{
          display: 'block', width: '100%', height: 140, resize: 'vertical',
          boxSizing: 'border-box', margin: 0, padding: '8px 10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}
