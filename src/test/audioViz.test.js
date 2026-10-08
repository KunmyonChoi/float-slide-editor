import { describe, it, expect } from 'vitest'
import { DEFAULT_VIZ, VIZ_SHAPES, VIZ_CHANNELS, barCount, staticFrame, barsFromFrequency, drawViz, paintViz, vizBarsPerChannel, staticVizFrame, vizLiveFrame, VIZ_RUNTIME_SRC } from '../core/audioViz'

describe('audioViz — 순수 헬퍼', () => {
  it('barCount: 폭에 채우기 (두께+간격 단위로 분할)', () => {
    // width 100, bar 6 + gap 4 = unit 10 → floor((100+4)/10)=10
    expect(barCount(100, 6, 4)).toBe(10)
    // 폭 0 이하라도 최소 1
    expect(barCount(0, 6, 3)).toBe(1)
    // 간격 0
    expect(barCount(50, 5, 0)).toBe(10)
  })

  it('staticFrame: 길이 n, 값은 0.12~1 범위, 결정적', () => {
    const a = staticFrame(20)
    const b = staticFrame(20)
    expect(a.length).toBe(20)
    expect(a).toEqual(b) // 결정적
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0.12 - 1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9) }
  })

  it('barsFromFrequency: 길이 n, 0~1 클램프, sensitivity 배율', () => {
    const freq = new Uint8Array(128).fill(128) // 중간값
    const out = barsFromFrequency(freq, 16, 1)
    expect(out.length).toBe(16)
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    // sensitivity 2배 → 값이 더 큼(클램프 전 비교 위해 작은 입력)
    const low = new Uint8Array(128).fill(40)
    const o1 = barsFromFrequency(low, 8, 1)
    const o2 = barsFromFrequency(low, 8, 2)
    expect(o2[0]).toBeGreaterThan(o1[0])
    // 빈 입력 → 0 배열
    expect(barsFromFrequency(new Uint8Array(0), 4, 1)).toEqual([0, 0, 0, 0])
  })

  it('drawViz: bars/mirror 모두 막대 수만큼 채움 호출(fake ctx)', () => {
    const calls = { fill: 0, clearRect: 0, beginPath: 0 }
    const ctx = {
      clearRect: () => calls.clearRect++,
      beginPath: () => calls.beginPath++,
      moveTo: () => {}, arcTo: () => {}, closePath: () => {},
      fill: () => calls.fill++,
      set fillStyle(v) {}, get fillStyle() { return '' },
    }
    const mags = [0.2, 0.5, 1, 0.1]
    drawViz(ctx, 100, 50, mags, { ...DEFAULT_VIZ, shape: 'bars' })
    expect(calls.clearRect).toBe(1)
    expect(calls.fill).toBe(4) // 막대 4개
    calls.fill = 0
    drawViz(ctx, 100, 50, mags, { ...DEFAULT_VIZ, shape: 'mirror' })
    expect(calls.fill).toBe(4)
  })

  it('VIZ_SHAPES/DEFAULT_VIZ 노출', () => {
    expect(VIZ_SHAPES.map(s => s.value)).toContain('bars')
    expect(VIZ_SHAPES.map(s => s.value)).toContain('mirror')
    expect(DEFAULT_VIZ.shape).toBe('bars')
  })
})

// 그리기 호출을 세는 가짜 캔버스 — fillStyle 순서도 기록
function fakeCtx() {
  const calls = { fill: 0, stroke: 0, colors: [], moves: [] }
  let fs = ''
  const ctx = {
    calls,
    clearRect() {}, beginPath() {}, closePath() {}, arcTo() {},
    moveTo(x, y) { calls.moves.push([x, y]) }, lineTo() {},
    fill() { calls.fill++; calls.colors.push(fs) }, stroke() { calls.stroke++; calls.colors.push(ctx.strokeStyle) },
    save() {}, restore() {}, translate() {}, rotate() {},
    set fillStyle(v) { fs = v }, get fillStyle() { return fs },
    strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
  }
  return ctx
}

describe('audioViz — 모양 5종 · 스테레오', () => {
  const V = (o) => ({ ...DEFAULT_VIZ, color: '#aa0000', color2: '#00bb00', ...o })

  it('새 모양과 채널 선택지가 노출된다', () => {
    expect(VIZ_SHAPES.map(s => s.value)).toEqual(['bars', 'mirror', 'wave', 'circle', 'blocks'])
    expect(VIZ_CHANNELS.map(s => s.value)).toEqual(['mono', 'stereo'])
    expect(DEFAULT_VIZ.channels).toBe('mono')
  })

  it('막대 스테레오: 막대마다 위(왼쪽 색)·아래(오른쪽 색) 두 번 칠한다', () => {
    const ctx = fakeCtx()
    paintViz(ctx, 100, 60, { L: [0.5, 1, 0.2], R: [0.1, 0.4, 0.9] }, V({ shape: 'bars', channels: 'stereo' }))
    expect(ctx.calls.fill).toBe(6)
    expect(ctx.calls.colors).toEqual(['#aa0000', '#00bb00', '#aa0000', '#00bb00', '#aa0000', '#00bb00'])
  })

  it('미러 스테레오: 가운데에서 왼쪽은 왼쪽 채널, 오른쪽은 오른쪽 채널(나비형)', () => {
    const ctx = fakeCtx()
    paintViz(ctx, 200, 60, { L: [1, 0.5], R: [0.3, 0.2] }, V({ shape: 'mirror', channels: 'stereo' }))
    expect(ctx.calls.fill).toBe(4)
    const xs = ctx.calls.moves.map(m => m[0])
    // 왼쪽 채널 막대는 가운데(100)보다 왼쪽, 오른쪽 채널 막대는 오른쪽
    expect(xs[0]).toBeLessThan(100); expect(xs[1]).toBeGreaterThan(100)
    expect(xs[2]).toBeLessThan(xs[0]); expect(xs[3]).toBeGreaterThan(xs[1])
  })

  it('파형: 모노는 선 1줄, 스테레오는 위·아래 2줄(각 채널 색)', () => {
    const wave = Array.from({ length: 32 }, (_, i) => Math.sin(i))
    const mono = fakeCtx()
    paintViz(mono, 300, 80, { L: [], waveL: wave }, V({ shape: 'wave' }))
    expect(mono.calls.stroke).toBe(1)
    const st = fakeCtx()
    paintViz(st, 300, 80, { L: [], waveL: wave, waveR: wave }, V({ shape: 'wave', channels: 'stereo' }))
    expect(st.calls.stroke).toBe(2)
    expect(st.calls.colors).toEqual(['#aa0000', '#00bb00'])
  })

  it('원형: 반원 분량 n개 → 막대 2n개, 스테레오면 오른쪽 반원이 오른쪽 채널 색', () => {
    const v = V({ shape: 'circle', channels: 'stereo' })
    const n = vizBarsPerChannel(300, 300, v)
    expect(n).toBeGreaterThanOrEqual(8)
    const f = staticVizFrame(300, 300, v)
    expect(f.L).toHaveLength(n)
    const ctx = fakeCtx()
    paintViz(ctx, 300, 300, f, v)
    expect(ctx.calls.fill).toBe(n * 2)
    expect(ctx.calls.colors.slice(0, n).every(c => c === '#00bb00')).toBe(true)
    expect(ctx.calls.colors.slice(n).every(c => c === '#aa0000')).toBe(true)
  })

  it('LED 칸: 큰 값일수록 켜지는 칸이 많다', () => {
    const lo = fakeCtx(), hi = fakeCtx()
    paintViz(lo, 20, 100, { L: [0.1] }, V({ shape: 'blocks', barWidth: 6, barGap: 3 }))
    paintViz(hi, 20, 100, { L: [1] }, V({ shape: 'blocks', barWidth: 6, barGap: 3 }))
    expect(hi.calls.fill).toBeGreaterThan(lo.calls.fill)
    expect(hi.calls.fill).toBe(Math.floor((100 + 3) / 9))
  })

  it('미러 스테레오는 채널당 막대 수가 절반', () => {
    const mono = vizBarsPerChannel(400, 80, V({ shape: 'mirror' }))
    const st = vizBarsPerChannel(400, 80, V({ shape: 'mirror', channels: 'stereo' }))
    expect(st).toBe(Math.floor(mono / 2))
    expect(staticVizFrame(400, 80, V({ shape: 'mirror', channels: 'stereo' })).L).toHaveLength(st)
  })

  it('vizLiveFrame: 스테레오는 두 분석기를 따로 읽고, 파형은 시간 영역 표본을 −1~1로', () => {
    const an = (val) => ({
      fftSize: 256, frequencyBinCount: 128,
      getByteFrequencyData: (b) => b.fill(val), getByteTimeDomainData: (b) => b.fill(val),
    })
    const f = vizLiveFrame({ L: an(255), R: an(0) }, 4, V({ channels: 'stereo' }))
    expect(f.L).toEqual([1, 1, 1, 1]); expect(f.R).toEqual([0, 0, 0, 0])
    const mono = vizLiveFrame({ L: an(255) }, 3, V({}))
    expect(mono.R).toEqual(mono.L)
    const w = vizLiveFrame({ L: an(255), R: an(0) }, 4, V({ shape: 'wave', channels: 'stereo' }))
    expect(w.waveL.length).toBe(256) // fftSize 256 → 솎지 않음
    expect(w.waveL[0]).toBeCloseTo(127 / 128); expect(w.waveR[0]).toBe(-1)
  })

  it('VIZ_RUNTIME_SRC: 내보낸 HTML 안에서 그대로 실행된다(바깥 이름에 기대지 않음)', () => {
    const run = new Function(`${VIZ_RUNTIME_SRC}; return { paintViz, staticVizFrame, vizBarsPerChannel, vizLiveFrame }`)
    const rt = run()
    const v = V({ shape: 'circle', channels: 'stereo' })
    const ctx = fakeCtx()
    rt.paintViz(ctx, 200, 200, rt.staticVizFrame(200, 200, v), v)
    expect(ctx.calls.fill).toBe(rt.vizBarsPerChannel(200, 200, v) * 2)
  })
})
