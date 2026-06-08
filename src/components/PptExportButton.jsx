import { useCallback, useEffect, useRef, useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { ToolBtn } from './FloatingToolbar'

const EMBED_PREF_KEY = 'ppt-embed-fonts'

function loadEmbedPref() {
  try {
    const v = localStorage.getItem(EMBED_PREF_KEY)
    return v === null ? true : v === 'true'
  } catch {
    return true
  }
}

/**
 * PptExportButton — 최상단 툴바의 PPT 내보내기 버튼 + 폰트 임베딩 옵션(▾).
 * python-pptx 백엔드가 가용하면 그쪽으로, 아니면 pptxgenjs 폴백.
 * 임베딩 ON: 외부 전달 안전(파일 큼) / OFF: 가벼움(시스템 폰트 의존).
 * (pptxgenjs 폴백은 폰트 임베딩 자체를 안 하므로 이 옵션은 python 경로에만 의미)
 */
export default function PptExportButton() {
  const canvasSize = useFlatStore(s => s.canvasSize)
  const hasContent = useFlatStore(s => s.flatElements.length > 0)
  const [pythonAvailable, setPythonAvailable] = useState(null) // null=확인중
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [embedFonts, setEmbedFonts] = useState(loadEmbedPref)
  const wrapRef = useRef(null)

  // 백엔드 가용성 1회 확인
  useEffect(() => {
    import('../core/PptxBackendClient.js').then(({ checkBackend }) =>
      checkBackend().then(setPythonAvailable)
    )
  }, [])

  // 메뉴 외부 클릭/ESC 닫기
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const setPref = useCallback((val) => {
    setEmbedFonts(val)
    try { localStorage.setItem(EMBED_PREF_KEY, String(val)) } catch { /* ignore */ }
  }, [])

  const runExport = useCallback(async (embed) => {
    if (busy) return
    setBusy(true)
    try {
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      const { checkBackend, exportViaPython } = await import('../core/PptxBackendClient.js')
      if (await checkBackend()) {
        console.log(
          `%c[PPT Export] python-pptx 엔진 사용 — 폰트 임베딩 ${embed ? 'ON' : 'OFF'}`,
          'color:#22c55e;font-weight:bold'
        )
        await exportViaPython(pages, canvasSize, { embedFonts: embed })
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

  // 메뉴 항목: 선택 시 기본값으로 기억 + 즉시 내보내기
  const pickAndExport = useCallback((embed) => {
    setMenuOpen(false)
    setPref(embed)
    runExport(embed)
  }, [setPref, runExport])

  const engine =
    pythonAvailable === true ? 'python-pptx' :
    pythonAvailable === false ? 'pptxgenjs (fallback)' :
    '엔진 확인 중'

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <ToolBtn
        onClick={() => runExport(embedFonts)}
        disabled={!hasContent || busy}
        title={`PPT (전체 페이지) 내보내기 — ${engine} · 폰트 임베딩 ${embedFonts ? 'ON' : 'OFF'}`}
      >
        <PptIcon />
        <span className="text-xs ml-1">{busy ? 'PPT…' : 'PPT'}</span>
      </ToolBtn>

      <button
        onClick={() => setMenuOpen(v => !v)}
        disabled={!hasContent || busy}
        title="폰트 임베딩 옵션"
        className={[
          'flex items-center px-1 py-1.5 rounded-lg transition-colors',
          'text-slate-300 hover:text-white hover:bg-white/10',
          (!hasContent || busy) ? 'opacity-40 cursor-default' : '',
        ].join(' ')}
        style={{ marginLeft: -2 }}
      >
        <CaretIcon />
      </button>

      {menuOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 4,
          minWidth: 230,
          background: 'rgba(15,23,42,0.97)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          zIndex: 10000,
          padding: 4,
          userSelect: 'none',
        }}>
          <MenuItem
            checked={embedFonts}
            label="임베딩 포함하여 내보내기"
            hint="외부 전달용 · 파일 큼"
            onClick={() => pickAndExport(true)}
          />
          <MenuItem
            checked={!embedFonts}
            label="임베딩 없이 내보내기"
            hint="가벼움 · 시스템 폰트 사용"
            onClick={() => pickAndExport(false)}
          />
          {pythonAvailable === false && (
            <div style={{ padding: '6px 12px', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              현재 pptxgenjs 폴백 — 임베딩 미지원
            </div>
          )}
          <style>{`.ppt-embed-item:hover { background: rgba(255,255,255,0.1) }`}</style>
        </div>
      )}
    </div>
  )
}

function MenuItem({ checked, label, hint, onClick }) {
  return (
    <div
      onClick={onClick}
      className="ppt-embed-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 6, cursor: 'pointer', color: '#e2e8f0',
      }}
    >
      <span style={{ width: 14, fontSize: 12, color: '#22c55e' }}>{checked ? '✓' : ''}</span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{hint}</span>
      </span>
    </div>
  )
}

function CaretIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="6 9 12 15 18 9" />
    </svg>
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
