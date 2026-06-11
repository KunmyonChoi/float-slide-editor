import { useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'

/**
 * 슬라이드 삭제 후 하단에 '실행취소' 토스트(몇 초). 클릭하면 복원.
 * 확인 대화상자 없이 안전하게 삭제할 수 있게 한다.
 */
export default function SlideDeleteToast() {
  const notice = useFlatStore(s => s.pageDeleteNotice)
  const restore = useFlatStore(s => s.restoreDeletedPage)
  const dismiss = useFlatStore(s => s.dismissPageDeleteNotice)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => dismiss(), 5000)
    return () => clearTimeout(t)
  }, [notice, dismiss])

  if (!notice) return null

  const btn = {
    border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 13,
    padding: '5px 10px', color: '#fff', background: 'rgba(99,102,241,0.85)',
  }
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10000, display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px 8px 14px', borderRadius: 10,
        background: 'rgba(15,23,42,0.95)', color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        fontSize: 13, backdropFilter: 'blur(8px)',
      }}
    >
      <span>슬라이드가 삭제되었습니다</span>
      <button onClick={restore} style={btn}>실행취소</button>
      <button
        onClick={dismiss}
        title="닫기"
        style={{ ...btn, background: 'transparent', color: '#94a3b8', padding: '5px 6px' }}
      >✕</button>
    </div>
  )
}
