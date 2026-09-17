import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { resolveConnectors } from './ConnectorRouting'
import { BlobStore } from './BlobStore'
import { computeSteps, stepDurations } from './slideAnimation'
import { transcribeSpeech } from './SttClient'
import { getOrFetchTranscript } from './transcriptCache'
import { correctTranscriptWithNotes } from './captionAlign'
import { presentationOrder } from './karaoke'
import { hasApiKey } from './OpenAIClient'
import { openAiSettings } from '../components/AiSettingsModal'

/**
 * usePresentationEngine — 발표 상태 일체(덱·현재 슬라이드·빌드 단계·잉크·나레이션·자막)를
 * 소유하는 훅.
 *
 * 단일 화면 발표(FlatPresenter)와 듀얼 모니터의 발표자 창(SpeakerView)이 같은 엔진을
 * 쓴다. 청중 창은 이 엔진을 돌리지 않는다 — 발표자 창이 내보낸 상태를 받아 그리기만
 * 하므로, 두 창이 각자 타이머를 돌려 어긋나는 일이 생기지 않는다.
 */

const INK_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#ffffff', '#111827']

// 발표 시작 전 자막(STT) 준비를 얼마나 기다릴지 — 첫 슬라이드 하나만 막고, 나머지는 백그라운드로.
const CAPTION_PREFETCH_TIMEOUT_MS = 10000

// 음성 있는 슬라이드의 빌드 자동 진행 텀
// 나레이션이 있는 슬라이드에서 단계와 단계 사이에 두는 텀(ms).
// PPT 내보내기(PptMotion)도 같은 값을 써서 재생 리듬을 맞춘다.
export const AUDIO_TERM = 300

// 루프 발표에서 '음성이 흐르지 않는' 슬라이드에 머무는 시간(ms) — 애니메이션이 다 나온 뒤부터 잰다.
// 무인 전시에서 관람객이 읽을 틈은 줘야 하고, 너무 길면 덱이 멈춰 보인다.
export const LOOP_DWELL_MS = 5000

/** 빌드 단계를 자동 재생할 때 마지막 단계까지 걸리는 총 시간(ms). 루프의 머무는 시간 기준점. */
export function autoBuildTotalMs(animInfo, elements) {
  if (!animInfo?.stepCount) return 0
  return stepDurations(animInfo, elements).reduce((sum, d) => sum + d + AUDIO_TERM, 0)
}

export { INK_COLORS }

// 페이지 키(예: "3-1") → { pageIndex, variantIndex } 정렬 순서로 슬라이드 진행 순서를 만든다.
export function sortedPageKeys(pages) {
  return Object.keys(pages).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || (aV || 0) - (bV || 0)
  })
}

// 이 페이지의 자막이 이미 프로젝트에 저장돼 있고, 그 자막이 지금의 notesAudio를 위한 것인지
// (forRef 일치) 확인한다 — 음성이 교체되면 forRef가 낡은 참조가 되어 false를 반환(재생성 필요).
export function hasFreshCaptions(page, audioSrcRef) {
  return !!page?.notesCaptions && page.notesCaptions.forRef === audioSrcRef
}

// 저장된 자막이 지금 음성의 것이면서 '노트 원문 교정'까지 거쳤는지. 교정 단계가 생기기 전에
// 만들어진 자막은 다시 써 주기만 하면 되므로(STT 재호출 없음) 손볼 대상으로 본다.
export function captionsUpToDate(page, audioSrcRef) {
  if (!hasFreshCaptions(page, audioSrcRef)) return false
  return page.notesCaptions.notesAligned != null || !page.notes
}

// pageKey의 notesAudio(idb:// 참조) → 자막을 보장한다.
// 1) 프로젝트에 이미 저장된(음성 교체 전) 자막이 있으면 그대로 재사용(STT 재호출 없음 — 이래야
//    같은 덱을 다시 열거나 공유 링크로 받은 사람도 다시 돈을 쓰지 않는다).
//    단, 노트 원문 교정을 아직 거치지 않은 옛 자막이면 그 단계만 태워 저장을 갱신한다(무료·즉시).
// 2) 없으면 STT로 새로 전사(같은 오디오를 여러 곳에서 동시에 요청해도 getOrFetchTranscript가
//    중복 호출을 막는다) → 노트 원문에 맞춰 교정 → forRef와 함께 flatStore에 저장한다.
//
// 전사 캐시(transcriptCache)에는 교정 전 원본이 들어간다 — 캐시의 단위는 '오디오'이고 교정은
// '페이지의 노트'에 달렸으므로, 같은 음성을 다른 노트의 페이지가 써도 각자 맞게 교정된다.
async function ensureCaptionsForPage(pageKey, audioSrcRef, pageSnapshot) {
  if (hasFreshCaptions(pageSnapshot, audioSrcRef)) {
    const saved = pageSnapshot.notesCaptions
    if (saved.notesAligned != null || !pageSnapshot.notes) return saved
    const fixed = { ...correctTranscriptWithNotes(saved, pageSnapshot.notes), forRef: audioSrcRef }
    useFlatStore.getState().setPageNotesCaptions(fixed, pageKey, pageSnapshot)
    return fixed
  }

  const blobKey = BlobStore.parseRef(audioSrcRef)
  const blob = await BlobStore.get(blobKey)
  if (!blob) throw new Error('오디오를 찾을 수 없습니다.')
  const transcript = await getOrFetchTranscript(blobKey, () => transcribeSpeech(blob))
  const corrected = correctTranscriptWithNotes(transcript, pageSnapshot?.notes)
  const withRef = { ...corrected, forRef: audioSrcRef }
  useFlatStore.getState().setPageNotesCaptions(withRef, pageKey, pageSnapshot)
  return withRef
}

// 방금 저장된 자막을 로컬 allPages 스냅샷에도 반영(불변 업데이트) — 그래야 이후 같은 슬라이드를
// 다시 확인할 때(뒤로 갔다 다시 오는 등) 이미 있는 걸 또 요청하지 않는다.
function mergePageCaptions(setAllPages, key, notesCaptions) {
  setAllPages(prev => (prev ? { ...prev, [key]: { ...prev[key], notesCaptions } } : prev))
}

export function usePresentationEngine({ onExit } = {}) {
  const [allPages, setAllPages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingCaptions, setLoadingCaptions] = useState(false) // 첫 슬라이드 자막 준비 중(로딩 화면 문구용)

  // 미방문 페이지 포함 전체 페이지 비동기 추출 (프리로드 완료 대기)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      while (useFlatStore.getState()._preloading) {
        await new Promise(r => setTimeout(r, 200))
        if (cancelled) return
      }
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      if (cancelled) return
      setAllPages(pages)

      // 가라오케 자막이 켜져 있으면 시작 슬라이드의 STT만 여기서 기다린다 — "발표 중간부터
      // 자막이 뜨는" 문제를 첫 화면에서부터 막기 위함. 나머지는 발표 시작 후 백그라운드로.
      const keys = sortedPageKeys(pages)
      if (useEditorStore.getState().karaokeCaptions && keys.length) {
        const startIdx = Math.max(0, Math.min(useEditorStore.getState().presentStartIndex || 0, keys.length - 1))
        const startKey = keys[startIdx]
        const startAudio = pages[startKey]?.notesAudio
        if (BlobStore.isIdbRef(startAudio) && !captionsUpToDate(pages[startKey], startAudio)) {
          setLoadingCaptions(true)
          await Promise.race([
            ensureCaptionsForPage(startKey, startAudio, pages[startKey])
              .then(withRef => mergePageCaptions(setAllPages, startKey, withRef))
              .catch(() => { /* 실패해도 발표는 시작 — 슬라이드별 자막 로직이 재시도 */ }),
            new Promise(r => setTimeout(r, CAPTION_PREFETCH_TIMEOUT_MS)),
          ])
          if (cancelled) return
        }
      }
      setLoadingCaptions(false)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const sortedKeys = useMemo(() => (allPages ? sortedPageKeys(allPages) : []), [allPages])

  // 최신 allPages를 ref로도 들고 있는다 — 아래 백그라운드 프리페치 루프가 자기 자신의 자막
  // 저장으로 인한 allPages 갱신 때문에 매번 처음부터 재시작하지 않고, 최신 값만 읽게 하기 위함.
  const allPagesRef = useRef(allPages)
  useEffect(() => { allPagesRef.current = allPages }, [allPages])

  // 발표 시작 인덱스(F5=0, Shift+F5=현재 페이지). 마운트 시 1회 고정.
  const [currentSlide, setCurrentSlide] = useState(() => useEditorStore.getState().presentStartIndex || 0)
  const [revealed, setRevealed] = useState(0)        // 진행한 빌드 단계 수(0..stepCount)
  const [playingStep, setPlayingStep] = useState(-1) // 지금 재생 중인 단계(-1=없음)

  // 자동 진행 타이머가 "지금 몇 단계까지 나왔는지"를 읽기 위한 거울 — 발표자가 손으로 앞질러
  // 갔는데 뒤늦게 깨어난 타이머가 화면을 되감는 일을 막는다.
  const revealedRef = useRef(0)
  useEffect(() => { revealedRef.current = revealed }, [revealed])

  // allPages 로드 후 범위 클램프(시작 인덱스가 총 슬라이드 수 초과 방지)
  useEffect(() => {
    if (allPages && sortedKeys.length > 0) {
      setCurrentSlide(c => Math.max(0, Math.min(c, sortedKeys.length - 1)))
    }
  }, [allPages]) // eslint-disable-line react-hooks/exhaustive-deps

  const page = allPages?.[sortedKeys[currentSlide]]
  // 커넥터 기하는 참조 도형에서 유도 — 발표 모드에서도 해석된 사본으로 렌더
  const elements = useMemo(() => resolveConnectors(page?.elements || []), [page])
  const canvasSize = useMemo(() => page?.canvasSize || { w: 1280, h: 720 }, [page])
  const animInfo = useMemo(() => computeSteps(elements), [elements])
  const totalSlides = sortedKeys.length

  // 다음 슬라이드(발표자 창의 "다음" 썸네일용) — 없으면 null
  const nextPage = allPages?.[sortedKeys[currentSlide + 1]] || null

  // 루프 발표(전시회처럼 무인으로 계속 틀어두기) — 마지막 장 다음은 처음으로 돌아간다.
  const loopPresentation = useEditorStore(s => s.loopPresentation)
  // 루프 회차. 한 장짜리 덱은 되감아도 currentSlide가 그대로라 이펙트가 다시 돌지 않는다 —
  // 회차를 의존성에 넣어 '같은 장으로 되감기'도 새 진입으로 취급한다.
  const [loopCycle, setLoopCycle] = useState(0)

  /** 남은 빌드 단계와 무관하게 다음 장으로(자동 진행·루프 전용). 마지막 장이면 루프일 때만 처음으로. */
  const advanceSlide = useCallback(() => {
    if (currentSlide < totalSlides - 1) {
      setPlayingStep(-1)
      setRevealed(0)
      setCurrentSlide(currentSlide + 1)
    } else if (loopPresentation) {
      setPlayingStep(-1)
      setRevealed(0)
      setCurrentSlide(0)
      setLoopCycle(c => c + 1)
    }
    // 루프가 꺼져 있으면 마지막 장에 그대로 머문다(기존 동작)
  }, [currentSlide, totalSlides, loopPresentation])

  // ── 네비게이션 — 빌드 단계 먼저 진행, 다 끝나면 슬라이드 이동 ──
  const goNext = useCallback(() => {
    if (revealed < animInfo.stepCount) {
      setPlayingStep(revealed)   // 막 진입하는 단계 재생
      setRevealed(revealed + 1)
    } else if (currentSlide < totalSlides - 1 || loopPresentation) {
      advanceSlide()             // 마지막 장에서의 되감기는 advanceSlide가 판단
    }
  }, [revealed, animInfo.stepCount, currentSlide, totalSlides, loopPresentation, advanceSlide])

  const goPrev = useCallback(() => {
    if (revealed > 0) {
      setPlayingStep(-1)         // 되감기는 즉시(애니메이션 없음)
      setRevealed(revealed - 1)
    } else if (currentSlide > 0) {
      // 이전 슬라이드는 끝까지 진행된 상태로 진입
      const prevEls = resolveConnectors(allPages?.[sortedKeys[currentSlide - 1]]?.elements || [])
      setPlayingStep(-1)
      setRevealed(computeSteps(prevEls).stepCount)
      setCurrentSlide(currentSlide - 1)
    }
  }, [revealed, currentSlide, allPages, sortedKeys])

  /** 임의 슬라이드로 점프(발표자 창의 "전체 보기" 그리드) — 끝까지 진행된 상태로 진입 */
  const goToSlide = useCallback((idx) => {
    const i = Math.max(0, Math.min(idx, sortedKeys.length - 1))
    if (i === currentSlide) return
    setPlayingStep(-1)
    setRevealed(0)
    setCurrentSlide(i)
  }, [currentSlide, sortedKeys.length])

  // ── 발표 잉크(펜 주석) — 임시: 슬라이드별 보관, 종료(언마운트) 시 폐기 ──
  const [penActive, setPenActive] = useState(false)
  const [penTool, setPenTool] = useState('pen')     // pen | highlighter | eraser
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [penWidth, setPenWidth] = useState('thin')  // thin | thick
  const [inkBySlide, setInkBySlide] = useState({})  // { [slideIndex]: strokes[] }
  const [blackout, setBlackout] = useState(false)   // 슬라이드 블랙아웃(잉크만 보이게)

  const slideStrokes = inkBySlide[currentSlide] || []
  const commitStroke = useCallback((stroke) => {
    setInkBySlide(m => ({ ...m, [currentSlide]: [...(m[currentSlide] || []), stroke] }))
  }, [currentSlide])
  const eraseStroke = useCallback((id) => {
    setInkBySlide(m => ({ ...m, [currentSlide]: (m[currentSlide] || []).filter(s => s.id !== id) }))
  }, [currentSlide])
  const clearSlideInk = useCallback(() => {
    setInkBySlide(m => ({ ...m, [currentSlide]: [] }))
  }, [currentSlide])

  // ── 노트 음성 나레이션 ──
  // <audio> 엘리먼트는 엔진이 안에서만 붙든다. ref 객체를 컴포넌트로 돌려주면 JSX에서
  // 렌더 중 ref 접근이 되어버리므로, 밖으로는 콜백 ref와 조회 함수만 내보낸다.
  const audioElRef = useRef(null)
  const setAudioEl = useCallback((el) => { audioElRef.current = el }, [])
  /** 현재 재생 위치(초) — 자막이 매 프레임 읽는다 */
  const getAudioTime = useCallback(() => audioElRef.current?.currentTime || 0, [])
  /** 청중 창에 실어 보낼 재생 상태 */
  const getAudioStatus = useCallback(() => {
    const a = audioElRef.current
    return { time: a?.currentTime || 0, playing: !!(a && !a.paused && !a.ended) }
  }, [])
  const [narration, setNarration] = useState(true)
  // '음성 후 자동 진행'은 발표 전에도 설정 가능하도록 editorStore에 보관(localStorage 기억)
  const autoAdvance = useEditorStore(s => s.autoAdvance)
  // '애니메이션 자동 재생' — 음성 유무와 무관하게 빌드 단계를 클릭 없이 순서대로 흘려보낸다.
  const autoBuild = useEditorStore(s => s.autoBuild)
  const audioSrc = page?.notesAudio
  const hasAudio = !!audioSrc && BlobStore.isIdbRef(audioSrc)
  // 덱에 음성이 하나라도 있으면 나레이션 컨트롤 노출
  const deckHasAudio = useMemo(
    () => sortedKeys.some(k => BlobStore.isIdbRef(allPages?.[k]?.notesAudio)),
    [allPages, sortedKeys])

  // 음성이 실제로 흐르지 못한 슬라이드(자동재생 차단·블롭 유실·디코드 실패)를 표시한다.
  // 루프에서 중요하다 — '음성이 끝나면 다음 장'만 믿고 있으면 여기서 덱이 영영 멈춘다.
  const [audioBlocked, setAudioBlocked] = useState(false)
  const onAudioError = useCallback(() => setAudioBlocked(true), [])

  // 슬라이드 진입 시 해당 노트 음성 자동 재생, 이동/종료 시 정지.
  // loading이 꺼지기 전(= 로딩 화면 표시 중, 자막 준비 중 포함)에는 재생하지 않는다 —
  // allPages는 자막 선행 대기보다 먼저 채워지므로, loading 없이는 화면이 로딩 문구를
  // 보여주는 동안 나레이션이 먼저 흘러나온다.
  useEffect(() => {
    const el = audioElRef.current
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    setAudioBlocked(false)
    if (loading || !narration || !hasAudio) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(audioSrc)).then(url => {
      if (cancelled || !audioElRef.current) return
      if (!url) { setAudioBlocked(true); return }
      audioElRef.current.src = url
      // 노트 음성 볼륨(0~1). 0이어도 재생은 유지돼 자동진행은 동작(립싱크 영상이 소리 담당 시 0).
      audioElRef.current.volume = page?.notesAudioVolume ?? 1
      audioElRef.current.play().catch(() => {
        if (!cancelled) setAudioBlocked(true) // 자동재생 차단/실패 — 발표는 그대로 진행
      })
    })
    return () => { cancelled = true }
  }, [currentSlide, loopCycle, narration, hasAudio, audioSrc, page?.notesAudioVolume, loading])

  // 이 슬라이드에서 음성이 실제로 흐르는가 — 자동 진행의 신호원을 고르는 기준.
  const audioWillPlay = narration && hasAudio && !audioBlocked

  const onAudioEnded = useCallback(() => {
    if (autoAdvance || loopPresentation) advanceSlide()
  }, [autoAdvance, loopPresentation, advanceSlide])

  const replayAudio = useCallback(() => {
    const el = audioElRef.current
    if (!el || !el.src) return
    el.currentTime = 0
    el.volume = page?.notesAudioVolume ?? 1
    el.play().catch(() => { /* 무시 */ })
  }, [page?.notesAudioVolume])

  // 클릭 없이 빌드 단계를 순서대로 자동 재생 — 단계마다 이전 종료 후 0.3초 텀.
  // 켜지는 경우는 세 가지다.
  //  1) 음성 있는 슬라이드: 나레이션에 맞춰 클릭 트리거를 자동으로 흘려보낸다.
  //  2) '애니메이션 자동 재생' 옵션: 음성이 없어도 같은 리듬으로 흘려보낸다 — 클릭해 가며
  //     나레이션을 읽기 힘든 상황용. 마지막 단계까지 나오면 그대로 멈춘다.
  //  3) 루프 발표: 눌러 줄 사람이 없으니 당연히 자동이어야 한다.
  // (슬라이드→슬라이드 자동 전환은 '음성 후 자동 진행'과 루프가 담당.)
  const autoPlaySteps = autoBuild || loopPresentation || (narration && hasAudio)
  useEffect(() => {
    if (loading || !autoPlaySteps || animInfo.stepCount === 0) return
    const durs = stepDurations(animInfo, elements)
    const timers = []
    let t = AUDIO_TERM
    for (let s = 0; s < animInfo.stepCount; s++) {
      timers.push(setTimeout(() => {
        if (revealedRef.current > s) return // 발표자가 이미 앞질러 감 — 되감지 않는다
        setPlayingStep(s)
        setRevealed(s + 1)
      }, t))
      t += durs[s] + AUDIO_TERM
    }
    return () => timers.forEach(clearTimeout)
  }, [currentSlide, loopCycle, autoPlaySteps, animInfo, elements, loading])

  // 루프 발표에서 음성이 흐르지 않는 슬라이드(음성 없음·나레이션 끔·자동재생 차단)를 넘기는 타이머.
  // 음성이 흐르는 슬라이드는 onAudioEnded가 넘기므로 여기서 손대지 않는다 — 두 곳이 같이 넘기면
  // 한 장을 건너뛴다.
  // 의존성에 animInfo/elements 객체가 아니라 계산된 시간(숫자)을 두는 이유: 백그라운드 자막
  // 저장이 allPages를 새로 만들면 두 객체의 신원이 바뀐다. 그때마다 타이머를 다시 걸면
  // 슬라이드가 필요 이상으로 오래 머문다.
  const buildTotalMs = autoBuildTotalMs(animInfo, elements)
  useEffect(() => {
    if (loading || !loopPresentation || audioWillPlay) return
    const t = setTimeout(advanceSlide, buildTotalMs + LOOP_DWELL_MS)
    return () => clearTimeout(t)
  }, [loading, loopPresentation, audioWillPlay, buildTotalMs, advanceSlide, currentSlide, loopCycle])

  // ── 가라오케 자막(STT 단어별 하이라이트) ──
  const captionsOn = useEditorStore(s => s.karaokeCaptions)
  const setCaptionsOn = useEditorStore(s => s.setKaraokeCaptions)
  const [captionWords, setCaptionWords] = useState(null)   // 현재 슬라이드 자막 단어(없으면 null)
  const [captionBusy, setCaptionBusy] = useState(false)
  const [captionErr, setCaptionErr] = useState('')

  // 발표 시작 후: 나머지 슬라이드의 자막을 진행 순서대로 백그라운드에서 미리 준비(요청만, 대기 없음).
  useEffect(() => {
    if (loading || !allPages || !useEditorStore.getState().karaokeCaptions) return
    let cancelled = false
    ;(async () => {
      const order = presentationOrder(currentSlide, sortedKeys.length)
      for (const idx of order) {
        if (cancelled) return
        const key = sortedKeys[idx]
        const p = allPagesRef.current?.[key]
        const src = p?.notesAudio
        if (!BlobStore.isIdbRef(src) || captionsUpToDate(p, src)) continue
        await ensureCaptionsForPage(key, src, p)
          .then(withRef => mergePageCaptions(setAllPages, key, withRef))
          .catch(() => { /* 이 슬라이드는 나중에 슬라이드별 로직이 재시도 */ })
      }
    })()
    return () => { cancelled = true }
    // currentSlide는 시작점일 뿐 — 슬라이드가 바뀔 때마다 다시 돌 필요 없음(진행 순서에 이미 전부 포함).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sortedKeys.length])

  // 자막 on + 현재 슬라이드에 음성 있음 → 저장된 자막이 있으면 그대로, 없으면 STT 호출.
  useEffect(() => {
    setCaptionErr('')
    if (!captionsOn || !hasAudio) { setCaptionWords(null); return }
    if (captionsUpToDate(page, audioSrc)) { setCaptionWords(page.notesCaptions.words); return }
    setCaptionWords(null)
    let cancelled = false
    setCaptionBusy(true)
    ensureCaptionsForPage(sortedKeys[currentSlide], audioSrc, page)
      .then(transcript => {
        if (cancelled) return
        setCaptionWords(transcript.words)
        mergePageCaptions(setAllPages, sortedKeys[currentSlide], transcript)
      })
      .catch(e => { if (!cancelled) setCaptionErr(e.message || '자막 생성 실패') })
      .finally(() => { if (!cancelled) setCaptionBusy(false) })
    return () => { cancelled = true }
  }, [captionsOn, hasAudio, audioSrc]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCaptions = useCallback(() => {
    if (!captionsOn && !hasApiKey()) { openAiSettings(); return }
    setCaptionsOn(!captionsOn)
  }, [captionsOn, setCaptionsOn])

  // ── 발표 중 키보드 ──
  // Escape는 2단계: 펜이 켜져 있으면 펜만 끄고(+블랙아웃 해제), 아니면 발표 종료.
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (penActive) { setPenActive(false); setBlackout(false); return }
      onExit?.()
      return
    }
    // 발표 그리기 단축키 — 단일 키로 도구 직접 선택(+필요 시 드로잉 자동 진입).
    // 도구 전환 시 블랙아웃은 유지(전환마다 풀리지 않도록); 해제는 펜 종료에서.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'KeyP') { e.preventDefault(); setPenActive(true); setPenTool('pen'); return }
      if (e.code === 'KeyH') { e.preventDefault(); setPenActive(true); setPenTool('highlighter'); return }
      if (e.code === 'KeyE') { e.preventDefault(); setPenActive(true); setPenTool('eraser'); return }
      if (e.code === 'KeyC') { e.preventDefault(); clearSlideInk(); return }
      if (e.code === 'KeyB') { e.preventDefault(); setPenActive(true); setBlackout(b => !b); return }
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      goNext()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault()
      goPrev()
    }
  }, [penActive, onExit, goNext, goPrev, clearSlideInk])

  return {
    // 덱
    allPages, sortedKeys, loading, loadingCaptions,
    page, nextPage, elements, canvasSize, animInfo,
    // 진행
    currentSlide, totalSlides, revealed, playingStep, goNext, goPrev, goToSlide, advanceSlide,
    // 잉크
    penActive, setPenActive, penTool, setPenTool, penColor, setPenColor, penWidth, setPenWidth,
    blackout, setBlackout, slideStrokes, inkBySlide, commitStroke, eraseStroke, clearSlideInk,
    // 나레이션
    setAudioEl, getAudioTime, getAudioStatus,
    narration, setNarration, hasAudio, deckHasAudio, autoAdvance, autoBuild, loopPresentation,
    onAudioEnded, onAudioError, replayAudio,
    // 자막
    captionsOn, toggleCaptions, captionWords, captionBusy, captionErr,
    // 키보드
    handleKeyDown,
  }
}
