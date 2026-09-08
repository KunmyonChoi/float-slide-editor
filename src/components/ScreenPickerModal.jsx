import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEditorStore } from '../store/editorStore'
import {
  listScreens, permissionState, screensSupported,
  pickAudienceScreen, rememberPlacement, PLACEMENT,
} from '../core/screenPlacement'

/**
 * ScreenPickerModal — 발표 시작 전 청중 화면을 고르는 다이얼로그.
 *
 * 환경에 따라 세 얼굴을 갖는다.
 *  A. 화면 여럿 + 배치 권한 있음 → 배치도에서 청중 화면을 고른다
 *  B. 화면 여럿 + 권한 없음/미지원 → 일반 창으로 열고 사용자가 옮긴다(권한 요청 안내)
 *  C. 화면 하나 → 리허설로 갈지, 발표자 보기 없이 슬라이드만 띄울지
 *
 * "발표 시작"을 누르는 클릭이 곧 사용자 제스처가 되므로 청중 창이 팝업 차단에 걸릴
 * 확률도 낮아진다 — 화면 목록을 조회하느라 소모된 활성화를 새로 얻은 채로 창을 연다.
 */
export default function ScreenPickerModal() {
  const picker = useEditorStore(s => s.screenPicker)
  const close = useEditorStore(s => s.closeScreenPicker)

  const [env, setEnv] = useState(null)     // listScreens() 결과
  const [perm, setPerm] = useState('prompt')
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [remember, setRemember] = useState(true)
  const [asking, setAsking] = useState(false)

  const supported = screensSupported()

  // 환경 조사는 값만 돌려주고 상태 반영은 호출부가 한다 — 이펙트 안에서 곧바로 setState를
  // 부르지 않도록(그리고 조사 도중 다이얼로그가 닫히면 버릴 수 있도록).
  const readEnv = useCallback(async (force) => {
    const state = await permissionState()
    const empty = { supported, denied: false, screens: [], currentIndex: -1 }
    if (!supported) return { perm: state, env: { ...empty, supported: false }, suggested: null }
    // 권한이 없을 때 조회하면 프롬프트가 뜬다 — 사용자가 버튼을 눌렀을 때(force)만 부른다.
    if (state !== 'granted' && !force) return { perm: state, env: empty, suggested: null }
    const next = await listScreens()
    return {
      perm: next.denied ? state : 'granted',
      env: next,
      suggested: pickAudienceScreen(next.screens, next.currentIndex),
    }
  }, [supported])

  const apply = useCallback((r) => {
    setPerm(r.perm)
    setEnv(r.env)
    setSelectedIndex(r.suggested ? r.suggested.index : null)
  }, [])

  useEffect(() => {
    if (!picker) return
    let cancelled = false
    ;(async () => {
      const r = await readEnv(false)
      if (!cancelled) apply(r)
    })()
    return () => { cancelled = true }
  }, [picker, readEnv, apply])

  // 다이얼로그가 열려 있는 동안 Esc는 발표가 아니라 다이얼로그를 닫는다
  useEffect(() => {
    if (!picker) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [picker, close])

  const screens = useMemo(() => env?.screens || [], [env])
  const others = useMemo(
    () => screens.filter(s => s.index !== env?.currentIndex),
    [screens, env?.currentIndex])

  // 화면이 하나인지 — 권한 없이도 screen.isExtended로 알 수 있다(Chrome).
  const isExtended = typeof window !== 'undefined' ? window.screen?.isExtended : undefined
  const singleScreen = env
    ? (screens.length > 0 ? others.length === 0 : isExtended === false)
    : false

  const start = useCallback((placement) => {
    if (remember) rememberPlacement(placement)
    useEditorStore.getState().beginPresentation({ startIndex: picker?.startIndex || 0, placement })
  }, [remember, picker])

  const requestPermission = useCallback(async () => {
    setAsking(true)
    apply(await readEnv(true))   // getScreenDetails() — 여기서 브라우저 권한 프롬프트가 뜬다
    setAsking(false)
  }, [readEnv, apply])

  if (!picker) return null

  const selected = screens.find(s => s.index === selectedIndex) || null

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, maxHeight: '100%', overflowY: 'auto',
          borderRadius: 12, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', color: '#e2e8f0',
          display: 'flex', flexDirection: 'column',
        }}
        className="thin-scrollbar"
      >
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <PresenterIcon />
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {singleScreen ? '연결된 화면이 하나입니다' : '청중 화면 선택'}
          </span>
          <div style={{ flexGrow: 1 }} />
          {!env && <span style={{ fontSize: 11, color: '#67738a' }}>화면 확인 중…</span>}
          {env && !singleScreen && screens.length > 0 && (
            <span style={{ fontSize: 11, color: '#67738a' }}>화면 {screens.length}개 감지됨</span>
          )}
        </div>

        {env && (singleScreen ? (
          <SingleScreenBody onStart={start} />
        ) : screens.length > 0 ? (
          <ScreenChoiceBody
            screens={screens}
            currentIndex={env.currentIndex}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        ) : (
          <ManualBody supported={supported} perm={perm} asking={asking} onRequest={requestPermission} />
        ))}

        {/* 기억하기 */}
        {env && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '0 20px 14px',
            fontSize: 12, color: '#94a3b8', cursor: 'pointer',
          }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              style={{ accentColor: '#6366f1', margin: 0 }} />
            이 배치를 기억하고 다음부터는 묻지 않기
          </label>
        )}

        {/* 액션 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 16px' }}>
          <span style={{ fontSize: 11, color: '#67738a' }}>
            발표 옵션에서 언제든 다시 고를 수 있습니다
          </span>
          <div style={{ flexGrow: 1 }} />
          <button type="button" onClick={close} style={ghostBtn}>취소</button>
          {env && !singleScreen && (
            screens.length > 0 ? (
              <button type="button" disabled={!selected}
                onClick={() => start({ mode: PLACEMENT.screen, screen: selected })}
                style={{ ...primaryBtn, opacity: selected ? 1 : 0.4, cursor: selected ? 'pointer' : 'not-allowed' }}>
                발표 시작
              </button>
            ) : (
              <button type="button" onClick={() => start({ mode: PLACEMENT.manual })} style={primaryBtn}>
                청중 창 열기
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ── 상태 A: 화면 고르기 ─────────────────────────────────

function ScreenChoiceBody({ screens, currentIndex, selectedIndex, onSelect }) {
  // 배치도는 실제 화면 폭에 비례해 그린다 — 어느 게 프로젝터인지 크기로도 알아보게.
  const maxW = Math.max(...screens.map(s => s.width || 1))
  const ordered = [...screens].sort((a, b) => (a.left ?? 0) - (b.left ?? 0))

  return (
    <div style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>
        슬라이드를 띄울 화면을 고르세요. 나머지 화면에 발표자 보기가 열립니다.
      </span>

      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap',
        gap: 26, padding: '22px 12px', borderRadius: 10,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        {ordered.map(s => {
          const isCurrent = s.index === currentIndex
          const isSelected = s.index === selectedIndex
          const w = Math.round(120 + 120 * ((s.width || 1) / maxW))
          const h = Math.round(w * ((s.height || 9) / (s.width || 16)))
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => { if (!isCurrent) onSelect(s.index) }}
              title={isCurrent ? '발표자가 보고 있는 화면입니다' : `${s.label} 을(를) 청중 화면으로`}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
                background: 'transparent', border: 'none', padding: 0,
                cursor: isCurrent ? 'default' : 'pointer',
              }}
            >
              <div style={{
                width: w, height: h, borderRadius: 6, position: 'relative', overflow: 'hidden',
                background: isCurrent ? '#0f172a' : '#ffffff',
                border: '1px solid rgba(255,255,255,0.14)',
                outline: isSelected ? '2px solid #6366f1' : 'none', outlineOffset: 2,
                opacity: isCurrent ? 0.8 : 1,
              }}>
                {isCurrent ? <PresenterMiniature /> : <SlideMiniature />}
                <span style={{
                  position: 'absolute', top: 6, [isCurrent ? 'left' : 'right']: 6,
                  fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                  background: isSelected ? '#6366f1' : 'rgba(15,23,42,0.85)',
                  color: isSelected ? '#ffffff' : '#a5b4fc',
                }}>
                  {isCurrent ? '발표자 보기' : isSelected ? '청중' : '선택'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <span style={{
                  fontSize: 12, color: isSelected ? '#e2e8f0' : '#cbd5e1',
                  fontWeight: isSelected ? 500 : 400, maxWidth: w + 40,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.label}</span>
                <span style={{ fontSize: 10, color: '#67738a' }}>
                  {s.width} × {s.height}{isCurrent ? ' · 현재 창' : s.isInternal ? ' · 내장' : ''}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <Note tone="ok">
        화면 배치 권한 허용됨 — 청중 창이 선택한 화면에 바로 전체화면으로 열립니다.
      </Note>
    </div>
  )
}

// ── 상태 B: 권한 없음 · 수동 배치 ────────────────────────

function ManualBody({ supported, perm, asking, onRequest }) {
  return (
    <div style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <WarnIcon />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>브라우저가 화면 위치를 알려주지 않습니다</span>
          <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            청중 창을 일반 창으로 엽니다. 프로젝터 쪽으로 끌어다 놓은 뒤 창을 클릭하거나{' '}
            <Kbd>F11</Kbd> 로 전체화면으로 만드세요.
          </span>
        </div>
      </div>

      {supported && perm !== 'denied' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 8,
          background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)',
        }}>
          <span style={{ fontSize: 11.5, color: '#a5b4fc' }}>
            화면 배치 권한을 허용하면 다음부터는 자동으로 배치됩니다.
          </span>
          <div style={{ flexGrow: 1 }} />
          <button type="button" onClick={onRequest} disabled={asking} style={{
            height: 24, padding: '0 10px', borderRadius: 6, fontSize: 11.5,
            background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.35)',
            color: '#c7d2fe', cursor: asking ? 'default' : 'pointer', opacity: asking ? 0.6 : 1,
          }}>{asking ? '요청 중…' : '권한 요청'}</button>
        </div>
      )}

      {supported && perm === 'denied' && (
        <Note tone="warn">
          이 사이트의 화면 배치 권한이 차단돼 있습니다. 주소창의 자물쇠 아이콘에서 허용으로
          바꾸면 다음 발표부터 자동 배치됩니다.
        </Note>
      )}
    </div>
  )
}

// ── 상태 C: 화면 하나 ───────────────────────────────────

function SingleScreenBody({ onStart }) {
  return (
    <div style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <MonitorIcon />
        <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          청중 창 없이 발표자 보기만 열어 시간 배분을 연습하거나, 발표자 보기를 건너뛰고
          슬라이드만 전체화면으로 띄울 수 있습니다.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flexGrow: 1 }} />
        <button type="button" onClick={() => onStart({ mode: PLACEMENT.slidesOnly })} style={ghostBtn}>
          슬라이드만 전체화면
        </button>
        <button type="button" onClick={() => onStart({ mode: PLACEMENT.rehearsal })} style={primaryBtn}>
          리허설 모드로 시작
        </button>
      </div>
    </div>
  )
}

// ── 조각 ────────────────────────────────────────────────

const ghostBtn = {
  height: 32, padding: '0 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1',
}
const primaryBtn = {
  height: 32, padding: '0 18px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
  background: '#6366f1', border: '1px solid #a5b4fc', color: '#ffffff',
}

function Kbd({ children }) {
  return (
    <span style={{
      fontFamily: 'monospace', background: 'rgba(255,255,255,0.1)', color: '#cbd5e1',
      padding: '1px 5px', borderRadius: 4,
    }}>{children}</span>
  )
}

function Note({ tone, children }) {
  const c = tone === 'ok'
    ? { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', fg: '#6ee7b7' }
    : { bg: 'rgba(251,189,35,0.1)', border: 'rgba(251,189,35,0.3)', fg: '#fbbd23' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 8,
      background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <span style={{ fontSize: 11.5, color: c.fg, lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function PresenterIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="9" rx="1.5" />
      <rect x="16" y="7" width="6" height="5" rx="1" />
      <line x1="8" y1="17" x2="8" y2="20" /><line x1="5" y1="20" x2="11" y2="20" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
      <rect x="2" y="4" width="20" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fbbd23" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

/** 청중 화면 미리보기 — 슬라이드 한 장 */
function SlideMiniature() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '14%', display: 'flex', flexDirection: 'column', gap: '7%' }}>
      <div style={{ height: '18%', width: '62%', borderRadius: 2, background: '#0f172a', opacity: 0.75 }} />
      <div style={{ height: '7%', width: '80%', borderRadius: 2, background: '#cbd5e1' }} />
      <div style={{ height: '7%', width: '66%', borderRadius: 2, background: '#cbd5e1' }} />
    </div>
  )
}

/** 발표자 화면 미리보기 — 미리보기 + 노트 + 하단 바 */
function PresenterMiniature() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '6%', display: 'flex', flexDirection: 'column', gap: '4%' }}>
      <div style={{ height: '10%', borderRadius: 2, background: 'rgba(255,255,255,0.1)' }} />
      <div style={{ flexGrow: 1, display: 'flex', gap: '4%' }}>
        <div style={{ flexGrow: 2, borderRadius: 2, background: 'rgba(255,255,255,0.85)' }} />
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '6%' }}>
          <div style={{ flexGrow: 1, borderRadius: 2, background: 'rgba(255,255,255,0.5)' }} />
          <div style={{ flexGrow: 1, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
        </div>
      </div>
      <div style={{ height: '14%', borderRadius: 2, background: 'rgba(99,102,241,0.3)' }} />
    </div>
  )
}
