import { useState, useEffect, useRef, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'
import { computeAlignmentChanges, computeDistributionChanges } from '../core/SnapEngine'

const DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  color: '#000', fontSize: '16px', fontFamily: 'sans-serif',
  fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
  letterSpacing: 'normal', textTransform: 'none', textDecoration: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'cover',
}

const ELEMENT_PRESETS = {
  text: {
    type: 'text', width: 200, height: 40,
    content: '새 텍스트', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, padding: '4px 8px' },
  },
  rect: {
    type: 'shape', width: 150, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0' },
  },
  circle: {
    type: 'shape', width: 100, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', borderRadius: '50%' },
  },
}

export default function FlatContextMenu({ x, y, canvasX, canvasY, onClose }) {
  const {
    selectedFlatIds, clipboard, canvasSize, flatElements,
    copyElement, cutElement, pasteElement, duplicateElement,
    removeSelectedElements, selectAllFlats,
    bringForward, sendBackward, bringToFront, sendToBack,
    addFlatElement, setSelectedFlat, batchUpdateFlatElementsIndividual,
    updateFlatElement, batchUpdateFlatElements,
  } = useFlatStore()

  const menuRef = useRef(null)
  const [adjusted, setAdjusted] = useState({ x, y })
  const [openSubmenu, setOpenSubmenu] = useState(null)
  const hoverTimeout = useRef(null)

  const hasSelection = selectedFlatIds.length > 0
  const singleId = selectedFlatIds.length === 1 ? selectedFlatIds[0] : null
  const clipboardEmpty = !clipboard || clipboard.length === 0
  const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))
  const allLocked = selectedEls.length > 0 && selectedEls.every(e => e.locked)
  const anyLocked = selectedEls.some(e => e.locked)

  // 위치 보정 (메뉴가 stageRef 밖으로 나가지 않게)
  useEffect(() => {
    if (!menuRef.current) return
    const menu = menuRef.current
    const parent = menu.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    let ax = x, ay = y
    if (x + menuRect.width > parentRect.width) ax = x - menuRect.width
    if (y + menuRect.height > parentRect.height) ay = y - menuRect.height
    ax = Math.max(0, ax)
    ay = Math.max(0, ay)
    setAdjusted({ x: ax, y: ay })
  }, [x, y])

  // 외부 클릭 + Escape 닫기
  useEffect(() => {
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // 요소 생성
  const insertElement = useCallback((preset) => {
    const p = ELEMENT_PRESETS[preset]
    if (!p) return
    let ex = canvasX - p.width / 2
    let ey = canvasY - p.height / 2
    ex = Math.max(0, Math.min(ex, canvasSize.w - p.width))
    ey = Math.max(0, Math.min(ey, canvasSize.h - p.height))
    const maxZ = flatElements.length > 0
      ? Math.max(...flatElements.map(e => e.zIndex))
      : 0
    const el = {
      id: nextFlatId(),
      sourceId: null,
      ...p,
      styles: { ...p.styles },
      x: ex, y: ey,
      zIndex: maxZ + 1,
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [canvasX, canvasY, canvasSize, flatElements, addFlatElement, setSelectedFlat])

  // 액션 디스패치
  const handleAction = useCallback((action) => {
    switch (action) {
      case 'cut': cutElement(); break
      case 'copy': copyElement(); break
      case 'paste': pasteElement(); break
      case 'duplicate': duplicateElement(); break
      case 'delete': removeSelectedElements(); break
      case 'selectAll': selectAllFlats(); break
      case 'bringToFront': if (singleId) bringToFront(singleId); break
      case 'bringForward': if (singleId) bringForward(singleId); break
      case 'sendBackward': if (singleId) sendBackward(singleId); break
      case 'sendToBack': if (singleId) sendToBack(singleId); break
      case 'insertText': insertElement('text'); break
      case 'insertRect': insertElement('rect'); break
      case 'insertCircle': insertElement('circle'); break
      case 'lock': {
        const locked = !allLocked
        if (selectedFlatIds.length === 1) {
          updateFlatElement(selectedFlatIds[0], { locked })
        } else {
          batchUpdateFlatElements(selectedFlatIds, { locked })
        }
        break
      }
      case 'alignLeft': case 'alignCenterH': case 'alignRight':
      case 'alignTop': case 'alignMiddleV': case 'alignBottom': {
        const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))
        const changes = computeAlignmentChanges(selectedEls, action)
        if (changes.length > 0) batchUpdateFlatElementsIndividual(changes)
        break
      }
      case 'distributeH': case 'distributeV': {
        const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))
        const changes = computeDistributionChanges(selectedEls, action)
        if (changes.length > 0) batchUpdateFlatElementsIndividual(changes)
        break
      }
    }
    onClose()
  }, [singleId, cutElement, copyElement, pasteElement, duplicateElement,
      removeSelectedElements, selectAllFlats, bringForward, sendBackward,
      bringToFront, sendToBack, insertElement, onClose, allLocked,
      flatElements, selectedFlatIds, batchUpdateFlatElementsIndividual,
      updateFlatElement, batchUpdateFlatElements])

  // 서브메뉴 hover
  const enterSubmenu = (key) => {
    clearTimeout(hoverTimeout.current)
    setOpenSubmenu(key)
  }
  const leaveSubmenu = () => {
    hoverTimeout.current = setTimeout(() => setOpenSubmenu(null), 150)
  }

  // 메뉴 항목 빌드
  const items = hasSelection ? [
    { id: 'cut', label: '잘라내기', shortcut: 'Ctrl+X', action: 'cut' },
    { id: 'copy', label: '복사', shortcut: 'Ctrl+C', action: 'copy' },
    { id: 'paste', label: '붙여넣기', shortcut: 'Ctrl+V', action: 'paste', disabled: clipboardEmpty },
    { id: 'dup', label: '복제', shortcut: 'Ctrl+D', action: 'duplicate' },
    { id: 'del', label: '삭제', shortcut: 'Delete', action: 'delete' },
    { id: 'lock', label: allLocked ? '잠금 해제' : '잠금', action: 'lock' },
    { id: 'sep1', type: 'separator' },
    { id: 'zorder', label: '순서', submenu: 'zorder', disabled: !singleId,
      children: [
        { id: 'front', label: '맨 앞으로', shortcut: 'Ctrl+Shift+]', action: 'bringToFront' },
        { id: 'forward', label: '앞으로', shortcut: 'Ctrl+]', action: 'bringForward' },
        { id: 'backward', label: '뒤로', shortcut: 'Ctrl+[', action: 'sendBackward' },
        { id: 'back', label: '맨 뒤로', shortcut: 'Ctrl+Shift+[', action: 'sendToBack' },
      ],
    },
    { id: 'align', label: '정렬', submenu: 'align', disabled: selectedFlatIds.length < 2,
      children: [
        { id: 'alignLeft', label: '왼쪽 맞춤', action: 'alignLeft' },
        { id: 'alignCenterH', label: '가로 가운데', action: 'alignCenterH' },
        { id: 'alignRight', label: '오른쪽 맞춤', action: 'alignRight' },
        { id: 'sepA', type: 'separator' },
        { id: 'alignTop', label: '위쪽 맞춤', action: 'alignTop' },
        { id: 'alignMiddleV', label: '세로 가운데', action: 'alignMiddleV' },
        { id: 'alignBottom', label: '아래쪽 맞춤', action: 'alignBottom' },
        ...(selectedFlatIds.length >= 3 ? [
          { id: 'sepD', type: 'separator' },
          { id: 'distH', label: '가로 균등 분배', action: 'distributeH' },
          { id: 'distV', label: '세로 균등 분배', action: 'distributeV' },
        ] : []),
      ],
    },
    { id: 'sep2', type: 'separator' },
    { id: 'all', label: '전체 선택', shortcut: 'Ctrl+A', action: 'selectAll' },
  ] : [
    { id: 'paste', label: '붙여넣기', shortcut: 'Ctrl+V', action: 'paste', disabled: clipboardEmpty },
    { id: 'sep1', type: 'separator' },
    { id: 'insert', label: '요소 추가', submenu: 'insert',
      children: [
        { id: 'itext', label: '텍스트', action: 'insertText' },
        { id: 'irect', label: '사각형', action: 'insertRect' },
        { id: 'icircle', label: '원', action: 'insertCircle' },
      ],
    },
    { id: 'sep2', type: 'separator' },
    { id: 'all', label: '전체 선택', shortcut: 'Ctrl+A', action: 'selectAll' },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        left: adjusted.x,
        top: adjusted.y,
        minWidth: 180,
        background: 'rgba(15,23,42,0.97)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        zIndex: 10000,
        padding: '4px',
        userSelect: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map(item => {
        if (item.type === 'separator') {
          return <div key={item.id} style={{
            height: 1,
            margin: '4px 8px',
            background: 'rgba(255,255,255,0.1)',
          }} />
        }

        if (item.submenu) {
          return (
            <div
              key={item.id}
              style={{ position: 'relative' }}
              onMouseEnter={() => !item.disabled && enterSubmenu(item.submenu)}
              onMouseLeave={leaveSubmenu}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 12px', borderRadius: 6, cursor: item.disabled ? 'default' : 'pointer',
                color: item.disabled ? 'rgba(255,255,255,0.3)' : '#e2e8f0',
                fontSize: 13,
              }}
                className={item.disabled ? '' : 'ctx-item'}
              >
                <span>{item.label}</span>
                <span style={{ fontSize: 10, marginLeft: 12 }}>▸</span>
              </div>
              {openSubmenu === item.submenu && !item.disabled && (
                <Submenu items={item.children} onAction={handleAction} parentRef={menuRef} />
              )}
            </div>
          )
        }

        return (
          <div
            key={item.id}
            onClick={() => !item.disabled && handleAction(item.action)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', borderRadius: 6,
              cursor: item.disabled ? 'default' : 'pointer',
              color: item.disabled ? 'rgba(255,255,255,0.3)' : '#e2e8f0',
              fontSize: 13,
            }}
            className={item.disabled ? '' : 'ctx-item'}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 24 }}>
                {item.shortcut}
              </span>
            )}
          </div>
        )
      })}
      <style>{`
        .ctx-item:hover { background: rgba(255,255,255,0.1) }
      `}</style>
    </div>
  )
}

function Submenu({ items, onAction, parentRef }) {
  const subRef = useRef(null)
  const [flipLeft, setFlipLeft] = useState(false)

  useEffect(() => {
    if (!subRef.current || !parentRef.current) return
    const subRect = subRef.current.getBoundingClientRect()
    const stageEl = parentRef.current.parentElement
    if (!stageEl) return
    const stageRect = stageEl.getBoundingClientRect()
    if (subRect.right > stageRect.right) setFlipLeft(true)
  }, [parentRef])

  return (
    <div
      ref={subRef}
      style={{
        position: 'absolute',
        top: 0,
        ...(flipLeft ? { right: '100%', marginRight: 4 } : { left: '100%', marginLeft: 4 }),
        minWidth: 160,
        background: 'rgba(15,23,42,0.97)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        padding: '4px',
      }}
    >
      {items.map(item => (
        <div
          key={item.id}
          onClick={() => onAction(item.action)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
            color: '#e2e8f0', fontSize: 13,
          }}
          className="ctx-item"
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 24 }}>
              {item.shortcut}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
