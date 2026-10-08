import { useMemo } from 'react'
import FlatElementRenderer from './FlatElementRenderer'
import PresenterInkOverlay from './PresenterInkOverlay'
import KaraokeCaptions from './KaraokeCaptions'
import LoopLayer from './LoopLayer'
import { isHiddenAt, animationCss, directionVars, hasLoop, loopStartMs, isEntrance } from '../core/slideAnimation'
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
 * @param {number} captionSpaceBelow 슬라이드 아래 레터박스 여백(캔버스 단위). 자막이 들어갈
 *                            만큼 넓으면 슬라이드를 덮는 대신 그 아래에 그린다.
 * @param {boolean} stageMarker 영상 녹화 중 — 녹화기가 잘라 낼 슬라이드 영역 표시(data-present-stage)
 * @param {boolean} frozen    이 장의 t=0 모습으로 멈춰 그린다(영상 녹화 시작 대기) — 등장 전 요소는 숨기고,
 *                            애니메이션·반복 효과·미디어 재생은 하지 않는다(playNow=false)
 * @param {boolean} noTransition 슬라이드 전환 효과 없이 진입(녹화의 첫 장 — 멈춘 화면에서 그대로 이어지게)
 */
export default function PresentedSlide({
  slideKey, page, elements, animInfo, revealed, playingStep,
  scale, canvasSize,
  penActive = false, penTool, penColor, penWidth,
  blackout = false, strokes = [], onCommitStroke, onEraseStroke,
  captionWords, getAudioTime, captionSpaceBelow = 0, stageMarker = false,
  frozen = false, noTransition = false,
}) {
  // KaraokeCaptions는 `audioEl.currentTime`을 매 프레임 읽는다 — 엘리먼트 대신
  // 같은 모양의 얇은 어댑터를 넘겨 컴포넌트를 그대로 재사용한다.
  const audioClock = useMemo(
    () => (getAudioTime ? { get currentTime() { return getAudioTime() } } : null),
    [getAudioTime])

  const skipTransition = frozen || noTransition
  const transitionStyle = useMemo(() => (skipTransition ? {} : {
    animation: slideTransitionCss(page?.transition),
    ...(slideTransitionVars(page?.transition) || {}),
  }), [page?.transition, skipTransition])
  const playNow = !frozen

  return (
    <div data-present-stage={stageMarker ? '' : undefined} style={{
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
            // 멈춘 t=0 화면: 등장 효과 요소는 아직 나오기 전이라 숨기고, 퇴장 효과 요소는 그대로 보인다.
            const preEnter = frozen && isEntrance(el.anim.effect)
            return (
              <div key={el.id} style={{
                position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                zIndex: el.zIndex,
                transformOrigin: 'center center',
                animation: frozen ? undefined : animationCss(el.anim, animInfo.autoOffsets?.[el.id] ?? 0),
                ...(frozen ? {} : (directionVars(el.anim) || {})),
                ...(preEnter ? { opacity: 0, visibility: 'hidden' } : {}),
              }}>
                <LoopLayer el={el} startMs={loopStartMs(animInfo, el)} active={!frozen}>
                  <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                    isEditing={false} scale={scale} canvasSize={canvasSize} playNow={playNow} />
                </LoopLayer>
              </div>
            )
          }

          // 등장/퇴장 없이 반복 효과만 — 위치 래퍼 + 반복 래퍼, 슬라이드 진입부터 반복
          if (step == null && hasLoop(el)) {
            return (
              <div key={el.id} style={{
                position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                zIndex: el.zIndex,
              }}>
                <LoopLayer el={el} startMs={loopStartMs(animInfo, el)} active={!frozen}>
                  <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                    isEditing={false} scale={scale} canvasSize={canvasSize} playNow={playNow} />
                </LoopLayer>
              </div>
            )
          }

          // 애니메이션 없는 요소는 래퍼 없이 그대로(레이아웃/스태킹 영향 최소화)
          if (step == null) {
            return (
              <FlatElementRenderer key={el.id} element={el} isSelected={false}
                isEditing={false} scale={scale} canvasSize={canvasSize} playNow={playNow} />
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
              {/* 보이는 동안만 반복 — 단계가 드러나는 순간 시작하고, 되돌아가 숨으면 멈춘다 */}
              <LoopLayer el={el} startMs={loopStartMs(animInfo, el)} active={!showHidden && !frozen}>
                <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                  isEditing={false} scale={scale} canvasSize={canvasSize} playNow={playNow} />
              </LoopLayer>
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
        <KaraokeCaptions audioEl={audioClock} words={captionWords} spaceBelow={captionSpaceBelow} />
      )}
    </div>
  )
}
