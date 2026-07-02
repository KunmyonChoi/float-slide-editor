/**
 * imageFit — object-fit 기하 계산(순수). 마스크 클리핑·contain 캡처가 공유해 드리프트를 막는다.
 */

/**
 * objectFit:contain일 때 박스(boxW×boxH) 안에서 이미지(natW×natH)가 실제 표시되는 사각형.
 * @returns {{x:number,y:number,w:number,h:number}} 박스-로컬 px
 */
export function containFitRect(boxW, boxH, natW, natH) {
  const boxAR = boxW / boxH, imgAR = natW / natH
  if (imgAR >= boxAR) { const dh = boxW / imgAR; return { x: 0, y: (boxH - dh) / 2, w: boxW, h: dh } }
  const dw = boxH * imgAR; return { x: (boxW - dw) / 2, y: 0, w: dw, h: boxH }
}
