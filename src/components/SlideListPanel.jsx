import { memo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import FlatElementRenderer from './FlatElementRenderer'
import { resolveConnectors } from '../core/ConnectorRouting'

const PANEL_W = 200
// 패널 가용 폭에 맞춤: PANEL_W − px-2(16) − 번호 w-4(16) − gap-2(8) − 스크롤바 여유(≈12)
// 이보다 크면 썸네일 오른쪽이 패널/스크롤바에 잘린다.
const THUMB_W = PANEL_W - 52 // = 148

/**
 * SlideListPanel — 좌측 슬라이드 목록(썸네일) 패널.
 * 모든 flat 페이지 미리보기 + 현재 페이지 강조 + 클릭 이동 + 드래그 순서 변경.
 * 오른쪽 PropertyPanel의 DockedShell 접기 패턴을 좌측용으로 미러링(기본 접힘).
 */
export default function SlideListPanel() {
  const collapsed = useFlatStore(s => s.slideListCollapsed)
  const toggle = useFlatStore(s => s.toggleSlideListCollapsed)
  // 재렌더 트리거용 구독 (목록은 getFlatPageList로 계산)
  const flatPageCount = useFlatStore(s => s.flatPageCount)
  const flatCurrentPage = useFlatStore(s => s.flatCurrentPage)
  useFlatStore(s => s.flatElements)   // 현재 페이지 편집 시 썸네일 라이브 갱신
  useFlatStore(s => s.canvasSize)

  const [dragFrom, setDragFrom] = useState(null)
  const [dragOver, setDragOver] = useState(null) // { index, before }
  const [ctxMenu, setCtxMenu] = useState(null)    // { x, y, index }
  const currentRef = useRef(null)
  const listRef = useRef(null)

  // 목록에 포커스가 있을 때 Enter → 현재 슬라이드 뒤에 제목+내용 레이아웃 페이지 추가(현재 테마)
  const onListKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      useFlatStore.getState().addPage('titleContent')
    }
  }

  // 컨텍스트 메뉴 바깥 클릭/ESC 닫기
  useEffect(() => {
    if (!ctxMenu) return
    const onDown = () => setCtxMenu(null)
    const onKey = (e) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [ctxMenu])

  // 페이지 전환 시(키보드 포함) 현재 페이지 썸네일을 화면 안으로 스크롤
  useEffect(() => {
    if (!collapsed && currentRef.current) {
      currentRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [flatCurrentPage, collapsed])

  if (flatPageCount === 0) return null

  const shell = {
    background: 'rgba(15,23,42,0.9)',
    backdropFilter: 'blur(16px)',
    borderRight: '1px solid rgba(255,255,255,0.08)',
  }

  // 접힘: 얇은 띠 + 펼치기 버튼
  if (collapsed) {
    return (
      <div className="shrink-0 flex flex-col items-center pt-2" style={{ width: 32, ...shell }}>
        <button
          onClick={toggle}
          title="슬라이드 목록 펼치기"
          className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
        >
          <ChevronRightIcon />
        </button>
        <span className="mt-2 text-[10px] text-slate-500" style={{ writingMode: 'vertical-rl' }}>슬라이드</span>
      </div>
    )
  }

  const pages = useFlatStore.getState().getFlatPageList()

  const onDrop = (e, targetIdx, before) => {
    e.preventDefault()
    const from = dragFrom
    setDragFrom(null); setDragOver(null)
    if (from == null) return
    // 삽입 위치(원본 인덱스 기준 0..N) → 제거 후 최종 인덱스로 변환
    const insertPos = before ? targetIdx : targetIdx + 1
    let to = insertPos > from ? insertPos - 1 : insertPos
    if (to === from) return
    useFlatStore.getState().reorderPage(from, to)
  }

  return (
    <div className="shrink-0 flex flex-col" style={{ width: PANEL_W, ...shell }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <span className="text-xs font-medium text-slate-400">슬라이드 {flatPageCount}</span>
        <button
          onClick={toggle}
          title="슬라이드 목록 접기"
          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
        >
          <ChevronLeftIcon />
        </button>
      </div>

      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        style={{ outline: 'none' }}
        className="flex-1 overflow-y-auto thin-scrollbar py-2 px-2 space-y-1.5"
      >
        {pages.map((p) => {
          const isOverBefore = dragOver && dragOver.index === p.index && dragOver.before
          const isOverAfter = dragOver && dragOver.index === p.index && !dragOver.before
          return (
            <div key={p.key} ref={p.isCurrent ? currentRef : null}>
              {isOverBefore && <DropLine />}
              <div
                draggable
                onDragStart={() => setDragFrom(p.index)}
                onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                onDragOver={(e) => {
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY < r.top + r.height / 2
                  if (!dragOver || dragOver.index !== p.index || dragOver.before !== before) {
                    setDragOver({ index: p.index, before })
                  }
                }}
                onDrop={(e) => onDrop(e, p.index, e.clientY < e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2)}
                onClick={() => { useFlatStore.getState().goToFlatPage(p.index); listRef.current?.focus() }}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  useFlatStore.getState().goToFlatPage(p.index) // 우클릭한 페이지를 현재로
                  setCtxMenu({ x: e.clientX, y: e.clientY, index: p.index })
                }}
                className="flex items-start gap-2 cursor-pointer group"
                style={{ opacity: dragFrom === p.index ? 0.4 : 1 }}
              >
                <span className={`text-[11px] pt-1 w-4 text-right shrink-0 ${p.isCurrent ? 'text-indigo-300' : 'text-slate-500'}`}>
                  {p.index + 1}
                </span>
                <div
                  className="rounded overflow-hidden transition-shadow"
                  style={{
                    outline: p.isCurrent ? '2px solid rgb(99,102,241)' : '1px solid rgba(255,255,255,0.12)',
                    outlineOffset: p.isCurrent ? -1 : 0,
                  }}
                >
                  <SlideThumbnail elements={p.elements} canvasSize={p.canvasSize} width={THUMB_W} />
                </div>
              </div>
              {isOverAfter && <DropLine />}
            </div>
          )
        })}
      </div>

      {ctxMenu && createPortal(
        <SlideContextMenu
          x={ctxMenu.x} y={ctxMenu.y} index={ctxMenu.index}
          pageCount={flatPageCount}
          onClose={() => setCtxMenu(null)}
        />,
        document.body,
      )}
    </div>
  )
}

// 슬라이드 우클릭 컨텍스트 메뉴
function SlideContextMenu({ x, y, index, pageCount, onClose }) {
  const run = (fn) => () => { fn(); onClose() }
  const s = useFlatStore.getState()
  const items = [
    { label: '새 슬라이드', shortcut: 'Ctrl+M', action: () => s.addPage('titleContent') },
    { label: '슬라이드 복제', action: () => s.duplicatePage() },
    { type: 'sep' },
    { label: '앞으로 이동', action: () => s.movePageOrder(-1), disabled: index <= 0 },
    { label: '뒤로 이동', action: () => s.movePageOrder(1), disabled: index >= pageCount - 1 },
    { type: 'sep' },
    { label: '삭제', shortcut: 'Del', action: () => s.deletePage(), disabled: pageCount <= 1, danger: true },
  ]
  // 화면 밖으로 넘치지 않게 위치 보정
  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - items.length * 30 - 12)
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: 10050, minWidth: 168,
        background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)', padding: 4,
      }}
    >
      {items.map((it, i) => it.type === 'sep'
        ? <div key={i} style={{ height: 1, margin: '4px 8px', background: 'rgba(255,255,255,0.1)' }} />
        : (
          <div
            key={i}
            onClick={it.disabled ? undefined : run(it.action)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', borderRadius: 6, fontSize: 13,
              cursor: it.disabled ? 'default' : 'pointer',
              color: it.disabled ? 'rgba(255,255,255,0.3)' : (it.danger ? '#fca5a5' : '#e2e8f0'),
            }}
            className={it.disabled ? '' : 'slide-ctx-item'}
          >
            <span>{it.label}</span>
            {it.shortcut && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 20 }}>{it.shortcut}</span>}
          </div>
        ))}
      <style>{`.slide-ctx-item:hover{background:rgba(255,255,255,0.1)}`}</style>
    </div>
  )
}

function DropLine() {
  return <div style={{ height: 2, background: 'rgb(99,102,241)', borderRadius: 2, margin: '2px 0 2px 24px' }} />
}

// 페이지 썸네일 — 요소를 작은 배율로 렌더(기존 FlatElementRenderer 재사용, 비대화형).
// 같은 elements/canvasSize면 재렌더 스킵(현재 페이지만 라이브 갱신).
export const SlideThumbnail = memo(function SlideThumbnail({ elements, canvasSize, width }) {
  const cs = canvasSize && canvasSize.w ? canvasSize : { w: 1280, h: 720 }
  const scale = width / cs.w
  const height = Math.round(cs.h * scale)
  const els = resolveConnectors(elements) // 커넥터 기하 유도(썸네일도 동일)
  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden', background: '#fff', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: cs.w, height: cs.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {els.map(el => (
          <FlatElementRenderer key={el.id} element={el} isSelected={false} isEditing={false} scale={scale} canvasSize={cs} />
        ))}
      </div>
    </div>
  )
})

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
