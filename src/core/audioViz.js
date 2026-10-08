/**
 * 오디오 비주얼라이저 — 순수 기하/그리기 헬퍼.
 *
 * 편집 모드(정적 대표 프레임), 발표 모드(AnalyserNode 실시간), PPTX 스냅샷, 내보낸 HTML의 재생 스크립트가
 * 같은 paintViz/vizBarsPerChannel/staticVizFrame/vizLiveFrame을 쓴다. 내보낸 HTML에는 이 함수들의 소스를
 * 그대로 넣으므로(VIZ_RUNTIME_SRC) 바깥 이름을 참조하지 않는 자립 함수여야 한다(빌드가 이름을 바꿔도 동작하도록).
 *
 * 모양: bars(막대) · mirror(중앙 상하) · wave(파형 선) · circle(원형) · blocks(LED 칸)
 * 채널: mono(하나로) · stereo(왼쪽·오른쪽 채널을 따로 — 막대·LED는 가운데에서 위(왼쪽)/아래(오른쪽),
 *       미러는 가운데에서 왼쪽/오른쪽으로 펼친 나비형, 파형은 위/아래 두 줄, 원형은 왼쪽/오른쪽 반원).
 *       오른쪽 채널 색은 color2(비우면 color).
 */

/** 비주얼라이저 모양 선택지 (속성 패널 SelectInput용) */
export const VIZ_SHAPES = [
  { value: 'bars', label: '막대 (아래에서 위로)' },
  { value: 'mirror', label: '미러 (중앙 상하 분리)' },
  { value: 'wave', label: '파형 (선)' },
  { value: 'circle', label: '원형 (둘레 막대)' },
  { value: 'blocks', label: 'LED 칸 (끊어진 막대)' },
]

/** 채널 선택지 */
export const VIZ_CHANNELS = [
  { value: 'mono', label: '모노 (하나로)' },
  { value: 'stereo', label: '스테레오 (왼쪽·오른쪽 따로)' },
]

/** 기본 비주얼라이저 설정 — 요소 생성·미설정 필드 보충에 사용 */
export const DEFAULT_VIZ = {
  shape: 'bars',     // VIZ_SHAPES
  channels: 'mono',  // 'mono' | 'stereo'
  barWidth: 6,       // 막대 두께(px) — 파형은 그 절반이 선 두께
  barGap: 3,         // 막대 간격(px)
  barRadius: 3,      // 막대 모서리 곡률(px)
  color: '#6366f1',  // 막대 색(스테레오면 왼쪽 채널)
  color2: '',        // 스테레오 오른쪽 채널 색(비우면 color)
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

/** 채널 하나에 필요한 막대 수 — 모양·채널·크기에 따라. (자립 함수) */
export function vizBarsPerChannel(w, h, vizIn) {
  const v = Object.assign({ shape: 'bars', channels: 'mono', barWidth: 6, barGap: 3 }, vizIn || {})
  const unit = Math.max(1, (v.barWidth || 1) + (v.barGap || 0))
  const across = Math.max(1, Math.floor(((w || 0) + (v.barGap || 0)) / unit))
  if (v.shape === 'circle') {
    // 둘레(안쪽 원) 기준으로 막대를 채우고 반원 하나 분량을 돌려준다 — 나머지 반원은 거울(모노) 또는 오른쪽 채널
    const r0 = Math.min(w || 0, h || 0) * 0.22
    const total = Math.max(16, Math.min(180, Math.round((2 * Math.PI * r0) / unit)))
    return Math.ceil(total / 2)
  }
  if (v.shape === 'mirror' && v.channels === 'stereo') return Math.max(1, Math.floor(across / 2))
  return across
}

/** 편집 미리보기·PPTX용 정적 프레임 — 채널별 막대 높이와 파형 표본(결정적). (자립 함수) */
export function staticVizFrame(w, h, vizIn) {
  const v = Object.assign({ shape: 'bars', channels: 'mono', barWidth: 6, barGap: 3 }, vizIn || {})
  const unit = Math.max(1, (v.barWidth || 1) + (v.barGap || 0))
  let n = Math.max(1, Math.floor(((w || 0) + (v.barGap || 0)) / unit))
  if (v.shape === 'circle') n = Math.ceil(Math.max(16, Math.min(180, Math.round((2 * Math.PI * Math.min(w || 0, h || 0) * 0.22) / unit))) / 2)
  else if (v.shape === 'mirror' && v.channels === 'stereo') n = Math.max(1, Math.floor(n / 2))
  const mags = (seed) => {
    const o = []
    for (let i = 0; i < n; i++) {
      const s = Math.sin(i * 0.55 + seed) * 0.5 + Math.sin(i * 0.17 + 2.1) * 0.35 + Math.sin(i * 1.3) * 0.15
      o.push(0.12 + 0.88 * Math.abs(s))
    }
    return o
  }
  const wave = (ph) => {
    const o = []
    for (let i = 0; i < 128; i++) {
      const t = i / 127
      o.push(Math.sin(t * Math.PI * 6 + ph) * 0.6 * Math.sin(t * Math.PI) + Math.sin(t * Math.PI * 23 + ph * 2) * 0.15)
    }
    return o
  }
  return { L: mags(1), R: mags(2.4), waveL: wave(0), waveR: wave(1.3) }
}

/**
 * 분석기(AnalyserNode)에서 지금 프레임을 읽는다. nodes = { L, R?, waveL?, waveR? } — R이 없으면 모노(L만).
 * waveL/waveR은 파형용으로 창이 긴 분석기(없으면 L/R).
 * 파형 모양이면 시간 영역 표본(−1~1), 아니면 주파수 막대 높이(0~1, n개). (자립 함수)
 */
export function vizLiveFrame(nodes, n, vizIn) {
  const v = Object.assign({ shape: 'bars', sensitivity: 1 }, vizIn || {})
  const sens = v.sensitivity || 1
  const wave = v.shape === 'wave'
  const read = (an) => {
    if (!an) return null
    if (wave) {
      const buf = new Uint8Array(an.fftSize)
      an.getByteTimeDomainData(buf)
      const o = []
      // 표본을 512개쯤으로 줄여 그린다 — 너무 성기게 솎으면 높은 소리가 느린 물결로 잘못 보인다(앨리어싱)
      const step = Math.max(1, Math.floor(buf.length / 512))
      for (let i = 0; i < buf.length; i += step) o.push(Math.max(-1, Math.min(1, ((buf[i] - 128) / 128) * sens)))
      return o
    }
    const buf = new Uint8Array(an.frequencyBinCount)
    an.getByteFrequencyData(buf)
    const out = new Array(n).fill(0)
    const usable = Math.max(1, Math.floor(buf.length * 0.7))
    for (let i = 0; i < n; i++) {
      const s = Math.floor((i / n) * usable)
      const e = Math.max(s + 1, Math.floor(((i + 1) / n) * usable))
      let sum = 0
      for (let j = s; j < e; j++) sum += buf[j]
      out[i] = Math.max(0, Math.min(1, (sum / (e - s) / 255) * sens))
    }
    return out
  }
  const nl = nodes && (wave ? nodes.waveL || nodes.L : nodes.L)
  const nr = nodes && (wave ? nodes.waveR || nodes.R : nodes.R)
  const l = read(nl)
  const r = nr ? read(nr) : l
  return wave ? { L: [], R: [], waveL: l, waveR: r } : { L: l || [], R: r || l || [] }
}

/**
 * 프레임을 그린다. frame = { L: 높이(0~1)[], R?: 높이[], waveL?: 표본(−1~1)[], waveR?: 표본[] }
 * w/h는 논리 px(요소 크기). (자립 함수)
 */
export function paintViz(ctx, w, h, frame, vizIn) {
  const v = Object.assign({ shape: 'bars', channels: 'mono', barWidth: 6, barGap: 3, barRadius: 3, color: '#6366f1', color2: '' }, vizIn || {})
  const stereo = v.channels === 'stereo'
  const cL = v.color, cR = v.color2 || v.color
  const L = (frame && frame.L) || [], R = (frame && frame.R) || L
  const bw = Math.max(1, v.barWidth), gap = Math.max(0, v.barGap), unit = bw + gap
  const minBar = Math.max(1, bw * 0.06)  // 무음 구간에도 살짝 보이는 최소 길이
  const clamp = (m) => Math.max(0, Math.min(1, m || 0))
  const rr = (x, y, rw, rh, r) => {
    const q = Math.max(0, Math.min(r, rw / 2, rh / 2))
    ctx.beginPath()
    ctx.moveTo(x + q, y)
    ctx.arcTo(x + rw, y, x + rw, y + rh, q)
    ctx.arcTo(x + rw, y + rh, x, y + rh, q)
    ctx.arcTo(x, y + rh, x, y, q)
    ctx.arcTo(x, y, x + rw, y, q)
    ctx.closePath()
    ctx.fill()
  }
  // LED 칸: 기준선(base)에서 dir(−1 위 / +1 아래) 방향으로 len/maxLen 비율만큼 칸을 켠다
  const blocks = (x, base, m, maxLen, dir) => {
    const seg = Math.max(2, bw), step = seg + Math.max(1, gap)
    const total = Math.max(1, Math.floor((maxLen + Math.max(1, gap)) / step))
    const lit = Math.max(1, Math.round(m * total))
    for (let k = 0; k < lit; k++) {
      const y = dir < 0 ? base - k * step - seg : base + k * step
      rr(x, y, bw, seg, Math.min(v.barRadius, seg / 2))
    }
  }
  ctx.clearRect(0, 0, w, h)

  if (v.shape === 'wave') {
    const line = (samples, cy, amp, color) => {
      if (!samples || samples.length < 2) return
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(1.5, bw / 2)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      const n = samples.length
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w
        const y = cy - Math.max(-1, Math.min(1, samples[i] || 0)) * amp
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    const wl = frame && frame.waveL, wr = (frame && frame.waveR) || wl
    if (stereo) { line(wl, h * 0.25, h * 0.22, cL); line(wr, h * 0.75, h * 0.22, cR) }
    else line(wl, h / 2, h * 0.45, cL)
    return
  }

  if (v.shape === 'circle') {
    const cx = w / 2, cy = h / 2
    const r0 = Math.min(w, h) * 0.22
    const maxLen = Math.max(2, Math.min(w, h) / 2 - r0 - 1)
    const half = L.length, total = half * 2
    // 위(12시)에서 시계 방향 — 오른쪽 반원은 오른쪽 채널(모노면 같은 값), 왼쪽 반원은 왼쪽 채널을 거울로.
    // 그래서 낮은 소리가 12시, 높은 소리가 6시 쪽에 온다.
    for (let i = 0; i < total; i++) {
      const right = i < half
      const k = right ? i : total - 1 - i
      const m = clamp(right ? R[k] : L[k])
      const len = Math.max(minBar, maxLen * m)
      const ang = -Math.PI / 2 + ((i + 0.5) / total) * Math.PI * 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(ang)
      ctx.fillStyle = stereo && right ? cR : cL
      rr(r0, -bw / 2, len, bw, v.barRadius)
      ctx.restore()
    }
    return
  }

  if (v.shape === 'mirror' && stereo) {
    // 나비형: 가운데에서 왼쪽으로 왼쪽 채널, 오른쪽으로 오른쪽 채널(낮은 소리가 가운데)
    const n = L.length, cx = w / 2
    for (let i = 0; i < n; i++) {
      const hl = Math.max(minBar / 2, (h / 2) * clamp(L[i]))
      const hr = Math.max(minBar / 2, (h / 2) * clamp(R[i]))
      ctx.fillStyle = cL
      rr(cx - gap / 2 - i * unit - bw, h / 2 - hl, bw, hl * 2, v.barRadius)
      ctx.fillStyle = cR
      rr(cx + gap / 2 + i * unit, h / 2 - hr, bw, hr * 2, v.barRadius)
    }
    return
  }

  // 막대 · 미러(모노) · LED 칸 — 폭 가운데 정렬
  const n = L.length
  const totalW = n * unit - gap
  let x = Math.max(0, (w - totalW) / 2)
  const mid = h / 2, halfH = Math.max(1, h / 2 - 1)
  for (let i = 0; i < n; i++) {
    const ml = clamp(L[i]), mr = clamp(R[i])
    if (v.shape === 'mirror') {
      ctx.fillStyle = cL
      const hf = Math.max(minBar / 2, (h / 2) * ml)
      rr(x, mid - hf, bw, hf * 2, v.barRadius)
    } else if (stereo) {
      // 위 = 왼쪽 채널(가운데에서 위로), 아래 = 오른쪽 채널(가운데에서 아래로), 사이 2px 틈
      ctx.fillStyle = cL
      if (v.shape === 'blocks') blocks(x, mid - 1, ml, halfH, -1)
      else { const a = Math.max(minBar, halfH * ml); rr(x, mid - 1 - a, bw, a, v.barRadius) }
      ctx.fillStyle = cR
      if (v.shape === 'blocks') blocks(x, mid + 1, mr, halfH, 1)
      else { const b = Math.max(minBar, halfH * mr); rr(x, mid + 1, bw, b, v.barRadius) }
    } else {
      ctx.fillStyle = cL
      if (v.shape === 'blocks') blocks(x, h, ml, h, -1)
      else { const bh = Math.max(minBar, h * ml); rr(x, h - bh, bw, bh, v.barRadius) }
    }
    x += unit
  }
}

/** (이전 API) 막대 높이 배열(mags, 0~1) 하나를 그린다 — 두 채널에 같은 값. */
export function drawViz(ctx, w, h, mags, vizIn) {
  paintViz(ctx, w, h, { L: mags, R: mags }, { ...DEFAULT_VIZ, ...(vizIn || {}) })
}

/** 정적 미리보기 한 장을 그린다(편집 화면·PPTX 스냅샷). */
export function paintStaticViz(ctx, w, h, vizIn) {
  const v = { ...DEFAULT_VIZ, ...(vizIn || {}) }
  paintViz(ctx, w, h, staticVizFrame(w, h, v), v)
}

/**
 * 내보낸 HTML 재생 스크립트에 넣을 함수 소스. 빌드가 함수 이름을 바꿔도 되도록 var에 담아 넣는다:
 * `var vizBarsPerChannel=(…); var staticVizFrame=(…); var vizLiveFrame=(…); var paintViz=(…);`
 */
export const VIZ_RUNTIME_SRC = [
  ['vizBarsPerChannel', vizBarsPerChannel],
  ['staticVizFrame', staticVizFrame],
  ['vizLiveFrame', vizLiveFrame],
  ['paintViz', paintViz],
].map(([name, fn]) => `var ${name}=(${fn.toString()});`).join('\n')
