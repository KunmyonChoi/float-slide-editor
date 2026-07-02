import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'
import { recoverPendingLipsyncJobs, countRecoverable } from '../core/lipsyncRunner'

/**
 * AiJobTray — 전역 AI 작업 트레이(우하단). 선택/페이지와 무관하게 진행 중·완료·실패 작업을
 * 보여주고 취소/보기/적용/닫기를 제공한다. (project_ai_job_model Phase 2)
 *
 * 생성이 컴포넌트 수명에서 분리돼 있으므로, 사용자가 다른 요소를 선택하거나 페이지를
 * 이동해도 여기서 상태를 확인하고 결과를 적용할 수 있다.
 */
const KIND_ICON = { lipsync: '🎬', imagen: '🖼️', 'image-enhance': '🪄', 'image-edit': '✏️', 'video': '🎬', default: '✨' }
const IMAGE_KINDS = ['imagen', 'image-enhance', 'image-edit'] // 결과가 이미지(미리보기 <img>)

export default function AiJobTray() {
  const jobs = useAiJobStore(s => s.jobs)
  const visible = jobs.filter(j => j.status !== 'applied') // 적용 끝난 건 숨김

  const [expanded, setExpanded] = useState(false)
  const chipRef = useRef(null)
  // 위치는 작업이 바뀌어도 유지(고정 resetKey). 드래그 시 자유 위치로.
  const { pos, startDrag, dragging } = useDraggableToolbar('aijobtray', chipRef)

  // 탭 폐기/새로고침으로 유실됐던 진행 중 립싱크 결과 회수 안내(durable 기록 기반).
  // localStorage라 비반응형 — 렌더마다 값싸게 재계산(jobs 변화가 리렌더를 유발). 클릭 후엔
  // 결과가 도착해 기록이 정리될 때까지 버튼이 남지 않도록 dismissed로 즉시 숨긴다.
  const [recoverDismissed, setRecoverDismissed] = useState(false)
  const recoverable = recoverDismissed ? 0 : countRecoverable()
  const doRecover = () => { const n = recoverPendingLipsyncJobs(); setRecoverDismissed(true); if (n) setExpanded(true) }

  // 새 완료(ready)가 생기면 한 번 펼쳐 알림
  const readyIds = visible.filter(j => j.status === 'ready').map(j => j.id).join(',')
  const prevReady = useRef('')
  useEffect(() => {
    if (readyIds && readyIds !== prevReady.current) setExpanded(true)
    prevReady.current = readyIds
  }, [readyIds])

  if (visible.length === 0 && recoverable === 0) return null

  const running = visible.filter(j => j.status === 'running')
  const readyJobs = visible.filter(j => j.status === 'ready')
  const failedJobs = visible.filter(j => j.status === 'failed')

  // 칩 요약 라벨/색
  let summary, dot = null
  if (running.length) {
    summary = `생성 중 ${running[0].progress || 0}%${running.length > 1 ? ` (+${running.length - 1})` : ''}`
  } else if (readyJobs.length) {
    summary = `완료 ${readyJobs.length}`; dot = '#34d399'
  } else if (failedJobs.length) {
    summary = `실패 ${failedJobs.length}`; dot = '#f87272'
  }

  const containerStyle = {
    position: 'fixed', zIndex: 9000, pointerEvents: 'none',
    ...(pos ? { left: pos.left, top: pos.top } : { right: 16, bottom: 96 }),
  }

  return (
    <div style={containerStyle}>
      <div style={{ position: 'relative', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {/* 펼침: 카드 목록을 칩 위로 */}
        {expanded && visible.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
            width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {visible.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        )}
        {/* 복구 안내 — 이전 세션에 진행 중이던 립싱크 결과 회수(사용자 클릭=팝업 열기 제스처) */}
        {recoverable > 0 && (
          <button
            onClick={doRecover}
            title="이전에 진행 중이던 립싱크 결과를 다시 불러옵니다(팝업이 열립니다)."
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
              borderRadius: 999, background: 'rgba(180,83,9,0.95)', color: '#fff',
              border: '1px solid rgba(253,224,71,0.5)', boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
              cursor: 'pointer', fontFamily: 'system-ui, sans-serif', fontSize: 12.5, fontWeight: 600,
            }}
          >
            ⟳ 이전 립싱크 결과 복구 {recoverable}
          </button>
        )}
        {/* 컴팩트 칩(평소) — 클릭 토글, 그립으로 드래그 */}
        {visible.length > 0 && (
          <div ref={chipRef}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px 0 6px',
              borderRadius: 999, background: 'rgba(15,23,42,0.96)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)', cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
              width: 'fit-content',
            }}
            onClick={() => setExpanded(o => !o)}
            title={expanded ? '접기' : '펼치기'}
          >
            <GripHandle onPointerDown={startDrag} dragging={dragging} />
            <span style={{ fontSize: 14 }}>🎬</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{summary}</span>
            {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{expanded ? '▾' : '▴'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function JobCard({ job }) {
  const { cancelJob, applyJob, removeJob } = useAiJobStore.getState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  // 결과 영상 blob → 미리보기용 object URL (카드 수명 동안 1회 생성, 언마운트 시 해제)
  const resultUrl = useMemo(
    () => (job.result?.blob ? URL.createObjectURL(job.result.blob) : null),
    [job.result],
  )
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl) }, [resultUrl])

  // 적용: mode 'replace'(기본) | 'add'. 대상이 다른 페이지면 그 페이지로 이동해 보여준 뒤 적용.
  const doApply = (mode) => {
    setMenuOpen(false)
    const st = useFlatStore.getState()
    if (job.targetPageKey) st.goToFlatPageByKey(job.targetPageKey)
    applyJob(job.id, { mode })
  }

  const isImg = IMAGE_KINDS.includes(job.kind) // 이미지 결과면 <img> 미리보기 + 단일 '적용'(교체 대상 없음)
  const running = job.status === 'running'
  const ready = job.status === 'ready'
  const failed = job.status === 'failed'
  const cancelled = job.status === 'cancelled'

  return (
    <div style={{
      pointerEvents: 'auto',
      background: 'rgba(15,23,42,0.97)', color: '#e2e8f0',
      border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)', padding: 12,
      backdropFilter: 'blur(8px)', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{KIND_ICON[job.kind] || KIND_ICON.default}</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.label}
        </span>
        {(ready || failed || cancelled) && (
          <button onClick={() => removeJob(job.id)} title="닫기"
            style={iconBtn}>✕</button>
        )}
      </div>

      {running && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Spinner />
            <span style={{ fontSize: 12, color: '#94a3b8', flex: 1 }}>{job.statusText || '생성 중…'}</span>
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>{job.progress > 0 ? `${job.progress}%` : ''}</span>
          </div>
          <Bar pct={job.progress} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => cancelJob(job.id)} style={ghostBtn}>취소</button>
          </div>
        </>
      )}

      {ready && (
        <>
          <div style={{ fontSize: 12, color: '#34d399', margin: '6px 0 8px' }}>✅ 완료</div>
          {resultUrl && (
            <div onClick={() => setLightbox(true)} title="클릭하여 크게 보기"
              style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: '#000' }}>
              {isImg
                ? <img src={resultUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 150, objectFit: 'contain' }} />
                : <>
                    <video src={resultUrl} muted preload="metadata" style={{ width: '100%', display: 'block', maxHeight: 150, objectFit: 'contain' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>▶</div>
                  </>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8, position: 'relative' }}>
            <button onClick={() => setLightbox(true)} style={ghostBtn}>미리보기</button>
            {/* 교체 대상이 있으면 적용 ▾ 분할(교체/추가), 없으면(레이아웃 이미지 등) 단일 '적용'(추가) */}
            {job.targetElementId ? (
              <div style={{ display: 'flex' }}>
                <button onClick={() => doApply('replace')} style={{ ...primaryBtn, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>적용</button>
                <button onClick={() => setMenuOpen(o => !o)} title="적용 방식"
                  style={{ ...primaryBtn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '5px 8px', borderLeft: '1px solid rgba(255,255,255,0.25)' }}>▾</button>
              </div>
            ) : (
              <button onClick={() => doApply('add')} style={primaryBtn}>적용</button>
            )}
            {menuOpen && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 1,
                background: '#1e293b', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)', overflow: 'hidden', minWidth: 130,
              }}>
                <button onClick={() => doApply('replace')} style={menuItem}>원본 교체</button>
                <button onClick={() => doApply('add')} style={menuItem}>새로 추가</button>
              </div>
            )}
          </div>
        </>
      )}

      {failed && (
        <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
          ⚠ 실패: {job.error}
        </div>
      )}
      {cancelled && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>취소됨</div>
      )}

      {lightbox && resultUrl && createPortal(
        <div onClick={() => setLightbox(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10060, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          {isImg
            ? <img src={resultUrl} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, background: '#000' }} />
            : <video src={resultUrl} controls autoPlay onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, background: '#000' }} />}
        </div>,
        document.body,
      )}
    </div>
  )
}

function Bar({ pct }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 6, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct || 0))}%`, background: '#6366f1', transition: 'width 0.3s' }} />
    </div>
  )
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#a5b4fc" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

const iconBtn = {
  border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer',
  fontSize: 12, padding: '2px 4px', borderRadius: 5,
}
const ghostBtn = {
  padding: '5px 10px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtn = {
  padding: '5px 12px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const menuItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12.5,
  border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
}
