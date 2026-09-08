import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useFlatStore } from '../store/flatStore'
import {
  checkBackend, exportViaPython, dockerRunCommand,
  getBackendBase, setBackendBase, PPTX_DOCKER_IMAGE, getBackendBuild,
} from '../core/PptxBackendClient'
import { APP_VERSION } from '../appVersion'
import { promptUrl } from './UrlPrompt'

const EMBED_PREF_KEY = 'ppt-embed-fonts'
const NARRATION_PREF_KEY = 'ppt-embed-narration'

// 사용자 입력 파일명 → 안전한 .pptx 파일명 (경로문자 제거, 확장자 보정)
function normalizePptxName(raw) {
  let n = (raw || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.pptx$/i, '').trim()
  if (!n) n = 'slide-export'
  return `${n}.pptx`
}

/** 나레이션 음성 포함 여부 — 기본 켬(파일은 커지지만 발표 그대로 넘어간다). */
function loadNarrationPref() {
  try {
    return localStorage.getItem(NARRATION_PREF_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveNarrationPref(val) {
  try { localStorage.setItem(NARRATION_PREF_KEY, String(val)) } catch { /* ignore */ }
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
 * PPT 내보내기 — 파일 ▸ 내보내기 메뉴에서 호출하는 명령형 API + 화면 조각.
 *
 * 앱 어딘가에 <PptExportHost />를 한 번 마운트하고, 어디서든
 *   runPptExport()    — 저장된 임베딩 설정으로 전체 페이지를 내보낸다(진행 오버레이 포함)
 *   openPptSettings() — 임베딩 옵션 + 변환 서버 설정 모달을 연다
 * 를 부른다. (예전에는 툴바 상단의 버튼 + ▾ 드롭다운이었다. 내보내기는 파일 메뉴로
 * 모으고, 입력창이 있는 서버 설정은 드롭다운보다 모달이 맞는 자리라 갈라놓았다.)
 *
 * python-pptx 백엔드가 가용하면 그쪽으로, 아니면 pptxgenjs 폴백.
 * 임베딩 ON: 외부 전달 안전(파일 큼) / OFF: 가벼움(시스템 폰트 의존).
 * (pptxgenjs 폴백은 폰트 임베딩 자체를 안 하므로 이 옵션은 python 경로에만 의미)
 */

const usePptStore = create(() => ({
  busy: false, stage: '', elapsed: 0, settingsOpen: false,
}))

export function openPptSettings() { usePptStore.setState({ settingsOpen: true }) }
function closePptSettings() { usePptStore.setState({ settingsOpen: false }) }

function savePref(val) {
  try { localStorage.setItem(EMBED_PREF_KEY, String(val)) } catch { /* ignore */ }
}

let timer = null

/**
 * 전체 페이지를 PPTX로 내보낸다. embed 생략 시 저장된 임베딩 설정을 따른다.
 * 이미 진행 중이면 무시. 파일명은 사용자에게 묻고, 취소하면 아무 일도 하지 않는다.
 */
export async function runPptExport(embed) {
  if (usePptStore.getState().busy) return
  const useEmbed = embed === undefined ? loadEmbedPref() : embed
  if (embed !== undefined) savePref(embed)

  // 파일명 입력 — 기본값은 저장/HTML/프로젝트 공통 base name(없으면 slide-export)
  const base = useFlatStore.getState().getExportBaseName() || 'slide-export'
  const picked = await promptUrl({ title: 'PPT 파일 이름', placeholder: '파일 이름', initialValue: base })
  if (picked == null) return // 취소
  const filename = normalizePptxName(picked)

  usePptStore.setState({ busy: true, elapsed: 0, stage: '페이지 수집 중…' })
  const start = Date.now()
  clearInterval(timer)
  timer = setInterval(() => usePptStore.setState({ elapsed: Math.floor((Date.now() - start) / 1000) }), 250)
  try {
    const canvasSize = useFlatStore.getState().canvasSize
    const { pages } = await useFlatStore.getState().getAllPagesAsync()
    if (await checkBackend(true)) {
      usePptStore.setState({ stage: useEmbed ? '서버에서 생성 중… (폰트 임베딩 포함)' : '서버에서 생성 중…' })
      console.log(
        `%c[PPT Export] python-pptx 엔진 사용 — 폰트 임베딩 ${useEmbed ? 'ON' : 'OFF'}`,
        'color:#22c55e;font-weight:bold'
      )
      await exportViaPython(pages, canvasSize, {
        embedFonts: useEmbed, editorVersion: APP_VERSION, filename, embedNarration: loadNarrationPref(),
      })
    } else {
      usePptStore.setState({ stage: '브라우저에서 생성 중… (pptxgenjs)' })
      console.log('%c[PPT Export] pptxgenjs 엔진 사용 (fallback)', 'color:#f59e0b;font-weight:bold')
      const { exportToPptx } = await import('../core/PptExporter.js')
      await exportToPptx(pages, canvasSize, {
        editorVersion: APP_VERSION, filename, embedNarration: loadNarrationPref(),
      })
    }
  } catch (err) {
    console.error('PPT 내보내기 실패:', err)
    alert('PPT 내보내기 실패: ' + err.message)
  } finally {
    clearInterval(timer)
    usePptStore.setState({ busy: false, stage: '' })
  }
}

/** 진행 오버레이 + 설정 모달을 담는 호스트. 앱에 한 번만 마운트한다. */
export function PptExportHost() {
  const { busy, stage, elapsed, settingsOpen } = usePptStore()
  return (
    <>
      {busy && <ExportOverlay stage={stage} elapsed={elapsed} />}
      {settingsOpen && <PptSettingsModal onClose={closePptSettings} />}
    </>
  )
}

/** 임베딩 기본값 + 변환 서버(연결 상태·Docker 명령·백엔드 URL) 설정. */
function PptSettingsModal({ onClose }) {
  const [pythonAvailable, setPythonAvailable] = useState(null) // null=확인중
  const [embedFonts, setEmbedFonts] = useState(loadEmbedPref)
  const [narration, setNarration] = useState(loadNarrationPref)
  const [backendUrl, setBackendUrl] = useState(() => getBackendBase())

  useEffect(() => { checkBackend().then(setPythonAvailable) }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const applyBackendUrl = useCallback((url) => {
    setBackendBase(url)
    setBackendUrl(getBackendBase())
    setPythonAvailable(null)
    checkBackend(true).then(setPythonAvailable)
  }, [])

  const pick = (val) => { setEmbedFonts(val); savePref(val) }
  const pickNarration = (val) => { setNarration(val); saveNarrationPref(val) }

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12, color: '#e2e8f0',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>PPT 변환 서버 설정</div>

        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '0 12px 4px' }}>
            폰트 임베딩 — 내보낼 때 기본값
          </div>
          <MenuItem
            checked={embedFonts}
            label="임베딩 포함"
            hint="외부 전달용 · 파일 큼"
            onClick={() => pick(true)}
          />
          <MenuItem
            checked={!embedFonts}
            label="임베딩 없이"
            hint="가벼움 · 시스템 폰트 사용"
            onClick={() => pick(false)}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '0 12px 4px' }}>
            나레이션 음성
          </div>
          <MenuItem
            checked={narration}
            label="슬라이드에 넣기"
            hint="장이 뜨면 자동 재생 · 파일이 커진다"
            onClick={() => pickNarration(true)}
          />
          <MenuItem
            checked={!narration}
            label="넣지 않기"
            hint="화면·노트만 · 파일이 가볍다"
            onClick={() => pickNarration(false)}
          />
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />

        <BackendSection
          pythonAvailable={pythonAvailable}
          backendUrl={backendUrl}
          onApplyUrl={applyBackendUrl}
          onRecheck={() => { setPythonAvailable(null); checkBackend(true).then(setPythonAvailable) }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'rgba(99,102,241,0.9)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
          }}>닫기</button>
        </div>
        <style>{`.ppt-embed-item:hover { background: rgba(255,255,255,0.1) }`}</style>
      </div>
    </div>,
    document.body,
  )
}

function ExportOverlay({ stage, elapsed }) {
  return createPortal(
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
    </div>,
    document.body,
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
