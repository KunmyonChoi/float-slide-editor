import { useRef } from 'react'
import { useEditorStore } from '../store/editorStore'

/**
 * Toolbar — HTML 파일 업로드 및 기본 액션
 */
export default function Toolbar() {
  const fileRef = useRef(null)
  const { loadHtml } = useEditorStore()

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => loadHtml(ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleLoadSample = async () => {
    try {
      const res = await fetch('/sample-slides/simple.html')
      const text = await res.text()
      loadHtml(text)
    } catch {
      // 샘플 파일이 없을 경우 fallback
      loadHtml(FALLBACK_SAMPLE)
    }
  }

  return (
    <header className="h-12 bg-slate-800 flex items-center px-4 gap-3 shrink-0">
      <span className="text-white font-semibold text-sm tracking-wide">float-editor</span>
      <span className="text-slate-500 text-xs">Phase 1</span>
      <div className="flex-1" />
      <button
        onClick={handleLoadSample}
        className="text-xs px-3 py-1.5 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
      >
        샘플 로드
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
      >
        HTML 열기
      </button>
      <input ref={fileRef} type="file" accept=".html,.htm" className="hidden" onChange={handleFileChange} />
    </header>
  )
}

const FALLBACK_SAMPLE = `
<section style="max-width:800px;margin:0 auto;padding:40px;font-family:sans-serif">
  <h1 style="font-size:2rem;color:#1e293b;margin-bottom:16px">float-editor 샘플 슬라이드</h1>
  <p style="color:#475569;line-height:1.6">이 텍스트를 클릭해서 요소를 선택해 보세요. 왼쪽 패널에서 요소 정보를 확인할 수 있습니다.</p>
  <div style="display:flex;gap:24px;margin-top:32px">
    <div style="flex:1;background:#f1f5f9;padding:24px;border-radius:8px">
      <h2 style="font-size:1.2rem;color:#334155;margin:0 0 12px">컬럼 1</h2>
      <p style="color:#64748b;font-size:0.9rem">텍스트 단락입니다.</p>
    </div>
    <div style="flex:1;background:#f0fdf4;padding:24px;border-radius:8px">
      <h2 style="font-size:1.2rem;color:#166534;margin:0 0 12px">컬럼 2</h2>
      <img src="https://placehold.co/300x160/a3e635/365314?text=Sample+Image" alt="샘플 이미지" style="width:100%;border-radius:4px" />
    </div>
  </div>
</section>
`
