/**
 * lipsyncRecovery — 진행 중 립싱크 잡을 브라우저에 durable하게 기록해, 탭이 폐기/새로고침되어도
 * 결과를 회수할 수 있게 한다. (모바일 크롬 등에서 팝업/opener 탭이 백그라운드에서 discard되면
 * aiJobStore(메모리)가 사라져 결과 relay가 끊기는 문제 대응 — project_lipsync_integration)
 *
 * 실제 생성은 서버(RunPod)에서 돌고 결과는 R2에 저장되므로, 필요한 건 "다시 접속해 결과를 가져올
 * 식별자"뿐이다. providerJobId(=Worker 잡 id: /api/status/<id>로 폴링) + 적용 대상 메타를 남긴다.
 *
 * entry: { jobId, providerJobId, label, targetPageKey, targetElementId, audioKind, createdAt }
 *   - jobId: opener(aiJobStore)가 발급한 잡 id(제출 시점). 라우팅/중복 판정용.
 *   - providerJobId: /api/generate가 돌려준 Worker 잡 id. null이면 아직 제출 전(회수 불가).
 */

const KEY = 'lipsync-pending-jobs'
// 오래된 항목은 정리(RunPod 상태 보존 창이 지나면 회수 불가). 서버 결과(R2)는 남지만 폴링 대상이
// 사라질 수 있어 무한 보관은 무의미 — 12시간 경과분은 폐기.
const MAX_AGE_MS = 12 * 60 * 60 * 1000

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function writeAll(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)) } catch { /* quota/denied — 무시 */ }
}
function prune(arr, now) {
  const cutoff = (now || Date.now()) - MAX_AGE_MS
  return arr.filter(e => e && e.jobId && (e.createdAt || 0) >= cutoff)
}

/** 살아있는(만료 전) 항목 목록. 읽을 때 만료분 정리. */
export function listPending() {
  const pruned = prune(readAll())
  writeAll(pruned)
  return pruned
}

/** 제출 시 기록(같은 jobId가 있으면 대체). */
export function savePending(entry) {
  const arr = readAll().filter(e => e.jobId !== entry.jobId)
  arr.push({ providerJobId: null, ...entry })
  writeAll(prune(arr))
}

/** providerJobId 등 부분 갱신(submitted 수신 시). */
export function updatePending(jobId, patch) {
  writeAll(readAll().map(e => (e.jobId === jobId ? { ...e, ...patch } : e)))
}

/** 완료/실패 등 종료 시 제거. */
export function removePending(jobId) {
  writeAll(readAll().filter(e => e.jobId !== jobId))
}

/** 회수 가능한(providerJobId 보유) 항목 수 — 복구 UI 노출 판정용. */
export function countRecoverable() {
  return listPending().filter(e => e.providerJobId).length
}
