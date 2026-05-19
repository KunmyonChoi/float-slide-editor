/**
 * BlobStore — IndexedDB 기반 대용량 바이너리(영상/이미지) 저장소
 *
 * 요소의 content에 "idb://<key>" 참조를 저장하고,
 * 실제 바이너리는 IndexedDB에 보관한다.
 *
 * 사용:
 *   const key = await BlobStore.put(file)       // File/Blob → key
 *   const blobUrl = await BlobStore.getUrl(key)  // key → blob URL (캐시됨)
 *   const blob = await BlobStore.get(key)        // key → Blob
 *   await BlobStore.delete(key)                  // 삭제
 */

const DB_NAME = 'float-editor-blobs'
const DB_VERSION = 1
const STORE_NAME = 'blobs'

let _db = null
const _urlCache = new Map()  // key → blobURL (메모리 캐시)

function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Blob/File을 IndexedDB에 저장하고 키를 반환한다.
 * @param {Blob|File} blob
 * @param {string} [key] - 지정하지 않으면 자동 생성 (hash 기반)
 * @returns {Promise<string>} idb:// 접두사 없는 순수 키
 */
async function put(blob, key) {
  if (!key) {
    // 파일 이름 + 크기 + 시간 기반 키
    const name = blob.name || 'blob'
    key = `${name}-${blob.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(blob, key)
    tx.oncomplete = () => resolve(key)
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * IndexedDB에서 Blob을 가져온다.
 * @param {string} key
 * @returns {Promise<Blob|null>}
 */
async function get(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Blob URL을 반환한다 (캐시됨 — 같은 키에 대해 한번만 생성).
 * @param {string} key
 * @returns {Promise<string|null>} blob:// URL
 */
async function getUrl(key) {
  if (_urlCache.has(key)) return _urlCache.get(key)
  const blob = await get(key)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  _urlCache.set(key, url)
  return url
}

/**
 * IndexedDB에서 삭제한다.
 * @param {string} key
 */
async function remove(key) {
  // blob URL 해제
  if (_urlCache.has(key)) {
    URL.revokeObjectURL(_urlCache.get(key))
    _urlCache.delete(key)
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * 모든 키 목록을 반환한다.
 * @returns {Promise<string[]>}
 */
async function keys() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * content 문자열이 IndexedDB 참조인지 확인한다.
 * @param {string} content
 * @returns {boolean}
 */
function isIdbRef(content) {
  return typeof content === 'string' && content.startsWith('idb://')
}

/**
 * "idb://key" 에서 key를 추출한다.
 * @param {string} ref
 * @returns {string}
 */
function parseRef(ref) {
  return ref.slice(6) // 'idb://'.length === 6
}

/**
 * key를 "idb://key" 참조 문자열로 만든다.
 * @param {string} key
 * @returns {string}
 */
function toRef(key) {
  return `idb://${key}`
}

export const BlobStore = { put, get, getUrl, remove, keys, isIdbRef, parseRef, toRef }
export default BlobStore
