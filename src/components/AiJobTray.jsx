import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'

/**
 * AiJobTray — 전역 AI 작업 트레이(우하단). 선택/페이지와 무관하게 진행 중·완료·실패 작업을
 * 보여주고 취소/보기/적용/닫기를 제공한다. (project_ai_job_model Phase 2)
 *
 * 생성이 컴포넌트 수명에서 분리돼 있으므로, 사용자가 다른 요소를 선택하거나 페이지를
 * 이동해도 여기서 상태를 확인하고 결과를 적용할 수 있다.
 */
const KIND_ICON = { lipsync: '🎬', 'image-enhance': '🪄', 'image-edit': '✏️', 'video': '🎬', default: '✨' }

export default function AiJobTray() {
  const jobs = useAiJobStore(s => s.jobs)
  const visible = jobs.filter(j => j.status !== 'applied') // 적용 끝난 건 숨김
  if (visible.length === 0) return null

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 72, zIndex: 9000,
      display: 'flex', flexDirection: 'column', gap: 8, width: 300, maxWidth: 'calc(100vw - 32px)',
      pointerEvents: 'none',
    }}>
      {visible.map(job => <JobCard key={job.id} job={job} />)}
    </div>
  )
}

function JobCard({ job }) {
  const { cancelJob, applyJob, removeJob } = useAiJobStore.getState()

  const view = () => {
    const st = useFlatStore.getState()
    if (job.targetPageKey) st.goToFlatPageByKey(job.targetPageKey)
    if (job.targetElementId) {
      // 같은 페이지로 이동한 직후 선택 (다른 페이지면 복원 후 라이브에 존재)
      const exists = st.flatElements.some(e => e.id === job.targetElementId)
      if (exists) st.setSelectedFlat(job.targetElementId)
    }
  }
  const apply = () => { view(); applyJob(job.id) }

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
          <div style={{ fontSize: 12, color: '#34d399', marginTop: 6 }}>✅ 완료 — 결과를 적용하세요</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button onClick={view} style={ghostBtn}>보기</button>
            <button onClick={apply} style={primaryBtn}>적용</button>
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
