import SlideCanvas, { InsertPopup } from './components/SlideCanvas'
import FloatingToolbar from './components/FloatingToolbar'
import FloatingEditorPanel from './components/FloatingEditorPanel'
import FlatCanvas from './components/FlatCanvas'
import ComparePanel from './components/ComparePanel'
import PageBar from './components/PageBar'
import { useFlatStore } from './store/flatStore'

export default function App() {
  const viewMode = useFlatStore(s => s.viewMode)

  const isSplit = viewMode === 'split'
  const showSlide = viewMode === 'html' || isSplit
  const showFlat  = viewMode === 'flat' || isSplit

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className={`flex flex-1 overflow-hidden ${isSplit ? '' : 'flex-col'}`}>
        {/* SlideCanvas는 항상 마운트 유지 — iframe 재로드 방지 */}
        <div
          className={isSplit ? 'flex flex-col flex-1 border-r border-white/10' : 'flex flex-col flex-1'}
          style={showSlide ? undefined : { position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        >
          <SlideCanvas />
        </div>
        {showFlat && (
          <div className="flex flex-col flex-1">
            <FlatCanvas />
          </div>
        )}
      </div>
      <PageBar />
      <FloatingToolbar />
      <FloatingEditorPanel />
      <ComparePanel />
      <InsertPopup />
    </div>
  )
}
