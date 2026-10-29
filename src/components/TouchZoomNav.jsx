import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isBackgroundElement } from '../core/SnapEngine'
import { visibleRect, panToCenter, minimapSize, zoomRange, scaleToT, snapZoom } from '../core/viewNav'
import { createOneEuro2D } from '../core/oneEuro'

/**
 * 터치 기기용 화면 이동 내비게이터 — 캔버스 우하단(데스크톱의 ZoomControl 자리).
 *  - 미니맵 패드: 슬라이드 축소판 위에 지금 보이는 영역 사각형. 사각형을 끌면 화면이 따라가고
 *    손을 떼면 그 자리에 멈춘다. 다른 곳을 탭하면 그곳이 가운데로 온다. 확대해서 움직일 곳이 있을 때만 보인다.
 *    이 컨트롤 크기만큼은 오른쪽·아래로 슬라이드 밖까지 더 갈 수 있어, 컨트롤에 가린 구석도 꺼내 볼 수 있다.
 *  - 줌 슬라이더: 왼쪽 끝 = 맞춤, 오른쪽 끝 = 200%(로그 눈금). 맞춤·100%에서 자석. 화면 가운데 기준으로 확대.
 *  - % 버튼: 맞춤 ↔ 100%.
 * 캔버스를 만지지 않으므로 요소 선택·이동과 부딪히지 않는다.
 */
export default function TouchZoomNav({ scale, pan, fit, stage, canvas, elements, onPan, onZoom, onFit, panTool, onTogglePan, handIcon }) {
  const [mapOpen, setMapOpen] = useState(true)
  const zoomed = scale > fit * 1.001
  // 이 컨트롤이 화면 오른쪽 아래를 덮는 크기(가장자리 여백 12px 포함) — 미니맵을 접고 펴면 달라진다
  const rootRef = useRef(null)
  const [cover, setCover] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const measure = () => setCover({ w: node.offsetWidth + 12, h: node.offsetHeight + 12 })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])
  // 패드·슬라이더를 만지는 동안 캔버스 쪽(마키·선택 해제·손 도구 팬·롱프레스 메뉴)으로 새지 않게
  const stop = (e) => { e.stopPropagation(); e.preventDefault() }

  const btn = {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
    color: '#cbd5e1', fontSize: 12, lineHeight: 1, padding: 0, touchAction: 'manipulation',
  }
  const panel = {
    background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', borderRadius: 9,
  }

  return (
    <div
      ref={rootRef}
      data-no-pan="true"
      data-testid="touch-zoom-nav"
      onMouseDown={stop}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={stop}
      style={{
        position: 'absolute', right: 12, bottom: 12, zIndex: 60,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
        userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      {zoomed && stage.w > 0 && (mapOpen ? (
        <div style={{ ...panel, display: 'flex', alignItems: 'stretch', gap: 2, padding: 4 }}>
          <button
            type="button"
            aria-label="미니맵 접기"
            title="미니맵 접기"
            onClick={() => setMapOpen(false)}
            style={{ ...btn, width: 22, height: 'auto', border: 'none', background: 'transparent', color: '#64748b', fontSize: 14 }}
          >›</button>
          <MinimapPad scale={scale} pan={pan} stage={stage} canvas={canvas} elements={elements} onPan={onPan}
            extra={{ w: cover.w / scale, h: cover.h / scale }} />
        </div>
      ) : (
        <button
          type="button"
          aria-label="미니맵 펴기"
          title="미니맵 펴기"
          onClick={() => setMapOpen(true)}
          style={{ ...btn, ...panel, color: '#c7d2fe' }}
        >
          <MapIcon />
        </button>
      ))}

      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 4, padding: 4 }}>
        <button
          type="button"
          style={panTool
            ? { ...btn, background: 'rgba(99,102,241,0.3)', borderColor: 'rgba(99,102,241,0.5)', color: '#c7d2fe' }
            : btn}
          onClick={onTogglePan}
          title={panTool ? '손 도구 끄기' : '손 도구 — 드래그로 화면 이동'}
        >
          {handIcon}
        </button>
        {/* 캔버스 폭이 좁으면(속성 패널을 연 휴대폰) 슬라이더를 줄여 한 줄에 들어가게 — 버튼·여백 ≈ 116px */}
        <ZoomSlider scale={scale} fit={fit} onZoom={onZoom} onFit={onFit}
          width={Math.max(56, Math.min(112, Math.round(stage.w - 24 - 116)))} />
        <button
          type="button"
          style={{ ...btn, width: 46, fontVariantNumeric: 'tabular-nums' }}
          onClick={() => (zoomed ? onFit() : onZoom(1))}
          title={zoomed ? '맞춤으로' : '100%로'}
        >
          {Math.round(scale * 100)}%
        </button>
      </div>
    </div>
  )
}

// 미니맵 끌기 필터 — 단위는 패드 px. 느리게(10px/s) ≈ 2Hz로 떨림을 거르고, 빠르게(400px/s) ≈ 25Hz로 바로 따라간다.
const PAD_FILTER = { minCutoff: 1.5, beta: 0.06, dCutoff: 1 }
const SETTLE_CUTOFF = 5 // 손을 뗀 뒤에는 적어도 이 차단 주파수로 빨리 자리 잡는다(τ ≈ 32ms)
const STILL_PX = 0.5    // 화면 px — 거른 위치가 손가락 자리에 이만큼 가까우면 그 자리로 맞추고 쉰다
const TAP_PX = 2        // 패드 px — 사각형 안을 이만큼도 안 움직이고 떼면 탭(화면은 그대로)

/**
 * 미니맵 패드 — 슬라이드 축소판(배경색 + 요소 상자) 위에 보이는 영역 사각형.
 *
 * 패드는 슬라이드를 수십 분의 1로 줄인 지도라 손가락 1px이 화면 수십 px가 된다(큰 포스터일수록 더).
 * 정수 터치 좌표의 계단과 손 떨림이 그대로 커지지 않도록, 손가락 위치는 One Euro 필터로 거르고
 * 화면은 매 프레임(requestAnimationFrame) 그 결과로 옮긴다(onPan). 손가락이 멈추면 쉬고, 다른 입력이
 * 화면을 옮기면(손 도구·휠·줌) 미니맵은 손을 뗀다 — 남의 이동을 덮어쓰지 않도록.
 */
function MinimapPad({ scale, pan, stage, canvas, elements, onPan, extra }) {
  const { w: mw, h: mh, k } = minimapSize(canvas)
  const vr = visibleRect(stage, canvas, scale, pan)
  // { id, dx, dy, start, raw, up, moved, lastT, startPan, sent } — dx/dy: 손가락이 사각형 가운데에서
  // 떨어진 거리(캔버스 px), start·raw: 손가락(패드 px), sent: 최근에 보낸 이동(다른 입력 감지용)
  const grabRef = useRef(null)
  const filterRef = useRef(null)
  const rafRef = useRef(0)
  const [active, setActive] = useState(false)
  // 프레임 루프가 최신 값을 읽도록(렌더가 끝난 뒤 갱신)
  const latest = useRef(null)
  useLayoutEffect(() => { latest.current = { scale, canvas, vr, extra, onPan, pan } })
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const { bgColor, boxes } = useMemo(() => {
    // 배경 레이어는 여러 겹일 수 있다(페이지 바탕 위에 슬라이드 바탕) — 맨 위에서부터 보이는 것
    let bgColor = '#fff'
    const layers = elements.filter(isBackgroundElement).sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))
    for (const l of layers) {
      if (l.type === 'image' || l.type === 'video') { bgColor = '#94a3b8'; break }
      if (solidColor(l.styles?.backgroundColor)) { bgColor = l.styles.backgroundColor; break }
    }
    const boxes = elements
      .filter(el => !isBackgroundElement(el) && el.shapeType !== 'connector' && el.width > 0 && el.height > 0)
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
      .map(el => ({
        id: el.id, x: el.x, y: el.y, w: el.width, h: el.height,
        // 도형은 제 색으로(알아보기 쉽게), 글자·그림 등은 회색 상자로
        fill: el.type === 'shape' && solidColor(el.styles?.backgroundColor) ? el.styles.backgroundColor
          : el.type === 'image' || el.type === 'video' ? 'rgba(100,116,139,0.6)' : 'rgba(100,116,139,0.32)',
      }))
    return { bgColor, boxes }
  }, [elements])

  // 요소 상자는 화면을 옮겨도 그대로 — 끄는 동안 매 프레임 상자 수백 개를 다시 만들지 않게(보이는 영역 사각형만 바뀐다)
  const boxRects = useMemo(() => boxes.map(b => (
    <rect
      key={b.id}
      x={b.x * k} y={b.y * k} width={Math.max(1, b.w * k)} height={Math.max(1, b.h * k)}
      rx={1} fill={b.fill}
    />
  )), [boxes, k])

  const toPad = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  // 거른 손가락 위치(패드 px) → 화면 이동
  const panAt = (g, fx, fy) => {
    const { canvas, scale, vr, extra } = latest.current
    return panToCenter(fx / k - g.dx, fy / k - g.dy, canvas, scale, vr, extra)
  }
  const end = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    grabRef.current = null
    setActive(false)
  }
  const emit = (g, p) => {
    const last = g.sent[g.sent.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) return
    g.sent.push(latest.current.onPan(p) || p) // 실제로 적용된(클램프한) 값
    if (g.sent.length > 8) g.sent.shift()
  }
  const tick = (t) => {
    rafRef.current = 0
    const g = grabRef.current
    if (!g) return
    // 지금 화면이 미니맵이 보낸 이동이 아니면 다른 입력이 옮긴 것 — 그만둔다(덮어쓰지 않음)
    const cur = latest.current.pan
    const near = (q) => Math.abs(q.x - cur.x) < 0.5 && Math.abs(q.y - cur.y) < 0.5
    if (!near(g.startPan) && !g.sent.some(near)) { end(); return }
    const dt = g.lastT == null ? 1 / 60 : Math.min(0.05, Math.max(0.004, (t - g.lastT) / 1000))
    g.lastT = t
    const o = filterRef.current.step(g.raw.x, g.raw.y, dt, g.up ? SETTLE_CUTOFF : 0)
    // 남은 거리를 화면 px로 — 큰 포스터·높은 배율에서도 마지막에 손가락 자리로 맞출 때 튀지 않게
    if (Math.hypot(o.x - g.raw.x, o.y - g.raw.y) * latest.current.scale / k < STILL_PX) {
      emit(g, panAt(g, g.raw.x, g.raw.y))
      filterRef.current.reset(g.raw.x, g.raw.y)
      g.lastT = null
      if (g.up) end() // 손을 뗐으면 끝, 아니면 손가락이 다시 움직일 때까지 쉰다
      return
    }
    emit(g, panAt(g, o.x, o.y))
    rafRef.current = requestAnimationFrame(tick)
  }
  const wake = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(tick) }

  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    if (grabRef.current && !grabRef.current.up) return // 둘째 손가락은 무시(자리 잡는 중이면 새로 잡는다)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    const p = toPad(e)
    const pc = { x: p.x / k, y: p.y / k }
    const inside = pc.x >= vr.x && pc.x <= vr.x + vr.w && pc.y >= vr.y && pc.y <= vr.y + vr.h
    const cx = vr.x + vr.w / 2, cy = vr.y + vr.h / 2
    // 사각형 안을 잡으면 잡은 자리 그대로 끌고(조금 움직인 뒤부터), 밖을 탭하면 그곳이 가운데로 오도록 미끄러진다
    grabRef.current = {
      id: e.pointerId, dx: inside ? pc.x - cx : 0, dy: inside ? pc.y - cy : 0,
      start: p, raw: p, up: false, moved: !inside, lastT: null, startPan: { ...pan }, sent: [],
    }
    // 필터는 지금 화면에 해당하는 손가락 위치에서 출발 — 안을 잡으면 손가락 자리, 밖을 탭하면 지금 화면 자리
    filterRef.current = createOneEuro2D(PAD_FILTER)
    filterRef.current.reset((cx + grabRef.current.dx) * k, (cy + grabRef.current.dy) * k)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (!inside) wake()
    setActive(true)
  }
  const onMove = (e) => {
    const g = grabRef.current
    if (!g || g.up || g.id !== e.pointerId) return
    g.raw = toPad(e)
    if (!g.moved) {
      if (Math.hypot(g.raw.x - g.start.x, g.raw.y - g.start.y) <= TAP_PX) return
      g.moved = true // 끌기 시작 — 잡은 자리에서 손가락까지 부드럽게 따라붙는다
    }
    wake()
  }
  const onUp = (e) => {
    const g = grabRef.current
    if (!g || g.up || g.id !== e.pointerId) return
    if (!g.moved) { end(); return } // 탭 — 화면은 그대로
    g.up = true // 프레임 루프가 마저 자리 잡고 끝낸다
    wake()
  }

  // 보이는 영역을 슬라이드 안으로 잘라 그린다(맞춤 근처에선 화면이 슬라이드보다 넓다)
  const x0 = Math.max(0, vr.x), y0 = Math.max(0, vr.y)
  const x1 = Math.min(canvas.w, vr.x + vr.w), y1 = Math.min(canvas.h, vr.y + vr.h)

  return (
    <div
      data-testid="minimap-pad"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: 'relative', width: mw, height: mh, borderRadius: 4, overflow: 'hidden',
        background: bgColor, touchAction: 'none', cursor: 'grab',
        opacity: active ? 1 : 0.8, transition: 'opacity 0.15s',
      }}
    >
      <svg width={mw} height={mh} style={{ display: 'block', pointerEvents: 'none' }}>
        {boxRects}
        {x1 > x0 && y1 > y0 && (
          <rect
            data-testid="minimap-view"
            x={x0 * k} y={y0 * k} width={(x1 - x0) * k} height={(y1 - y0) * k}
            fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  )
}

// 투명하지 않은 단색(rgba 알파 0 · transparent 제외)
function solidColor(c) {
  if (typeof c !== 'string' || !c || c === 'transparent') return false
  const m = c.match(/^rgba\([^)]*,\s*([\d.]+)\)$/)
  return !m || parseFloat(m[1]) > 0
}

const THUMB = 18

/** 줌 슬라이더 — 맞춤(왼쪽 끝) ~ 200%, 로그 눈금. 트랙을 탭하면 그 자리로, 끌면 따라간다. */
function ZoomSlider({ scale, fit, onZoom, onFit, width = 112 }) {
  const range = zoomRange(fit)
  const t = scaleToT(scale, range)
  const t100 = range.lo < 1 && range.hi >= 1 ? scaleToT(1, range) : null
  const dragRef = useRef(null) // 끄는 손가락 pointerId
  const [dragging, setDragging] = useState(false)
  const travel = width - THUMB

  const apply = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const z = snapZoom((e.clientX - r.left - THUMB / 2) / travel, range)
    if (z.fit) onFit()
    else onZoom(z.scale)
  }
  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    if (dragRef.current != null) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    dragRef.current = e.pointerId
    setDragging(true)
    apply(e)
  }
  const onMove = (e) => { if (dragRef.current === e.pointerId) apply(e) }
  const onUp = (e) => {
    if (dragRef.current !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const thumbX = t * travel
  const tick = (tt) => (
    <div style={{
      position: 'absolute', left: THUMB / 2 + tt * travel - 0.5, top: 9, width: 1, height: 12,
      background: 'rgba(148,163,184,0.6)',
    }} />
  )

  return (
    <div
      role="slider"
      aria-label="확대·축소"
      aria-valuemin={Math.round(range.lo * 100)}
      aria-valuemax={Math.round(range.hi * 100)}
      aria-valuenow={Math.round(scale * 100)}
      data-testid="zoom-slider"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ position: 'relative', width, height: 30, touchAction: 'none', cursor: 'pointer' }}
    >
      <div style={{
        position: 'absolute', left: THUMB / 2, right: THUMB / 2, top: 13, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.12)',
      }} />
      <div style={{
        position: 'absolute', left: THUMB / 2, width: thumbX, top: 13, height: 4, borderRadius: 2,
        background: '#6366f1',
      }} />
      {tick(0)}
      {t100 != null && tick(t100)}
      <div style={{
        position: 'absolute', left: thumbX, top: 6, width: THUMB, height: THUMB, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
        transform: dragging ? 'scale(1.15)' : undefined, transition: 'transform 0.1s',
      }} />
      {dragging && (
        <div style={{
          position: 'absolute', left: thumbX + THUMB / 2, bottom: 34, transform: 'translateX(-50%)',
          padding: '3px 7px', borderRadius: 6, background: '#6366f1', color: '#fff',
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none',
        }}>
          {scale <= fit * 1.001 ? '맞춤' : `${Math.round(scale * 100)}%`}
        </div>
      )}
    </div>
  )
}

function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="10" y="9" width="7" height="6" rx="1" />
    </svg>
  )
}
