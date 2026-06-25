/**
 * 오디오 비주얼라이저 — 순수 기하/그리기 헬퍼.
 *
 * 편집 모드(정적 대표 프레임), 발표 모드(AnalyserNode 실시간), PPTX 스냅샷이
 * 동일한 drawViz/staticFrame을 공유한다. 막대는 '폭에 채우기'로 배치.
 */

/** 비주얼라이저 모양 선택지 (속성 패널 SelectInput용) */
export const VIZ_SHAPES = [
  { value: 'bars', label: '막대 (아래에서 위로)' },
  { value: 'mirror', label: '미러 (중앙 상하 분리)' },
]

/** 기본 비주얼라이저 설정 — 요소 생성·미설정 필드 보충에 사용 */
export const DEFAULT_VIZ = {
  shape: 'bars',     // 'bars' | 'mirror'
  barWidth: 6,       // 막대 두께(px)
  barGap: 3,         // 막대 간격(px)
  barRadius: 3,      // 막대 모서리 곡률(px)
  color: '#6366f1',  // 막대 색
  smoothing: 0.8,    // AnalyserNode smoothingTimeConstant (0~1, 클수록 부드럽게)
  sensitivity: 1,    // 막대 높이 배율(반응 민감도)
}

/** '폭에 채우기' — 요소 폭에 막대 두께+간격으로 채울 수 있는 막대 개수 */
export function barCount(width, barWidth, barGap) {
  const unit = Math.max(1, (barWidth || 1) + (barGap || 0))
  return Math.max(1, Math.floor(((width || 0) + (barGap || 0)) / unit))
}

/**
 * 편집 모드용 정적 대표 프레임 — 막대 높이(0~1) 배열.
 * 결정적(의사난수) 패턴이라 소리 없이도 모양/색/간격을 디자인할 수 있다.
 */
export function staticFrame(n, seed = 1) {
  const out = []
  for (let i = 0; i < n; i++) {
    // 사인 합성으로 부드러운 의사난수 — 가운데가 약간 높은 자연스러운 분포
    const v = Math.sin(i * 0.55 + seed) * 0.5 + Math.sin(i * 0.17 + 2.1) * 0.35 + Math.sin(i * 1.3) * 0.15
    out.push(0.12 + 0.88 * Math.abs(v))
  }
  return out
}

/**
 * AnalyserNode 주파수 바이트(0~255) → 막대 높이(0~1) 배열(n개).
 * 사람 귀에 의미 있는 저~중역대에 집중(상위 고역대는 거의 0이라 제외)하고,
 * n개 버킷으로 평균낸 뒤 sensitivity 배율·클램프.
 */
export function barsFromFrequency(freq, n, sensitivity = 1) {
  const out = new Array(n).fill(0)
  if (!freq || freq.length === 0) return out
  const usable = Math.max(1, Math.floor(freq.length * 0.7)) // 상위 30% 고역대 버림
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i / n) * usable)
    const end = Math.max(start + 1, Math.floor(((i + 1) / n) * usable))
    let sum = 0
    for (let j = start; j < end; j++) sum += freq[j]
    const avg = sum / (end - start) / 255 // 0~1
    out[i] = Math.max(0, Math.min(1, avg * sensitivity))
  }
  return out
}

/** 라운드 사각형 경로 (canvas 2d) */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * 막대 높이 배열(mags, 0~1)을 canvas 2d 컨텍스트에 그린다.
 * w/h는 논리 px(요소 크기). 막대는 폭 중앙 정렬로 채운다.
 */
export function drawViz(ctx, w, h, mags, vizIn) {
  const viz = { ...DEFAULT_VIZ, ...(vizIn || {}) }
  const { shape, barWidth, barGap, barRadius, color } = viz
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  const unit = Math.max(1, barWidth + barGap)
  const n = mags.length
  const totalW = n * unit - barGap
  let x = Math.max(0, (w - totalW) / 2) // 중앙 정렬
  const minBar = Math.max(1, barWidth * 0.06) // 무음 구간에도 살짝 보이는 최소 높이
  for (let i = 0; i < n; i++) {
    const m = Math.max(0, Math.min(1, mags[i] || 0))
    if (shape === 'mirror') {
      const half = Math.max(minBar / 2, (h / 2) * m)
      roundRectPath(ctx, x, h / 2 - half, barWidth, half * 2, barRadius)
    } else {
      const bh = Math.max(minBar, h * m)
      roundRectPath(ctx, x, h - bh, barWidth, bh, barRadius)
    }
    ctx.fill()
    x += unit
  }
}
