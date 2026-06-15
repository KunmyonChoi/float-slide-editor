/**
 * OpenAIClient — 브라우저에서 직접 OpenAI(ChatGPT) API를 호출한다.
 *
 * 키는 사용자 본인 것을 설정 화면에서 입력받아 localStorage에 보관한다(서버 없음).
 * OpenAI REST API는 CORS를 허용하므로 별도 백엔드 프록시 없이 호출 가능하다.
 *
 * 주의: localStorage 키는 같은 브라우저를 쓰는 사람에게 노출될 수 있다(공용 PC 주의).
 */

const KEY_STORAGE = 'openai-api-key'
const MODEL_STORAGE = 'openai-model'
const IMAGE_MODEL_STORAGE = 'openai-image-model'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
// 유연 해상도(정확한 종횡비)를 지원하는 생성 모델
const FLEX_SIZE_MODELS = ['gpt-image-2', 'gpt-image-1.5']
// images/edits 를 지원하는 모델(gpt-image-2는 edits 미지원)
const EDIT_CAPABLE_MODELS = ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini']
const ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/generations'
const IMAGE_EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits'

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || '' } catch { return '' }
}

export function setApiKey(key) {
  try {
    const v = (key || '').trim()
    if (v) localStorage.setItem(KEY_STORAGE, v)
    else localStorage.removeItem(KEY_STORAGE)
  } catch { /* localStorage 비활성 환경 무시 */ }
}

export function hasApiKey() {
  return !!getApiKey()
}

export function getModel() {
  try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL } catch { return DEFAULT_MODEL }
}

export function setModel(model) {
  try {
    const v = (model || '').trim()
    if (v) localStorage.setItem(MODEL_STORAGE, v)
    else localStorage.removeItem(MODEL_STORAGE)
  } catch { /* 무시 */ }
}

export function getImageModel() {
  try { return localStorage.getItem(IMAGE_MODEL_STORAGE) || DEFAULT_IMAGE_MODEL } catch { return DEFAULT_IMAGE_MODEL }
}

export function setImageModel(model) {
  try {
    const v = (model || '').trim()
    if (v) localStorage.setItem(IMAGE_MODEL_STORAGE, v)
    else localStorage.removeItem(IMAGE_MODEL_STORAGE)
  } catch { /* 무시 */ }
}

export { DEFAULT_MODEL, DEFAULT_IMAGE_MODEL }

/**
 * Chat Completions 호출 → assistant 텍스트 반환.
 * images를 주면 vision(멀티모달) 입력으로 user 메시지에 첨부한다.
 * @param {{ system?: string, user: string, images?: string[], model?: string, temperature?: number, signal?: AbortSignal }} opts
 */
export async function chat({ system, user, images, model, temperature = 0.7, responseFormat, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')

  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  const userContent = (images && images.length)
    ? [{ type: 'text', text: user }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
    : user
  messages.push({ role: 'user', content: userContent })

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || getModel(),
        messages,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || ''
    } catch { /* 본문 파싱 실패 무시 */ }
    if (res.status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
    if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
    throw new Error(`OpenAI 오류 (${res.status})${detail ? ': ' + detail : ''}`)
  }

  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI 응답이 비어 있습니다.')
  return text.trim()
}

const IMAGE_PROMPT_SYSTEM = `You are an expert visual director for presentation slides.
Given the text content of a single slide text box, infer its purpose, topic, and tone, then write ONE concise English image-generation prompt for an image that visually supports that slide.

Rules:
- Output ONLY the prompt text. No preamble, no quotes, no labels, no markdown.
- Write in English regardless of the input language.
- If a required visual style is provided, you MUST use exactly that style. Otherwise choose a fitting style (e.g. clean flat infographic illustration) that matches the slide's purpose.
- Specify subject, composition, mood, and a coherent color palette.
- Avoid embedding readable text/words inside the image; describe imagery only.
- Keep it under 60 words, suitable for a 16:9 slide background or accent graphic.`

/**
 * 텍스트 박스 내용 → 목적에 맞는 영어 이미지 생성 프롬프트 1개.
 * @param {string} text  텍스트 박스의 평문 내용
 * @param {{ model?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function generateImagePrompt(text, { model, style, signal } = {}) {
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('텍스트 박스에 분석할 내용이 없습니다.')
  const styleClause = (style || '').trim()
    ? `\n\nRequired visual style (use exactly this): ${style.trim()}`
    : ''
  return chat({
    system: IMAGE_PROMPT_SYSTEM,
    user: `Slide text box content:\n"""\n${trimmed}\n"""${styleClause}`,
    model,
    temperature: 0.8,
    signal,
  })
}

const INFOGRAPHIC_SYSTEM = `You are an expert information designer. You are given a screenshot of a presentation slide.
Analyze it, then output a COMPACT JSON specification that an image model will use to render a clean, modern INFOGRAPHIC version of the slide.

Output ONLY a single valid JSON object (no markdown, no commentary) with exactly these keys:
{
  "style": "clean flat vector infographic, cohesive palette, generous whitespace",
  "language": "the language of the slide text, e.g. Korean",
  "layout": "short description of how blocks/sections/flow are arranged",
  "sections": [{ "heading": "exact short label copied verbatim from the slide", "points": ["exact short label"], "icon": "icon idea in English" }],
  "texts_verbatim": ["EVERY on-image text string, copied EXACTLY from the slide in its ORIGINAL language"],
  "palette": ["#hex", "#hex"],
  "must": "Render every string in texts_verbatim EXACTLY as written, in the original language, with correct legible characters (e.g. Hangul); do not translate; no gibberish; no extra text."
}

Rules:
- Preserve the key message, data points, and visual hierarchy. Do NOT invent facts or numbers.
- Copy all labels/headings/points VERBATIM in the ORIGINAL language. NEVER translate to English.
- Keep labels short and the JSON compact.`

/**
 * 슬라이드 캡처(스크린샷) → 인포그래픽 이미지 생성 프롬프트(영어).
 * vision 가능한 텍스트 모델(getModel, 기본 gpt-4o-mini)을 사용한다.
 * @param {string} imageDataUrl  슬라이드 캡처 data URL
 * @param {{ model?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function analyzeImageForInfographic(imageDataUrl, { model, signal } = {}) {
  if (!imageDataUrl) throw new Error('변환할 캡처 이미지가 없습니다.')
  return chat({
    system: INFOGRAPHIC_SYSTEM,
    user: 'Here is a screenshot of the slide. Output the infographic JSON spec.',
    images: [imageDataUrl],
    model,
    temperature: 0.5,
    responseFormat: { type: 'json_object' },
    signal,
  })
}

// gpt-image-2/1.5: 유연 해상도 — 대상 종횡비를 16배수로 맞춤(최대변 3840, 종횡비 ≤3:1).
export function flexSize(width, height, longEdge = 1536) {
  const r = (width || 1) / (height || 1)
  const round16 = v => Math.max(512, Math.min(3840, Math.round(v / 16) * 16))
  let W, H
  if (r >= 1) { W = longEdge; H = round16(longEdge / r) }
  else { H = longEdge; W = round16(longEdge * r) }
  W = round16(W); H = round16(H)
  if (W / H > 3) H = round16(W / 3) // 종횡비 3:1 제한
  if (H / W > 3) W = round16(H / 3)
  return `${W}x${H}`
}

// 생성 모델별 size 선택: 유연 모델은 정확한 종횡비, 그 외는 프리셋.
export function generationSize(model, width, height) {
  return FLEX_SIZE_MODELS.includes(model) ? flexSize(width, height) : pickImageSize(model, width, height)
}

// 모델별 지원 사이즈 중 박스 종횡비에 가장 가까운 것 선택(프리셋).
export function pickImageSize(model, width, height) {
  const ratio = (width || 1) / (height || 1)
  const landscape = ratio > 1.2
  const portrait = ratio < 0.83
  if (model === 'dall-e-3') {
    if (landscape) return '1792x1024'
    if (portrait) return '1024x1792'
    return '1024x1024'
  }
  // gpt-image-1 (및 기타)
  if (landscape) return '1536x1024'
  if (portrait) return '1024x1536'
  return '1024x1024'
}

/**
 * 프롬프트 → 생성 이미지(data URL).
 * @param {string} prompt  영어 이미지 생성 프롬프트
 * @param {{ model?: string, width?: number, height?: number, size?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>} `data:image/png;base64,...`
 */
export async function generateImage(prompt, { model, width, height, size, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')
  const p = (prompt || '').trim()
  if (!p) throw new Error('이미지 생성 프롬프트가 비어 있습니다.')

  const m = model || getImageModel()
  const body = {
    model: m,
    prompt: p,
    n: 1,
    size: size || generationSize(m, width, height),
  }
  if (m.startsWith('gpt-image')) body.quality = 'medium' // gpt-image 계열은 b64 기본 반환
  else body.response_format = 'b64_json' // dall-e 계열만 명시해야 b64 반환

  let res
  try {
    res = await fetch(IMAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }

  if (!res.ok) await throwImageError(res, '이미지 생성')

  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('이미지 응답이 비어 있습니다.')
  return `data:image/png;base64,${b64}`
}

async function throwImageError(res, label) {
  let detail = ''
  try { detail = (await res.json())?.error?.message || '' } catch { /* 무시 */ }
  if (res.status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
  if (res.status === 403) throw new Error(`이미지 모델 사용 권한이 없습니다(조직 인증 필요할 수 있음)${detail ? ': ' + detail : ''}`)
  if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
  throw new Error(`${label} 오류 (${res.status})${detail ? ': ' + detail : ''}`)
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/**
 * 입력 이미지 → 인포그래픽으로 편집(image-to-image). gpt-image-1 edits 사용.
 * 원본의 구도/위치를 유지한 채 변환하는 데 적합하다.
 * @param {string} imageDataUrl  입력 이미지 data URL(캡처/crop)
 * @param {string} prompt  편집 지시 프롬프트
 * @param {{ width?: number, height?: number, size?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>} `data:image/png;base64,...`
 */
export async function editImage(imageDataUrl, prompt, { width, height, size, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')
  if (!imageDataUrl) throw new Error('편집할 입력 이미지가 없습니다.')
  const p = (prompt || '').trim()
  if (!p) throw new Error('이미지 편집 프롬프트가 비어 있습니다.')

  // edits는 gpt-image-1.5/1/mini 지원(gpt-image-2·dall-e-3 미지원) → 설정값이 가능하면 사용, 아니면 1.5
  const configured = getImageModel()
  const editModel = EDIT_CAPABLE_MODELS.includes(configured) ? configured : 'gpt-image-1.5'
  const form = new FormData()
  form.append('model', editModel)
  form.append('image', dataUrlToBlob(imageDataUrl), 'input.png')
  form.append('prompt', p)
  form.append('size', size || pickImageSize(editModel, width, height))
  form.append('quality', 'medium')
  form.append('input_fidelity', 'high') // 원본 이미지의 레이아웃/구도/글자를 최대한 유지

  let res
  try {
    res = await fetch(IMAGE_EDIT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // multipart: Content-Type은 브라우저가 설정
      body: form,
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }
  if (!res.ok) await throwImageError(res, '이미지 편집')

  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('이미지 응답이 비어 있습니다.')
  return `data:image/png;base64,${b64}`
}
