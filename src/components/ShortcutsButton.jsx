import { useState, useRef, useEffect } from 'react'
import AnchoredMenu from './AnchoredMenu'

// ⌘(맥) / Ctrl(그 외) 표기
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
const MOD = isMac ? '⌘' : 'Ctrl'

const GROUPS = [
  {
    title: '편집',
    items: [
      [`${MOD} Z`, '실행취소'],
      [`${MOD} ⇧ Z / ${MOD} Y`, '다시실행'],
      [`${MOD} C / X / V`, '복사 / 잘라내기 / 붙여넣기'],
      [`${MOD} ⇧ C / V`, '서식 복사 / 붙여넣기'],
      [`${MOD} D`, '복제'],
      [`${MOD} A`, '전체 선택'],
      [`${MOD} G / ${MOD} ⇧ G`, '그룹 / 그룹 해제'],
      ['Delete / Backspace', '선택 요소 삭제'],
      ['Delete', '슬라이드 삭제 (선택 없을 때)'],
      ['Enter / F2', '편집 시작'],
      ['Esc', '선택 해제 / 편집 종료'],
      [`${MOD} S`, '프로젝트 저장'],
      [`${MOD} ⌥ V`, '클립보드(이미지/텍스트) 붙여넣기'],
    ],
  },
  {
    title: '텍스트 서식 (선택 중)',
    items: [
      [`${MOD} B / I / U`, '굵게 / 기울임 / 밑줄'],
      [`${MOD} ⇧ . / ,`, '글자 크기 키우기 / 줄이기'],
    ],
  },
  {
    title: '배치 · 패널 · 뷰',
    items: [
      [`${MOD} ] / [`, '앞으로 / 뒤로'],
      [`${MOD} ⇧ ] / [`, '맨 앞 / 맨 뒤'],
      ['[', '슬라이드 목록 토글'],
      [']', '속성 패널 토글'],
      ['\\', '발표자 노트 토글'],
    ],
  },
  {
    title: '발표 모드',
    items: [
      ['F5 / ⇧ F5', '발표 시작 (처음부터 / 현재 슬라이드)'],
      ['← → / Space', '이전 / 다음 슬라이드'],
      [`${MOD} P`, '펜 모드'],
      [`${MOD} E`, '지우개'],
      ['E', '현재 슬라이드 잉크 지우기'],
      ['Esc', '펜 끄기 / 발표 종료'],
    ],
  },
]

/** 단축키 목록 플로팅 팝업 토글 — 툴바 우상단 끝 */
export default function ShortcutsButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="단축키 목록"
        className={[
          'flex items-center px-2.5 py-1.5 rounded-lg text-sm transition-colors',
          open ? 'bg-indigo-500/30 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10',
        ].join(' ')}
      >
        <KeyboardIcon />
      </button>

      <AnchoredMenu anchorRef={ref} open={open} z={10060}>
        <div
          className="thin-scrollbar rounded-xl border border-white/10 shadow-xl overflow-y-auto p-1"
          style={{ width: 320, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 80px)', background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(12px)' }}
        >
          <p className="text-[11px] font-semibold text-slate-200 px-2.5 pt-1.5 pb-1">키보드 단축키</p>
          {GROUPS.map(g => (
            <div key={g.title} className="mb-1">
              <p className="text-[9px] uppercase tracking-wide text-slate-500 px-2.5 pt-1.5 pb-0.5">{g.title}</p>
              {g.items.map(([keys, desc]) => (
                <div key={keys + desc} className="flex items-center justify-between gap-3 px-2.5 py-1 rounded-md hover:bg-white/5">
                  <span className="text-[12px] text-slate-300 truncate">{desc}</span>
                  <kbd className="shrink-0 text-[11px] font-mono text-indigo-200 bg-white/8 border border-white/10 rounded px-1.5 py-0.5 whitespace-nowrap">{keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </AnchoredMenu>
    </div>
  )
}

function KeyboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  )
}
