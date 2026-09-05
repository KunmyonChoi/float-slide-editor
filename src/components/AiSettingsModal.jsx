import { create } from 'zustand'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getApiKey, setApiKey, getModel, setModel, getImageModel, setImageModel } from '../core/OpenAIClient'
import {
  getTextSelection, setTextSelection, getVisionSelection, setVisionSelection,
  getLocalLlmModel, getLocalLlmUrl, setLocalLlmUrl,
  getLocalVisionModel, getLocalVisionUrlRaw, setLocalVisionUrl,
  probeOllama, modelInList, testLocalLlm,
  detectOS, ollamaInstall, ollamaServeWithOrigin, LLM_DEFAULT_URL,
} from '../core/LlmBackendClient'
import {
  getImagenBase, setImagenBase, probeImagenBackend,
  imagenDockerRunCommand, IMAGEN_DOCKER_IMAGE,
} from '../core/ImagenBackendClient'

const IMG_BACKEND_KEY = 'ai-image-backend' // 이미지 생성 러너와 공유
const LOCAL_IMAGE_ENGINE = 'ideogram' // 이미지 생성 콤보의 로컬 항목(현재 엔진 하나)

/**
 * AI 설정 모달 — OpenAI(ChatGPT) API 키 + 작업별 모델 선택.
 *
 * 텍스트·이미지 생성·비전 세 가지를 각각 콤보 하나로 고른다. OpenAI 모델과 로컬 모델이
 * 같은 목록(optgroup)에 함께 있어, 콤보를 여는 것만으로 로컬 선택지가 보인다.
 * 로컬 항목을 고르면 그 콤보 바로 아래에 해당 로컬 설정(모델·URL·상태·설치 안내)이 펼쳐진다.
 *
 * 앱 어딘가에 <AiSettingsHost />를 한 번 마운트하고, 어디서든 openAiSettings()로 연다.
 * 키·설정은 localStorage에 보관한다(서버 없음).
 */

const useAiSettingsStore = create(() => ({ open: false }))

export function openAiSettings() {
  useAiSettingsStore.setState({ open: true })
}

function closeAiSettings() {
  useAiSettingsStore.setState({ open: false })
}

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
// 생성·편집·마스크 모두 이 설정 모델(기본 gpt-image-2)을 사용. 편집은 설정 모델이 edits를
// 지원하지 않을 때만 gpt-image-1.5로 자동 폴백(방어). 목록엔 gpt-image-2만 노출한다.
const IMAGE_MODEL_OPTIONS = ['gpt-image-2']

const labelStyle = { fontSize: 12, color: '#94a3b8', marginBottom: 4 }
const fieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
  background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
}
// 드롭다운 항목 — OS 기본 흰 배경에 밝은 글자가 묻히는 것 방지
const optionStyle = { background: '#1e293b', color: '#f1f5f9' }
const hintStyle = { fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.5 }
const codeStyle = { display: 'block', userSelect: 'text', fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '6px 8px', borderRadius: 6, marginTop: 4, wordBreak: 'break-all' }
const smallBtnStyle = { fontSize: 11, padding: '1px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }
const sectionStyle = { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }
const panelStyle = { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '2px solid rgba(99,102,241,0.5)', paddingLeft: 10 }
const noteStyle = { fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.6, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 }

/** 콤보 값 'local:qwen2.5:3b' → { provider, model } (모델명에 ':'이 있어 첫 ':'만 자른다). */
function parseSel(v) {
  const s = String(v || '')
  if (s === 'inherit') return { provider: 'inherit', model: '' }
  const i = s.indexOf(':')
  return i < 0 ? { provider: s, model: '' } : { provider: s.slice(0, i), model: s.slice(i + 1) }
}

/**
 * 백엔드 상태 조회 — 모달이 열릴 때와 URL이 바뀔 때만(입력 중 과다 호출 방지 350ms 디바운스).
 * probe는 예외를 던지지 않고 { ok, ... }를 준다.
 */
function useProbe(probe, url) {
  const [nonce, setNonce] = useState(0)
  const [result, setResult] = useState(null) // { url, nonce, data }
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      probe(url).then(data => { if (alive) setResult({ url, nonce, data }) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [probe, url, nonce])
  // 결과가 지금 URL/재조회 차수의 것일 때만 유효 — 아니면 아직 조회 중(effect에서 setState 불필요).
  const fresh = result?.url === url && result?.nonce === nonce
  const data = fresh ? result.data : null
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { loading: !fresh, data, ok: !!data?.ok, reload }
}

/**
 * 로컬(Ollama) optgroup 항목들.
 * 서버 미연결이어도 항목을 숨기지 않고 비활성 항목 + 이유를 남기고, 저장돼 있던 모델은
 * 조회 실패와 무관하게 항상 선택 가능한 항목으로 유지한다(사용자 설정이 사라지지 않도록).
 */
function localOptions(probe, savedModel) {
  const models = probe.data?.models || []
  const out = []
  if (probe.loading) out.push(<option key="_s" disabled style={optionStyle}>로컬 (확인 중…)</option>)
  else if (!probe.ok) out.push(<option key="_s" disabled style={optionStyle}>로컬 (서버 미연결)</option>)
  else if (!models.length) out.push(<option key="_s" disabled style={optionStyle}>로컬 (설치된 모델 없음)</option>)
  for (const m of models) out.push(<option key={m} value={`local:${m}`} style={optionStyle}>{m}</option>)
  if (savedModel && !models.includes(savedModel)) {
    out.push(
      <option key={`saved:${savedModel}`} value={`local:${savedModel}`} style={optionStyle}>
        {savedModel}{probe.ok ? ' (미설치)' : ''}
      </option>
    )
  }
  return out
}

/** OpenAI optgroup 항목들 — 목록에 없는 저장 모델도 유지. */
function openaiOptions(options, current) {
  const list = options.includes(current) || !current ? options : [...options, current]
  return list.map(m => <option key={m} value={`openai:${m}`} style={optionStyle}>{m}</option>)
}

/** 로컬 서버 조회 실패 이유 — 항목을 숨기는 대신 왜 못 쓰는지 밝힌다. */
function LocalUnavailable({ probe, base }) {
  if (probe.loading || probe.ok) return null
  return (
    <div style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      로컬 모델 목록을 불러오지 못했습니다({base} · {probe.data?.error || '연결 실패'}). Ollama 실행 여부와 OLLAMA_ORIGINS 설정을 확인하세요.
      <button type="button" onClick={probe.reload} style={smallBtnStyle}>다시 확인</button>
    </div>
  )
}

export function AiSettingsHost() {
  const open = useAiSettingsStore(s => s.open)
  if (!open) return null
  return <AiSettingsDialog />
}

function AiSettingsDialog() {
  // 열릴 때만 마운트 → 저장값을 useState 초기화로 읽는다(effect 불필요).
  const [key, setKey] = useState(() => getApiKey())
  const [reveal, setReveal] = useState(false)
  const inputRef = useRef(null)

  // 콤보 값: 'openai:<모델>' | 'local:<모델>' | (비전만) 'inherit'
  const [textSel, setTextSel] = useState(() => {
    const s = getTextSelection()
    return s.provider === 'local' ? `local:${s.model || getLocalLlmModel()}` : `openai:${s.model || getModel()}`
  })
  const [visSel, setVisSel] = useState(() => {
    const s = getVisionSelection()
    if (s.provider === 'inherit') return 'inherit'
    return s.provider === 'local' ? `local:${s.model || getLocalVisionModel()}` : `openai:${s.model || getModel()}`
  })
  const [imgSel, setImgSel] = useState(() => {
    let backend = 'openai'
    try { backend = localStorage.getItem(IMG_BACKEND_KEY) || 'openai' } catch { /* ignore */ }
    return backend === 'local' ? `local:${LOCAL_IMAGE_ENGINE}` : `openai:${getImageModel()}`
  })

  // 로컬 서버 주소(콤보에서 로컬을 고른 경우에만 아래 패널에 노출)
  const [llmUrl, setLlmUrl] = useState(() => getLocalLlmUrl())
  const [visUrl, setVisUrl] = useState(() => getLocalVisionUrlRaw())
  const [imgUrl, setImgUrl] = useState(() => getImagenBase())
  const [imgCmdCopied, setImgCmdCopied] = useState(false)
  const [llmTest, setLlmTest] = useState(null) // { busy } | { ok, text } | { ok:false, err }

  const text = parseSel(textSel)
  const vis = parseSel(visSel)
  const img = parseSel(imgSel)
  const textLocal = text.provider === 'local'
  const visLocal = vis.provider === 'local'
  const imgLocal = img.provider === 'local'

  // 콤보에 로컬 항목을 채울 서버 — 비전 URL은 비우면 텍스트 URL을 쓴다.
  const llmBase = llmUrl.trim() || LLM_DEFAULT_URL
  const visBase = visUrl.trim() || llmBase
  const llm = useProbe(probeOllama, llmBase)
  const vision = useProbe(probeOllama, visBase)
  const imagen = useProbe(probeImagenBackend, imgUrl.trim())

  // 목록 조회에 실패해도 저장돼 있던 모델은 항목으로 남긴다(설정 유실 방지).
  const savedTextLocal = textLocal ? text.model : getLocalLlmModel()
  const savedVisLocal = visLocal ? vis.model : getLocalVisionModel()
  const openaiTextModel = text.provider === 'openai' ? text.model : getModel()

  const runLlmTest = async () => {
    setLlmTest({ busy: true })
    try { setLlmTest({ ok: true, text: await testLocalLlm(text.model, llmBase) }) }
    catch (e) { setLlmTest({ ok: false, err: e?.message || String(e) }) }
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const save = () => {
    setApiKey(key)
    // 로컬 서버 주소는 선택과 무관하게 저장 — 다음에 로컬을 골랐을 때 그대로 쓴다.
    setLocalLlmUrl(llmUrl.trim())
    setLocalVisionUrl(visUrl.trim())
    setImagenBase(imgUrl.trim())

    if (textLocal) setTextSelection('local', text.model || getLocalLlmModel())
    else { setModel(text.model); setTextSelection('openai', text.model) }

    if (visLocal) setVisionSelection('local', vis.model || getLocalVisionModel())
    else if (vis.provider === 'openai') setVisionSelection('openai', vis.model)
    else setVisionSelection('inherit')

    if (!imgLocal) setImageModel(img.model)
    try {
      localStorage.setItem(IMG_BACKEND_KEY, imgLocal ? 'local' : 'openai')
      // 이미지 엔진 변경을 같은 탭 구독자에 알림
      window.dispatchEvent(new Event('ai-image-backend-change'))
    } catch { /* ignore */ }
    closeAiSettings()
  }

  const os = detectOS()
  const inst = ollamaInstall(os)
  const textReady = llm.ok && modelInList(llm.data?.models, text.model)
  const visReady = vision.ok && modelInList(vision.data?.models, vis.model)
  const imgReady = imagen.ok && imagen.data?.ready

  return createPortal(
    <div
      onMouseDown={closeAiSettings}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(480px, 92vw)', maxHeight: '90vh',
          background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {/* 제목·푸터는 고정, 가운데 본문만 스크롤(설정 항목이 많아 화면을 넘칠 수 있어) */}
        <div style={{ fontSize: 15, fontWeight: 600, flexShrink: 0 }}>AI 설정</div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, marginRight: -8, paddingRight: 8 }}>

        <div>
          <div style={labelStyle}>OpenAI API 키</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type={reveal ? 'text' : 'password'}
              value={key}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              style={{ ...fieldStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setReveal(v => !v)}
              style={{
                padding: '0 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
              }}
            >{reveal ? '숨김' : '표시'}</button>
          </div>
          <div style={hintStyle}>
            키는 이 브라우저(localStorage)에만 저장되며 외부로 전송되지 않습니다(OpenAI 호출 시에만 사용).
            공용 PC에서는 사용 후 비워두는 것을 권장합니다. 아래에서 로컬 모델만 쓴다면 키는 없어도 됩니다.
          </div>
        </div>

        {/* ── 텍스트 모델 ── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>텍스트 모델 (분석·프롬프트·발표 원고)</div>
          <select value={textSel} onChange={e => setTextSel(e.target.value)} style={fieldStyle}>
            <optgroup label="OpenAI">{openaiOptions(MODEL_OPTIONS, openaiTextModel)}</optgroup>
            <optgroup label="로컬 (Ollama · 오프라인)">{localOptions(llm, savedTextLocal)}</optgroup>
          </select>
          <LocalUnavailable probe={llm} base={llmBase} />
          {textLocal && (
            <div style={panelStyle}>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                텍스트 AI(요약·번역·프롬프트 등)가 로컬 Ollama로 동작합니다(인터넷·OpenAI 키 불필요).
              </div>
              <div>
                <div style={labelStyle}>모델 이름 (목록에 없는 모델도 직접 입력)</div>
                <input value={text.model} onChange={e => setTextSel(`local:${e.target.value.trim()}`)} placeholder="qwen2.5:3b" spellCheck={false} style={fieldStyle} />
                <div style={{ ...hintStyle, marginTop: 3 }}>
                  가벼움 <code>qwen2.5:3b</code> · 균형 <code>qwen2.5:7b</code> · 한국어 튜닝 GGUF는 <code>hf.co/&lt;repo&gt;</code> 형식(예: <code>hf.co/MyeongHo0621/Qwen2.5-3B-Korean</code>, GGUF일 때)
                </div>
              </div>
              <div>
                <div style={labelStyle}>서버 URL</div>
                <input value={llmUrl} onChange={e => setLlmUrl(e.target.value.trim())} placeholder={LLM_DEFAULT_URL} spellCheck={false} style={fieldStyle} />
              </div>
              <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                상태:{' '}
                {llm.loading ? '확인 중…'
                  : llm.ok
                    ? <span style={{ color: textReady ? '#16a34a' : '#d97706' }}>
                        실행 중 ({llm.data.version ? `v${llm.data.version}, ` : ''}{text.model} {textReady ? '설치됨' : '미설치'})
                      </span>
                    : <span style={{ color: '#dc2626' }}>미연결</span>}
                <button type="button" onClick={llm.reload} style={smallBtnStyle}>다시 확인</button>
                <button type="button" onClick={runLlmTest} disabled={!llm.ok || llmTest?.busy}
                  style={{ ...smallBtnStyle, border: 'none', background: 'rgba(99,102,241,0.85)', color: '#fff', cursor: llm.ok ? 'pointer' : 'default', opacity: llm.ok ? 1 : 0.5 }}>테스트</button>
              </div>
              {llmTest && (
                <div style={{ fontSize: 11.5, lineHeight: 1.5, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, whiteSpace: 'pre-wrap', userSelect: 'text', color: llmTest.ok === false ? '#fca5a5' : '#cbd5e1' }}>
                  {llmTest.busy ? '테스트 중… (모델 첫 로드 시 수십 초)' : llmTest.ok ? `✓ 응답: ${llmTest.text}` : `✗ ${llmTest.err}`}
                </div>
              )}
              {!textReady && (
                <div style={noteStyle}>
                  <b>설치 안내 ({os})</b>
                  <div style={{ marginTop: 4 }}>① Ollama 설치:{inst.type === 'cmd'
                    ? <code style={codeStyle}>{inst.text}</code>
                    : <> <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" style={{ color: '#a5b4fc' }}>{inst.text}</a></>}</div>
                  <div style={{ marginTop: 6 }}>② 모델 받기:<code style={codeStyle}>ollama pull {text.model}</code></div>
                  <div style={{ marginTop: 6 }}>③ 이 앱(공개 주소)이 호출하려면 Origin 허용 후 실행:<code style={codeStyle}>{ollamaServeWithOrigin()}</code></div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 이미지 생성 모델 ── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>이미지 생성 모델</div>
          <select value={imgSel} onChange={e => setImgSel(e.target.value)} style={fieldStyle}>
            <optgroup label="OpenAI">{openaiOptions(IMAGE_MODEL_OPTIONS, img.provider === 'openai' ? img.model : getImageModel())}</optgroup>
            <optgroup label="로컬">
              <option value={`local:${LOCAL_IMAGE_ENGINE}`} style={optionStyle}>로컬 ideogram (GPU 서버) — 생성 전용</option>
            </optgroup>
          </select>
          <div style={hintStyle}>
            {imgLocal && (
              <span style={{ display: 'inline-block', marginRight: 6, padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: '#fcd34d', border: '1px solid rgba(252,211,77,0.5)' }}>생성 전용</span>
            )}
            로컬 엔진은 <b>텍스트 → 이미지 생성에만</b> 쓰입니다. 설명으로 편집 · 여백까지 그림 채우기 ·
            선택 영역/슬라이드 이미지 생성 등 <b>편집 계열은 항상 OpenAI</b>로 처리됩니다(로컬 대체 없음).
          </div>
          {imgLocal && (
            <div style={panelStyle}>
              <div>
                <div style={labelStyle}>서버 URL</div>
                <input value={imgUrl} onChange={e => setImgUrl(e.target.value.trim())} placeholder="http://localhost:8323" spellCheck={false} style={fieldStyle} />
                <div style={{ ...hintStyle, marginTop: 3 }}>로컬 Docker 또는 원격 GPU/프록시 주소</div>
              </div>
              <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                상태:{' '}
                {imagen.loading ? '확인 중…'
                  : imagen.ok
                    ? <span style={{ color: imgReady ? '#16a34a' : '#d97706' }}>{imgReady ? `연결됨${imagen.data.device ? ` (${imagen.data.device})` : ''}` : '연결됨(모델 로딩 중… 기동 ~3분)'}</span>
                    : <span style={{ color: '#dc2626' }}>미연결</span>}
                <button type="button" onClick={imagen.reload} style={smallBtnStyle}>다시 확인</button>
              </div>
              {!imgReady && (
                <div style={noteStyle}>
                  <b>실행 안내</b> — NVIDIA GPU(40GB+) 머신에서 (게이트·비상업 모델 → 유효한 HF 토큰 필요):
                  <code style={codeStyle}>{imagenDockerRunCommand({})}</code>
                  <button type="button"
                    onClick={() => { try { navigator.clipboard?.writeText(imagenDockerRunCommand({})); setImgCmdCopied(true); setTimeout(() => setImgCmdCopied(false), 1500) } catch { /* ignore */ } }}
                    style={{ ...smallBtnStyle, marginTop: 6, padding: '2px 10px' }}>{imgCmdCopied ? '복사됨 ✓' : '명령 복사'}</button>
                  <span style={{ marginLeft: 8, color: '#64748b' }}>{IMAGEN_DOCKER_IMAGE}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 비전 모델(이미지 분석) ── */}
        <div style={sectionStyle}>
          <div style={labelStyle}>비전 모델 (이미지 분석 · 인포그래픽)</div>
          <select value={visSel} onChange={e => setVisSel(e.target.value)} style={fieldStyle}>
            <option value="inherit" style={optionStyle}>텍스트 모델과 동일</option>
            <optgroup label="OpenAI">{openaiOptions(MODEL_OPTIONS, vis.provider === 'openai' ? vis.model : '')}</optgroup>
            <optgroup label="로컬 (Ollama · GPU 필요)">{localOptions(vision, savedVisLocal)}</optgroup>
          </select>
          <LocalUnavailable probe={vision} base={visBase} />
          {vis.provider === 'inherit' && textLocal && (
            <div style={hintStyle}>
              로컬 텍스트 모델은 이미지를 읽지 못하므로, 이미지 분석은 <b>OpenAI</b>로 갑니다.
              오프라인으로 하려면 아래 목록에서 로컬 비전 모델을 고르세요.
            </div>
          )}
          {visLocal && (
            <div style={panelStyle}>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                인포그래픽 등 <b>이미지를 분석</b>하는 작업에만 사용됩니다. GPU 필요(M1 불가) — 로컬 또는 원격.
              </div>
              <div>
                <div style={labelStyle}>모델 이름 (목록에 없는 모델도 직접 입력)</div>
                <input value={vis.model} onChange={e => setVisSel(`local:${e.target.value.trim()}`)} placeholder="qwen3-vl:30b-a3b-thinking" spellCheck={false} style={fieldStyle} />
              </div>
              <div>
                <div style={labelStyle}>서버 URL (비우면 텍스트 모델 URL 사용)</div>
                <input value={visUrl} onChange={e => setVisUrl(e.target.value.trim())} placeholder={llmBase} spellCheck={false} style={fieldStyle} />
              </div>
              <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                상태:{' '}
                {vision.loading ? '확인 중…'
                  : vision.ok
                    ? <span style={{ color: visReady ? '#16a34a' : '#d97706' }}>{visReady ? `실행 중, ${vis.model} 설치됨` : `실행 중, ${vis.model} 미설치 (ollama pull 필요)`}</span>
                    : <span style={{ color: '#dc2626' }}>미연결</span>}
                <button type="button" onClick={vision.reload} style={smallBtnStyle}>다시 확인</button>
              </div>
              {vision.ok && !visReady && (
                <div style={noteStyle}>
                  모델 받기:<code style={codeStyle}>ollama pull {vis.model}</code>
                </div>
              )}
            </div>
          )}
        </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setApiKey(''); setKey('') }}
            style={{
              padding: '7px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8',
            }}
          >키 삭제</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={closeAiSettings}
              style={{
                padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
              }}
            >취소</button>
            <button
              type="button"
              onClick={save}
              style={{
                padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
                border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
              }}
            >저장</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
