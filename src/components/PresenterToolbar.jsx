import { useEditorStore } from '../store/editorStore'
import { INK_COLORS } from '../core/usePresentationEngine'

// 펜 툴바 그룹(도구/팔레트/굵기) — nowrap로 묶어 그룹 내부는 줄바꿈되지 않게
const TOOL_CLUSTER = { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }
// 매크로 그룹 — 좁을 때 이 경계에서만 줄바꿈(넓으면 한 줄):
//  ① 도구+팔레트  ② 굵기+휴지통+블랙아웃+종료
const TOOL_MACRO = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }

function ctrlBtn(active) {
  return {
    width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    // 선택 상태는 솔리드 인디고 + 흰색 + 외곽 링으로 또렷하게(비선택은 옅게)
    background: active ? '#6366f1' : 'rgba(255,255,255,0.06)',
    border: '1px solid ' + (active ? '#a5b4fc' : 'rgba(255,255,255,0.12)'),
    boxShadow: active ? '0 0 0 2px rgba(99,102,241,0.45)' : 'none',
    color: active ? '#ffffff' : '#cbd5e1', fontSize: 13,
    fontWeight: active ? 700 : 400,
    transition: 'background 0.12s, box-shadow 0.12s',
  }
}

const PANEL = {
  borderRadius: 12, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.1)',
}

/**
 * NarrationControls — 노트 음성/자막/자동 진행.
 * @param {boolean} inline true면 발표자 창 패널 안에 박히는 형태(고정 위치 없음)
 */
export function NarrationControls({ eng, inline = false }) {
  const autoAdvance = useEditorStore(s => s.autoAdvance)
  if (!eng.deckHasAudio) return null

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 10,
        ...PANEL,
        color: '#cbd5e1', fontSize: 12,
        ...(inline
          ? { flexWrap: 'wrap' }
          : {
            position: 'fixed', bottom: 20, left: 20, zIndex: 1011,
            opacity: 0.45, transition: 'opacity 0.2s',
          }),
      }}
      onMouseEnter={inline ? undefined : (e) => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={inline ? undefined : (e) => { e.currentTarget.style.opacity = '0.45' }}
    >
      <button type="button" title={eng.narration ? '나레이션 끄기' : '나레이션 켜기'}
        onClick={() => eng.setNarration(n => !n)}
        style={ctrlBtn(eng.narration)}>{eng.narration ? '🔊' : '🔇'}</button>
      {eng.hasAudio && (
        <button type="button" title="이 슬라이드 음성 다시 재생"
          onClick={eng.replayAudio}
          style={ctrlBtn(false)}>▶</button>
      )}
      <button type="button"
        title={eng.captionsOn ? '가라오케 자막 끄기 (STT로 노트 음성을 텍스트로 표시)' : '가라오케 자막 켜기 (STT로 노트 음성을 텍스트로 표시)'}
        onClick={eng.toggleCaptions}
        style={ctrlBtn(eng.captionsOn)}>{eng.captionBusy ? '⏳' : 'CC'}</button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#94a3b8' }}>
        <input type="checkbox" checked={autoAdvance} onChange={e => useEditorStore.getState().setAutoAdvance(e.target.checked)} />
        음성 후 자동 진행
      </label>
      {eng.captionErr && <span style={{ color: '#fca5a5', fontSize: 11 }}>{eng.captionErr}</span>}
    </div>
  )
}

/**
 * InkControls — 펜/형광펜/지우개 + 색·굵기 + 블랙아웃.
 * @param {boolean} inline true면 발표자 창 하단 바에 박히는 형태(고정 위치 없음)
 */
export function InkControls({ eng, inline = false }) {
  const { penActive, penTool, penColor, penWidth, blackout } = eng
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexWrap: 'wrap', gap: 8, padding: '6px 8px',
        ...PANEL,
        ...(inline
          ? {}
          : {
            position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1011,
            maxWidth: 'calc(100vw - 16px)', // 좁은 화면에서 양옆 잘림 방지 → 그룹 단위 줄바꿈
            opacity: penActive ? 1 : 0.4, transition: 'opacity 0.2s',
          }),
      }}
      onMouseEnter={inline ? undefined : (e) => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={inline ? undefined : (e) => { e.currentTarget.style.opacity = penActive ? '1' : '0.4' }}
    >
      {!penActive ? (
        <button type="button" title="펜 모드 켜기 (P)"
          onClick={() => { eng.setPenTool('pen'); eng.setPenActive(true) }}
          style={ctrlBtn(false)}>✎</button>
      ) : (<>
        {/* 그룹① 도구 + 색상 팔레트 (좁으면 이게 1줄) */}
        <div style={TOOL_MACRO}>
          <div style={TOOL_CLUSTER}>
            <button type="button" title="펜 (P)" onClick={() => eng.setPenTool('pen')} style={ctrlBtn(penTool === 'pen')}>✎</button>
            <button type="button" title="형광펜 (H)" onClick={() => eng.setPenTool('highlighter')} style={ctrlBtn(penTool === 'highlighter')}>🖍</button>
            <button type="button" title="지우개 (E)" onClick={() => eng.setPenTool('eraser')} style={ctrlBtn(penTool === 'eraser')}>⌫</button>
          </div>
          <div style={TOOL_CLUSTER}>
            {INK_COLORS.map(c => (
              <button key={c} type="button" title={`색 ${c}`}
                onClick={() => { eng.setPenColor(c); if (penTool === 'eraser') eng.setPenTool('pen') }}
                style={{
                  width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0,
                  background: c,
                  border: penColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)',
                  boxShadow: penColor === c ? '0 0 0 1px rgba(99,102,241,0.8)' : 'none',
                }} />
            ))}
          </div>
        </div>
        {/* 그룹② 굵기 + 휴지통 + 블랙아웃 + 종료 (좁으면 다음 줄) */}
        <div style={TOOL_MACRO}>
          <div style={TOOL_CLUSTER}>
            <button type="button" title="가는 선" onClick={() => eng.setPenWidth('thin')} style={ctrlBtn(penWidth === 'thin')}>•</button>
            <button type="button" title="굵은 선" onClick={() => eng.setPenWidth('thick')} style={ctrlBtn(penWidth === 'thick')}>⬤</button>
          </div>
          <button type="button" title="현재 슬라이드 잉크 전체 지우기 (C)" onClick={eng.clearSlideInk} style={ctrlBtn(false)}>🗑</button>
          <button type="button" title="블랙아웃 — 슬라이드 가리고 잉크만 (B)" onClick={() => eng.setBlackout(b => !b)} style={ctrlBtn(blackout)}>◼</button>
          {/* 펜 모드 종료 — X 아이콘 danger 알약으로 명확히 */}
          <button type="button" title="펜 모드 종료 (Esc)" onClick={() => { eng.setPenActive(false); eng.setBlackout(false) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px',
              borderRadius: 7, cursor: 'pointer', fontSize: 12,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5',
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            종료
          </button>
        </div>
      </>)}
    </div>
  )
}

/** 단일 화면 발표의 하단 오버레이 묶음 */
export default function PresenterToolbar({ eng }) {
  return (
    <>
      <NarrationControls eng={eng} />
      <InkControls eng={eng} />
    </>
  )
}
