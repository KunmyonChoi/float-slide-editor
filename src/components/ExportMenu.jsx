import { useState, useRef, useEffect, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { exportFlatHtml, exportFlatHtmlAllPages, downloadHtml } from '../core/FlatExporter'
import { openAiSettings } from './AiSettingsModal'
import { openFile } from '../core/FilePicker'
import { confirmDialog } from './ConfirmDialog'

const ACCEPT_FLATPROJ = { 'application/octet-stream': ['.flatproj'] }
const ACCEPT_HTML = { 'text/html': ['.html', '.htm'] }

// 새 프로젝트용 빈 슬라이드 1장 (1280×720 흰 배경)
/**
 * FileMenu — 파일 드롭다운 메뉴 (저장/열기/내보내기/가져오기)
 * FloatingToolbar에 배치
 */
export default function FileMenu({ fallbackSample }) {
  const [open, setOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState(null)
  const hoverTimeout = useRef(null)
  const menuRef = useRef(null)

  const { flatElements, canvasSize, fontImports,
          setViewMode, loadAllPages, clearPageCache, regenerateAllPages, debugMode, setDebugMode } = useFlatStore()
  const { loadHtml, htmlImported } = useEditorStore()

  const hasContent = flatElements.length > 0

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 서브메뉴 hover
  const enterSubmenu = (key) => {
    clearTimeout(hoverTimeout.current)
    setOpenSubmenu(key)
  }
  const leaveSubmenu = () => {
    hoverTimeout.current = setTimeout(() => setOpenSubmenu(null), 150)
  }

  // ── 액션들 ──

  // HTML 열기 — 확장자 필터(.html/.htm)
  const handleOpenHtml = useCallback(async () => {
    setOpen(false)
    const file = await openFile({ description: 'HTML 슬라이드', accept: ACCEPT_HTML, acceptAttr: '.html,.htm' })
    if (!file) return
    const text = await file.text()
    clearPageCache()
    useFlatStore.getState().setProjectFile(null, null) // .flatproj 아님 → 재저장 대상 초기화
    loadHtml(text, { imported: true })
  }, [clearPageCache, loadHtml])

  // 샘플 슬라이드
  const handleLoadSample = useCallback(() => {
    setOpen(false)
    clearPageCache()
    useFlatStore.getState().setProjectFile(null, null)
    loadHtml(fallbackSample, { imported: true })
  }, [clearPageCache, loadHtml, fallbackSample])

  // 새 프로젝트 — 현재 작업을 비우고 빈 슬라이드로 시작
  const handleNewProject = useCallback(async () => {
    setOpen(false)
    if (hasContent) {
      const ok = await confirmDialog({
        title: '새 프로젝트 시작',
        message: '현재 작업 내용이 모두 사라집니다.\n저장하지 않았다면 먼저 저장하세요. 계속할까요?',
        confirmText: '새로 시작',
        cancelText: '취소',
        danger: true,
      })
      if (!ok) return
    }
    // 앱 최초 실행(새로고침)과 동일한 경로로 시작 — 제목 슬라이드 레이아웃 + 슬라이드 목록이
    // 즉시 보이도록 startScratchProject를 직접 호출한다(빈 덱 HTML 추출 트리거에 의존하지 않음).
    clearPageCache()
    useEditorStore.getState().resetDeck()
    useFlatStore.getState().startScratchProject('title')
  }, [hasContent, clearPageCache])

  // 프로젝트 저장 — 기억된 파일이 있으면 같은 파일에 덮어쓰기, 없으면 저장 팝업(Ctrl+S와 동일)
  const handleSaveProject = useCallback(async () => {
    setOpen(false)
    await useFlatStore.getState().saveProject()
  }, [])

  // 다른 이름으로 저장 — 항상 저장 팝업으로 새 파일
  const handleSaveProjectAs = useCallback(async () => {
    setOpen(false)
    await useFlatStore.getState().saveProject({ saveAs: true })
  }, [])

  // 프로젝트 열기 — 확장자 필터(.flatproj). 파일명/핸들을 기억해 재저장에 사용.
  const handleOpenProject = useCallback(async () => {
    setOpen(false)
    const { file, handle } = await openFile({ description: 'Genitor 프로젝트', accept: ACCEPT_FLATPROJ, acceptAttr: '.flatproj', withHandle: true })
    if (!file) return
    const { loadProjectFile } = await import('../core/ProjectSerializer.js')
    try {
      const data = await loadProjectFile(file)
      loadAllPages(data.pages, data.currentPageKey)
      useFlatStore.getState().setCustomTheme(data.customTheme) // 사용자정의 테마 복원
      useFlatStore.getState().setThemeId(data.themeId) // 저장된 테마 선택 복원
      useFlatStore.getState().setProjectFile(handle, file.name) // 같은 파일에 재저장하도록 기억
      // flat 프로젝트는 원본 HTML이 없으므로 'Flat 재생성' 게이트를 닫는다.
      useEditorStore.getState().setHtmlImported(false)
      const { viewMode } = useFlatStore.getState()
      if (viewMode === 'html') setViewMode('flat')
    } catch (err) {
      alert('프로젝트 파일을 열 수 없습니다: ' + err.message)
    }
  }, [loadAllPages, setViewMode])

  // 원본으로 되돌리기 — 처음 가져온 HTML 슬라이드 상태로 전체 페이지를 다시 변환(편집 내용 삭제)
  const handleRevertToOriginal = useCallback(async () => {
    setOpen(false)
    const ok = await confirmDialog({
      title: '원본으로 되돌리기',
      message: '편집한 내용이 사라지고\n처음 가져온 슬라이드로 되돌립니다. 계속할까요?',
      confirmText: '되돌리기',
      cancelText: '취소',
      danger: true,
    })
    if (ok) regenerateAllPages()
  }, [regenerateAllPages])

  // HTML 내보내기 (현재 페이지)
  const handleExportHtml = useCallback(() => {
    setOpen(false)
    const html = exportFlatHtml(flatElements, canvasSize, fontImports)
    downloadHtml(html, 'slide-export.html')
  }, [flatElements, canvasSize, fontImports])

  // HTML 내보내기 (전체 페이지)
  const handleExportHtmlAll = useCallback(async () => {
    setOpen(false)
    const { pages } = await useFlatStore.getState().getAllPagesAsync()
    const html = exportFlatHtmlAllPages(pages)
    downloadHtml(html, 'slide-export-all.html')
  }, [])

  // 이미지 내보내기 (현재 페이지)
  const handleExportImage = useCallback(async () => {
    setOpen(false)
    const canvasNode = useFlatStore.getState()._canvasRef?.current
    if (!canvasNode) { alert('캔버스를 찾을 수 없습니다'); return }
    const { exportAsImage, downloadImage } = await import('../core/ImageExporter.js')
    try {
      const dataUrl = await exportAsImage(canvasNode, { format: 'png', scale: 2 })
      downloadImage(dataUrl, 'slide-export.png')
    } catch (err) {
      alert('이미지 내보내기 실패: ' + err.message)
    }
  }, [])

  // 이미지 내보내기 (전체 페이지)
  const handleExportImageAll = useCallback(async () => {
    setOpen(false)
    // 먼저 전체 페이지 추출 (미방문 페이지 포함)
    await useFlatStore.getState().getAllPagesAsync()
    const canvasNode = useFlatStore.getState()._canvasRef?.current
    if (!canvasNode) { alert('캔버스를 찾을 수 없습니다'); return }
    const { exportAllPagesAsImages, downloadImagesAsZip } = await import('../core/ImageExporter.js')
    try {
      const results = await exportAllPagesAsImages(canvasNode, useFlatStore.getState(), { format: 'png', scale: 2 })
      await downloadImagesAsZip(results, { zipName: 'slide-images.zip', format: 'png' })
    } catch (err) {
      alert('이미지 내보내기 실패: ' + err.message)
    }
  }, [])

  // PDF 내보내기 (현재 페이지) — 브라우저 렌더를 래스터로 굳혀 폰트/플랫폼 무관 동일 표시
  const handleExportPdf = useCallback(async () => {
    setOpen(false)
    const canvasNode = useFlatStore.getState()._canvasRef?.current
    if (!canvasNode) { alert('캔버스를 찾을 수 없습니다'); return }
    const { exportCurrentPageToPdf } = await import('../core/PdfExporter.js')
    try {
      await exportCurrentPageToPdf(canvasNode, useFlatStore.getState(), { scale: 2 })
    } catch (err) {
      alert('PDF 내보내기 실패: ' + err.message)
    }
  }, [])

  // PDF 내보내기 (전체 페이지)
  const handleExportPdfAll = useCallback(async () => {
    setOpen(false)
    await useFlatStore.getState().getAllPagesAsync()
    const canvasNode = useFlatStore.getState()._canvasRef?.current
    if (!canvasNode) { alert('캔버스를 찾을 수 없습니다'); return }
    const { exportToPdf } = await import('../core/PdfExporter.js')
    try {
      await exportToPdf(canvasNode, useFlatStore.getState(), { scale: 2 })
    } catch (err) {
      alert('PDF 내보내기 실패: ' + err.message)
    }
  }, [])

  // PPT 내보내기는 최상단 툴바의 PptExportButton으로 이동됨.

  // JSON 내보내기 (현재 페이지)
  const handleExportJson = useCallback(() => {
    setOpen(false)
    const data = JSON.stringify({
      version: 1,
      elements: flatElements,
      canvasSize,
      fontImports,
    }, null, 2)
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slide-export.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [flatElements, canvasSize, fontImports])

  // JSON 내보내기 (전체 페이지)
  const handleExportJsonAll = useCallback(async () => {
    setOpen(false)
    const { pages, currentPageKey } = await useFlatStore.getState().getAllPagesAsync()
    const data = JSON.stringify({ version: 1, pages, currentPageKey }, null, 2)
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'slide-export-all.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const ITEMS = [
    { id: 'newProject', label: '새 프로젝트', action: handleNewProject },
    { id: 'sepNew', type: 'separator' },
    { id: 'openProject', label: '프로젝트 열기', action: handleOpenProject },
    { id: 'saveProject', label: '프로젝트 저장', shortcut: 'Ctrl+S', action: handleSaveProject, disabled: !hasContent },
    { id: 'saveProjectAs', label: '다른 이름으로 저장', action: handleSaveProjectAs, disabled: !hasContent },
    { id: 'sep1', type: 'separator' },
    { id: 'export', label: '내보내기', submenu: 'export', disabled: !hasContent,
      children: [
        { id: 'exportHtml', label: 'HTML — 현재 페이지', action: handleExportHtml },
        { id: 'exportHtmlAll', label: 'HTML — 전체 페이지', action: handleExportHtmlAll },
        { id: 'sepE1', type: 'separator' },
        { id: 'exportImage', label: '이미지 — 현재 페이지', shortcut: 'PNG', action: handleExportImage },
        { id: 'exportImageAll', label: '이미지 — 전체 페이지', shortcut: 'ZIP', action: handleExportImageAll },
        { id: 'sepPdf', type: 'separator' },
        { id: 'exportPdf', label: 'PDF — 현재 페이지', shortcut: 'PDF', action: handleExportPdf },
        { id: 'exportPdfAll', label: 'PDF — 전체 페이지', shortcut: 'PDF', action: handleExportPdfAll },
        { id: 'sepE2', type: 'separator' },
        { id: 'exportJson', label: 'JSON — 현재 페이지', action: handleExportJson },
        { id: 'exportJsonAll', label: 'JSON — 전체 페이지', action: handleExportJsonAll },
      ],
    },
    { id: 'import', label: '가져오기', submenu: 'import',
      children: [
        { id: 'importHtml', label: 'HTML 슬라이드 가져오기', action: handleOpenHtml },
      ],
    },
    // 외부 HTML을 가져온 경우에만 노출 — 처음 가져온 원본으로 되돌리기
    ...(htmlImported ? [{ id: 'revertOriginal', label: '원본으로 되돌리기', action: handleRevertToOriginal }] : []),
    { id: 'sepAi', type: 'separator' },
    { id: 'aiSettings', label: 'AI 설정', shortcut: 'OpenAI', action: openAiSettings },
    { id: 'sepDebug', type: 'separator' },
    // 샘플 슬라이드는 디버그/데모용 — 디버그 모드일 때만 노출
    ...(debugMode ? [{ id: 'loadSample', label: '샘플 슬라이드', action: handleLoadSample }] : []),
    { id: 'debug', label: '디버그 모드', shortcut: debugMode ? '✓ 켜짐' : '꺼짐',
      action: () => setDebugMode(!debugMode) },
  ]

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="파일"
        className={[
          'flex items-center px-2.5 py-1.5 rounded-lg text-sm transition-colors',
          'text-slate-300 hover:text-white hover:bg-white/10',
        ].join(' ')}
      >
        <FileIcon />
        <span className="text-xs ml-1">파일</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          minWidth: 200,
          background: 'rgba(15,23,42,0.97)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          zIndex: 10000,
          padding: '4px',
          userSelect: 'none',
        }}>
          {ITEMS.map(item => {
            if (item.type === 'separator') {
              return <div key={item.id} style={{
                height: 1, margin: '4px 8px',
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
                    padding: '6px 12px', borderRadius: 6,
                    cursor: item.disabled ? 'default' : 'pointer',
                    color: item.disabled ? 'rgba(255,255,255,0.3)' : '#e2e8f0',
                    fontSize: 13,
                  }} className={item.disabled ? '' : 'file-menu-item'}>
                    <span>{item.label}</span>
                    <span style={{ fontSize: 10, marginLeft: 12 }}>▸</span>
                  </div>
                  {openSubmenu === item.submenu && !item.disabled && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: '100%',
                      marginLeft: 4,
                      minWidth: 160,
                      background: 'rgba(15,23,42,0.97)',
                      backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 10,
                      boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                      padding: '4px',
                    }}>
                      {item.children.map(child => {
                      if (child.type === 'separator') {
                        return <div key={child.id} style={{ height: 1, margin: '4px 8px', background: 'rgba(255,255,255,0.1)' }} />
                      }
                      return (
                        <div
                          key={child.id}
                          onClick={child.action}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                            color: '#e2e8f0', fontSize: 13,
                          }}
                          className="file-menu-item"
                        >
                          <span>{child.label}</span>
                          {child.shortcut && (
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 24 }}>
                              {child.shortcut}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div
                key={item.id}
                onClick={() => !item.disabled && item.action()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 12px', borderRadius: 6,
                  cursor: item.disabled ? 'default' : 'pointer',
                  color: item.disabled ? 'rgba(255,255,255,0.3)' : '#e2e8f0',
                  fontSize: 13,
                }}
                className={item.disabled ? '' : 'file-menu-item'}
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
          <style>{`.file-menu-item:hover { background: rgba(255,255,255,0.1) }`}</style>
        </div>
      )}

    </div>
  )
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}
