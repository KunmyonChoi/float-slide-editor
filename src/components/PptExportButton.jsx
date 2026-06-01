import { useCallback, useEffect, useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { ToolBtn } from './FloatingToolbar'

/**
 * PptExportButton — 최상단 툴바의 PPT 내보내기 버튼.
 * python-pptx 백엔드가 가용하면 그쪽으로, 아니면 pptxgenjs 폴백.
 * (이전에는 파일 > 내보내기 > PPT 서브메뉴에 있었음)
 */
export default function PptExportButton() {
  const canvasSize = useFlatStore(s => s.canvasSize)
  const hasContent = useFlatStore(s => s.flatElements.length > 0)
  const [pythonAvailable, setPythonAvailable] = useState(null) // null=확인중
  const [busy, setBusy] = useState(false)

  // 백엔드 가용성 1회 확인
  useEffect(() => {
    import('../core/PptxBackendClient.js').then(({ checkBackend }) =>
      checkBackend().then(setPythonAvailable)
    )
  }, [])

  const handleExport = useCallback(async () => {
    if (busy) return
    setBusy(true)
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
    } finally {
      setBusy(false)
    }
  }, [busy, canvasSize])

  const engine =
    pythonAvailable === true ? 'python-pptx' :
    pythonAvailable === false ? 'pptxgenjs (fallback)' :
    '엔진 확인 중'

  return (
    <ToolBtn
      onClick={handleExport}
      disabled={!hasContent || busy}
      title={`PPT (전체 페이지) 내보내기 — ${engine}`}
    >
      <PptIcon />
      <span className="text-xs ml-1">{busy ? 'PPT…' : 'PPT'}</span>
    </ToolBtn>
  )
}

function PptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 13h3a2 2 0 1 1 0 4H9v-4zM9 17v2" />
    </svg>
  )
}
