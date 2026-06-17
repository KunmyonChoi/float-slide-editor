/**
 * RecentProjects — 최근 연/저장한 프로젝트 파일을 기억(최대 5개).
 *
 * File System Access API의 FileSystemFileHandle은 IndexedDB에 구조화 복제로 저장 가능해서,
 * 다음 세션에서도 (권한 재요청 후) 같은 파일을 다시 열 수 있다.
 * 핸들이 없는 폴백 브라우저(Firefox/Safari)에서는 재열기가 불가하므로 저장하지 않는다.
 */

const DB_NAME = 'genitor-recents'
const STORE = 'recents'
const VERSION = 1
const MAX = 5

let _dbPromise = null
function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

async function getAllRaw() {
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch { return [] }
}

/** 최근 항목 목록(최신순, 최대 5). [{ name, handle, time }] */
export async function getRecents() {
  const list = await getAllRaw()
  return list.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, MAX)
}

/** 최근 항목 추가/갱신. handle 없으면(폴백) 무시. */
export async function addRecent(handle, name) {
  if (!handle || !name) return
  try {
    const db = await openDB()
    // 같은 name은 keyPath로 자동 덮어쓰기(시간 갱신)
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').put({ name, handle, time: Date.now() })
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    // 5개 초과분(오래된 것) 정리
    const list = await getAllRaw()
    if (list.length > MAX) {
      const old = list.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(MAX)
      const store = tx(await openDB(), 'readwrite')
      old.forEach(e => store.delete(e.name))
    }
  } catch { /* IndexedDB 실패는 무시(기능 저하만) */ }
}

/** 항목 제거(파일이 이동/삭제돼 열기 실패 시 등). */
export async function removeRecent(name) {
  if (!name) return
  try {
    const db = await openDB()
    await new Promise((resolve) => {
      const req = tx(db, 'readwrite').delete(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch { /* 무시 */ }
}
