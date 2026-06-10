/**
 * slideLayouts — 백지 시작용 슬라이드 레이아웃(스캐폴딩).
 * 각 레이아웃은 캔버스 비율과 무관하도록 상대 좌표(0~1)로 정의하고,
 * build(canvasSize)에서 실제 px 요소 스펙으로 변환한다.
 * 반환 스펙은 부분 FlatElement(id/zIndex/rotation 등은 삽입측에서 채움).
 * 각 요소는 layoutRole을 가져, 다른 레이아웃으로 '변환' 시 역할별로 내용을 이어받는다.
 */

const TITLE = '#1e293b'   // 진한 슬레이트(밝은 배경 가정)
const BODY = '#334155'
const MUTED = '#64748b'

// 본문 계열 역할 — 변환 시 내용 풀(FIFO)로 공유(body↔left↔right)
export const CONTENT_ROLES = new Set(['body', 'left', 'right'])

/**
 * 상대 좌표 텍스트 스펙 → px (size는 캔버스 높이 비율).
 * 첫 인자는 빈 박스에 흐리게 표시될 안내문(placeholder). 실제 content는 빈 값으로 시작 →
 * 사용자가 입력하면 안내문이 사라진다.
 */
function text(placeholder, { xf, yf, wf, hf, size, weight = 400, align = 'left', color = TITLE, role }, cs) {
  return {
    type: 'text',
    x: Math.round(xf * cs.w),
    y: Math.round(yf * cs.h),
    width: Math.round(wf * cs.w),
    height: Math.round(hf * cs.h),
    content: '',
    placeholder,
    isRich: false,
    layoutRole: role,
    styles: {
      fontSize: Math.round(size * cs.h) + 'px',
      fontWeight: String(weight),
      color,
      textAlign: align,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1.3',
    },
  }
}

export const SLIDE_LAYOUTS = [
  { id: 'blank', name: '빈 슬라이드', build: () => [] },

  {
    id: 'title', name: '제목 슬라이드',
    build: (cs) => [
      text('제목을 입력하세요', { role: 'title', xf: 0.1, yf: 0.36, wf: 0.8, hf: 0.16, size: 0.075, weight: 700, align: 'center' }, cs),
      text('부제목', { role: 'subtitle', xf: 0.1, yf: 0.55, wf: 0.8, hf: 0.08, size: 0.03, weight: 400, align: 'center', color: MUTED }, cs),
    ],
  },

  {
    id: 'titleContent', name: '제목 + 내용',
    build: (cs) => [
      text('제목을 입력하세요', { role: 'title', xf: 0.07, yf: 0.08, wf: 0.86, hf: 0.12, size: 0.05, weight: 700, align: 'left' }, cs),
      text('내용을 입력하세요', { role: 'body', xf: 0.07, yf: 0.24, wf: 0.86, hf: 0.64, size: 0.028, weight: 400, align: 'left', color: BODY }, cs),
    ],
  },

  {
    id: 'section', name: '섹션 구분',
    build: (cs) => [
      text('섹션 제목', { role: 'title', xf: 0.1, yf: 0.42, wf: 0.8, hf: 0.16, size: 0.06, weight: 700, align: 'center' }, cs),
    ],
  },

  {
    id: 'twoColumn', name: '두 단',
    build: (cs) => [
      text('제목을 입력하세요', { role: 'title', xf: 0.07, yf: 0.08, wf: 0.86, hf: 0.12, size: 0.045, weight: 700, align: 'left' }, cs),
      text('왼쪽 내용', { role: 'left', xf: 0.07, yf: 0.26, wf: 0.41, hf: 0.62, size: 0.026, weight: 400, align: 'left', color: BODY }, cs),
      text('오른쪽 내용', { role: 'right', xf: 0.52, yf: 0.26, wf: 0.41, hf: 0.62, size: 0.026, weight: 400, align: 'left', color: BODY }, cs),
    ],
  },
]

/**
 * 레이아웃 변환 시 기존 레이아웃 요소의 내용을 새 레이아웃 스펙에 역할별로 이어받는다.
 * - title/subtitle: 역할 정확 매칭으로 이어받음
 * - 본문 계열(body/left/right): 내용 풀(FIFO)로 이어받음
 * 매칭 안 되는 기존 내용은 버려진다(변환). 새 역할에 매칭 없으면 기본 플레이스홀더 유지.
 * @returns 새 스펙 배열(content가 이어받기로 교체될 수 있음)
 */
export function carryLayoutContent(oldLayoutEls, newSpecs) {
  const byRole = {}
  const contentPool = []
  for (const el of oldLayoutEls || []) {
    const r = el.layoutRole
    if (r === 'title' || r === 'subtitle') byRole[r] = el.content
    else if (CONTENT_ROLES.has(r)) contentPool.push(el.content)
  }
  let pi = 0
  return newSpecs.map(spec => {
    let content = spec.content
    if ((spec.layoutRole === 'title' || spec.layoutRole === 'subtitle') && byRole[spec.layoutRole] != null) {
      content = byRole[spec.layoutRole]
    } else if (CONTENT_ROLES.has(spec.layoutRole) && pi < contentPool.length) {
      content = contentPool[pi++]
    }
    return { ...spec, content }
  })
}
