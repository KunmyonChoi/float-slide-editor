/**
 * SttClient — OpenAI Whisper 기반 음성 인식(STT). 단어 단위 타임스탬프를 받아
 * 가라오케 자막(단어별 하이라이트)에 사용한다.
 *
 * 모델 선택: word-level timestamp(timestamp_granularities=word)는 OpenAI 호스팅 모델 중
 * whisper-1에서만 제공된다. gpt-4o-transcribe / gpt-4o-mini-transcribe는 정확도는 더 높지만
 * verbose_json + 타임스탬프 세분화를 지원하지 않아(2026-08 기준) 가라오케 용도로는 쓸 수 없다.
 * 따라서 이 기능은 whisper-1로 고정한다.
 *
 * 키는 OpenAIClient와 동일한 localStorage 키(사용자 본인 키)를 재사용한다.
 */
import { getApiKey } from './OpenAIClient'

const TRANSCRIBE_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
// 단어 타임스탬프를 지원하는 유일한 OpenAI 호스팅 STT 모델(2026-08 기준).
export const STT_MODEL = 'whisper-1'
// OpenAI 업로드 제한.
export const MAX_FILE_BYTES = 25 * 1024 * 1024

/**
 * 음성 Blob → 텍스트 + 단어별 타임스탬프.
 * @param {Blob} blob  오디오 파일(≤25MB, mp3/mp4/mpeg/mpga/m4a/wav/webm/ogg/flac 등)
 * @param {{ language?: string, prompt?: string, signal?: AbortSignal }} [opts]
 *   language: ISO-639-1 코드(예: 'ko'). 지정하면 정확도·속도가 향상된다.
 *   prompt: 고유명사·전문용어 힌트(선택). Whisper가 참고만 하며 결과에 그대로 나오진 않는다.
 * @returns {Promise<{ text: string, words: {word:string,start:number,end:number}[], language?: string, duration?: number }>}
 */
export async function transcribeSpeech(blob, { language, prompt, signal } = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다. 먼저 키를 입력하세요.')
  if (!blob || !blob.size) throw new Error('변환할 음성 파일이 없습니다.')
  if (blob.size > MAX_FILE_BYTES) throw new Error('음성 파일이 너무 큽니다(25MB 초과). 노트를 나눠서 더 짧은 음성으로 만들어 주세요.')

  const form = new FormData()
  form.append('file', blob, guessFileName(blob))
  form.append('model', STT_MODEL)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  if (language) form.append('language', language)
  if (prompt) form.append('prompt', prompt)

  let res
  try {
    res = await fetch(TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // multipart: Content-Type은 브라우저가 설정
      body: form,
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error('OpenAI에 연결할 수 없습니다. 네트워크 연결을 확인하세요.')
  }

  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message || '' } catch { /* 본문 파싱 실패 무시 */ }
    if (res.status === 401) throw new Error('API 키가 유효하지 않습니다. 키를 다시 확인하세요.')
    if (res.status === 413) throw new Error('음성 파일이 너무 큽니다(25MB 초과).')
    if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.')
    throw new Error(`OpenAI STT 오류 (${res.status})${detail ? ': ' + detail : ''}`)
  }

  const data = await res.json()
  const words = Array.isArray(data?.words)
    ? data.words
      .map(w => ({ word: String(w.word ?? '').trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
      .filter(w => w.word)
    : []
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  if (!text && !words.length) throw new Error('음성에서 인식된 텍스트가 없습니다. 음성 파일 내용을 확인하세요.')
  return {
    text,
    words,
    language: data?.language,
    duration: typeof data?.duration === 'number' ? data.duration : undefined,
  }
}

/** Blob의 MIME 타입에서 확장자를 추정한다(OpenAI가 파일명 확장자로 형식을 판별하는 경우 대비). */
function guessFileName(blob) {
  if (blob.name) return blob.name
  const type = blob.type || ''
  const ext = type.includes('webm') ? 'webm'
    : (type.includes('mp4') || type.includes('m4a')) ? 'm4a'
      : type.includes('ogg') ? 'ogg'
        : type.includes('wav') ? 'wav'
          : 'mp3'
  return `audio.${ext}`
}
