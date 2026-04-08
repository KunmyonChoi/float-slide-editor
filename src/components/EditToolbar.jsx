import { useRef, useState, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { ToolBtn, Divider, UndoIcon, RedoIcon } from './FloatingToolbar'

const INSERT_ITEMS = [
  { tag: 'p',   label: '텍스트', icon: '📝', attrs: { textContent: '새 텍스트' } },
  { tag: 'img', label: '이미지', icon: '🖼', attrs: { src: 'https://placehold.co/400x300', alt: '이미지' } },
  { tag: 'div', label: '박스',   icon: '📦', attrs: {} },
]

/**
 * EditToolbar — 편집 컨텍스트 툴바
 * Undo/Redo, 삽입, 캔버스 크기, z-순서, 품질
 * 발표 모드에서는 완전히 숨겨진다.
 */
export default function EditToolbar() {
  const { slideHtml, mode, canUndo: htmlCanUndo, canRedo: htmlCanRedo,
          selectedId, elements, undo: htmlUndo, redo: htmlRedo, insertElement } = useEditorStore()
  const { viewMode, selectedFlatId,
          canUndo: flatCanUndo, canRedo: flatCanRedo,
          undo: flatUndo, redo: flatRedo,
          bringForward, sendBackward, bringToFront, sendToBack } = useFlatStore()
  const [insertOpen, setInsertOpen] = useState(false)
  const insertRef = useRef(null)

  const isFlatMode = viewMode === 'flat' || viewMode === 'split'
  const canUndo = isFlatMode ? flatCanUndo : htmlCanUndo
  const canRedo = isFlatMode ? flatCanRedo : htmlCanRedo
  const undo = isFlatMode ? flatUndo : htmlUndo
  const redo = isFlatMode ? flatRedo : htmlRedo

  // Ctrl+Z/Y → 모드에 따라 적절한 undo/redo 호출
  useEffect(() => {
    const onKeyDown = (e) => {
      // flat/split 모드에서는 FlatCanvas가 undo/redo 처리
      const vm = useFlatStore.getState().viewMode
      if (vm === 'flat' || vm === 'split') return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); htmlUndo() }
        if (e.code === 'KeyZ' && e.shiftKey)  { e.preventDefault(); htmlRedo() }
        if (e.code === 'KeyY')                { e.preventDefault(); htmlRedo() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [htmlUndo, htmlRedo])

  // 발표 모드에서는 완전히 숨김
  if (mode === 'present') return null

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 shrink-0"
      style={{
        background: 'rgba(15,23,42,0.7)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <ToolBtn onClick={undo} disabled={!canUndo} title="실행취소 (Ctrl+Z)">
        <UndoIcon />
      </ToolBtn>
      <ToolBtn onClick={redo} disabled={!canRedo} title="다시실행 (Ctrl+Y)">
        <RedoIcon />
      </ToolBtn>

      <Divider />

      {/* 요소 삽입 */}
      <InsertDropdown
        innerRef={insertRef}
        open={insertOpen}
        setOpen={setInsertOpen}
        disabled={!slideHtml}
        onInsert={(tag, attrs) => {
          const meta = selectedId ? elements.get(selectedId) : null
          const parentId = meta?.type === 'container' ? selectedId : null
          insertElement(parentId, tag, attrs)
          setInsertOpen(false)
        }}
      />

      {/* z-순서 버튼 (flat/split 모드 + 요소 선택 시) */}
      {isFlatMode && selectedFlatId && (
        <>
          <Divider />
          <ToolBtn onClick={() => sendToBack(selectedFlatId)} title="맨 뒤로 (Ctrl+Shift+[)">
            <span className="text-xs">⤓</span>
          </ToolBtn>
          <ToolBtn onClick={() => sendBackward(selectedFlatId)} title="뒤로 (Ctrl+[)">
            <span className="text-xs">↓</span>
          </ToolBtn>
          <ToolBtn onClick={() => bringForward(selectedFlatId)} title="앞으로 (Ctrl+])">
            <span className="text-xs">↑</span>
          </ToolBtn>
          <ToolBtn onClick={() => bringToFront(selectedFlatId)} title="맨 앞으로 (Ctrl+Shift+])">
            <span className="text-xs">⤒</span>
          </ToolBtn>
        </>
      )}
    </div>
  )
}

function InsertDropdown({ innerRef, open, setOpen, disabled, onInsert }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (innerRef.current && !innerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, innerRef, setOpen])

  return (
    <div ref={innerRef} style={{ position: 'relative' }}>
      <ToolBtn onClick={() => setOpen(v => !v)} disabled={disabled} title="요소 삽입">
        <PlusIcon /><span className="text-xs ml-1">삽입</span>
      </ToolBtn>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
            transform: 'translateX(-50%)',
            width: 140,
            background: 'rgba(15,23,42,0.97)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            zIndex: 100,
            overflow: 'hidden',
            padding: '4px',
          }}
        >
          {INSERT_ITEMS.map(item => (
            <button
              key={item.tag}
              onClick={() => onInsert(item.tag, item.attrs)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10 transition-colors"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
