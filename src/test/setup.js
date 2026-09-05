import '@testing-library/jest-dom'

/**
 * localStorage 폴리필 (테스트 전용).
 *
 * Node 26은 자체 실험적 `localStorage` 전역을 정의하는데, `--localstorage-file` 없이는
 * 값이 undefined다. 이 전역 접근자가 jsdom의 window.localStorage를 가려버려서
 * (sessionStorage는 정상 동작) 설정을 localStorage에 저장하는 모듈의 테스트가
 * `Cannot read properties of undefined (reading 'clear')`로 무더기 실패했다.
 *
 * 없을 때만 Web Storage API와 동일한 메모리 구현으로 채운다. 프로덕션 코드엔 영향 없음.
 */
if (!globalThis.localStorage) {
  const store = new Map()
  const memoryStorage = {
    get length() { return store.size },
    key(i) { return [...store.keys()][i] ?? null },
    getItem(k) { const key = String(k); return store.has(key) ? store.get(key) : null },
    setItem(k, v) { store.set(String(k), String(v)) },
    removeItem(k) { store.delete(String(k)) },
    clear() { store.clear() },
  }
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage, configurable: true, writable: true,
    })
  } catch {
    // 접근자가 재정의 불가면 setter 경유로 시도(그마저 막히면 테스트가 원래대로 실패)
    try { globalThis.localStorage = memoryStorage } catch { /* ignore */ }
  }
}
