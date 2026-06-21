import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'
import { BlobStore } from '../core/BlobStore'
import { copyElementToSystemClipboard } from '../core/SystemClipboard'
import { computeAlignmentChanges, computeDistributionChanges, isBackgroundElement } from '../core/SnapEngine'
import { promptUrl } from './UrlPrompt'
import { openInfographic } from './InfographicModal'

const DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  color: '#000', fontSize: '16px', fontFamily: 'sans-serif',
  fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
  letterSpacing: 'normal', textTransform: 'none', textDecoration: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'contain',
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
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', textAlign: 'center', alignItems: 'center' },
  },
  roundRect: {
    type: 'shape', width: 150, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', borderRadius: '16px', textAlign: 'center', alignItems: 'center' },
  },
  circle: {
    type: 'shape', width: 100, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', borderRadius: '50%', textAlign: 'center', alignItems: 'center' },
  },
  lineH: {
    type: 'shape', width: 200, height: 2,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#94a3b8' },
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
  const singleTextEl = selectedEls.length === 1 && selectedEls[0].type === 'text' ? selectedEls[0] : null
  const singleImageEl = selectedEls.length === 1 && selectedEls[0].type === 'image' ? selectedEls[0] : null
  const singleVideoEl = selectedEls.length === 1 && selectedEls[0].type === 'video' ? selectedEls[0] : null

  // 배경 요소 찾기 — 명시 배경(플래그/__bg)만
  const bgElement = useMemo(() => flatElements.find(el => isBackgroundElement(el)), [flatElements])
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

  // 외부 클릭(터치/마우스/펜 공용 pointerdown) + Escape 닫기
  useEffect(() => {
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const fileInputRef = useRef(null)

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
    // 텍스트는 현재 테마 기본 서식(글자색/굵기/그림자) 적용
    const themeText = p.type === 'text' ? useFlatStore.getState().getThemeTextDefault() : null
    const el = {
      id: nextFlatId(),
      sourceId: null,
      ...p,
      styles: { ...p.styles, ...(themeText ? { color: themeText.color, fontWeight: themeText.fontWeight, textShadow: themeText.textShadow } : {}) },
      x: ex, y: ey,
      zIndex: maxZ + 1,
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [canvasX, canvasY, canvasSize, flatElements, addFlatElement, setSelectedFlat])

  // 커스텀 요소 삽입 (이미지/영상)
  const insertCustomElement = useCallback((elData) => {
    let ex = canvasX - elData.width / 2
    let ey = canvasY - elData.height / 2
    ex = Math.max(0, Math.min(ex, canvasSize.w - elData.width))
    ey = Math.max(0, Math.min(ey, canvasSize.h - elData.height))
    const maxZ = flatElements.length > 0
      ? Math.max(...flatElements.map(e => e.zIndex))
      : 0
    const el = {
      id: nextFlatId(),
      sourceId: null,
      ...elData,
      x: ex, y: ey,
      zIndex: maxZ + 1,
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [canvasX, canvasY, canvasSize, flatElements, addFlatElement, setSelectedFlat])

  // 이미지 Blob/File → 캔버스에 맞게 축소해 우클릭 위치에 삽입(파일선택/캡처 붙여넣기 공용)
  const insertImageFromBlob = useCallback((blob) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        const maxW = canvasSize.w * 0.6, maxH = canvasSize.h * 0.6
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h)
          w = Math.round(w * ratio)
          h = Math.round(h * ratio)
        }
        insertCustomElement({
          type: 'image',
          width: w, height: h,
          content: ev.target.result,
          isRich: false, merged: false,
          styles: { ...DEFAULT_STYLES, objectFit: 'contain' },
        })
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(blob)
  }, [canvasSize, insertCustomElement])

  // 이미지 파일 선택 처리
  const handleImageFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) { onClose(); return }
    insertImageFromBlob(file)
    e.target.value = '' // 같은 파일 재선택 허용
    onClose()
  }, [insertImageFromBlob, onClose])

  // 텍스트 → 캔버스에 텍스트 요소로 삽입(우클릭 위치). 줄 수/길이로 크기 추정.
  const insertTextElement = useCallback((text) => {
    const lines = text.trim().split('\n')
    const w = Math.min(Math.max(200, Math.max(...lines.map(l => l.length)) * 10), canvasSize.w * 0.8)
    const h = Math.max(40, lines.length * 24)
    insertCustomElement({
      type: 'text',
      width: Math.round(w), height: h,
      content: text.trim().replace(/\n/g, '<br>'),
      isRich: text.includes('\n'),
      merged: false,
      styles: { ...DEFAULT_STYLES, padding: '4px 8px' },
    })
  }, [canvasSize, insertCustomElement])

  // OS 클립보드 붙여넣기 — 내용 타입을 보고 이미지/텍스트로 구분 삽입.
  // 내부 요소 클립보드(Ctrl+V)와 무관하게 외부 캡처/복사본을 강제로 붙인다.
  const pasteFromClipboard = useCallback(async () => {
    if (!navigator.clipboard?.read) { alert('이 브라우저는 클립보드 읽기를 지원하지 않습니다.'); return }
    try {
      const items = await navigator.clipboard.read()
      // 1순위: 이미지
      for (const item of items) {
        const t = item.types.find(x => x.startsWith('image/'))
        if (t) { insertImageFromBlob(await item.getType(t)); return }
      }
      // 2순위: 텍스트
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text()
          if (text.trim()) { insertTextElement(text); return }
        }
      }
      alert('클립보드에 붙여넣을 이미지나 텍스트가 없습니다.')
    } catch {
      alert('클립보드를 읽지 못했습니다(권한이 필요할 수 있어요).')
    }
  }, [insertImageFromBlob, insertTextElement])

  // 영상 URL → embed URL 변환
  const parseVideoUrl = (url) => {
    // YouTube
    let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
    if (m) return { embedUrl: `https://www.youtube.com/embed/${m[1]}`, provider: 'youtube' }
    // Vimeo
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (m) return { embedUrl: `https://player.vimeo.com/video/${m[1]}`, provider: 'vimeo' }
    // 기타 URL은 직접 embed 시도
    return { embedUrl: url, provider: 'other' }
  }

  // 영상 추가
  const insertVideo = useCallback(async () => {
    const url = await promptUrl({ title: '영상 URL을 입력하세요', placeholder: 'YouTube, Vimeo URL' })
    if (!url || !url.trim()) return
    const { embedUrl } = parseVideoUrl(url.trim())
    const w = Math.min(560, canvasSize.w * 0.6)
    const h = Math.round(w * 9 / 16) // 16:9
    insertCustomElement({
      type: 'video',
      width: w, height: h,
      content: embedUrl,
      isRich: false, merged: false,
      // 기본 옵션: 자동 재생 on, 반복·음소거 off, 발표 화면 컨트롤 숨김
      autoplay: true, loop: false, muted: false, hideControls: true,
      styles: { ...DEFAULT_STYLES, borderRadius: '8px' },
    })
  }, [canvasSize, insertCustomElement])

  // 선택한 미디어(이미지/비디오) 다운로드 (data URL / idb:// / 외부 URL 모두 처리)
  const downloadSelectedMedia = useCallback(async () => {
    const el = flatElements.find(e => e.id === singleId)
    if (!el || (el.type !== 'image' && el.type !== 'video') || !el.content) return
    const isVideo = el.type === 'video'
    const pfx = isVideo ? 'video/' : 'image/'
    let src = el.content
    if (BlobStore.isIdbRef(src)) src = await BlobStore.getUrl(BlobStore.parseRef(src))
    let url = src, revoke = false, ext = isVideo ? 'mp4' : 'png'
    try {
      const resp = await fetch(src)
      const blob = await resp.blob()
      // video/webm;codecs=... → 'webm'만 추출
      if (blob.type.startsWith(pfx)) ext = (blob.type.split('/')[1] || ext).split(';')[0].split('+')[0]
      url = URL.createObjectURL(blob); revoke = true
    } catch { /* fetch 실패 시 원본 src로 직접 시도 */ }
    // 녹화 삽입 등으로 filename이 있으면 우선 사용
    const name = el.filename || `${isVideo ? 'video' : 'image'}.${ext}`
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [flatElements, singleId])

  // 액션 디스패치
  const handleAction = useCallback((action) => {
    switch (action) {
      case 'cut': if (selectedEls.length === 1) copyElementToSystemClipboard(selectedEls[0]); cutElement(); break
      case 'copy': copyElement(); if (selectedEls.length === 1) copyElementToSystemClipboard(selectedEls[0]); break
      case 'paste': pasteElement(); break
      case 'pasteClipboard': pasteFromClipboard(); break
      case 'duplicate': duplicateElement(); break
      case 'delete': removeSelectedElements(); break
      case 'selectAll': selectAllFlats(); break
      case 'bringToFront': if (singleId) bringToFront(singleId); break
      case 'bringForward': if (singleId) bringForward(singleId); break
      case 'sendBackward': if (singleId) sendBackward(singleId); break
      case 'sendToBack': if (singleId) sendToBack(singleId); break
      case 'copyStyle': useFlatStore.getState().copyStyle(); break
      case 'pasteStyle': useFlatStore.getState().pasteStyle(); break
      case 'group': useFlatStore.getState().groupSelected(); break
      case 'ungroup': useFlatStore.getState().ungroupSelected(); break
      case 'insertText': insertElement('text'); break
      case 'insertRect': insertElement('rect'); break
      case 'insertRoundRect': insertElement('roundRect'); break
      case 'insertCircle': insertElement('circle'); break
      case 'insertLine': insertElement('lineH'); break
      case 'insertImage': fileInputRef.current?.click(); return // onClose 호출하지 않음
      case 'insertVideo': insertVideo(); break
      case 'formatBackground': if (bgElement) setSelectedFlat(bgElement.id); break
      case 'setThemeTitle':
        if (singleTextEl) useFlatStore.getState().updateCustomTheme({ role: 'title', style: { color: singleTextEl.styles.color } })
        break
      case 'setThemeBody':
        if (singleTextEl) {
          const c = singleTextEl.styles.color
          const st = useFlatStore.getState()
          st.updateCustomTheme({ role: 'body', style: { color: c } })
          st.updateCustomTheme({ role: 'default', style: { color: c } })
        }
        break
      case 'setThemeBg':
        if (bgElement) {
          const s = bgElement.styles || {}
          const bg = (s.backgroundImage && s.backgroundImage !== 'none')
            ? { type: 'gradient', value: s.backgroundImage }
            : { type: 'color', value: s.backgroundColor || '#ffffff' }
          useFlatStore.getState().updateCustomTheme({ bg })
        }
        break
      case 'downloadMedia': downloadSelectedMedia(); break
      case 'aiInfographic': openInfographic(); break
      case 'convertToBg': {
        // 단일 이미지/영상만 배경으로 변환(타입 유지). 원래 위치/크기는 _restore에 보관.
        if (selectedEls.length !== 1) break
        const el = selectedEls[0]
        if (el.type !== 'image' && el.type !== 'video') break
        // 새 배경은 기존 배경들보다 '앞'(최상위 배경)에 — 안 그러면 흰 배경 등에 가려 사라진다.
        // 배경끼리는 render z에 -1,000,000 오프셋이 있어 항상 콘텐츠 아래로 유지됨.
        const otherBgZs = flatElements.filter(e => e.id !== el.id && isBackgroundElement(e)).map(e => e.zIndex)
        const bgTopZ = otherBgZs.length
          ? Math.max(...otherBgZs) + 1
          : (flatElements.length ? Math.min(...flatElements.map(e => e.zIndex)) - 1 : 0)
        updateFlatElement(el.id, {
          isBackground: true, sourceId: '__bg', locked: true,
          x: 0, y: 0, width: canvasSize.w, height: canvasSize.h, zIndex: bgTopZ,
          _restore: { x: el.x, y: el.y, width: el.width, height: el.height, zIndex: el.zIndex, objectFit: el.styles?.objectFit },
          styles: { ...(el.styles || {}), objectFit: 'cover' }, // 배경은 꽉 채움
        })
        setSelectedFlat(null) // 배경은 캔버스 선택 대상 아님
        break
      }
      case 'restoreFromBg': {
        // 배경 → 일반 요소로 복원
        if (selectedEls.length !== 1) break
        const el = selectedEls[0]
        if (!isBackgroundElement(el)) break
        useFlatStore.getState().restoreBackgroundToNormal(el.id)
        break
      }
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
      bringToFront, sendToBack, insertElement, insertVideo, onClose, allLocked,
      flatElements, selectedFlatIds, batchUpdateFlatElementsIndividual,
      updateFlatElement, batchUpdateFlatElements, bgElement, setSelectedFlat, singleTextEl, downloadSelectedMedia, pasteFromClipboard])

  // 서브메뉴 hover
  const enterSubmenu = (key) => {
    clearTimeout(hoverTimeout.current)
    setOpenSubmenu(key)
  }
  const leaveSubmenu = () => {
    hoverTimeout.current = setTimeout(() => setOpenSubmenu(null), 150)
  }

  // 메뉴 항목 빌드 — 개념별 그룹 배열을 디바이더로 합침(빈 그룹/연속 디바이더 자동 제거)
  const joinGroups = (groups) => {
    const out = []
    for (const g of groups) {
      if (!g || g.length === 0) continue
      if (out.length) out.push({ id: `__sep${out.length}`, type: 'separator' })
      out.push(...g)
    }
    return out
  }

  const items = hasSelection ? joinGroups([
    // 편집/클립보드
    [
      { id: 'cut', label: '잘라내기', shortcut: 'Ctrl+X', action: 'cut' },
      { id: 'copy', label: '복사', shortcut: 'Ctrl+C', action: 'copy' },
      { id: 'paste', label: '붙여넣기', shortcut: 'Ctrl+V', action: 'paste', disabled: clipboardEmpty },
      { id: 'pasteClip', label: '클립보드 붙여넣기 (이미지/텍스트)', shortcut: 'Ctrl+Alt+V', action: 'pasteClipboard' },
      { id: 'dup', label: '복제', shortcut: 'Ctrl+D', action: 'duplicate' },
    ],
    // 서식
    [
      { id: 'copyStyle', label: '서식 복사', shortcut: 'Ctrl+Shift+C', action: 'copyStyle', disabled: !singleId },
      { id: 'pasteStyle', label: '서식 붙여넣기', shortcut: 'Ctrl+Shift+V', action: 'pasteStyle',
        disabled: !useFlatStore.getState().styleClipboard },
      ...(singleTextEl ? [{ id: 'themeColor', label: '사용자 테마 색 지정', submenu: 'themeColor',
        children: [
          { id: 'asTitle', label: '이 색을 제목색으로', action: 'setThemeTitle' },
          { id: 'asBody', label: '이 색을 본문색으로', action: 'setThemeBody' },
        ],
      }] : []),
    ],
    // 배치
    [
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
      { id: 'group', label: '그룹', shortcut: 'Ctrl+G', action: 'group', disabled: selectedFlatIds.length < 2 },
      { id: 'ungroup', label: '그룹 해제', shortcut: 'Ctrl+Shift+G', action: 'ungroup', disabled: !selectedEls.some(e => e.groupId) },
    ],
    // 변환/상태
    [
      { id: 'lock', label: allLocked ? '잠금 해제' : '잠금', action: 'lock' },
      ...(singleImageEl ? [{ id: 'dlImage', label: '이미지 다운로드', action: 'downloadMedia' }] : []),
      ...(singleVideoEl ? [{ id: 'dlVideo', label: '비디오 다운로드', action: 'downloadMedia' }] : []),
      // 배경으로 변환: 단일 이미지/영상만(이미 배경인 것 제외)
      ...(selectedEls.length === 1 && !isBackgroundElement(selectedEls[0]) && ['image', 'video'].includes(selectedEls[0].type)
        ? [{ id: 'toBg', label: '배경으로 변환', action: 'convertToBg' }] : []),
      // 일반 요소로 복원: 선택이 배경일 때
      ...(selectedEls.length === 1 && isBackgroundElement(selectedEls[0])
        ? [{ id: 'restoreBg', label: '일반 요소로 복원', action: 'restoreFromBg' }] : []),
    ],
    // 삭제
    [
      { id: 'del', label: '삭제', shortcut: 'Delete', action: 'delete' },
    ],
    // 선택
    [
      { id: 'all', label: '전체 선택', shortcut: 'Ctrl+A', action: 'selectAll' },
    ],
  ]) : joinGroups([
    // 붙여넣기
    [
      { id: 'paste', label: '붙여넣기', shortcut: 'Ctrl+V', action: 'paste', disabled: clipboardEmpty },
      { id: 'pasteClip', label: '클립보드 붙여넣기 (이미지/텍스트)', shortcut: 'Ctrl+Alt+V', action: 'pasteClipboard' },
    ],
    // 배경
    [
      ...(bgElement ? [{ id: 'formatBg', label: '배경 서식', action: 'formatBackground' }] : []),
      ...(bgElement ? [{ id: 'bgToTheme', label: '현재 배경을 사용자 테마로', action: 'setThemeBg' }] : []),
    ],
    // 추가
    [
      { id: 'insert', label: '요소 추가', submenu: 'insert',
        children: [
          { id: 'itext', label: '텍스트', action: 'insertText' },
          { id: 'irect', label: '사각형', action: 'insertRect' },
          { id: 'iroundrect', label: '둥근 사각형', action: 'insertRoundRect' },
          { id: 'icircle', label: '원', action: 'insertCircle' },
          { id: 'iline', label: '선', action: 'insertLine' },
          { id: 'isep', type: 'separator' },
          { id: 'iimage', label: '이미지', action: 'insertImage' },
          { id: 'ivideo', label: '영상', action: 'insertVideo' },
        ],
      },
      { id: 'aiInfographic', label: 'AI 인포그래픽 변환', action: 'aiInfographic' },
    ],
    // 선택
    [
      { id: 'all', label: '전체 선택', shortcut: 'Ctrl+A', action: 'selectAll' },
    ],
  ])

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
        zIndex: 10100, // 선택 시 뜨는 플로팅 바(AI 바·인라인툴바, ~10060)보다 위
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
      {/* 이미지 파일 선택용 숨김 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFile}
        style={{ display: 'none' }}
      />
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
      {items.map(item => {
        if (item.type === 'separator') {
          return <div key={item.id} style={{ height: 1, margin: '4px 8px', background: 'rgba(255,255,255,0.1)' }} />
        }
        return (
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
        )
      })}
    </div>
  )
}
