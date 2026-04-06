/**
 * FixtureManager
 * Flat 변환 결과를 JSON 픽스처로 캡처/저장/로드한다.
 * 앱에서 캡처 → JSON 다운로드 → src/test/fixtures/에 저장 → Vitest에서 로드.
 */

import { exportFlatHtml } from './FlatExporter.js'

/**
 * @typedef {{
 *   slideIndex: number,
 *   originalHtml: string,
 *   flatElements: object[],
 *   canvasSize: { w: number, h: number },
 *   flatHtml: string,
 *   timestamp: string,
 *   elementCount: number
 * }} SlideFixture
 */

/**
 * 현재 변환 상태에서 픽스처를 캡처한다.
 * 앱 내에서 호출 (라이브 DOM 접근 가능).
 * @param {number} slideIndex
 * @param {string} originalHtml — exportOriginalHtml() 결과
 * @param {object[]} flatElements
 * @param {{ w: number, h: number }} canvasSize
 * @returns {SlideFixture}
 */
export function captureFixture(slideIndex, originalHtml, flatElements, canvasSize) {
  const flatHtml = exportFlatHtml(flatElements, canvasSize)
  return {
    slideIndex,
    originalHtml,
    flatElements: flatElements.map(stripInternals),
    canvasSize,
    flatHtml,
    timestamp: new Date().toISOString(),
    elementCount: flatElements.length,
  }
}

/**
 * 전체 덱의 픽스처 매니페스트를 생성한다.
 * @param {SlideFixture[]} fixtures
 * @param {string} sourceFile
 * @returns {object}
 */
export function createManifest(fixtures, sourceFile) {
  return {
    sourceFile,
    capturedAt: new Date().toISOString(),
    slideCount: fixtures.length,
    slides: fixtures.map(f => ({
      index: f.slideIndex,
      elementCount: f.elementCount,
      timestamp: f.timestamp,
    })),
  }
}

/**
 * 픽스처 배열을 JSON 문자열로 직렬화한다.
 * @param {SlideFixture[]} fixtures
 * @returns {string}
 */
export function serializeFixtures(fixtures) {
  return JSON.stringify(fixtures, null, 2)
}

/**
 * JSON 문자열에서 픽스처 배열을 로드한다.
 * @param {string} json
 * @returns {SlideFixture[]}
 */
export function loadFixtures(json) {
  return JSON.parse(json)
}

/**
 * 단일 픽스처를 Blob URL로 다운로드한다.
 * @param {SlideFixture} fixture
 * @param {string} filename
 */
export function downloadFixture(fixture, filename) {
  const json = JSON.stringify(fixture, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 전체 덱 픽스처를 하나의 JSON 파일로 다운로드한다.
 * @param {SlideFixture[]} fixtures
 * @param {string} filename
 */
export function downloadAllFixtures(fixtures, filename) {
  const json = serializeFixtures(fixtures)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── 내부 헬퍼 ────────────────────────────────────────────────

/** 내부 필드(_domOrder, _originalZIndex) 제거 */
function stripInternals(el) {
  const { _domOrder, _originalZIndex, ...rest } = el
  return rest
}
