/**
 * captureCanvasRegion — 현재 슬라이드 캔버스를 이미지로 캡처하고 특정 영역만 잘라낸다.
 *
 * 이미지 생성·편집 러너(imageJobRunner)가 공유한다.
 * 요소 content는 data:/idb://(BlobStore)/원격·blob: 등 형식이 제각각이라 직접 읽기 어렵다.
 * 대신 렌더된 캔버스를 캡처하면 모든 형식을 안전하게, 화면에 보이는 픽셀(objectFit 반영) 그대로 얻는다.
 */
import { useFlatStore } from '../store/flatStore'

/**
 * 전체 캡처 data URL에서 캔버스 좌표 bbox 영역만 잘라낸다(캡처 스케일 자동 보정).
 * @param {string} dataUrl  전체 캔버스 캡처 data URL
 * @param {{x:number,y:number,w:number,h:number}} bbox  캔버스 좌표 영역
 * @param {{w:number,h:number}} canvasSize  논리 캔버스 크기
 * @returns {Promise<string>} 잘라낸 영역 data URL(png)
 */
export function cropToBBox(dataUrl, bbox, canvasSize) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = img.naturalWidth / canvasSize.w // 캡처:캔버스 배율
      const sx = Math.max(0, Math.round(bbox.x * k))
      const sy = Math.max(0, Math.round(bbox.y * k))
      const sw = Math.round(bbox.w * k)
      const sh = Math.round(bbox.h * k)
      const c = document.createElement('canvas')
      c.width = sw; c.height = sh
      const ctx = c.getContext('2d')
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('캡처 이미지를 처리하지 못했습니다.'))
    img.src = dataUrl
  })
}

/**
 * 현재 페이지를 캡처해 주어진 bbox 영역만 잘라 반환한다.
 *
 * 선택을 비우지 않는다 — exportAsImage가 캡처 동안 선택 테두리(outline)를 제거하고
 * 선택 오버레이(data-export-ignore)를 캡처에서 제외하므로 선택 UI는 결과에 찍히지 않는다.
 * (선택을 비우면 선택 상태에 마운트가 묶인 플로팅바가 캡처 도중 언마운트되어 작업이 끊긴다.)
 * @param {{x:number,y:number,w:number,h:number}} bbox  캡처할 캔버스 좌표 영역
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>} 잘라낸 영역 data URL(png)
 */
export async function captureElementRegion(bbox, { signal } = {}) {
  const st = useFlatStore.getState()
  const canvasNode = st._canvasRef?.current
  if (!canvasNode) throw new Error('캔버스를 찾을 수 없습니다.')
  if (!bbox || bbox.w < 2 || bbox.h < 2) throw new Error('캡처할 영역이 너무 작습니다.')

  const cs = st.canvasSize
  const { exportAsImage } = await import('./ImageExporter.js')
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  // offscreen=true: 복제본에서 캡처해 살아있는 캔버스를 건드리지 않는다(캡처 중 화면 '움찔' 방지).
  const full = await exportAsImage(canvasNode, { format: 'png', scale: 2, offscreen: true })
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  return cropToBBox(full, bbox, cs)
}
