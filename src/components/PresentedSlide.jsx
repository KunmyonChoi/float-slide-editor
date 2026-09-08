import { useMemo } from 'react'
import FlatElementRenderer from './FlatElementRenderer'
import PresenterInkOverlay from './PresenterInkOverlay'
import KaraokeCaptions from './KaraokeCaptions'
import { isHiddenAt, animationCss, directionVars } from '../core/slideAnimation'
import { slideTransitionCss, slideTransitionVars } from '../core/slideTransition'

/**
 * PresentedSlide — 발표 화면에 실제로 그려지는 한 장.
 *
 * 발표자 창(미리보기)·청중 창·단일 화면 발표가 모두 이 컴포넌트를 쓴다 —
 * 청중이 보는 것과 발표자가 보는 것이 어긋나지 않으려면 렌더러가 하나여야 한다.
 * 상태는 전혀 갖지 않고 받은 대로만 그린다(잉크 편집만 콜백으로 위임).
 *
 * @param {number} slideKey 슬라이드가 바뀔 때 remount시켜 진입 애니메이션을 재시작시키는 키
 * @param {() => number} getAudioTime 나레이션 재생 위치(초)를 돌려주는 함수. 발표자 창에서는
 *                            실제 <audio>를, 청중 창에서는 발표자가 보내온 값에 경과를 더한
 *                            추정값을 돌려준다. 자막이 매 프레임 호출한다.
 */
export default function PresentedSlide({
  slideKey, page, elements, animInfo, revealed, playingStep,
  scale, canvasSize,
  penActive = false, penTool, penColor, penWidth,
  blackout = false, strokes = [], onCommitStroke, onEraseStroke,
  captionWords, getAudioTime,
}) {
  // KaraokeCaptions는 `audioEl.currentTime`을 매 프레임 읽는다 — 엘리먼트 대신
  // 같은 모양의 얇은 어댑터를 넘겨 컴포넌트를 그대로 재사용한다.
  const audioClock = useMemo(
    () => (getAudioTime ? { get currentTime() { return getAudioTime() } } : null),
    [getAudioTime])

  const transitionStyle = useMemo(() => ({
    animation: slideTransitionCss(page?.transition),
    ...(slideTransitionVars(page?.transition) || {}),
  }), [page?.transition])

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: canvasSize.w,
      height: canvasSize.h,
      transform: `translate(-50%, -50%) scale(${scale})`,
      transformOrigin: 'center center',
      background: '#fff',
    }}>
      <div
        key={slideKey}
        className="fe-slide-anim"
        style={{
          position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
          ...transitionStyle,
        }}
      >
        {elements.map(el => {
          const step = animInfo.stepOf[el.id]
          const playing = playingStep >= 0 && step === playingStep
          const showHidden = isHiddenAt(animInfo, el, revealed) && !playing

          // 자동(auto) 요소: 슬라이드 진입 즉시 CSS animation 재생.
          // 외부 div에 key={slideKey}가 있으므로 슬라이드 전환 시 remount → 애니 재시작.
          if (step == null && el.anim?.trigger?.mode === 'auto' && el.anim?.effect && el.anim.effect !== 'none') {
            return (
              <div key={el.id} style={{
                position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                zIndex: el.zIndex,
                transformOrigin: 'center center',
                animation: animationCss(el.anim, animInfo.autoOffsets?.[el.id] ?? 0),
                ...(directionVars(el.anim) || {}),
              }}>
                <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                  isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
              </div>
            )
          }

          // 애니메이션 없는 요소는 래퍼 없이 그대로(레이아웃/스태킹 영향 최소화)
          if (step == null) {
            return (
              <FlatElementRenderer key={el.id} element={el} isSelected={false}
                isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
            )
          }
          return (
            <div key={el.id} style={{
              position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
              zIndex: el.zIndex, // 래퍼가 요소 z를 보존(안 하면 z:auto로 양수 z 형제 아래로 깔림)
              transformOrigin: 'center center',
              opacity: showHidden ? 0 : undefined,
              visibility: showHidden ? 'hidden' : undefined,
              animation: playing ? animationCss(el.anim, animInfo.offsetOf[el.id]) : undefined,
              ...(playing ? (directionVars(el.anim) || {}) : {}),
            }}>
              <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
            </div>
          )
        })}

        {/* 블랙아웃: 슬라이드 내용을 가리는 검은 레이어 (잉크 오버레이보다 아래) */}
        {blackout && (
          <div style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 2147482000, pointerEvents: 'none' }} />
        )}

        <PresenterInkOverlay
          penActive={penActive}
          tool={penTool}
          color={penColor}
          penWidth={penWidth}
          scale={scale}
          canvasSize={canvasSize}
          strokes={strokes}
          onCommitStroke={onCommitStroke}
          onEraseStroke={onEraseStroke}
        />
      </div>

      {captionWords?.length > 0 && audioClock && (
        <KaraokeCaptions audioEl={audioClock} words={captionWords} />
      )}
    </div>
  )
}
