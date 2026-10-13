import { calibrationMarkers } from '../../core/videoExport'

/**
 * 화면 공유 영상 한 장을 흉내 낸 RGBA 버퍼 — 회색 바탕(도구 막대·바탕화면) 위 map 자리에 페이지(검정)와
 * 보정 표식을 그린다. map: CSS px → 버퍼 px (x' = sx·x + ox).
 * @param {object} o
 * @param {number} o.fw @param {number} o.fh  버퍼 크기
 * @param {{w:number,h:number}} o.viewport
 * @param {{sx:number,sy:number,ox:number,oy:number}} o.map
 * @param {string[]} [o.drop]   빼먹을 표식 id(가려짐 등)
 * @param {Array<{x:number,y:number,w:number,h:number,color:number[]}>} [o.extra] 덧그릴 사각형(버퍼 px)
 * @param {boolean} [o.markers=true]
 */
export function paintCaptureFrame({ fw, fh, viewport, map, drop = [], extra = [], markers = true }) {
  const data = new Uint8ClampedArray(fw * fh * 4)
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    const xa = Math.max(0, Math.round(x0)), xb = Math.min(fw, Math.round(x1))
    const ya = Math.max(0, Math.round(y0)), yb = Math.min(fh, Math.round(y1))
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const i = (y * fw + x) * 4
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
      }
    }
  }
  fill(0, 0, fw, fh, [128, 128, 128])
  fill(map.ox, map.oy, map.ox + viewport.w * map.sx, map.oy + viewport.h * map.sy, [0, 0, 0])
  if (markers) {
    for (const m of calibrationMarkers(viewport)) {
      if (drop.includes(m.id)) continue
      fill(map.ox + m.left * map.sx, map.oy + m.top * map.sy,
        map.ox + (m.left + m.size) * map.sx, map.oy + (m.top + m.size) * map.sy, m.color)
    }
  }
  for (const e of extra) fill(e.x, e.y, e.x + e.w, e.y + e.h, e.color)
  return { data, width: fw, height: fh }
}
