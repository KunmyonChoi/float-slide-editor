import { create } from 'zustand'

/**
 * aiJobStore — 전역 AI 생성 작업(job) 모델.
 *
 * 목적: AI 생성을 '선택된 요소/현재 페이지'의 컴포넌트 수명에서 분리해, 사용자가
 * 도중에 다른 요소를 선택하거나 페이지를 이동해도 생성이 계속되고 결과를 받게 한다.
 * (이미지/영상/립싱크 공통 모델 — 영상·립싱크처럼 분 단위 작업에 필수.)
 *
 * 각 job은 결과를 적용할 '대상'을 (현재 선택이 아니라) targetPageKey+targetElementId로
 * 바인딩한다. 완료 시 flatStore.applyToElementOnPage/addElementToPage로 대상에 반영.
 *
 * job: {
 *   id, kind, label,
 *   targetPageKey, targetElementId,   // 결과 적용 대상(선택 무관)
 *   status: 'running'|'ready'|'applied'|'failed'|'cancelled',
 *   progress: 0..100, statusText,
 *   result: { url?, blob?, ... } | null,
 *   error: string | null,
 *   abort: () => void | null,         // 진행 중 취소 훅(있으면)
 *   applyOptions: [{ mode, label }],  // 트레이 '적용' 버튼 구성(첫 항목이 주버튼). 없으면 기본 교체/추가.
 *   createdAt: number,                // 호출부가 주입(테스트 결정성)
 * }
 */

let _seq = 0
export function _nextJobId() { return `aijob-${++_seq}` }

export const useAiJobStore = create((set, get) => ({
  jobs: [],

  /** 작업 시작 → jobId 반환. createdAt은 호출부에서 Date.now() 주입(스토어는 결정적).
   * apply: 결과를 대상에 반영하는 콜백(러너가 주입). 트레이 '적용'이 호출. */
  startJob({ kind, label, targetPageKey = null, targetElementId = null, abort = null, apply = null, applyOptions = null, createdAt = 0 }) {
    const id = _nextJobId()
    const job = {
      id, kind, label: label || kind,
      targetPageKey, targetElementId,
      status: 'running', progress: 0, statusText: '',
      result: null, error: null, abort, apply, applyOptions, createdAt,
    }
    set(s => ({ jobs: [...s.jobs, job] }))
    return id
  },

  /** 진행률/상태문구 등 부분 갱신 */
  updateJob(id, patch) {
    set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, ...patch } : j)) }))
  },

  /** 생성 완료 — 결과 보관(아직 미적용: 'ready'). 적용은 applyJobResult가 담당. */
  completeJob(id, result) {
    set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'ready', progress: 100, result, error: null } : j)) }))
  },

  failJob(id, error) {
    set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'failed', error: String(error || 'failed'), abort: null } : j)) }))
  },

  /** 취소 — abort 훅 호출 후 상태 표시. */
  cancelJob(id) {
    const job = get().jobs.find(j => j.id === id)
    if (job?.abort) { try { job.abort() } catch { /* noop */ } }
    set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'cancelled', abort: null } : j)) }))
  },

  /** 작업을 'applied'로 표시(결과를 대상에 반영 완료 후 호출). */
  markApplied(id) {
    set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'applied', abort: null } : j)) }))
  },

  /** 결과를 대상에 반영 — job.apply(job, opts) 호출. apply가 Promise면 성공 시에만 'applied',
   * 실패 시 'ready'로 되돌려 트레이에 다시 노출(결과 유실 방지). 동기 apply는 즉시 applied.
   * opts.mode: 'replace'(원본 교체) | 'add'(새 요소). 러너가 해석. 시작했으면 true. */
  applyJob(id, opts = {}) {
    const job = get().jobs.find(j => j.id === id)
    if (!job || job.status !== 'ready') return false
    let result
    try { result = job.apply?.(job, opts) }
    catch (e) { get().updateJob(id, { error: '적용 실패: ' + (e?.message || e) }); return false }
    if (result && typeof result.then === 'function') {
      // 비동기 적용: 성공 후 applied, 실패 시 ready 유지 + 에러 표시(다시 적용 가능)
      result.then(() => get().markApplied(id))
        .catch(e => get().updateJob(id, { status: 'ready', error: '적용 실패: ' + (e?.message || e) }))
    } else {
      get().markApplied(id)
    }
    return true
  },

  /** 목록에서 제거(트레이 닫기/정리). */
  removeJob(id) {
    set(s => ({ jobs: s.jobs.filter(j => j.id !== id) }))
  },

  /** 특정 대상 요소에 대한 진행 중/대기 작업 조회(플로팅 바가 자기 요소 상태 표시용). */
  jobForElement(elementId) {
    return get().jobs.find(j => j.targetElementId === elementId && (j.status === 'running' || j.status === 'ready')) || null
  },
}))
