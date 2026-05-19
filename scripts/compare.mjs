/**
 * compare.mjs
 * 레퍼런스 PNG(원본 HTML 렌더링)와 float-editor 내보내기 PNG를 픽셀 단위로 비교
 *
 * 사용법:
 *   node scripts/compare.mjs [reference-dir] [exported-dir] [diff-dir]
 *
 * 기본값:
 *   reference: scripts/reference-pngs/
 *   exported:  ~/Downloads/  (slide-N.png 파일)
 *   diff:      scripts/diff-pngs/
 *
 * 출력:
 *   - diff PNG (차이 픽셀 빨간색 강조)
 *   - 콘솔 리포트 (슬라이드별 픽셀 차이 %, 주요 문제 영역)
 */

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const REFERENCE_DIR = process.argv[2] || resolve(__dirname, 'reference-pngs')
const EXPORTED_DIR  = process.argv[3] || resolve(process.env.HOME, 'Downloads')
const DIFF_DIR      = process.argv[4] || resolve(__dirname, 'diff-pngs')

const THRESHOLD = 0.1 // 픽셀 차이 허용 임계값 (0~1)

async function main() {
  mkdirSync(DIFF_DIR, { recursive: true })

  if (!existsSync(REFERENCE_DIR)) {
    console.error(`레퍼런스 디렉토리 없음: ${REFERENCE_DIR}`)
    console.error('먼저 gen-reference.mjs를 실행하세요.')
    process.exit(1)
  }

  // 레퍼런스 파일 목록
  const refFiles = readdirSync(REFERENCE_DIR)
    .filter(f => f.match(/^slide-\d+\.png$/))
    .sort()

  if (refFiles.length === 0) {
    console.error('레퍼런스 PNG 없음. gen-reference.mjs를 먼저 실행하세요.')
    process.exit(1)
  }

  const results = []

  for (const refFile of refFiles) {
    const slideNum = refFile.match(/slide-(\d+)/)?.[1]
    if (!slideNum) continue

    const refPath = resolve(REFERENCE_DIR, refFile)

    // 내보내기 파일 탐색: slide-N.png 또는 slide-0N.png
    const exportCandidates = [
      resolve(EXPORTED_DIR, `slide-${parseInt(slideNum)}.png`),
      resolve(EXPORTED_DIR, `slide-${slideNum}.png`),
      resolve(EXPORTED_DIR, `slide-export.png`), // 단일 파일 내보내기
    ]
    const exportPath = exportCandidates.find(p => existsSync(p))

    if (!exportPath) {
      console.log(`  ⚠️  slide-${slideNum}: 내보내기 PNG 없음 (${EXPORTED_DIR}/slide-${parseInt(slideNum)}.png)`)
      results.push({ slide: parseInt(slideNum), diffPct: null, missing: true })
      continue
    }

    const refPng = PNG.sync.read(readFileSync(refPath))
    const expPng = PNG.sync.read(readFileSync(exportPath))

    // 크기 맞추기 (내보내기 PNG가 2x scale일 수 있음)
    const { ref: refResized, exp: expResized } = matchSizes(refPng, expPng)

    const { width, height } = refResized
    const diffPng = new PNG({ width, height })

    const diffPixels = pixelmatch(
      refResized.data, expResized.data, diffPng.data,
      width, height,
      { threshold: THRESHOLD, includeAA: false }
    )

    const totalPixels = width * height
    const diffPct = (diffPixels / totalPixels * 100).toFixed(2)

    // diff PNG 저장
    const diffPath = resolve(DIFF_DIR, `diff-${slideNum}.png`)
    writeFileSync(diffPath, PNG.sync.write(diffPng))

    // 차이 영역 분석
    const regions = analyzeDiffRegions(diffPng, width, height)

    const grade = diffPct < 1 ? '✅' : diffPct < 5 ? '🟡' : '🔴'
    console.log(`  ${grade} slide-${slideNum}: ${diffPct}% 다름 (${diffPixels.toLocaleString()}px / ${totalPixels.toLocaleString()}px)`)
    if (regions.length > 0) {
      regions.forEach(r => console.log(`       └ 문제 영역: x=${r.x}~${r.x+r.w}, y=${r.y}~${r.y+r.h} (${r.density}% 밀도)`))
    }

    results.push({ slide: parseInt(slideNum), diffPct: parseFloat(diffPct), diffPixels, totalPixels, regions })
  }

  // 종합 리포트
  const valid = results.filter(r => r.diffPct !== null)
  if (valid.length > 0) {
    const avg = (valid.reduce((s, r) => s + r.diffPct, 0) / valid.length).toFixed(2)
    const worst = valid.sort((a, b) => b.diffPct - a.diffPct)[0]
    console.log(`\n─── 종합 ───`)
    console.log(`평균 차이: ${avg}%`)
    console.log(`최악 슬라이드: slide-${worst.slide} (${worst.diffPct}%)`)
    console.log(`diff PNG 저장: ${DIFF_DIR}`)
  }

  // JSON 리포트 저장
  const reportPath = resolve(DIFF_DIR, 'report.json')
  writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`리포트: ${reportPath}`)
}

/**
 * 두 PNG의 크기를 맞춤 (작은 쪽 기준, 비율 유지)
 */
function matchSizes(refPng, expPng) {
  // 내보내기가 2x scale인 경우: 가로 크기 비율로 감지
  const scale = expPng.width / refPng.width

  if (Math.abs(scale - 2) < 0.1) {
    // 내보내기가 2x → 레퍼런스를 2x로 업스케일하거나 내보내기를 다운스케일
    // 간단하게: 둘 다 레퍼런스 해상도로 맞춤 (내보내기 다운스케일)
    const downscaled = downsample(expPng, refPng.width, refPng.height)
    return { ref: refPng, exp: downscaled }
  }

  if (refPng.width !== expPng.width || refPng.height !== expPng.height) {
    // 크기 다름 → 작은 쪽 기준 크롭
    const w = Math.min(refPng.width, expPng.width)
    const h = Math.min(refPng.height, expPng.height)
    return {
      ref: crop(refPng, w, h),
      exp: crop(expPng, w, h),
    }
  }

  return { ref: refPng, exp: expPng }
}

/**
 * 간단한 다운샘플링 (픽셀 평균)
 */
function downsample(src, dstW, dstH) {
  const dst = new PNG({ width: dstW, height: dstH })
  const scaleX = src.width / dstW
  const scaleY = src.height / dstH

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.floor(x * scaleX)
      const srcY = Math.floor(y * scaleY)
      const srcIdx = (srcY * src.width + srcX) * 4
      const dstIdx = (y * dstW + x) * 4
      dst.data[dstIdx]     = src.data[srcIdx]
      dst.data[dstIdx + 1] = src.data[srcIdx + 1]
      dst.data[dstIdx + 2] = src.data[srcIdx + 2]
      dst.data[dstIdx + 3] = src.data[srcIdx + 3]
    }
  }
  return dst
}

/**
 * PNG를 주어진 크기로 크롭
 */
function crop(png, w, h) {
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * png.width + x) * 4
      const dstIdx = (y * w + x) * 4
      out.data[dstIdx]     = png.data[srcIdx]
      out.data[dstIdx + 1] = png.data[srcIdx + 1]
      out.data[dstIdx + 2] = png.data[srcIdx + 2]
      out.data[dstIdx + 3] = png.data[srcIdx + 3]
    }
  }
  return out
}

/**
 * diff PNG에서 차이가 집중된 영역 분석 (간단 그리드 방식)
 */
function analyzeDiffRegions(diffPng, width, height) {
  const GRID = 8 // 8x8 그리드로 분할
  const cellW = Math.floor(width / GRID)
  const cellH = Math.floor(height / GRID)
  const cells = []

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let diffCount = 0
      const x0 = gx * cellW, y0 = gy * cellH
      const x1 = x0 + cellW, y1 = y0 + cellH

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4
          // pixelmatch diff: 빨간 채널만 255인 픽셀 = 차이 픽셀
          if (diffPng.data[idx] > 200 && diffPng.data[idx + 1] < 50) {
            diffCount++
          }
        }
      }

      const density = Math.round(diffCount / (cellW * cellH) * 100)
      if (density > 5) {
        cells.push({ x: x0, y: y0, w: cellW, h: cellH, density })
      }
    }
  }

  // 밀도 높은 순서로 정렬, 상위 3개만
  return cells.sort((a, b) => b.density - a.density).slice(0, 3)
}

main().catch(e => { console.error(e); process.exit(1) })
