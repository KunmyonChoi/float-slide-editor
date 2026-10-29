/**
 * 휠 이벤트가 무엇에서 왔는지 가른다.
 *
 * 브라우저는 마우스 휠, 트랙패드 두 손가락 스크롤, 트랙패드 핀치를 모두 같은 'wheel' 이벤트로 보낸다.
 *   'pinch'    — 트랙패드 핀치(브라우저가 ctrlKey를 합성) 또는 Ctrl/Cmd+휠 → 줌
 *   'trackpad' — 트랙패드 두 손가락 스크롤 → 이동(팬)
 *   'mouse'    — 마우스 휠 → 줌 (Genitor는 마우스 휠을 커서 기준 줌으로 쓴다)
 *
 * 마우스 휠과 트랙패드 스크롤을 가르는 표준 속성이 없어서 휴리스틱으로 판단한다.
 *   1. deltaMode가 줄·페이지 단위면 마우스 (Firefox의 마우스 휠)
 *   2. 가로 성분(deltaX)이 있으면 트랙패드
 *   3. Chrome·Safari의 옛 속성 wheelDeltaY — 트랙패드는 정확히 deltaY × -3, 마우스 휠은 한 칸이 120의 배수
 *   4. 그 밖에는 작은 소수 delta를 트랙패드로 본다 (Windows 정밀 터치패드, wheelDeltaY가 없는 브라우저)
 * 무단 휠·고해상도 휠을 가진 마우스는 트랙패드로 판단될 수 있다(그때는 휠이 이동이 된다).
 */
export function wheelSource(e) {
  if (e.ctrlKey || e.metaKey) return 'pinch'
  if (e.deltaMode !== 0) return 'mouse'
  if (e.deltaX !== 0) return 'trackpad'
  const w = e.wheelDeltaY
  if (typeof w === 'number' && w !== 0) {
    if (w === -3 * e.deltaY) return 'trackpad'
    if (w % 120 === 0) return 'mouse'
    return 'trackpad'
  }
  return Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY) ? 'trackpad' : 'mouse'
}
