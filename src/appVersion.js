/* global __APP_VERSION__ */
// 빌드 시 vite define으로 주입되는 에디터 버전(git short SHA). 미주입 환경(테스트 등)은 'dev'.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
