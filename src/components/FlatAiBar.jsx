import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { hasApiKey, generateImagePrompt, generateImage, generateIdeogramCaption, editSlideText } from '../core/OpenAIClient'
import { generateLayoutImage, checkImagenBackend, imagenDockerRunCommand } from '../core/ImagenBackendClient'
import { isLocalLlmEnabled } from '../core/LlmBackendClient'
import { renderMarkdown } from '../core/markdown'
import { BlobStore } from '../core/BlobStore'
import { openAiSettings } from './AiSettingsModal'
import { IMAGE_STYLES } from '../core/aiImageStyles'
import { embedPngMetadata } from '../core/pngMeta'
import { useDraggableToolbar, GripHandle } from './useDraggableToolbar'

const IMG_BACKEND_KEY = 'ai-image-backend' // 'openai' | 'local'

// AI 번역 대상 언어(라벨=UI, name=프롬프트에 넣는 영어 언어명). 마지막 선택은 localStorage에 기억.
const TRANSLATE_LANG_KEY = 'ai-translate-lang'
const TRANSLATE_LANGS = [
  { code: 'en', label: '영어', name: 'English' },
  { code: 'ja', label: '일본어', name: 'Japanese' },
  { code: 'zh-Hans', label: '중국어(간체)', name: 'Simplified Chinese' },
  { code: 'zh-Hant', label: '중국어(번체)', name: 'Traditional Chinese' },
  { code: 'ko', label: '한국어', name: 'Korean' },
  { code: 'es', label: '스페인어', name: 'Spanish' },
  { code: 'fr', label: '프랑스어', name: 'French' },
]
const readLastLang = () => { try { return localStorage.getItem(TRANSLATE_LANG_KEY) || '' } catch { return '' } }

/** 텍스트 박스 비율에 맞춘 생성 크기 — 16배수, 긴변 ~1024, 256–1536 클램프(로컬 ideogram용). */
function genSizeForBox(w, h, longEdge = 1024) {
  const r = (w || 1) / (h || 1)
  const f = (v) => Math.max(256, Math.min(1536, Math.round(v / 16) * 16))
  let W, H
  if (r >= 1) { W = longEdge; H = f(longEdge / r) } else { H = longEdge; W = f(longEdge * r) }
  return { width: f(W), height: f(H) }
}

/**
 * FlatAiBar — 텍스트 박스(요소)를 단일 선택했을 때 뜨는 전용 AI 플로팅바.
 *
 * 액션 "AI 이미지 생성": 텍스트 박스 내용을 분석해 목적에 맞는 영어 프롬프트를 만들고,
 * 그 프롬프트로 이미지를 생성한 뒤, 미리보기(적용/재생성/취소)를 거쳐 **같은 위치·크기의
 * 이미지 요소로 텍스트 박스를 교체**한다(되돌리기 가능).
 *
 * 캔버스 줌과 무관하게 읽기 좋게 하려고 document.body 포털 + 화면 좌표로 배치한다.
 */
export default function FlatAiBar({ element, scale, canvasRef }) {
  // 'idle' | 'compose' | 'loading' | 'preview' | 'error'  (compose는 텍스트 '설명으로 편집' 지시 입력)
  const [phase, setPhase] = useState('idle')
  const [tool, setTool] = useState('image') // 패널이 표현하는 작업: 'image' | 'text'
  const [styleId, setStyleId] = useState('flat')
  const [status, setStatus] = useState('')
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [source, setSource] = useState('openai') // 생성 결과 출처(적용/재생성 분기): 'openai'(dataURL) | 'local'(blob)
  const [error, setError] = useState('')
  const [imgenDown, setImgenDown] = useState(false) // 로컬 이미지 서버 미연결 → 설치 안내 표시
  const [cmdCopied, setCmdCopied] = useState(false)
  const [imgMenuOpen, setImgMenuOpen] = useState(false) // 'AI 이미지 생성' 화풍 드롭다운
  // AI 텍스트 편집 상태
  const [menuOpen, setMenuOpen] = useState(false)       // 텍스트 편집 액션 드롭다운
  const [transOpen, setTransOpen] = useState(false)     // '번역' 언어 하위목록 펼침
  const [lastLangCode, setLastLangCode] = useState(readLastLang) // 마지막 번역 언어(빠른 재선택)
  const [transLang, setTransLang] = useState(null)      // 진행 중 번역 대상 {code,label,name}(재시도용)
  const [textAction, setTextAction] = useState(null)    // 'spelling'|'formal'|'markdown'|'prompt'|'translate'
  const [instruction, setInstruction] = useState('')    // '설명으로 편집' 지시문
  const [origText, setOrigText] = useState('')          // 편집 전 원문(미리보기 비교용)
  const [resultText, setResultText] = useState('')      // 편집 결과
  const abortRef = useRef(null)
  const blobRef = useRef(null) // 로컬 결과 Blob(적용 시 BlobStore 저장)

  // 이미지 생성 엔진은 AI 설정(이미지 생성 > 기본 엔진)을 따른다. 생성 시점에 읽음(설정 변경 즉시 반영).
  const getBackend = () => { try { return localStorage.getItem(IMG_BACKEND_KEY) || 'openai' } catch { return 'openai' } }

  // 로컬(blob:) 미리보기 URL 누수 방지 — imageUrl 교체/언마운트 시 이전 blob URL 해제(dataURL은 제외)
  useEffect(() => () => { if (imageUrl && imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  // 선택 요소의 화면 좌표(줌/팬 반영). ref는 렌더 중 읽지 않고 layout effect에서 계산.
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)
  // 다이어그램 모드면 연결점(도트)을 가리지 않도록 플로팅바를 더 멀리 띄운다(아래 GAP).
  const diagramMode = useFlatStore(s => s.diagramMode)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [])

  // 줌/팬에 따라 변하는 선택 요소의 화면 좌표를 렌더 후 측정해 state에 반영한다.
  // (DOM 측정→state는 레이아웃 의존 위치잡기의 정당한 패턴 — 동일값이면 setState 생략)
  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + element.x * scale,
      top: cr.top + element.y * scale,
      bottom: cr.top + (element.y + element.height) * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.height, scale, tick])

  // 선택 요소가 바뀌면 진행 중 작업 취소
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [element.id])

  const sourceText = useCallback(() => htmlToPlain(element.content), [element.content])

  // 전체 파이프라인: 텍스트 분석 → 프롬프트/캡션 → 이미지 생성 (엔진은 AI 설정값을 따름)
  const run = useCallback(async (styleOverride) => {
    const backend = getBackend()
    // OpenAI 백엔드는 이미지 API에 키 필수. 로컬 백엔드는 캡션 LLM에 OpenAI 키 또는 로컬 LLM 중 하나 필요.
    const needKey = backend === 'openai' || !isLocalLlmEnabled()
    if (needKey && !hasApiKey()) { openAiSettings(); return }
    setTool('image')
    // 드롭다운에서 고른 화풍(styleOverride)이 있으면 그것을, 없으면 현재 styleId 사용(setState 지연 회피).
    const sid = styleOverride || styleId
    const text = sourceText()
    if (!text) { setError('텍스트 박스에 분석할 내용이 없습니다.'); setPhase('error'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setImageUrl(''); setImgenDown(false); blobRef.current = null
    try {
      const directive = IMAGE_STYLES.find(s => s.id === sid)?.directive || ''
      if (backend === 'local') {
        setStatus('이미지 서버 확인 중…')
        if (!(await checkImagenBackend(true))) {
          setError('로컬 이미지 생성 서버에 연결할 수 없습니다.')
          setImgenDown(true); setPhase('error'); return
        }
        setStatus('장면 설명 작성 중… (LLM)')
        const caption = await generateIdeogramCaption(text, { style: directive, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setPrompt(JSON.stringify(caption, null, 2))
        setStatus('AI 이미지 생성 중… (로컬, 수십 초)')
        const { width, height } = genSizeForBox(element.width, element.height)
        const { blob, url } = await generateLayoutImage(caption, { width, height, preset: 'V4_TURBO_12', signal: ctrl.signal })
        if (ctrl.signal.aborted) { URL.revokeObjectURL(url); return }
        blobRef.current = blob; setSource('local'); setImageUrl(url); setPhase('preview')
      } else {
        setStatus('내용 분석 중…')
        const p = await generateImagePrompt(text, { style: directive, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setPrompt(p)
        setStatus('AI 이미지 생성 중… (수십 초 걸릴 수 있어요)')
        const url = await generateImage(p, { width: element.width, height: element.height, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setSource('openai'); setImageUrl(url); setPhase('preview')
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 호출에 실패했습니다.')
      setPhase('error')
    }
  }, [sourceText, styleId, element.width, element.height])

  // 현재 프롬프트/캡션(편집 가능)으로 이미지만 다시 생성
  const regenerate = useCallback(async () => {
    const p = prompt.trim()
    if (!p) { run(); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading'); setError(''); setStatus('AI 이미지 생성 중…')
    try {
      if (source === 'local') {
        let caption
        try { caption = JSON.parse(p) } catch { run(); return } // 편집본이 JSON 아니면 처음부터
        const { width, height } = genSizeForBox(element.width, element.height)
        const { blob, url } = await generateLayoutImage(caption, { width, height, preset: 'V4_TURBO_12', signal: ctrl.signal })
        if (ctrl.signal.aborted) { URL.revokeObjectURL(url); return }
        blobRef.current = blob; setImageUrl(url); setPhase('preview')
      } else {
        const url = await generateImage(p, { width: element.width, height: element.height, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        setImageUrl(url); setPhase('preview')
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '이미지 생성에 실패했습니다.')
      setPhase('error')
    }
  }, [prompt, source, run, element.width, element.height])

  // 텍스트 박스를 같은 위치·크기의 이미지 요소로 교체(되돌리기 가능)
  const apply = useCallback(async () => {
    if (!imageUrl) return
    const imgStyles = {
      objectFit: 'cover', objectPosition: 'center center',
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
    }
    let content
    if (source === 'local') {
      // 로컬 결과는 Blob → BlobStore(idb://) 보관. (dataURL 메타 임베드는 OpenAI 경로 전용)
      if (!blobRef.current) return
      const key = await BlobStore.put(blobRef.current)
      content = BlobStore.toRef(key)
    } else {
      content = embedPngMetadata(imageUrl, { description: sourceText(), prompt })
    }
    useFlatStore.getState().updateFlatElement(element.id, { type: 'image', content, isRich: false, styles: imgStyles })
    setPhase('idle'); setImageUrl(''); blobRef.current = null
  }, [imageUrl, source, element.id, sourceText, prompt])

  // ── AI 텍스트 편집 ──────────────────────────────────────────────
  // 텍스트 편집은 OpenAI 고정(품질 보장) → OpenAI 키 필수.
  const runTextEdit = useCallback(async (action, instr, targetLang) => {
    if (!hasApiKey()) { openAiSettings(); return }
    const text = sourceText()
    if (!text) { setTool('text'); setTextAction(action); setError('편집할 텍스트가 없습니다.'); setPhase('error'); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTool('text'); setTextAction(action); setOrigText(text); setError('')
    setPhase('loading'); setStatus(action === 'translate' ? 'AI가 번역 중…' : 'AI가 텍스트를 편집 중…')
    try {
      const out = await editSlideText(text, { action, instruction: instr, targetLang, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setResultText(out); setPhase('preview')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'AI 호출에 실패했습니다.'); setPhase('error')
    }
  }, [sourceText])

  // 액션 선택 → 프롬프트 편집은 지시 입력(compose), 나머지는 즉시 실행
  const startTextEdit = useCallback((action) => {
    setMenuOpen(false)
    if (action === 'prompt') {
      setTool('text'); setTextAction('prompt'); setInstruction(''); setError(''); setPhase('compose')
      return
    }
    runTextEdit(action, '')
  }, [runTextEdit])

  // 번역: 대상 언어 선택 → 즉시 번역 + 마지막 언어 기억
  const startTranslate = useCallback((lang) => {
    setMenuOpen(false); setTransOpen(false)
    setTransLang(lang)
    setLastLangCode(lang.code)
    try { localStorage.setItem(TRANSLATE_LANG_KEY, lang.code) } catch { /* ignore */ }
    runTextEdit('translate', '', lang.name)
  }, [runTextEdit])

  // 편집 결과를 요소에 적용(되돌리기 1스텝). 마크다운은 마크다운 모드로 전환.
  const applyText = useCallback(() => {
    const r = resultText.trim()
    if (!r) return
    const st = useFlatStore.getState()
    if (textAction === 'markdown') {
      st.updateFlatElement(element.id, { isMarkdown: true, md: r, content: renderMarkdown(r), isRich: true })
    } else {
      st.updateFlatElement(element.id, { content: plainToHtml(r), isRich: /\n/.test(r), isMarkdown: false })
    }
    st.reflowAutoFit?.()
    setPhase('idle'); setResultText(''); setOrigText('')
  }, [resultText, textAction, element.id])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase('idle'); setError(''); setImageUrl('')
    setResultText(''); setOrigText(''); setInstruction('')
    setMenuOpen(false); setTransOpen(false)
  }, [])

  // 드래그 이동 — 그립 핸들로 idle 액션바를 자유 위치로 옮김(선택 변경 시 자동 복귀)
  const barRef = useRef(null)
  const { pos: dragPos, startDrag, dragging } = useDraggableToolbar(element.id, barRef)

  // 화면 좌표 (layout effect에서 계산됨)
  if (!rect) return null
  const { left: elemLeft, top: elemTop, bottom: elemBottom } = rect

  const BAR_H = 36
  // 다이어그램 모드에선 요소 바깥(위·아래 ~14px)에 연결점이 떠 있고 터치 반지름(~13px)까지 겹쳐,
  // 기본 8px 간격이면 바가 위쪽 연결점을 덮어 모바일에서 잡을 수 없다 → 연결점 위로 넉넉히 띄운다.
  const GAP = diagramMode ? 30 : 8
  const placeAbove = elemTop - BAR_H - GAP >= 8
  const anchorTop = placeAbove ? elemTop - BAR_H - GAP : elemBottom + GAP
  const anchorLeft = Math.max(8, Math.min(window.innerWidth - 360, elemLeft))
  // 드래그된 자유 위치가 있으면 그것을, 없으면 자동 앵커를 사용
  const barLeft = dragPos ? dragPos.left : anchorLeft
  const barTop = dragPos ? dragPos.top : anchorTop

  const PANEL_W = 360
  const PANEL_H_EST = 380
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, elemLeft))
  const panelTop = Math.max(8, Math.min(
    window.innerHeight - PANEL_H_EST - 8,
    placeAbove ? elemTop - 8 - PANEL_H_EST : elemBottom + 8,
  ))

  return createPortal(
    <>
      {/* 플로팅 액션바 (idle) */}
      {phase === 'idle' && (
        <div
          ref={barRef}
          data-edit-accessory="true"
          // 포털 자식의 React 이벤트는 FlatCanvas(부모)로 버블링되므로 반드시 전파 차단.
          // (안 하면 mousedown이 캔버스 마퀴로 전달돼 mouseup에서 선택 해제→바 언마운트)
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: barLeft, top: barTop, zIndex: 10040,
            display: 'flex', alignItems: 'center', gap: 6,
            height: BAR_H, padding: '0 8px', borderRadius: 10,
            background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <GripHandle onPointerDown={startDrag} dragging={dragging} />
          {/* 'AI 이미지 생성' 버튼 자체가 화풍 드롭다운 — 화풍을 고르면 그 스타일로 바로 생성. */}
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => { setImgMenuOpen(v => !v); setMenuOpen(false) }}
              title="화풍을 골라 텍스트 내용에 어울리는 이미지를 생성하고, 이 영역을 이미지로 교체합니다"
              style={aiBtnStyle}
            >
              <SparkleIcon />
              <span style={{ fontSize: 12, marginLeft: 5 }}>AI 이미지 생성 ▾</span>
            </button>
            {imgMenuOpen && (
              <div style={{ ...menuStyle, left: 0, right: 'auto' }}>
                {IMAGE_STYLES.map(s => (
                  <button key={s.id} type="button" style={menuItemStyle}
                    onClick={() => { setImgMenuOpen(false); setStyleId(s.id); run(s.id) }}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.14)', margin: '0 2px' }} />
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              onClick={() => { setMenuOpen(v => !v); setImgMenuOpen(false) }}
              title="선택한 텍스트 내용을 AI로 다듬습니다(맞춤법·발표체·마크다운·지시 편집)"
              style={aiBtnStyle}
            >
              <span style={{ fontSize: 12 }}>✍️ 텍스트 편집 ▾</span>
            </button>
            {menuOpen && (
              <div style={menuStyle}>
                <button type="button" style={menuItemStyle} onClick={() => startTextEdit('spelling')}>맞춤법 교정</button>
                <button type="button" style={menuItemStyle} onClick={() => startTextEdit('formal')}>공식 발표체로</button>
                <button type="button" style={menuItemStyle} onClick={() => startTextEdit('markdown')}>마크다운 정리</button>
                <button type="button" style={menuItemStyle} onClick={() => startTextEdit('prompt')}>설명으로 편집…</button>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '3px 0' }} />
                {(() => {
                  const ll = TRANSLATE_LANGS.find(l => l.code === lastLangCode)
                  return ll ? <button type="button" style={menuItemStyle} onClick={() => startTranslate(ll)}>🌐 번역 → {ll.label}</button> : null
                })()}
                <button type="button" style={menuItemStyle} onClick={() => setTransOpen(v => !v)}>🌐 번역{transOpen ? ' ▾' : ' ▸'}</button>
                {transOpen && TRANSLATE_LANGS.map(l => (
                  <button key={l.code} type="button" style={{ ...menuItemStyle, paddingLeft: 22 }} onClick={() => startTranslate(l)}>{l.label}</button>
                ))}
              </div>
            )}
          </span>
        </div>
      )}

      {/* 로딩 / 미리보기 / 에러 팝업 */}
      {phase !== 'idle' && (
        <div
          data-edit-accessory="true"
          onMouseDown={e => { e.stopPropagation() }}
          style={{
            position: 'fixed', left: panelLeft, top: panelTop, width: PANEL_W, zIndex: 10045,
            background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <SparkleIcon /> {tool === 'text' ? 'AI 텍스트 편집' : 'AI 이미지 생성'}
          </div>

          {/* 텍스트 '설명으로 편집' 지시 입력 */}
          {tool === 'text' && phase === 'compose' && (
            <>
              <div style={{ fontSize: 11, color: '#64748b' }}>어떻게 편집할지 설명하세요 (예: "3개 불릿으로 요약", "존댓말로", "영어로 번역")</div>
              <textarea
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (instruction.trim()) runTextEdit('prompt', instruction) } }}
                rows={3}
                autoFocus
                placeholder="편집 지시문…"
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
                }}
              />
            </>
          )}

          {phase === 'loading' && (
            <div style={{ fontSize: 13, color: '#94a3b8', padding: '10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner /> {status || '처리 중…'}
            </div>
          )}

          {phase === 'error' && (
            <div style={{ fontSize: 12.5, color: '#fca5a5', lineHeight: 1.5 }}>
              {error}
              {imgenDown && (
                <div style={{ marginTop: 8, color: '#cbd5e1', lineHeight: 1.6 }}>
                  NVIDIA GPU(40GB+) 머신에서 아래 Docker로 실행하세요 (게이트·비상업 모델 → 유효한 HF 토큰 필요):
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 10.5, color: '#cbd5e1', background: 'rgba(0,0,0,0.35)', padding: 8, borderRadius: 6, margin: '6px 0 0' }}>{imagenDockerRunCommand({})}</pre>
                  <button type="button"
                    onClick={() => { try { navigator.clipboard?.writeText(imagenDockerRunCommand({})); setCmdCopied(true); setTimeout(() => setCmdCopied(false), 1500) } catch { /* ignore */ } }}
                    style={{ ...ghostBtnStyle, marginTop: 6 }}>{cmdCopied ? '복사됨 ✓' : '명령 복사'}</button>
                </div>
              )}
            </div>
          )}

          {/* 이미지 미리보기 */}
          {phase === 'preview' && tool === 'image' && (
            <>
              <div style={{
                width: '100%', height: 200, borderRadius: 8, overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>프롬프트(편집 후 재생성 가능)</div>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
                  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
                  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
                }}
              />
              <div style={{ fontSize: 11, color: '#64748b' }}>
                적용하면 이 텍스트 박스가 같은 위치·크기의 이미지로 교체됩니다(되돌리기 가능).
              </div>
            </>
          )}

          {/* 텍스트 편집 미리보기(전/후 비교) */}
          {phase === 'preview' && tool === 'text' && (
            <>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {textAction === 'translate' && transLang ? `번역 → ${transLang.label} · ` : ''}전 → 후 (적용하면 이 텍스트 요소 내용이 교체됩니다)
              </div>
              <div style={diffBoxStyle}>
                <div style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', marginBottom: 8, opacity: 0.75 }}>{origText}</div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '0 0 8px' }} />
                <div style={{ color: '#f1f5f9', whiteSpace: 'pre-wrap' }}>{resultText}</div>
              </div>
              {textAction === 'markdown' && (
                <div style={{ fontSize: 11, color: '#64748b' }}>적용 시 마크다운 모드로 전환되어 렌더링됩니다.</div>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={cancel} style={ghostBtnStyle}>취소</button>
            {/* 텍스트 흐름 버튼 */}
            {tool === 'text' && phase === 'compose' && (
              <button type="button" onClick={() => runTextEdit('prompt', instruction)} disabled={!instruction.trim()}
                style={{ ...primaryBtnStyle, opacity: instruction.trim() ? 1 : 0.5, cursor: instruction.trim() ? 'pointer' : 'default' }}>실행</button>
            )}
            {tool === 'text' && (phase === 'preview' || phase === 'error') && textAction && (
              <button type="button" onClick={() => runTextEdit(textAction, instruction, transLang?.name)} style={ghostBtnStyle}>다시 시도</button>
            )}
            {tool === 'text' && phase === 'preview' && (
              <button type="button" onClick={applyText} style={primaryBtnStyle}>적용</button>
            )}
            {/* 이미지 흐름 버튼 */}
            {tool === 'image' && (phase === 'preview' || phase === 'error') && (
              <button type="button" onClick={regenerate} style={ghostBtnStyle}>재생성</button>
            )}
            {tool === 'image' && phase === 'preview' && (
              <button type="button" onClick={apply} style={primaryBtnStyle}>적용</button>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}

// content(HTML 또는 평문) → 평문
function htmlToPlain(content) {
  if (!content) return ''
  if (!/[<&]/.test(content)) return content.trim()
  const div = document.createElement('div')
  div.innerHTML = content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

// 평문 → 안전한 HTML(엔티티 이스케이프 + 줄바꿈 <br>)
function plainToHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

const aiBtnStyle = {
  display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#c7d2fe',
  background: 'rgba(99,102,241,0.18)',
}
const ghostBtnStyle = {
  padding: '6px 12px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
}
const primaryBtnStyle = {
  padding: '6px 14px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer',
  border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
}
const menuStyle = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 10050,
  display: 'flex', flexDirection: 'column', minWidth: 150, maxHeight: '60vh', overflowY: 'auto', padding: 4,
  background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
}
const menuItemStyle = {
  textAlign: 'left', padding: '7px 10px', fontSize: 12.5, borderRadius: 7,
  border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
}
const diffBoxStyle = {
  width: '100%', maxHeight: 220, overflowY: 'auto', boxSizing: 'border-box',
  padding: '10px 12px', fontSize: 12.5, lineHeight: 1.55,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
      <path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6L15.5 17.5l2.6-.9L19 14z" opacity="0.7" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#a5b4fc" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}
