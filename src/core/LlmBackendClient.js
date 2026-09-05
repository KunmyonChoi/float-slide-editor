/**
 * LlmBackendClient — 로컬 LLM(Ollama) 설정·감지·설치 안내.
 *
 * Ollama는 OS별 네이티브 설치본을 쓰므로(컨테이너 불필요), 앱은 (1) 실행 여부 감지,
 * (2) OS별 설치 안내, (3) OpenAI 호환 엔드포인트(/v1)로 텍스트 호출 라우팅만 담당한다.
 * 실제 텍스트 호출은 OpenAIClient.chat이 isLocalLlmEnabled()일 때 이 base로 보낸다.
 */
export const LLM_DEFAULT_URL = 'http://localhost:11434'
export const LLM_DEFAULT_MODEL = 'qwen2.5:3b' // M1 등 저사양 PC 구동 가능(~2GB). 더 무거운 작업은 사용자가 7b로 변경

const ENABLED_KEY = 'local-llm-enabled' // (구) 체크박스 설정 — 이관 소스로만 읽는다
const URL_KEY = 'local-llm-url'
const MODEL_KEY = 'local-llm-model'

// 비전(이미지 분석) 전용 — 텍스트 모델과 분리. 이미지 첨부 chat()만 이쪽으로 라우팅.
// GPU 필요(M1 불가)라 텍스트(가벼운 모델)와 별도 모델/URL을 둔다.
export const LLM_DEFAULT_VISION_MODEL = 'qwen3-vl:30b-a3b-thinking'
const VISION_ENABLED_KEY = 'local-vision-enabled' // (구) 체크박스 설정 — 이관 소스로만 읽는다
const VISION_URL_KEY = 'local-vision-url'
const VISION_MODEL_KEY = 'local-vision-model'

// ── 모델 선택(단일 진실의 원천) ────────────────────────────────────
/**
 * 설정 화면의 콤보 하나가 "이 작업을 어느 모델로?"를 결정한다. 저장 값은
 *   'openai' | 'openai:<모델>' | 'local:<모델>' | (비전만) 'inherit'
 * 이고, isLocalLlmEnabled()/isLocalVisionEnabled()는 여기서 파생된다(별도 on/off 키 없음).
 *
 * 공급자별 모델명은 각자의 기존 키(local-llm-model / openai-model)에 그대로 남긴다 —
 * 콤보를 OpenAI ↔ 로컬로 오가도 반대편 모델 선택이 보존되고, 기존 getter들도 그대로 쓴다.
 * 선택 값과 그 키는 setter들이 항상 함께 갱신해 어긋나지 않는다.
 */
const TEXT_SEL_KEY = 'ai-text-model'
const VISION_SEL_KEY = 'ai-vision-model'

function readKey(k) {
  try { return localStorage.getItem(k) } catch { return null }
}
function writeKey(k, v) {
  try {
    if (v) localStorage.setItem(k, String(v).trim())
    else localStorage.removeItem(k)
  } catch { /* ignore */ }
}
/** 'local:qwen2.5:3b' → { provider:'local', model:'qwen2.5:3b' } (모델명에 ':'이 있어 첫 ':'만 자른다). */
function parseSelection(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s === 'inherit') return { provider: 'inherit', model: '' }
  const i = s.indexOf(':')
  const provider = i < 0 ? s : s.slice(0, i)
  if (provider !== 'openai' && provider !== 'local') return null
  return { provider, model: i < 0 ? '' : s.slice(i + 1).trim() }
}
const formatSelection = (provider, model) => (model ? `${provider}:${model}` : provider)

/**
 * 텍스트 모델 선택. 값이 없으면 (구) 'local-llm-enabled' 체크박스 설정에서 이관해 읽는다
 * → 기존 사용자는 설정 화면을 열지 않아도 동작이 그대로다.
 * @returns {{ provider: 'openai'|'local', model: string }} model ''=해당 공급자의 기존 저장 모델 사용
 */
export function getTextSelection() {
  const sel = parseSelection(readKey(TEXT_SEL_KEY))
  if (sel && sel.provider !== 'inherit') return sel
  return readKey(ENABLED_KEY) === '1'
    ? { provider: 'local', model: getLocalLlmModel() }
    : { provider: 'openai', model: '' }
}
/** 텍스트 모델 선택 저장. 로컬이면 모델명을 기존 키에도 남긴다(공급자별 기억). */
export function setTextSelection(provider, model = '') {
  const m = String(model || '').trim()
  writeKey(TEXT_SEL_KEY, formatSelection(provider, m))
  if (provider === 'local' && m) writeKey(MODEL_KEY, m)
}

/**
 * 비전 모델 선택. 'inherit'=텍스트 모델과 동일(= 기존 '로컬 비전 끔' 동작: OpenAI 텍스트 모델).
 * @returns {{ provider: 'inherit'|'openai'|'local', model: string }}
 */
export function getVisionSelection() {
  const sel = parseSelection(readKey(VISION_SEL_KEY))
  if (sel) return sel
  return readKey(VISION_ENABLED_KEY) === '1'
    ? { provider: 'local', model: getLocalVisionModel() }
    : { provider: 'inherit', model: '' }
}
export function setVisionSelection(provider, model = '') {
  const m = String(model || '').trim()
  writeKey(VISION_SEL_KEY, provider === 'inherit' ? 'inherit' : formatSelection(provider, m))
  if (provider === 'local' && m) writeKey(VISION_MODEL_KEY, m)
}
/** 비전에 OpenAI 모델을 명시 선택했을 때의 모델명(''=텍스트 모델 그대로). */
export function getVisionOpenAiModel() {
  const s = getVisionSelection()
  return s.provider === 'openai' ? s.model : ''
}

export function isLocalLlmEnabled() {
  return getTextSelection().provider === 'local'
}
export function setLocalLlmEnabled(on) {
  setTextSelection(on ? 'local' : 'openai', on ? getLocalLlmModel() : '')
}

/** Ollama 베이스 URL(끝 슬래시 제거). */
export function getLocalLlmUrl() {
  try {
    const o = localStorage.getItem(URL_KEY)
    if (o) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  return LLM_DEFAULT_URL
}
export function setLocalLlmUrl(url) {
  try {
    if (url) localStorage.setItem(URL_KEY, String(url).trim())
    else localStorage.removeItem(URL_KEY)
  } catch { /* ignore */ }
}

/** OpenAI 호환 chat 엔드포인트. */
export function getLocalLlmChatEndpoint() {
  return `${getLocalLlmUrl()}/v1/chat/completions`
}

// ── 비전 모델(이미지 분석) ──
export function isLocalVisionEnabled() {
  return getVisionSelection().provider === 'local'
}
export function setLocalVisionEnabled(on) {
  setVisionSelection(on ? 'local' : 'inherit', on ? getLocalVisionModel() : '')
}
/** 비전 서버 URL — 미지정 시 텍스트 URL로 폴백(같은 Ollama에 두 모델 시 URL 공유). */
export function getLocalVisionUrl() {
  try {
    const o = localStorage.getItem(VISION_URL_KEY)
    if (o) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  return getLocalLlmUrl()
}
export function setLocalVisionUrl(url) {
  writeKey(VISION_URL_KEY, url)
}
/** 저장된 비전 URL 원본(''=미지정 → 텍스트 URL 사용). 설정 입력창의 초기값용. */
export function getLocalVisionUrlRaw() {
  return readKey(VISION_URL_KEY) || ''
}
export function getLocalVisionModel() {
  try { return (localStorage.getItem(VISION_MODEL_KEY) || LLM_DEFAULT_VISION_MODEL).trim() } catch { return LLM_DEFAULT_VISION_MODEL }
}
export function setLocalVisionModel(m) {
  writeKey(VISION_MODEL_KEY, m)
  // 지금 선택된 것이 로컬 비전이면 선택 값도 같이 옮긴다(선택과 모델명이 어긋나지 않게).
  if (getVisionSelection().provider === 'local') setVisionSelection('local', getLocalVisionModel())
}
export function getLocalVisionChatEndpoint() {
  return `${getLocalVisionUrl()}/v1/chat/completions`
}

export function getLocalLlmModel() {
  // trim — 모델명 앞뒤 공백이 끼면 Ollama가 404("model not found")를 낸다(태그 정확 일치 필요).
  try { return (localStorage.getItem(MODEL_KEY) || LLM_DEFAULT_MODEL).trim() } catch { return LLM_DEFAULT_MODEL }
}
export function setLocalLlmModel(m) {
  writeKey(MODEL_KEY, m)
  // 지금 선택된 것이 로컬 텍스트면 선택 값도 같이 옮긴다(선택과 모델명이 어긋나지 않게).
  if (getTextSelection().provider === 'local') setTextSelection('local', getLocalLlmModel())
}

/** 사용자 OS 추정: 'mac' | 'win' | 'linux' | 'other'. */
export function detectOS() {
  if (typeof navigator === 'undefined') return 'other'
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
  if (/mac|iphone|ipad|ipod/.test(p)) return 'mac'
  if (/win/.test(p)) return 'win'
  if (/linux|x11|android/.test(p)) return 'linux'
  return 'other'
}

/** Ollama 설치 명령/안내(OS별). win/mac은 다운로드 페이지, linux는 설치 스크립트. */
export function ollamaInstall(os = detectOS()) {
  if (os === 'linux') return { type: 'cmd', text: 'curl -fsSL https://ollama.com/install.sh | sh' }
  if (os === 'mac') return { type: 'download', text: 'https://ollama.com/download (또는: brew install ollama)' }
  if (os === 'win') return { type: 'download', text: 'https://ollama.com/download' }
  return { type: 'download', text: 'https://ollama.com/download' }
}

/** 공개 앱(https)이 localhost를 호출하려면 Origin 허용 필요. */
export function ollamaServeWithOrigin(origin) {
  const o = origin || (typeof location !== 'undefined' ? location.origin : '*')
  return `OLLAMA_ORIGINS=${o} ollama serve`
}

/**
 * 임의 베이스 URL의 Ollama 상태·설치 모델 조회(캐시 없음, 예외 없음).
 * 설정 화면이 "입력 중인" URL을 바로 검사하고 모델 목록을 콤보에 채우는 데 쓴다.
 * (공개 origin은 OLLAMA_ORIGINS 미설정 시 CORS로 실패 → ok:false + 이유)
 * @returns {Promise<{ ok: boolean, version: string|null, models: string[], error: string }>}
 */
export async function probeOllama(base = getLocalLlmUrl()) {
  const b = String(base || '').trim().replace(/\/+$/, '') || LLM_DEFAULT_URL
  try {
    const vr = await fetch(`${b}/api/version`, { signal: AbortSignal.timeout(2000) })
    if (!vr.ok) return { ok: false, version: null, models: [], error: `응답 오류 ${vr.status}` }
    const version = (await vr.json())?.version || null
    let models = []
    try {
      const tr = await fetch(`${b}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (tr.ok) models = ((await tr.json())?.models || []).map(m => m.name)
    } catch { /* tags 실패 무시 */ }
    return { ok: true, version, models, error: '' }
  } catch (e) {
    return { ok: false, version: null, models: [], error: e?.name === 'TimeoutError' ? '응답 없음(타임아웃)' : '연결 실패' }
  }
}

/** 로컬 LLM 동작 테스트 — 샘플 chat 1회 보내 응답 텍스트 반환(설정 검증용). */
export async function testLocalLlm(model = getLocalLlmModel(), base) {
  const endpoint = base
    ? `${String(base).trim().replace(/\/+$/, '')}/v1/chat/completions`
    : getLocalLlmChatEndpoint()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '한국어로 한 문장만 자기소개 해줘.' }],
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    let d = ''
    try { d = (await res.json())?.error?.message || '' } catch { /* noop */ }
    throw new Error(`오류 ${res.status}${d ? ': ' + d : ''}`)
  }
  const j = await res.json()
  return j?.choices?.[0]?.message?.content?.trim() || '(빈 응답)'
}

/** 모델이 태그 목록에 있는지(태그 생략 시 :latest 허용). */
export function modelInList(models, model) {
  if (!models?.length || !model) return false
  const want = model.includes(':') ? model : `${model}:latest`
  return models.some(m => m === model || m === want || m.startsWith(model + ':'))
}
