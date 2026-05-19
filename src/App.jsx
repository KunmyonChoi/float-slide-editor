import SlideCanvas, { InsertPopup } from './components/SlideCanvas'
import FloatingToolbar from './components/FloatingToolbar'
import EditToolbar from './components/EditToolbar'
import PropertyPanel from './components/PropertyPanel'
import FlatCanvas from './components/FlatCanvas'
import FlatPresenter from './components/FlatPresenter'
import ComparePanel from './components/ComparePanel'
import PageBar from './components/PageBar'
import { useFlatStore } from './store/flatStore'
import { useEditorStore } from './store/editorStore'

export default function App() {
  const viewMode = useFlatStore(s => s.viewMode)
  const mode = useEditorStore(s => s.mode)

  const isSplit = viewMode === 'split'
  const showSlide = viewMode === 'html' || isSplit
  const showFlat  = viewMode === 'flat' || isSplit

  // flat/split 모드에서 발표 → FlatPresenter 사용
  const useFlatPresenter = mode === 'present' && (viewMode === 'flat' || viewMode === 'split')

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <FloatingToolbar />
      <EditToolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* SlideCanvas는 항상 마운트 유지 — iframe 재로드 방지 */}
        {/* 숨길 때도 원래 크기 유지 (flat 추출 시 정확한 레이아웃 필요) */}
        <div
          className={isSplit ? 'flex flex-col flex-1 border-r border-white/10' : 'flex flex-col flex-1'}
          style={showSlide ? undefined : { position: 'fixed', left: -9999, top: 0, width: '100vw', height: '100vh', overflow: 'hidden', pointerEvents: 'none' }}
        >
          <SlideCanvas />
        </div>
        {showFlat && (
          <div className="flex flex-col flex-1 min-w-0">
            <FlatCanvas />
          </div>
        )}
        {/* 통합 PropertyPanel — 도킹 시 flex row 마지막, 플로팅 시 fixed */}
        <PropertyPanel />
      </div>
      <PageBar />
      <ComparePanel />
      <InsertPopup />
      {/* flat 모드 발표 — fixed 전체화면 오버레이 */}
      {useFlatPresenter && <FlatPresenter />}
    </div>
  )
}
