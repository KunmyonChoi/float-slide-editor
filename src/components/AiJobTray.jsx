import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'
import { recoverPendingLipsyncJobs, countRecoverable } from '../core/lipsyncRunner'
import ImageComparePreview from './ImageComparePreview'

/**
 * AiJobTray — 전역 AI 작업 트레이(우하단). 선택/페이지와 무관하게 진행 중·완료·실패 작업을
 * 보여주고 취소/보기/적용/닫기를 제공한다. (project_ai_job_model Phase 2)
 *
 * 생성이 컴포넌트 수명에서 분리돼 있으므로, 사용자가 다른 요소를 선택하거나 페이지를
 * 이동해도 여기서 상태를 확인하고 결과를 적용할 수 있다.
 *
 * 입력 이미지가 있는 작업은 '캔버스에서 비교'로 결과를 원래 자리에 겹쳐 전후 슬라이더로
 * 확인할 수 있다(적용 전 비파괴). 한 번에 하나만 켜지도록 트레이가 활성 작업을 관리한다.
 */
// 결과가 이미지인 종류(미리보기 <img>). 그 외(립싱크·영상 매트)는 <video>.
const IMAGE_KINDS = ['image-gen', 'image-edit', 'image-cutout']

export default function AiJobTray() {
  const jobs = useAiJobStore(s => s.jobs)
  const visible = jobs.filter(j => j.status !== 'applied') // 적용 끝난 건 숨김

  const [expanded, setExpanded] = useState(false)
  // 캔버스 비교 오버레이를 켠 작업(한 번에 하나). 켜져 있으면 트레이를 오버레이 위로 올려
  // 슬라이더·버튼이 가려지지 않게 한다(오버레이 zIndex 10043).
  const [compareId, setCompareId] = useState(null)
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

  // 비교를 켠 작업이 사라졌거나(적용·닫기) 더 이상 ready가 아니면 자동으로 꺼진 것으로 본다.
  const activeCompareId = visible.some(j => j.id === compareId && j.status === 'ready') ? compareId : null

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
    position: 'fixed', zIndex: activeCompareId ? 10050 : 9000, pointerEvents: 'none',
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
            {visible.map(job => (
              <JobCard
                key={job.id}
                job={job}
                comparing={activeCompareId === job.id}
                onCompare={on => setCompareId(on ? job.id : null)}
              />
            ))}
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
            <span style={{ fontSize: 14 }}>✨</span>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{summary}</span>
            {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{expanded ? '▾' : '▴'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function JobCard({ job, comparing, onCompare }) {
  const { cancelJob, applyJob, removeJob } = useAiJobStore.getState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [split, setSplit] = useState(50)      // 캔버스 비교 구분선 위치(%)
  const [holding, setHolding] = useState(false) // '원본(꾹)' 누르는 동안 결과를 감춘다

  // 결과 blob → 미리보기용 object URL (카드 수명 동안 1회 생성, 언마운트 시 해제)
  const resultUrl = useMemo(
    () => (job.result?.blob ? URL.createObjectURL(job.result.blob) : null),
    [job.result],
  )
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl) }, [resultUrl])

  // 전후 비교용 '전' 이미지 — 러너가 Blob으로 담아두고(대용량 dataURL을 스토어에 남기지 않음)
  // 표시용 URL은 여기서 만들고 해제한다.
  const beforeUrl = useMemo(
    () => (job.result?.beforeBlob ? URL.createObjectURL(job.result.beforeBlob) : null),
    [job.result],
  )
  useEffect(() => () => { if (beforeUrl) URL.revokeObjectURL(beforeUrl) }, [beforeUrl])

  // 비교 대상 영역 — 요소를 편집한 결과면 요소의 '현재' 위치를 따르고(생성 중 옮겼을 수 있다),
  // 요소가 없거나 선택 영역/슬라이드 생성이면 시작 시점에 고정해 둔 사각형을 쓴다.
  const liveEl = useFlatStore(s => (job.targetElementId ? s.flatElements.find(e => e.id === job.targetElementId) : null))
  const compareArea = liveEl
    ? { x: liveEl.x, y: liveEl.y, w: liveEl.width, h: liveEl.height }
    : job.result?.area || null
  const canCompare = job.status === 'ready' && !!beforeUrl && !!compareArea

  // 적용: 대상이 다른 페이지면 그 페이지로 이동해 보여준 뒤 적용.
  const doApply = (mode) => {
    setMenuOpen(false)
    if (comparing) onCompare?.(false) // 내 비교만 끈다(다른 카드가 켜 둔 비교는 그대로)
    const st = useFlatStore.getState()
    if (job.targetPageKey) st.goToFlatPageByKey(job.targetPageKey)
    applyJob(job.id, { mode })
  }

  // 비교 켜기 — 결과가 놓일 페이지로 먼저 이동해야 오버레이가 맞는 자리에 뜬다.
  const toggleCompare = () => {
    if (!comparing && job.targetPageKey) useFlatStore.getState().goToFlatPageByKey(job.targetPageKey)
    onCompare?.(!comparing)
  }

  // 적용 방식은 러너가 준 applyOptions를 따른다(첫 항목이 주버튼). 없으면 기본 교체/추가.
  const applyOptions = job.applyOptions?.length
    ? job.applyOptions
    : (job.targetElementId
        ? [{ mode: 'replace', label: '원본 교체' }, { mode: 'add', label: '새로 추가' }]
        : [{ mode: 'add', label: '적용' }])

  const isImg = IMAGE_KINDS.includes(job.kind)
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
        <span style={{ fontSize: 16 }}>✨</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.label}
        </span>
        {(ready || failed || cancelled) && (
          <button onClick={() => { if (comparing) onCompare?.(false); removeJob(job.id) }} title="닫기"
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
          {comparing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <button
                onPointerDown={() => setHolding(true)} onPointerUp={() => setHolding(false)}
                onPointerLeave={() => setHolding(false)} onPointerCancel={() => setHolding(false)}
                title="누르는 동안 원본을 보여줍니다" style={ghostBtn}>원본(꾹)</button>
              <input type="range" min={0} max={100} value={split}
                onChange={e => setSplit(Number(e.target.value))} style={{ flex: 1 }} />
              <button onClick={() => setSplit(50)} title="구분선을 가운데로" style={ghostBtn}>리셋</button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8, position: 'relative', flexWrap: 'wrap' }}>
            {canCompare && (
              <button onClick={toggleCompare} title="결과를 캔버스의 원래 자리에 겹쳐 전후로 비교합니다"
                style={{ ...ghostBtn, marginRight: 'auto', ...(comparing ? compareOnBtn : {}) }}>
                {comparing ? '비교 끄기' : '캔버스에서 비교'}
              </button>
            )}
            <button onClick={() => setLightbox(true)} style={ghostBtn}>미리보기</button>
            {/* 적용 방식이 여럿이면 주버튼 + ▾ 분할, 하나면 단일 버튼 */}
            {applyOptions.length > 1 ? (
              <div style={{ display: 'flex' }}>
                <button onClick={() => doApply(applyOptions[0].mode)}
                  style={{ ...primaryBtn, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>{applyOptions[0].label}</button>
                <button onClick={() => setMenuOpen(o => !o)} title="적용 방식"
                  style={{ ...primaryBtn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '5px 8px', borderLeft: '1px solid rgba(255,255,255,0.25)' }}>▾</button>
              </div>
            ) : (
              <button onClick={() => doApply(applyOptions[0].mode)} style={primaryBtn}>{applyOptions[0].label}</button>
            )}
            {menuOpen && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 1,
                background: '#1e293b', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)', overflow: 'hidden', minWidth: 130,
              }}>
                {applyOptions.map(o => (
                  <button key={o.mode} onClick={() => doApply(o.mode)} style={menuItem}>{o.label}</button>
                ))}
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

      {/* 캔버스 전후 비교 오버레이 — 결과가 놓일 자리에 겹쳐 세로 슬라이더로 비교(비파괴) */}
      {comparing && canCompare && resultUrl && (
        <ImageComparePreview
          area={compareArea}
          beforeUrl={beforeUrl}
          resultUrl={resultUrl}
          objectFit={job.result.fit || 'contain'}
          split={split} onSplit={setSplit} showOriginal={holding}
        />
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
const compareOnBtn = { background: 'rgba(99,102,241,0.28)', color: '#c7d2fe', borderColor: 'rgba(99,102,241,0.5)' }
const primaryBtn = {
  padding: '5px 12px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const menuItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12.5,
  border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
}
