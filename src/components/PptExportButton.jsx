import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { ToolBtn } from './FloatingToolbar'
import {
  checkBackend, exportViaPython, dockerRunCommand,
  getBackendBase, setBackendBase, PPTX_DOCKER_IMAGE, getBackendBuild,
} from '../core/PptxBackendClient'
import { APP_VERSION } from '../appVersion'
import { promptUrl } from './UrlPrompt'

const EMBED_PREF_KEY = 'ppt-embed-fonts'

// 사용자 입력 파일명 → 안전한 .pptx 파일명 (경로문자 제거, 확장자 보정)
function normalizePptxName(raw) {
  let n = (raw || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.pptx$/i, '').trim()
  if (!n) n = 'slide-export'
  return `${n}.pptx`
}

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
 * 내보내는 동안 진행 오버레이(스피너·단계·경과 시간)를 표시.
 */
export default function PptExportButton() {
  const canvasSize = useFlatStore(s => s.canvasSize)
  const hasContent = useFlatStore(s => s.flatElements.length > 0)
  const [pythonAvailable, setPythonAvailable] = useState(null) // null=확인중
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [embedFonts, setEmbedFonts] = useState(loadEmbedPref)
  const [stage, setStage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const wrapRef = useRef(null)
  const timerRef = useRef(null)

  const [backendUrl, setBackendUrl] = useState(() => getBackendBase())

  // 백엔드 가용성 1회 확인
  useEffect(() => {
    checkBackend().then(setPythonAvailable)
  }, [])

  // 백엔드 URL 적용 + 재확인
  const applyBackendUrl = useCallback((url) => {
    setBackendBase(url)
    setBackendUrl(getBackendBase())
    setPythonAvailable(null)
    checkBackend(true).then(setPythonAvailable)
  }, [])

  // 언마운트 시 타이머 정리
  useEffect(() => () => clearInterval(timerRef.current), [])

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
    // 파일명 입력 — 기본값은 저장/HTML/프로젝트 공통 base name(없으면 slide-export)
    const base = useFlatStore.getState().getExportBaseName() || 'slide-export'
    const picked = await promptUrl({ title: 'PPT 파일 이름', placeholder: '파일 이름', initialValue: base })
    if (picked == null) return // 취소
    const filename = normalizePptxName(picked)
    setBusy(true)
    setElapsed(0)
    setStage('페이지 수집 중…')
    const start = Date.now()
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    try {
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      if (await checkBackend(true)) {
        setStage(embed ? '서버에서 생성 중… (폰트 임베딩 포함)' : '서버에서 생성 중…')
        console.log(
          `%c[PPT Export] python-pptx 엔진 사용 — 폰트 임베딩 ${embed ? 'ON' : 'OFF'}`,
          'color:#22c55e;font-weight:bold'
        )
        await exportViaPython(pages, canvasSize, { embedFonts: embed, editorVersion: APP_VERSION, filename })
      } else {
        setStage('브라우저에서 생성 중… (pptxgenjs)')
        console.log('%c[PPT Export] pptxgenjs 엔진 사용 (fallback)', 'color:#f59e0b;font-weight:bold')
        const { exportToPptx } = await import('../core/PptExporter.js')
        await exportToPptx(pages, canvasSize, { editorVersion: APP_VERSION, filename })
      }
    } catch (err) {
      console.error('PPT 내보내기 실패:', err)
      alert('PPT 내보내기 실패: ' + err.message)
    } finally {
      clearInterval(timerRef.current)
      setBusy(false)
      setStage('')
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
        <span className="text-xs ml-1 tb-label">{busy ? 'PPT…' : 'PPT'}</span>
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
          left: 0, // 버튼이 툴바 왼쪽에 있으므로 오른쪽으로 펼침(화면 밖 방지)
          marginTop: 4,
          width: 320,
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
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
          <div style={{ height: 1, margin: '4px 8px', background: 'rgba(255,255,255,0.1)' }} />
          <BackendSection
            pythonAvailable={pythonAvailable}
            backendUrl={backendUrl}
            onApplyUrl={applyBackendUrl}
            onRecheck={() => { setPythonAvailable(null); checkBackend(true).then(setPythonAvailable) }}
          />
          <style>{`.ppt-embed-item:hover { background: rgba(255,255,255,0.1) }`}</style>
        </div>
      )}

      {busy && createPortal(<ExportOverlay stage={stage} elapsed={elapsed} />, document.body)}
    </div>
  )
}

function ExportOverlay({ stage, elapsed }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(2,6,23,0.55)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'rgba(15,23,42,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14,
        padding: '24px 28px',
        minWidth: 300,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        textAlign: 'center',
        color: '#e2e8f0',
      }}>
        <div style={{
          width: 36, height: 36, margin: '0 auto',
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: '#22c55e',
          borderRadius: '50%',
          animation: 'ppt-spin 0.8s linear infinite',
        }} />
        <div style={{ marginTop: 16, fontSize: 14, fontWeight: 600 }}>PPT 내보내는 중…</div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.6)', minHeight: 16 }}>{stage}</div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
          {elapsed}s 경과
        </div>
        <div style={{
          marginTop: 14, height: 4, borderRadius: 2, overflow: 'hidden',
          background: 'rgba(255,255,255,0.1)', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
            background: 'linear-gradient(90deg, transparent, #22c55e, transparent)',
            animation: 'ppt-slide 1.2s ease-in-out infinite',
          }} />
        </div>
        <style>{`
          @keyframes ppt-spin { to { transform: rotate(360deg) } }
          @keyframes ppt-slide { 0% { left: -40% } 100% { left: 100% } }
        `}</style>
      </div>
    </div>
  )
}

function BackendSection({ pythonAvailable, backendUrl, onApplyUrl, onRecheck }) {
  const [draft, setDraft] = useState(backendUrl)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setDraft(backendUrl) }, [backendUrl])

  const status = pythonAvailable === true
    ? { dot: '#22c55e', text: 'python 변환 서버 연결됨' }
    : pythonAvailable === false
      ? { dot: '#f59e0b', text: '미연결 — pptxgenjs 폴백(임베딩 미지원)' }
      : { dot: '#94a3b8', text: '연결 확인 중…' }

  const cmd = dockerRunCommand()
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <div style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.dot, flex: '0 0 auto' }} />
        <span>{status.text}</span>
        <button onClick={onRecheck} title="다시 확인" style={iconBtnStyle}>↻</button>
      </div>
      {pythonAvailable === true && getBackendBuild() && (
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>
          서버 빌드: <code style={{ fontSize: 10.5 }}>{getBackendBuild()}</code>
        </div>
      )}

      {/* 연결돼 있어도 항상 노출 — 최신 이미지로 덮어쓰기(재다운로드/교체)할 수 있게 */}
      {(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
            {pythonAvailable === true ? '변환 서버 최신으로 업데이트 (Docker):' : '고품질 변환 서버 실행 (Docker):'}
          </div>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
            <code style={{
              flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'ui-monospace, monospace',
              background: 'rgba(0,0,0,0.35)', color: '#e2e8f0', borderRadius: 5,
              padding: '5px 7px', whiteSpace: 'nowrap', overflowX: 'auto',
            }}>{cmd}</code>
            <button onClick={copy} title="복사" style={{ ...iconBtnStyle, padding: '0 8px' }}>
              {copied ? '✓' : '복사'}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)' }}>
            이미지 <code style={{ fontSize: 10.5 }}>{PPTX_DOCKER_IMAGE}</code> · 실행 후 ↻로 재확인
          </div>
        </div>
      )}

      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>백엔드 URL</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onApplyUrl(draft) }}
          placeholder={`http://localhost:8321`}
          spellCheck={false}
          style={{
            flex: 1, fontSize: 11, fontFamily: 'ui-monospace, monospace',
            background: 'rgba(0,0,0,0.35)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, padding: '5px 7px',
          }}
        />
        <button onClick={() => onApplyUrl(draft)} title="적용" style={{ ...iconBtnStyle, padding: '0 8px' }}>적용</button>
      </div>
    </div>
  )
}

const iconBtnStyle = {
  background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', border: 'none',
  borderRadius: 5, cursor: 'pointer', fontSize: 11, lineHeight: '22px', minWidth: 22,
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
