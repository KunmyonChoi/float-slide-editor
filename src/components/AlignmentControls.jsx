import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'

/**
 * AlignmentControls
 * 요소의 가로/세로 정렬을 부모 컨텍스트에 맞게 직관적으로 조정하는 버튼 그룹.
 *
 * 사용자는 항상 "가로 왼쪽/가운데/오른쪽", "세로 위/가운데/아래"로 생각하고,
 * 내부적으로 부모의 display/flex-direction에 맞는 CSS 속성이 적용된다.
 */
export default function AlignmentControls({ id }) {
  const { readAlignment, applyAlignment } = useEditorStore()
  const [current, setCurrent] = useState({ h: null, v: null })

  useEffect(() => {
    setCurrent(readAlignment(id))
  }, [id, readAlignment])

  const handleClick = useCallback((axis, value) => {
    // 같은 값 클릭 시 토글 해제
    const newValue = current[axis] === value ? null : value
    applyAlignment(id, axis, newValue ?? 'start')
    setCurrent(prev => ({ ...prev, [axis]: newValue }))
  }, [id, current, applyAlignment])

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">정렬</p>

      {/* 가로 정렬 */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-500 w-8 shrink-0">가로</span>
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          <AlignBtn
            active={current.h === 'start'}
            onClick={() => handleClick('h', 'start')}
            title="왼쪽 정렬"
          >
            <AlignLeftIcon />
          </AlignBtn>
          <AlignBtn
            active={current.h === 'center'}
            onClick={() => handleClick('h', 'center')}
            title="가로 가운데 정렬"
          >
            <AlignHCenterIcon />
          </AlignBtn>
          <AlignBtn
            active={current.h === 'end'}
            onClick={() => handleClick('h', 'end')}
            title="오른쪽 정렬"
          >
            <AlignRightIcon />
          </AlignBtn>
        </div>
      </div>

      {/* 세로 정렬 */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-500 w-8 shrink-0">세로</span>
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          <AlignBtn
            active={current.v === 'start'}
            onClick={() => handleClick('v', 'start')}
            title="위쪽 정렬"
          >
            <AlignTopIcon />
          </AlignBtn>
          <AlignBtn
            active={current.v === 'center'}
            onClick={() => handleClick('v', 'center')}
            title="세로 가운데 정렬"
          >
            <AlignVCenterIcon />
          </AlignBtn>
          <AlignBtn
            active={current.v === 'end'}
            onClick={() => handleClick('v', 'end')}
            title="아래쪽 정렬"
          >
            <AlignBottomIcon />
          </AlignBtn>
        </div>
      </div>
    </div>
  )
}

function AlignBtn({ active, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
        active
          ? 'bg-indigo-500/30 text-indigo-300'
          : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── 정렬 아이콘 SVG ──────────────────────────────────────────

function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="2" x2="2" y2="14" />
      <rect x="4" y="4" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="4" y="9" width="5" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function AlignHCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="8" y1="2" x2="8" y2="14" />
      <rect x="3" y="4" width="10" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="4.5" y="9" width="7" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="14" y1="2" x2="14" y2="14" />
      <rect x="4" y="4" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="7" y="9" width="5" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function AlignTopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="2" x2="14" y2="2" />
      <rect x="4" y="4" width="3" height="8" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="9" y="4" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function AlignVCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="8" x2="14" y2="8" />
      <rect x="4" y="3" width="3" height="10" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="9" y="4.5" width="3" height="7" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}

function AlignBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="14" x2="14" y2="14" />
      <rect x="4" y="4" width="3" height="8" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
      <rect x="9" y="7" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}
