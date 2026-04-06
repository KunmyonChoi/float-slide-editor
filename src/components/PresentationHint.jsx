import { useState, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'

/**
 * PresentationHint
 * 발표 모드 진입 직후 2초간 "ESC로 편집 모드 복귀" 힌트를 표시한다.
 * 발표 모드에서만 렌더링된다 (App에서 조건부 렌더링).
 */
export default function PresentationHint() {
  const { exitPresentation } = useEditorStore()
  const [visible, setVisible] = useState(true)

  // 2초 후 자동으로 사라짐
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer"
      style={{
        transform: 'translateX(-50%)',
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.07)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.6s ease',
        pointerEvents: visible ? 'all' : 'none',
      }}
      onClick={exitPresentation}
      title="클릭하거나 ESC를 눌러 편집 모드로 돌아가기"
    >
      <span className="text-xs text-slate-400">발표 모드</span>
      <kbd className="text-xs bg-white/10 text-slate-300 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
      <span className="text-xs text-slate-500">편집 모드로 복귀</span>
    </div>
  )
}
