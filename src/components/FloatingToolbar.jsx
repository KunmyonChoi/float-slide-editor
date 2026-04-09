import { useState, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import CanvasSizeSelector from './CanvasSizeSelector'
import QualityDashboard from './QualityDashboard'
import FileMenu from './ExportMenu'

const FALLBACK_SAMPLE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1280px; height: 720px; overflow: hidden; font-family: 'Segoe UI', sans-serif; }
  .slide { position: absolute; inset: 0; display: none; flex-direction: column;
           align-items: center; justify-content: center; padding: 80px 100px; }
  .slide.active { display: flex; }
  .slide-1 { background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); }
  .slide-2 { background: #f8fafc; }
  .slide-3 { background: linear-gradient(135deg, #064e3b 0%, #065f46 100%); }
  #nav { position: fixed; bottom: 24px; right: 32px; display: flex; gap: 8px; z-index: 9; }
  #nav button { width:36px;height:36px;border:1px solid rgba(255,255,255,0.2);border-radius:8px;
                background:rgba(255,255,255,0.1);color:#fff;font-size:16px;cursor:pointer; }
  #nav button:hover { background:rgba(255,255,255,0.2); }
  #counter { position: fixed; bottom: 28px; left: 32px; font-size: 13px;
             color: rgba(255,255,255,0.4); z-index: 9; }
</style>
</head>
<body>

<div class="slide slide-1 active">
  <div style="color:#a5b4fc;font-size:14px;letter-spacing:4px;text-transform:uppercase;margin-bottom:16px;">float-editor sample</div>
  <h1 style="font-size:64px;font-weight:700;color:#fff;letter-spacing:-2px;text-align:center;line-height:1.1;margin-bottom:24px;">
    HTML 슬라이드<br>편집기
  </h1>
  <p style="font-size:20px;color:#94a3b8;text-align:center;max-width:560px;line-height:1.6;">
    키보드 ← → 또는 하단 버튼으로 슬라이드 이동<br>
    요소를 클릭하면 편집 패널이 열립니다
  </p>
</div>

<div class="slide slide-2">
  <div style="width:100%;max-width:960px;">
    <h2 style="font-size:40px;font-weight:700;color:#1e293b;margin-bottom:48px;">주요 기능</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="font-size:36px;margin-bottom:16px;">✏️</div>
        <h3 style="font-size:18px;font-weight:600;color:#1e293b;margin-bottom:8px;">텍스트 편집</h3>
        <p style="font-size:14px;color:#64748b;line-height:1.6;">더블클릭으로 인라인 편집</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="font-size:36px;margin-bottom:16px;">🖼️</div>
        <h3 style="font-size:18px;font-weight:600;color:#1e293b;margin-bottom:8px;">이미지 교체</h3>
        <p style="font-size:14px;color:#64748b;line-height:1.6;">클릭 한 번으로 교체</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="font-size:36px;margin-bottom:16px;">🎨</div>
        <h3 style="font-size:18px;font-weight:600;color:#1e293b;margin-bottom:8px;">스타일 조정</h3>
        <p style="font-size:14px;color:#64748b;line-height:1.6;">색상·크기·여백 GUI 편집</p>
      </div>
    </div>
  </div>
</div>

<div class="slide slide-3">
  <h2 style="font-size:48px;font-weight:700;color:#fff;margin-bottom:24px;">시작해볼까요?</h2>
  <p style="font-size:20px;color:#6ee7b7;max-width:480px;text-align:center;line-height:1.6;">
    상단 메뉴에서 HTML 파일을 열거나,<br>직접 슬라이드를 편집해보세요.
  </p>
</div>

<div id="nav">
  <button onclick="nav(-1)" title="이전 (←)">‹</button>
  <button onclick="nav(1)" title="다음 (→)">›</button>
</div>
<div id="counter"></div>

<script>
  var slides = document.querySelectorAll('.slide');
  var cur = 0;
  function show(n) {
    slides[cur].classList.remove('active');
    cur = Math.max(0, Math.min(slides.length - 1, n));
    slides[cur].classList.add('active');
    document.getElementById('counter').textContent = (cur + 1) + ' / ' + slides.length;
  }
  function nav(d) { show(cur + d); }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); nav(-1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
  });
  show(0);
</script>
</body>
</html>`

/**
 * FloatingToolbar (AppBar) — 글로벌 앱 기능
 * 브랜딩, 파일 열기/샘플, 발표, 뷰 모드 토글
 * 발표 모드에서는 완전히 숨겨진다.
 */
export default function FloatingToolbar() {
  const { slideHtml, mode, enterPresentation } = useEditorStore()
  const { viewMode, setViewMode, extractFromIframe, panelMode, setPanelMode } = useFlatStore()
  const iframeRef = useEditorStore(s => s.iframeRef)
  const [qualityOpen, setQualityOpen] = useState(false)

  // F5 키 → 발표 모드
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'F5') {
        e.preventDefault()
        enterPresentation()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enterPresentation])

  // 발표 모드에서는 완전히 숨김
  if (mode === 'present') return null

  return (
    <>
    <div
      className="flex items-center gap-1 px-3 py-1.5 shrink-0 relative z-30"
      style={{
        background: 'rgba(15,23,42,0.9)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span className="text-white font-semibold text-sm tracking-wide px-2 mr-1">
        float-editor
      </span>

      <Divider />

      {/* 파일 메뉴 */}
      <FileMenu fallbackSample={FALLBACK_SAMPLE} />

      <Divider />

      {/* 발표 모드 진입 */}
      <ToolBtn
        onClick={enterPresentation}
        disabled={!slideHtml}
        title="발표 모드 (F5) — 전체화면, 슬라이드 자체 네비게이션 동작"
        highlight
      >
        <PresentIcon /><span className="text-xs ml-1">발표</span>
      </ToolBtn>

      <Divider />

      {/* 뷰 모드 토글 */}
      <ViewModeToggle
        viewMode={viewMode}
        disabled={!slideHtml}
        onChange={(mode) => {
          if (mode !== 'html' && iframeRef) {
            const pk = `${useEditorStore.getState().currentPage}-${useEditorStore.getState().revealV || 0}`
            extractFromIframe(iframeRef, pk)
          }
          setViewMode(mode)
        }}
      />

      <Divider />

      {/* 패널 모드 토글 */}
      <ToolBtn
        onClick={() => setPanelMode(panelMode === 'docked' ? 'floating' : 'docked')}
        title={panelMode === 'docked' ? '패널 분리 (Floating)' : '패널 고정 (Docked)'}
      >
        {panelMode === 'docked' ? <UndockIcon /> : <DockIcon />}
        <span className="text-xs ml-1">{panelMode === 'docked' ? '분리' : '고정'}</span>
      </ToolBtn>

      <Divider />

      {/* 캔버스 크기 선택 */}
      <CanvasSizeSelector />

      <Divider />

      {/* 품질 분석 대시보드 */}
      <ToolBtn
        onClick={() => setQualityOpen(v => !v)}
        disabled={!slideHtml || viewMode === 'html'}
        title="전체 슬라이드 품질 분석"
      >
        <QualityIcon /><span className="text-xs ml-1">품질</span>
      </ToolBtn>

      <div className="flex-1" />

      <span className="text-xs text-slate-600 px-2 select-none">Phase 8</span>

    </div>

    {/* 품질 대시보드 패널 */}
    <QualityDashboard open={qualityOpen} onClose={() => setQualityOpen(false)} />
    </>
  )
}

// ── 공유 컴포넌트 (EditToolbar에서도 사용) ──────────────

const VIEW_MODES = [
  { mode: 'html',  label: 'HTML',  title: 'HTML DOM 뷰' },
  { mode: 'flat',  label: 'Flat',  title: 'PowerPoint-like 독립 요소 뷰' },
  { mode: 'split', label: 'Split', title: '좌우 비교 뷰' },
]

function ViewModeToggle({ viewMode, disabled, onChange }) {
  return (
    <div className="flex items-center bg-white/5 rounded-lg p-0.5">
      {VIEW_MODES.map(({ mode, label, title }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          disabled={disabled}
          title={title}
          className={[
            'px-2 py-1 rounded-md text-xs transition-colors',
            viewMode === mode
              ? 'bg-indigo-600/60 text-white font-medium'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
            disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ToolBtn({ children, onClick, disabled, title, highlight }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'flex items-center px-2.5 py-1.5 rounded-lg text-sm transition-colors',
        highlight
          ? 'text-indigo-300 hover:text-white hover:bg-indigo-600/50 disabled:opacity-30 disabled:cursor-not-allowed'
          : 'text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-1 shrink-0" />
}

export function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7v6h6" /><path d="M3 13C5 7 11 4 17 6s9 8 7 14" />
    </svg>
  )
}

export function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 7v6h-6" /><path d="M21 13C19 7 13 4 7 6S-2 14 0 20" />
    </svg>
  )
}

function PresentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <polygon fill="currentColor" stroke="none" points="10,8 10,13 15,10.5" />
    </svg>
  )
}

function QualityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}

function DockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </svg>
  )
}

function UndockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="8" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}
