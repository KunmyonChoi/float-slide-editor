/**
 * transcriptCache — 슬라이드 노트 음성(BlobStore 키) 단위 STT 변환 결과 캐시.
 *
 * 같은 음성을 다시 발표할 때마다 유료 STT API를 재호출하지 않도록 브라우저(localStorage)에
 * 보관한다. 음성이 교체되면 BlobStore 키 자체가 바뀌므로(BlobStore.put이 새 키를 발급) 캐시는
 * 자연히 무효화된다 — 별도의 스테일 판정이 필요 없다.
 *
 * 프로젝트 파일(.flatproj)에는 포함되지 않는 파생 캐시다: 다른 브라우저로 열면 다시 생성된다.
 */
const STORAGE_KEY = 'stt-transcript-cache-v1'
const MAX_ENTRIES = 200 // 무한정 쌓이지 않도록 오래된 항목부터 정리

function readAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function writeAll(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch { /* 용량 초과 등 무시 — 캐시 없이 동작 */ }
}

/**
 * @param {string} blobKey  BlobStore.put()이 반환한 키(idb:// 접두사 제외)
 * @returns {{ text:string, words:{word:string,start:number,end:number}[], language?:string, duration?:number } | null}
 */
export function getCachedTranscript(blobKey) {
  if (!blobKey) return null
  return readAll()[blobKey] || null
}

/** @param {string} blobKey @param {object} transcript  transcribeSpeech()의 반환값 */
export function setCachedTranscript(blobKey, transcript) {
  if (!blobKey || !transcript) return
  const map = readAll()
  map[blobKey] = transcript
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    // 문자열 키를 가진 일반 객체는 삽입 순서를 유지하므로 앞쪽(오래된 것)부터 제거
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k]
  }
  writeAll(map)
}

export function clearTranscriptCache() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* 무시 */ }
}

// 진행 중인 전사 요청(blobKey → Promise). 발표 시작 시 선행 전사(prefetch)와 현재 슬라이드
// 자막 로딩이 같은 오디오를 동시에 요청할 수 있어, 중복 STT 호출(과금 낭비)을 막기 위해 공유한다.
const _inflight = new Map()

/**
 * 캐시 우선 조회 → 없으면 fetchFn()으로 실제 전사를 수행하고 캐시에 저장한다.
 * 같은 blobKey를 여러 호출자가 동시에 요청해도(예: 백그라운드 프리페치 + 현재 슬라이드 표시)
 * 진행 중인 요청을 재사용해 STT 호출은 한 번만 나간다.
 * @param {string} blobKey
 * @param {() => Promise<object>} fetchFn  캐시 미스일 때 전사를 수행하는 함수(예: () => transcribeSpeech(blob))
 * @returns {Promise<object>} transcribeSpeech()와 같은 모양의 전사 결과
 */
export function getOrFetchTranscript(blobKey, fetchFn) {
  const cached = getCachedTranscript(blobKey)
  if (cached) return Promise.resolve(cached)
  if (_inflight.has(blobKey)) return _inflight.get(blobKey)
  const p = Promise.resolve()
    .then(fetchFn)
    .then(transcript => { setCachedTranscript(blobKey, transcript); return transcript })
    .finally(() => { _inflight.delete(blobKey) })
  _inflight.set(blobKey, p)
  return p
}
