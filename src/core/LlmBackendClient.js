/**
 * LlmBackendClient — 로컬 LLM(Ollama) 설정·감지·설치 안내.
 *
 * Ollama는 OS별 네이티브 설치본을 쓰므로(컨테이너 불필요), 앱은 (1) 실행 여부 감지,
 * (2) OS별 설치 안내, (3) OpenAI 호환 엔드포인트(/v1)로 텍스트 호출 라우팅만 담당한다.
 * 실제 텍스트 호출은 OpenAIClient.chat이 isLocalLlmEnabled()일 때 이 base로 보낸다.
 */
export const LLM_DEFAULT_URL = 'http://localhost:11434'
export const LLM_DEFAULT_MODEL = 'qwen2.5:7b'

const ENABLED_KEY = 'local-llm-enabled'
const URL_KEY = 'local-llm-url'
const MODEL_KEY = 'local-llm-model'

export function isLocalLlmEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}
export function setLocalLlmEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0') } catch { /* ignore */ }
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

export function getLocalLlmModel() {
  // trim — 모델명 앞뒤 공백이 끼면 Ollama가 404("model not found")를 낸다(태그 정확 일치 필요).
  try { return (localStorage.getItem(MODEL_KEY) || LLM_DEFAULT_MODEL).trim() } catch { return LLM_DEFAULT_MODEL }
}
export function setLocalLlmModel(m) {
  try {
    if (m) localStorage.setItem(MODEL_KEY, String(m).trim())
    else localStorage.removeItem(MODEL_KEY)
  } catch { /* ignore */ }
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

let _status = null // { ok, version, models } | { ok:false }
export function getLlmStatus() { return _status }

/**
 * Ollama 구동·모델 설치 여부 확인. /api/version + /api/tags.
 * (공개 origin은 OLLAMA_ORIGINS 미설정 시 CORS로 실패 → ok:false로 안내 노출)
 */
export async function checkOllama(force = false) {
  if (!force && _status) return _status
  const base = getLocalLlmUrl()
  try {
    const vr = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2000) })
    if (!vr.ok) { _status = { ok: false }; return _status }
    const version = (await vr.json())?.version || null
    let models = []
    try {
      const tr = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (tr.ok) models = ((await tr.json())?.models || []).map(m => m.name)
    } catch { /* tags 실패 무시 */ }
    _status = { ok: true, version, models }
  } catch {
    _status = { ok: false }
  }
  return _status
}

/** 로컬 LLM 동작 테스트 — 샘플 chat 1회 보내 응답 텍스트 반환(설정 검증용). */
export async function testLocalLlm(model = getLocalLlmModel()) {
  const res = await fetch(getLocalLlmChatEndpoint(), {
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

/** 지정 모델이 설치돼 있는지(태그 목록 기준). */
export function hasLocalModel(model = getLocalLlmModel()) {
  if (!_status?.ok) return false
  const want = model.includes(':') ? model : `${model}:latest`
  return _status.models?.some(m => m === model || m === want || m.startsWith(model + ':'))
}
