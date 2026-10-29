/**
 * One Euro 필터(2D) — 손가락 떨림은 걸러 내고 빠른 움직임은 늦추지 않는 저역 통과 필터.
 * Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input" (CHI 2012).
 *
 * 차단 주파수가 속도에 따라 바뀐다: cutoff = minCutoff + beta × 속도.
 * 느리게 움직일 때(떨림이 눈에 띄는 때)는 강하게 거르고, 빠르게 움직일 때는 거의 그대로 따라간다.
 * 미니맵처럼 손가락 1px이 화면 수십 px로 커지는 입력에서, 정수 터치 좌표의 계단과 손 떨림을 없앤다.
 *
 * 두 축에 같은 차단 주파수를 쓴다(속도 = 벡터 크기) — 대각선 이동이 축마다 다르게 늦지 않도록.
 */
const TAU = 2 * Math.PI

const alpha = (cutoff, dt) => 1 / (1 + 1 / (TAU * cutoff * dt))

export function createOneEuro2D({ minCutoff = 1.5, beta = 0.06, dCutoff = 1 } = {}) {
  let x = null, y = null   // 거른 위치
  let vx = 0, vy = 0       // 거른 속도(단위/초)
  return {
    reset(x0, y0) { x = x0; y = y0; vx = 0; vy = 0 },
    /**
     * 입력 (ix, iy)를 dt초 뒤 표본으로 넣고 거른 위치를 돌려준다.
     * minCutoffFloor를 주면 차단 주파수가 적어도 그 값 — 손을 뗀 뒤 남은 거리를 빨리 좁힐 때.
     */
    step(ix, iy, dt, minCutoffFloor = 0) {
      if (x == null) { x = ix; y = iy; return { x, y } }
      if (!(dt > 0)) return { x, y } // 같은 시각의 표본(dt 0)·잘못된 dt — 속도가 무한대로 번지지 않게 건너뛴다
      const ad = alpha(dCutoff, dt)
      vx = ad * ((ix - x) / dt) + (1 - ad) * vx
      vy = ad * ((iy - y) / dt) + (1 - ad) * vy
      const cutoff = Math.max(minCutoffFloor, minCutoff + beta * Math.hypot(vx, vy))
      const a = alpha(cutoff, dt)
      x = a * ix + (1 - a) * x
      y = a * iy + (1 - a) * y
      return { x, y }
    },
  }
}
