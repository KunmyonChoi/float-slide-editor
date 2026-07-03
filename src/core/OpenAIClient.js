/**
 * OpenAIClient — 브라우저에서 직접 OpenAI(ChatGPT) API를 호출한다.
 *
 * 키는 사용자 본인 것을 설정 화면에서 입력받아 localStorage에 보관한다(서버 없음).
 * OpenAI REST API는 CORS를 허용하므로 별도 백엔드 프록시 없이 호출 가능하다.
 *
 * 주의: localStorage 키는 같은 브라우저를 쓰는 사람에게 노출될 수 있다(공용 PC 주의).
 *
 * 텍스트(chat)는 '로컬 LLM 사용'(Ollama, OpenAI 호환) 시 로컬 엔드포인트로 라우팅된다.
 * 이미지 생성/편집은 로컬 대체가 없어 OpenAI 경로 유지.
 */
import { isLocalLlmEnabled, getLocalLlmChatEndpoint, getLocalLlmModel,
  isLocalVisionEnabled, getLocalVisionChatEndpoint, getLocalVisionModel } from './LlmBackendClient'
import { normalizeCaption } from './ideogramCaption'

const KEY_STORAGE = 'openai-api-key'
const MODEL_STORAGE = 'openai-model'
const IMAGE_MODEL_STORAGE = 'openai-image-model'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
// 유연 해상도(정확한 종횡비)를 지원하는 생성 모델
const FLEX_SIZE_MODELS = ['gpt-image-2', 'gpt-image-1.5']
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
 * allowLocal=false면 로컬 LLM 설정을 무시하고 항상 OpenAI로 호출한다(품질 보장이 필요한 기능용).
 * @param {{ system?: string, user: string, images?: string[], model?: string, temperature?: number, responseFormat?: object, allowLocal?: boolean, signal?: AbortSignal }} opts
 */
export async function chat({ system, user, images, model, temperature = 0.7, responseFormat, allowLocal = true, signal } = {}) {
  // 이미지 첨부 여부로 텍스트/비전 분리 라우팅. 비전(이미지)은 로컬 비전 모델(설정 시),
  // 아니면 OpenAI(비전 가능 모델). 텍스트는 로컬 텍스트 모델 또는 OpenAI.
  // allowLocal=false면 로컬 라우팅을 끈다(항상 OpenAI).
  const isVision = !!(images && images.length)
  const visionLocal = isVision && allowLocal && isLocalVisionEnabled()
  const textLocal = !isVision && allowLocal && isLocalLlmEnabled()
  const local = visionLocal || textLocal
  const apiKey = getApiKey()
  if (isVision && !visionLocal && !apiKey) {
    throw new Error('이미지 분석에는 비전 모델이 필요합니다. AI 설정에서 OpenAI 키를 입력하거나 로컬 비전 모델을 켜세요.')
  }
  if (!local && !apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')

  const endpoint = visionLocal ? getLocalVisionChatEndpoint() : textLocal ? getLocalLlmChatEndpoint() : ENDPOINT
  const useModel = visionLocal ? getLocalVisionModel() : textLocal ? getLocalLlmModel() : (model || getModel())

  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  const userContent = (images && images.length)
    ? [{ type: 'text', text: user }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
    : user
  messages.push({ role: 'user', content: userContent })

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 로컬(Ollama)은 키 불필요 — 더미 토큰. OpenAI는 사용자 키.
        Authorization: `Bearer ${apiKey || 'local'}`,
      },
      body: JSON.stringify({
        model: useModel,
        messages,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error(local
      ? '로컬 LLM(Ollama)에 연결할 수 없습니다. Ollama 실행 여부와 OLLAMA_ORIGINS 설정을 확인하세요.'
      : 'OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || ''
    } catch { /* 본문 파싱 실패 무시 */ }
    if (local) {
      if (res.status === 404) throw new Error(`로컬 LLM 모델(${useModel})을 찾을 수 없습니다. 'ollama pull ${useModel}'로 받으세요.`)
      throw new Error(`로컬 LLM 오류 (${res.status})${detail ? ': ' + detail : ''}`)
    }
    if (res.status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
    if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
    throw new Error(`OpenAI 오류 (${res.status})${detail ? ': ' + detail : ''}`)
  }

  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('응답이 비어 있습니다.')
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

// ── AI 텍스트 편집(단일 텍스트 요소 내용 다듬기) ────────────────────────────
// 평문(plain text) 기준으로 편집한다(OpenAI·소형 로컬 LLM 모두 안정). 리치 서식 재구성은
// 별도 기능(HTML→Flat)이 담당. 출력은 결과 텍스트만(설명·따옴표·코드펜스 없이).
// 언어 보존은 최우선 규칙(소형 로컬 LLM이 임의로 중국어/영어로 번역하는 것을 강하게 차단).
const LANG_GUARD = `CRITICAL LANGUAGE RULE: Write your ENTIRE output in the SAME language/script as the input text. If the input is Korean, the output MUST be Korean; if English, English; etc. This is an editing task, NOT translation — NEVER translate the text into a different language, and never mix in another language.`
const TEXT_EDIT_SYSTEMS = {
  spelling: `You are a meticulous proofreader for presentation slide text.
${LANG_GUARD}
Fix ONLY spelling, spacing, and obvious typos. Do NOT change meaning, wording, tone, or order. Preserve the line-break structure. If nothing needs fixing, return the text unchanged.
Output ONLY the corrected text — no preamble, no quotes, no explanation, no code fences.`,
  formal: `You rewrite presentation slide text into clear, formal presentation language (written, professional tone).
${LANG_GUARD}
Preserve every fact, number, and proper noun. Be concise and slide-appropriate — do not pad or add new information. Remove casual filler and first-person chatter.
Output ONLY the rewritten text — no preamble, no quotes, no explanation, no code fences.`,
  markdown: `You reorganize presentation slide text into clean, well-structured GitHub-Flavored Markdown.
${LANG_GUARD}
Use headings, bullet lists, and bold emphasis as appropriate to clarify structure. Preserve all original meaning and facts — restructure only, never invent content.
Output ONLY the Markdown source — no surrounding code fences, no preamble, no explanation.`,
  prompt: `You edit presentation slide text according to the user's instruction.
${LANG_GUARD} (Exception: obey only if the instruction EXPLICITLY asks to translate.)
Follow the instruction faithfully and keep it slide-appropriate. Output PLAIN text (no Markdown syntax) unless the instruction explicitly asks for a specific format.
Output ONLY the resulting text — no preamble, no quotes, no explanation, no code fences.`,
}

/** LLM 응답에서 실수로 붙은 코드펜스/감싼 따옴표를 제거(내용은 보존). */
function stripReplyDecorations(s) {
  let t = (s || '').trim()
  // ```lang ... ``` 코드펜스 벗기기
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  if (fence) t = fence[1].trim()
  // 전체를 감싼 한 쌍의 따옴표 제거(내부 따옴표는 유지)
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === '“' && t[t.length - 1] === '”'))) {
    const inner = t.slice(1, -1)
    if (!inner.includes('"') && !inner.includes('”')) t = inner.trim()
  }
  return t
}

export const TEXT_EDIT_ACTIONS = ['spelling', 'formal', 'markdown', 'prompt', 'translate']

/**
 * 단일 텍스트 요소 내용(평문)을 AI로 편집한다.
 * @param {string} text  편집 대상 평문
 * @param {{ action: 'spelling'|'formal'|'markdown'|'prompt', instruction?: string, model?: string, signal?: AbortSignal }} opts
 *   action='prompt'이면 instruction(지시문) 필수.
 * @returns {Promise<string>} 편집된 텍스트(마크다운 동작이면 마크다운 원문)
 */
export async function editSlideText(text, { action, instruction, targetLang, model, signal } = {}) {
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('편집할 텍스트가 없습니다.')
  let system, user
  if (action === 'translate') {
    // 번역은 대상 언어가 동적이라 시스템 프롬프트를 매번 구성한다.
    const lang = (targetLang || '').trim()
    if (!lang) throw new Error('번역할 대상 언어를 지정하세요.')
    system = `You are a professional translator for presentation slides.
Translate the text into ${lang}. Auto-detect the source language. If the text is ALREADY entirely in ${lang}, return it unchanged.
Preserve numbers, proper nouns, URLs, and the line-break structure. Keep it concise and slide-appropriate — do NOT add notes, romanization, pronunciation, or explanations.
Output ONLY the translated text — no preamble, no quotes, no explanation, no code fences.`
    user = `Text to translate:\n"""\n${trimmed}\n"""`
  } else {
    system = TEXT_EDIT_SYSTEMS[action]
    if (!system) throw new Error('알 수 없는 텍스트 편집 동작입니다.')
    if (action === 'prompt') {
      const instr = (instruction || '').trim()
      if (!instr) throw new Error('편집 지시문을 입력하세요.')
      user = `Instruction:\n"""\n${instr}\n"""\n\nText to edit:\n"""\n${trimmed}\n"""`
    } else {
      user = `Text to edit:\n"""\n${trimmed}\n"""`
    }
  }
  const out = await chat({
    system,
    user,
    model,
    temperature: action === 'spelling' ? 0.2 : action === 'translate' ? 0.3 : 0.5,
    allowLocal: false, // 텍스트 편집은 품질 보장 위해 OpenAI 고정(로컬 LLM 무시)
    signal,
  })
  const result = stripReplyDecorations(out)
  if (!result) throw new Error('편집 결과가 비어 있습니다.')
  return result
}

const IDEOGRAM_CAPTION_SYSTEM = `You convert a presentation slide text box's content into a JSON "caption" for the Ideogram 4 image model, which renders a STANDALONE ILLUSTRATION expressing the meaning of that text (like a slide background or accent graphic).

Output ONLY one valid JSON object (no markdown, no commentary) with this structure and key order:
{
  "high_level_description": "one or two sentence summary of the whole image",
  "style_description": {
    "aesthetics": "e.g. clean, modern, vibrant",
    "lighting": "e.g. soft even lighting",
    "medium": "one of: illustration | photograph | 3d render | graphic_design",
    "art_style": "concise visual style (OMIT this key and add \\"photo\\":\\"lens/DoF\\" instead when medium is photograph)",
    "color_palette": ["#RRGGBB", "up to 5 UPPERCASE hex"]
  },
  "compositional_deconstruction": {
    "background": "detailed description of the scene/environment",
    "elements": [ { "type": "obj", "bbox": [y_min, x_min, y_max, x_max], "desc": "what this object looks like and where" } ]
  }
}

Rules:
- bbox = 0-1000 normalized integers, origin top-left, format [y_min, x_min, y_max, x_max].
- Describe imagery ONLY. DO NOT output any "text"-type elements and DO NOT request readable words/letters/labels in the image — text output causes garbled glyphs. Convey the message purely through visuals.
- BACKGROUND vs ELEMENTS: Put the environment, scenery, sky, landscape, lighting and overall setting into "background" as rich prose. Use "elements" ONLY for distinct FOREGROUND subjects/objects that need explicit placement. Do NOT make background scenery (mountains, sky, room, etc.) an obj element.
- Keep it simple: most slide concepts are ONE main subject — then use exactly ONE obj for that subject (a large, sensibly centered bbox), or zero obj if the scene is best described by background alone. Use multiple obj only for genuinely separate foreground objects. Do NOT over-segment; avoid overlapping boxes unless one object is truly in front of another.
- Never describe elements as blurred, obscured, faded, or "soft" foreground — that creates muddy artifacts.
- color_palette is OPTIONAL: include ONLY colors that actually appear in the described scene. If unsure, OMIT the color_palette key. NEVER invent unrelated colors (e.g. no random purple/violet for a nature/portrait scene).
- Be concrete and visual; never invent words to display.
- If a required visual style is given, reflect it in style_description.
- Output strictly valid JSON only.`

/**
 * 텍스트 박스 내용 → Ideogram 4 구조화 캡션(객체). 로컬 ideogram 서버(/api/generate)용.
 * 평문 프롬프트는 ideogram이 가비지 텍스트를 내므로, LLM을 magic-prompt 대체로 써서
 * 구조화 캡션(obj 요소·텍스트 없음)으로 변환한다. 반환은 normalizeCaption으로 키순서 보정.
 * @param {string} text
 * @param {{ model?: string, style?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<object>} Ideogram 캡션 객체
 */
export async function generateIdeogramCaption(text, { model, style, signal } = {}) {
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('텍스트 박스에 분석할 내용이 없습니다.')
  const styleClause = (style || '').trim()
    ? `\n\nRequired visual style (reflect in style_description): ${style.trim()}`
    : ''
  const raw = await chat({
    system: IDEOGRAM_CAPTION_SYSTEM,
    user: `Slide text box content:\n"""\n${trimmed}\n"""${styleClause}\n\nOutput the Ideogram 4 caption JSON.`,
    model,
    temperature: 0.7,
    responseFormat: { type: 'json_object' },
    signal,
  })
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('AI가 올바른 캡션 JSON을 반환하지 않았습니다.') }
  const caption = normalizeCaption(parsed)
  if (!caption.compositional_deconstruction?.elements?.length && !caption.high_level_description) {
    throw new Error('생성된 캡션이 비어 있습니다.')
  }
  return caption
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
- Keep labels short and the JSON compact.
- If a required visual style is provided, set the "style" field to exactly that (keep all other rules: legible verbatim text, infographic layout).`

/**
 * 슬라이드 캡처(스크린샷) → 인포그래픽 이미지 생성 프롬프트(영어).
 * vision 가능한 텍스트 모델(getModel, 기본 gpt-4o-mini)을 사용한다.
 * @param {string} imageDataUrl  슬라이드 캡처 data URL
 * @param {{ model?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function analyzeImageForInfographic(imageDataUrl, { model, style, signal } = {}) {
  if (!imageDataUrl) throw new Error('변환할 캡처 이미지가 없습니다.')
  const styleClause = (style || '').trim()
    ? `\n\nRequired visual style (use for the "style" field): ${style.trim()}`
    : ''
  return chat({
    system: INFOGRAPHIC_SYSTEM,
    user: 'Here is a screenshot of the slide. Output the infographic JSON spec.' + styleClause,
    images: [imageDataUrl],
    model,
    temperature: 0.5,
    responseFormat: { type: 'json_object' },
    signal,
  })
}

const REMIX_SYSTEM = `You are an art director. Look at the reference image and write ONE detailed English image-generation prompt to RE-CREATE it as a brand-new artwork.

Capture and preserve from the reference:
- VISUAL STYLE: art medium/technique, rendering, color palette, lighting, mood, texture, level of detail.
- COMPOSITION: framing, aspect intent, subject placement, camera angle/perspective, foreground/background layering, negative space.

But REIMAGINE the subject and details so the result is a distinct new image (not a copy) that clearly shares the same style and composition. Describe concrete subject matter (the generator has no reference image — it only gets your text), so name the subjects, setting and key elements explicitly.

If any text/lettering appears in the reference, you may describe it, but keep wording generic — do not rely on exact glyphs.

Output ONLY the final prompt as a single plain-text paragraph. No preamble, no quotes, no lists, no explanations.`

/**
 * 리믹스용: 캡처 이미지를 비전으로 분석해 '새 이미지 생성 프롬프트'(영문)를 만든다.
 * editImage(img2img)와 달리 원본 픽셀에 얽매이지 않고 스타일·구도를 텍스트로만 이어받아
 * generateImage로 완전히 새 이미지를 재창조하기 위한 프롬프트.
 * @param {string} imageDataUrl  캡처 data URL
 * @param {{ direction?: string, model?: string, signal?: AbortSignal }} [opts]
 *   direction: 사용자 방향(선택) — 소재/무드를 틀 지시.
 * @returns {Promise<string>} 영문 생성 프롬프트
 */
export async function analyzeImageForRemix(imageDataUrl, { direction, model, signal } = {}) {
  if (!imageDataUrl) throw new Error('리믹스할 캡처 이미지가 없습니다.')
  const d = (direction || '').trim()
  const dirClause = d
    ? `\n\nApply this creative direction to the new image (steer subject/mood/setting accordingly while keeping the original's style and composition): ${d}`
    : ''
  return chat({
    system: REMIX_SYSTEM,
    user: 'Here is the reference image. Write the single image-generation prompt.' + dirClause,
    images: [imageDataUrl],
    model,
    temperature: 0.9, // 재창조 다양성
    allowLocal: false, // 비전 분석은 OpenAI 고정
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
export async function generateImage(prompt, { model, width, height, size, quality, signal } = {}) {
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
  if (m.startsWith('gpt-image')) body.quality = quality || 'medium' // gpt-image 계열은 b64 기본 반환
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

async function readImageErrorDetail(res) {
  try { return (await res.json())?.error?.message || '' } catch { return '' }
}

function throwImageErrorWith(status, detail, label) {
  if (status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
  if (status === 403) throw new Error(`이미지 모델 사용 권한이 없습니다(조직 인증 필요할 수 있음)${detail ? ': ' + detail : ''}`)
  if (status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
  throw new Error(`${label} 오류 (${status})${detail ? ': ' + detail : ''}`)
}

async function throwImageError(res, label) {
  throwImageErrorWith(res.status, await readImageErrorDetail(res), label)
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
 * 이미지 디자인 향상용 image-to-image 프롬프트를 만든다(editImage에 그대로 전달).
 * 원본의 모든 텍스트·요소 위치를 유지하면서 시각 스타일만 끌어올리도록 지시한다.
 * @param {string} [styleDirective]  화풍 지시문(aiImageStyles). 빈 값이면 모델 기본 미감 사용.
 * @returns {string}
 */
export function buildImageEnhancePrompt(styleDirective) {
  const base = `Redesign this presentation slide image with a more polished, professional and modern visual design. Improve the typography hierarchy, spacing, alignment, color harmony and overall visual balance.

CRITICAL constraints:
- Keep EVERY existing text string EXACTLY as written (verbatim, same language, legible characters); do not translate, add, remove or alter any wording.
- Render ALL text with crisp, correct, fully legible characters in the ORIGINAL script — including Korean Hangul (e.g. 한글), Chinese or Japanese. Never garble, distort, mojibake, drop strokes, or replace glyphs. Use clean high-contrast typography.
- Preserve the position, order and arrangement of every text block, icon, chart, photo and shape. Do NOT move, add or delete elements or change the layout.
- Only elevate the visual style and finish — do not redraw the slide as something different.`
  const d = (styleDirective || '').trim()
  return d ? `${base}\n\nStyle: ${d}` : base
}

/**
 * 입력 이미지 → image-to-image 편집(설정 모델의 edits 사용, 기본 gpt-image-2).
 * 원본의 구도/위치를 유지한 채 변환하는 데 적합하다. mask를 주면 그 영역만 편집(인페인팅).
 * @param {string} imageDataUrl  입력 이미지 data URL(캡처/crop)
 * @param {string} prompt  편집 지시 프롬프트
 * @param {{ width?: number, height?: number, size?: string, quality?: string, mask?: string, signal?: AbortSignal }} [opts]
 *   mask: 선택. 입력 이미지와 같은 크기의 PNG data URL. 투명 픽셀=편집 영역, 불투명=보존.
 * @returns {Promise<string>} `data:image/png;base64,...`
 */
export async function editImage(imageDataUrl, prompt, { width, height, size, quality = 'high', mask, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')
  if (!imageDataUrl) throw new Error('편집할 입력 이미지가 없습니다.')
  const p = (prompt || '').trim()
  if (!p) throw new Error('이미지 편집 프롬프트가 비어 있습니다.')

  // 설정 모델(기본 gpt-image-2)로 edits 호출. 마스크(부분편집)도 같은 모델을 쓴다.
  const blob = dataUrlToBlob(imageDataUrl)
  const maskBlob = mask ? dataUrlToBlob(mask) : null // 있으면 편집 영역 마스크(투명=편집)
  const model = getImageModel()
  // gpt-image-2: edits에서 유연 크기(정확 종횡비) 지원 + 입력을 자동 high fidelity 처리
  //   → input_fidelity 파라미터를 받지 않으므로 보내면 안 된다(보내면 오류).
  // gpt-image-1.5/1: edits는 프리셋 크기만, input_fidelity=high로 원본 보존.
  const isImage2 = model.startsWith('gpt-image-2')
  const form = new FormData()
  form.append('model', model)
  form.append('image', blob, 'input.png')
  if (maskBlob) form.append('mask', maskBlob, 'mask.png') // 부분 편집(인페인팅)
  form.append('prompt', p)
  form.append('size', size || (isImage2 ? flexSize(width, height) : pickImageSize(model, width, height)))
  form.append('quality', quality)
  if (!isImage2) form.append('input_fidelity', 'high')

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

  if (!res.ok) throwImageErrorWith(res.status, await readImageErrorDetail(res), '이미지 편집')

  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('이미지 응답이 비어 있습니다.')
  return `data:image/png;base64,${b64}`
}

// ── 발표자 노트(발표 원고) 생성 ──

export const NOTES_TONES = [
  { id: 'friendly', label: '친근하게', hint: '친근하고 자연스러운 구어체' },
  { id: 'formal', label: '격식 있게', hint: '정중하고 격식 있는 발표 어조' },
  { id: 'concise', label: '간결하게', hint: '군더더기 없이 핵심만 간결하게' },
]
export const NOTES_LENGTHS = [
  { id: 'short', label: '짧게', hint: '슬라이드당 1~2문장' },
  { id: 'medium', label: '보통', hint: '슬라이드당 3~5문장' },
  { id: 'long', label: '길게', hint: '슬라이드당 6문장 이상, 상세히' },
]

const SPEAKER_NOTES_SYSTEM = `You write speaker notes — the actual words a presenter SAYS out loud — for each slide of a deck.
Rules:
- Write a spoken script, NOT a copy of the slide text. Speak TO the audience, naturally.
- Use the whole deck for flow: add brief, natural transitions between slides where helpful.
- Keep each slide's notes about that slide only.
- Write in the SAME language as that slide's content.
- Tone: {tone}. Length per slide: {length}.
- No slide numbers, headings, quotes, or markdown inside the note text.
Output ONLY JSON: {"notes":[{"index":<0-based index>,"text":"<spoken notes>"}]}, one entry for EVERY slide index provided.`

/**
 * 슬라이드 요약 배열 → 페이지별 발표 원고.
 * @param {{ slides: {index:number,title?:string,text?:string}[], tone?: string, length?: string, model?: string, signal?: AbortSignal }} opts
 * @returns {Promise<Record<number,string>>} { [index]: notesText }
 */
export async function generateSpeakerNotes({ slides, tone, length, model, signal } = {}) {
  if (!slides || !slides.length) throw new Error('슬라이드 내용이 없습니다.')
  const toneHint = (NOTES_TONES.find(t => t.id === tone) || NOTES_TONES[0]).hint
  const lenHint = (NOTES_LENGTHS.find(l => l.id === length) || NOTES_LENGTHS[1]).hint
  const system = SPEAKER_NOTES_SYSTEM.replace('{tone}', toneHint).replace('{length}', lenHint)
  const user = slides
    .map(s => `# Slide ${s.index + 1}${s.title ? ': ' + s.title : ''}\n${(s.text || '').trim() || '(이 슬라이드에는 텍스트가 없습니다 — 맥락에 맞춰 간단히)'}`)
    .join('\n\n---\n\n')

  const raw = await chat({
    system, user, model, temperature: 0.7,
    responseFormat: { type: 'json_object' }, signal,
  })
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('AI 응답(JSON)을 해석할 수 없습니다.') }
  const arr = Array.isArray(parsed?.notes) ? parsed.notes : []
  const out = {}
  for (const n of arr) {
    if (n && typeof n.index === 'number' && typeof n.text === 'string') {
      out[n.index] = n.text.trim()
    }
  }
  if (!Object.keys(out).length) throw new Error('생성된 발표 원고가 비어 있습니다.')
  return out
}

// ── TTS(음성 합성) ──

const TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech'
const TTS_MODEL_STORAGE = 'openai-tts-model'
const TTS_VOICE_STORAGE = 'openai-tts-voice'
const TTS_INSTRUCTIONS_STORAGE = 'openai-tts-instructions'
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_TTS_VOICE = 'alloy'

// 전체 음성(gpt-4o-mini-tts 기준, OpenAI 공식 13종). tts-1/tts-1-hd는 일부만 지원.
export const TTS_VOICES = [
  { id: 'alloy', label: 'Alloy' }, { id: 'ash', label: 'Ash' }, { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral' }, { id: 'echo', label: 'Echo' }, { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova' }, { id: 'onyx', label: 'Onyx' }, { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' }, { id: 'verse', label: 'Verse' },
  { id: 'marin', label: 'Marin' }, { id: 'cedar', label: 'Cedar' },
]

// tts-1 / tts-1-hd가 지원하는 음성(공식). gpt-4o-mini-tts는 전체 지원.
const TTS1_VOICE_IDS = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer']
// instructions(톤·억양·감정·속도 지시)는 gpt-4o-mini-tts 계열만 지원(tts-1/tts-1-hd 미지원).
export const ttsSupportsInstructions = (model) => /^gpt-4o(-mini)?-tts/.test(model || '')

/** 모델이 지원하는 음성 목록. tts-1/tts-1-hd면 부분집합, 그 외(gpt-4o-mini-tts)는 전체. */
export function voicesForModel(model) {
  if (model === 'tts-1' || model === 'tts-1-hd') return TTS_VOICES.filter(v => TTS1_VOICE_IDS.includes(v.id))
  return TTS_VOICES
}

export function getTtsModel() {
  try { return localStorage.getItem(TTS_MODEL_STORAGE) || DEFAULT_TTS_MODEL } catch { return DEFAULT_TTS_MODEL }
}
export function setTtsModel(model) {
  try {
    const v = (model || '').trim()
    if (v) localStorage.setItem(TTS_MODEL_STORAGE, v); else localStorage.removeItem(TTS_MODEL_STORAGE)
  } catch { /* localStorage 비활성 무시 */ }
}
export function getTtsVoice() {
  try { return localStorage.getItem(TTS_VOICE_STORAGE) || DEFAULT_TTS_VOICE } catch { return DEFAULT_TTS_VOICE }
}
export function setTtsVoice(voice) {
  try {
    const v = (voice || '').trim()
    if (v) localStorage.setItem(TTS_VOICE_STORAGE, v); else localStorage.removeItem(TTS_VOICE_STORAGE)
  } catch { /* localStorage 비활성 무시 */ }
}
/** 음성 톤 지시(gpt-4o-mini-tts 전용). 빈 문자열=지시 없음. */
export function getTtsInstructions() {
  try { return localStorage.getItem(TTS_INSTRUCTIONS_STORAGE) || '' } catch { return '' }
}
export function setTtsInstructions(text) {
  try {
    const v = (text || '').trim()
    if (v) localStorage.setItem(TTS_INSTRUCTIONS_STORAGE, v); else localStorage.removeItem(TTS_INSTRUCTIONS_STORAGE)
  } catch { /* localStorage 비활성 무시 */ }
}

/**
 * 텍스트 → 음성(mp3 Blob). OpenAI /v1/audio/speech.
 * instructions(톤·억양·감정·속도 지시)는 gpt-4o-mini-tts 계열에서만 전송(tts-1/tts-1-hd는 무시).
 * @param {string} text
 * @param {{ voice?: string, model?: string, instructions?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<Blob>} audio/mpeg Blob
 */
export async function synthesizeSpeech(text, { voice, model, instructions, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')
  if (!text || !text.trim()) throw new Error('음성으로 변환할 노트가 없습니다.')

  const useModel = model || getTtsModel()
  const instr = (instructions ?? getTtsInstructions()).trim()
  const body = { model: useModel, voice: voice || getTtsVoice(), input: text, response_format: 'mp3' }
  // 모델이 지원할 때만 instructions 포함(미지원 모델에 보내면 400)
  if (instr && ttsSupportsInstructions(useModel)) body.instructions = instr

  let res
  try {
    res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }
  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message || '' } catch { /* 무시 */ }
    if (res.status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
    if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
    throw new Error(`OpenAI TTS 오류 (${res.status})${detail ? ': ' + detail : ''}`)
  }
  return await res.blob()
}
