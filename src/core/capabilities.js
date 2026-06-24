/**
 * capabilities — 앱이 의존하는 브라우저 권한/기능 감지·요청.
 *
 * 요청 가능한 것은 제한적이다(API 제약):
 *  - 파일 시스템 접근: 사전 요청 불가(저장/열기 시점에 핸들 권한 발생) → 지원 여부만.
 *  - 클립보드 읽기: 사용자 제스처로 read() 시도 시 프롬프트 → 요청 가능.
 *  - 폰트: 권한 아님(로드 상태) → 상태/대기만.
 *  - 저장소 영속성: navigator.storage.persist() 요청 가능.
 */

// ── 파일 시스템 접근(File System Access API) ──
export function fileSystemAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

// ── 클립보드 ──
export function clipboardReadSupported() {
  return typeof navigator !== 'undefined' && !!navigator.clipboard?.read
}
/** 'granted' | 'prompt' | 'denied' | 'unknown' */
export async function clipboardReadPermission() {
  try {
    const s = await navigator.permissions.query({ name: 'clipboard-read' })
    return s.state
  } catch { return 'unknown' }
}
/** 사용자 제스처에서 호출 — read()로 권한 프롬프트 유도. 결과 상태 반환. */
export async function requestClipboardRead() {
  if (!clipboardReadSupported()) return 'unsupported'
  try { await navigator.clipboard.read(); return 'granted' }
  catch (e) { return e?.name === 'NotAllowedError' ? 'denied' : 'unknown' }
}

// ── 폰트 로딩 ──
/** 'loaded' | 'loading' | 'unknown' */
export function fontsStatus() {
  return (typeof document !== 'undefined' && document.fonts?.status) || 'unknown'
}
export async function fontsReady() {
  try { await document.fonts.ready; return true } catch { return false }
}

// ── 저장소 영속성(IndexedDB 보존) ──
export function storageSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.persist
}
export async function storagePersisted() {
  try { return (await navigator.storage?.persisted?.()) ?? false } catch { return false }
}
export async function requestStoragePersist() {
  try { return (await navigator.storage?.persist?.()) ?? false } catch { return false }
}
/** { usage, quota } in bytes, or null */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null
  } catch { return null }
}

/** 바이트 → 사람이 읽는 크기 */
export function formatBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`
}
