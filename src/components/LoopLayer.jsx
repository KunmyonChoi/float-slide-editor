import { hasLoop, loopAnimationCss, loopVars, loopClassName } from '../core/slideAnimation'

/**
 * LoopLayer — 반복(강조) 효과 래퍼.
 *
 * 등장/퇴장 래퍼 안쪽에 한 겹 더 둔다 — 둘 다 transform을 쓰므로 같은 div에 걸면 서로 덮어쓴다.
 * active가 false면(요소가 아직 숨김) 래퍼는 두되 animation만 끈다 — 래퍼를 넣었다 뺐다 하면
 * 자식(영상·오디오 등)이 리마운트되어 재생이 처음부터 다시 시작된다. active가 true로 바뀌는 순간
 * CSS animation이 시작되므로 startMs는 "보이기 시작한 순간" 기준이다(loopStartMs).
 */
export default function LoopLayer({ el, startMs = 0, active = true, children }) {
  if (!hasLoop(el)) return children
  const shimmer = el.loopAnim.effect === 'shimmer'
  return (
    <div className={active ? loopClassName(el.loopAnim) : undefined} style={{
      position: 'absolute', inset: 0, transformOrigin: 'center center',
      // 반짝 스윕은 빛 띠가 요소 모서리 밖으로 새지 않게 요소 곡률로 자른다
      borderRadius: shimmer ? el.styles?.borderRadius : undefined,
      animation: active ? loopAnimationCss(el.loopAnim, startMs) : undefined,
      ...(active ? loopVars(el.loopAnim) : {}),
    }}>
      {children}
    </div>
  )
}
