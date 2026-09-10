import { BlobStore } from './BlobStore'
import { pruneTranscriptCache } from './transcriptCache'

/**
 * BlobGc — 아무도 참조하지 않는 IndexedDB 미디어(와 그 STT 자막 캐시)를 회수한다.
 *
 * 왜 '삭제 시 즉시 제거'가 아니라 GC인가:
 * 같은 blob을 여러 곳이 공유한다. 페이지를 복제하면 음성 참조가 그대로 복사되고, 실행취소
 * 히스토리와 삭제 취소 스태시에도 지워진 요소가 참조를 든 채 남아 있다. 그래서 "이 페이지에서
 * 지웠으니 blob도 지운다"는 살아 있는 참조를 끊을 수 있다. 대신 안전한 시점(프로젝트 저장 직후,
 * 프로젝트 열기 직후)에 앱 전체를 훑어 살아 있는 참조 집합을 만들고, 거기 없는 것만 지운다.
 *
 * 참조를 놓치면 데이터가 사라지므로 판정은 '넉넉하게 살림' 쪽으로 기운다 —
 * 애매하면 살린다(고아가 한 번 더 남는 건 다음 GC가 처리한다).
 */

// 워크 깊이 상한 — 순환은 seen으로 막고, 이 값은 예기치 못한 깊은 구조에서의 폭주만 막는다.
const MAX_DEPTH = 30

/**
 * roots(스토어 상태·페이지 캐시·작업 목록 등)를 훑어 blob 키를 가리킬 수 있는 것들을 모은다.
 * @returns {{ refStrings: string[], bareKeys: Set<string> }}
 *   refStrings — 'idb://'를 담은 문자열(요소 content, url(idb://…) 배경 등)
 *   bareKeys   — key/blobKey 속성에 담긴 순수 키(아직 요소에 붙지 않은 AI 작업 결과 등)
 */
export function collectRefs(roots) {
  const refStrings = []
  const bareKeys = new Set()
  const seen = new Set()

  const walk = (v, depth, propName) => {
    if (v == null || depth > MAX_DEPTH) return
    if (typeof v === 'string') {
      if ((propName === 'key' || propName === 'blobKey') && v) bareKeys.add(v)
      if (v.includes('idb://')) refStrings.push(v)
      return
    }
    if (typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { for (const item of v) walk(item, depth + 1); return }
    if (v instanceof Map) { for (const item of v.values()) walk(item, depth + 1); return }
    if (v instanceof Set) { for (const item of v) walk(item, depth + 1); return }
    // Blob/File/DOM 노드/클래스 인스턴스는 참조 문자열을 담지 않는다 — 순수 객체만 파고든다.
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return
    for (const k in v) walk(v[k], depth + 1, k)
  }

  for (const root of roots || []) walk(root, 0)
  return { refStrings, bareKeys }
}

/**
 * 살아 있는 키 판정 함수를 만든다.
 * 키에는 파일명이 그대로 들어가(공백·한글·확장자) 정규식으로 뽑아내기 어렵다. 그래서 문자열에서
 * 키를 추출하는 대신, 실제 존재하는 키가 어딘가에 언급되는지를 되묻는다.
 */
export function makeLivePredicate(roots) {
  const { refStrings, bareKeys } = collectRefs(roots)
  const isLive = (key) => {
    if (!key) return true
    if (bareKeys.has(key)) return true
    const needle = `idb://${key}`
    return refStrings.some(s => s.includes(needle))
  }
  isLive.refCount = refStrings.length + bareKeys.size
  return isLive
}

/**
 * 고아 blob과 그에 딸린 STT 자막 캐시를 회수한다.
 * @param {Array<object>} roots  살아 있는 참조를 담고 있을 수 있는 객체들
 * @param {{ dryRun?: boolean }} [opts]  dryRun이면 지우지 않고 세기만 한다
 * @returns {Promise<{ total:number, removed:number, orphans:string[], cachePruned:number, skipped?:boolean }>}
 */
export async function runBlobGc(roots, { dryRun = false } = {}) {
  const isLive = makeLivePredicate(roots)
  const all = await BlobStore.keys()

  // 안전장치: 앱 어디에도 참조가 하나도 안 보이는데 blob은 있다면, 훑기가 잘못됐을 가능성이
  // 덱이 정말 비었을 가능성보다 크다. 이럴 땐 아무것도 지우지 않는다.
  if (!isLive.refCount && all.length) {
    return { total: all.length, removed: 0, orphans: [], cachePruned: 0, skipped: true }
  }

  const orphans = all.filter(k => !isLive(k))
  if (!dryRun) {
    for (const k of orphans) {
      try { await BlobStore.remove(k) } catch { /* 하나 실패해도 나머지는 계속 */ }
    }
  }
  const cachePruned = pruneTranscriptCache(isLive, { dryRun })
  return { total: all.length, removed: orphans.length, orphans, cachePruned }
}
