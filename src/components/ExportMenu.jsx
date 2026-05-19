import { useState, useRef, useEffect, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { exportFlatHtml, exportFlatHtmlAllPages, downloadHtml } from '../core/FlatExporter'
import { nextFlatId } from '../core/FlatExtractor'

/**
 * FileMenu — 파일 드롭다운 메뉴 (저장/열기/내보내기/가져오기)
 * FloatingToolbar에 배치
 */
export default function FileMenu({ fallbackSample }) {
  const [open, setOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState(null)
  const hoverTimeout = useRef(null)
  const menuRef = useRef(null)
  const fileRef = useRef(null)       // .flatproj
  const htmlFileRef = useRef(null)   // .html
  const jsonFileRef = useRef(null)   // .json

  const { flatElements, canvasSize, fontImports, viewMode,
          setViewMode, loadAllPages, clearPageCache } = useFlatStore()
  const { loadHtml } = useEditorStore()

  const hasContent = flatElements.length > 0

  // Python 백엔드 상태 확인
  const [pythonAvailable, setPythonAvailable] = useState(null) // null=확인중, true/false
  useEffect(() => {
    import('../core/PptxBackendClient.js').then(({ checkBackend }) =>
      checkBackend().then(setPythonAvailable)
    )
  }, [])

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

  // HTML 열기
  const handleOpenHtml = useCallback(() => {
    setOpen(false)
    htmlFileRef.current?.click()
  }, [])

  const handleHtmlFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { clearPageCache(); loadHtml(ev.target.result) }
    reader.readAsText(file)
    e.target.value = ''
  }, [clearPageCache, loadHtml])

  // 샘플 슬라이드
  const handleLoadSample = useCallback(() => {
    setOpen(false)
    clearPageCache()
    loadHtml(fallbackSample)
  }, [clearPageCache, loadHtml, fallbackSample])

  // 프로젝트 저장
  const handleSaveProject = useCallback(async () => {
    setOpen(false)
    const { serializeProject, downloadProject } = await import('../core/ProjectSerializer.js')
    const json = await serializeProject(useFlatStore.getState())
    downloadProject(json, 'project.flatproj')
  }, [])

  // 프로젝트 열기
  const handleOpenProject = useCallback(() => {
    setOpen(false)
    fileRef.current?.click()
  }, [])

  const handleProjectFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const { loadProjectFile } = await import('../core/ProjectSerializer.js')
    try {
      const data = await loadProjectFile(file)
      loadAllPages(data.pages, data.currentPageKey)
      const { viewMode } = useFlatStore.getState()
      if (viewMode === 'html') setViewMode('flat')
    } catch (err) {
      alert('프로젝트 파일을 열 수 없습니다: ' + err.message)
    }
    e.target.value = ''
  }, [loadAllPages, setViewMode])

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
    const { exportAllPagesAsImages, downloadImage } = await import('../core/ImageExporter.js')
    try {
      const results = await exportAllPagesAsImages(canvasNode, useFlatStore.getState(), { format: 'png', scale: 2 })
      for (let i = 0; i < results.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 300))
        downloadImage(results[i].dataUrl, `slide-${i + 1}.png`)
      }
    } catch (err) {
      alert('이미지 내보내기 실패: ' + err.message)
    }
  }, [])

  // PPT 내보내기 (항상 전체 페이지)
  const handleExportPpt = useCallback(async () => {
    setOpen(false)
    try {
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      const { checkBackend, exportViaPython } = await import('../core/PptxBackendClient.js')
      if (await checkBackend()) {
        console.log('%c[PPT Export] python-pptx 엔진 사용', 'color:#22c55e;font-weight:bold')
        await exportViaPython(pages, canvasSize)
      } else {
        console.log('%c[PPT Export] pptxgenjs 엔진 사용 (fallback)', 'color:#f59e0b;font-weight:bold')
        const { exportToPptx } = await import('../core/PptExporter.js')
        await exportToPptx(pages, canvasSize)
      }
    } catch (err) {
      console.error('PPT 내보내기 실패:', err)
      alert('PPT 내보내기 실패: ' + err.message)
    }
  }, [canvasSize])

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

  // JSON 가져오기
  const handleImportJson = useCallback(() => {
    setOpen(false)
    jsonFileRef.current?.click()
  }, [])

  const handleJsonFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.elements || !Array.isArray(data.elements)) {
          throw new Error('유효하지 않은 JSON 형식')
        }
        const elements = data.elements.map(el => ({
          ...el,
          id: nextFlatId(),
          sourceId: null,
        }))
        const cs = data.canvasSize || canvasSize
        const fi = data.fontImports || []
        loadAllPages({
          '0-0': { elements, canvasSize: cs, fontImports: fi },
        }, '0-0')
        const { viewMode } = useFlatStore.getState()
        if (viewMode === 'html') setViewMode('flat')
      } catch (err) {
        alert('JSON 파일을 가져올 수 없습니다: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [canvasSize, loadAllPages, setViewMode])

  const ITEMS = [
    { id: 'saveProject', label: '프로젝트 저장', shortcut: '.flatproj', action: handleSaveProject, disabled: !hasContent },
    { id: 'openProject', label: '프로젝트 열기', action: handleOpenProject },
    { id: 'sep0', type: 'separator' },
    { id: 'openHtml', label: 'HTML 열기', action: handleOpenHtml },
    { id: 'loadSample', label: '샘플 슬라이드', action: handleLoadSample },
    { id: 'sep1', type: 'separator' },
    { id: 'export', label: '내보내기', submenu: 'export', disabled: !hasContent,
      children: [
        { id: 'exportHtml', label: 'HTML — 현재 페이지', action: handleExportHtml },
        { id: 'exportHtmlAll', label: 'HTML — 전체 페이지', action: handleExportHtmlAll },
        { id: 'sepE1', type: 'separator' },
        { id: 'exportImage', label: '이미지 — 현재 페이지', shortcut: 'PNG', action: handleExportImage },
        { id: 'exportImageAll', label: '이미지 — 전체 페이지', shortcut: 'PNG', action: handleExportImageAll },
        { id: 'sepE2', type: 'separator' },
        { id: 'exportPpt',
          label: pythonAvailable ? 'PPT (전체 페이지)' : 'PPT (전체 페이지)',
          shortcut: pythonAvailable ? 'python-pptx' : pythonAvailable === false ? 'pptxgenjs' : '...',
          action: handleExportPpt },
        { id: 'sepE3', type: 'separator' },
        { id: 'exportJson', label: 'JSON — 현재 페이지', action: handleExportJson },
        { id: 'exportJsonAll', label: 'JSON — 전체 페이지', action: handleExportJsonAll },
      ],
    },
    { id: 'import', label: '가져오기', submenu: 'import',
      children: [
        { id: 'importJson', label: 'JSON', action: handleImportJson },
      ],
    },
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

      <input ref={fileRef} type="file" accept=".flatproj" style={{ display: 'none' }} onChange={handleProjectFile} />
      <input ref={htmlFileRef} type="file" accept=".html,.htm" style={{ display: 'none' }} onChange={handleHtmlFile} />
      <input ref={jsonFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleJsonFile} />
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
