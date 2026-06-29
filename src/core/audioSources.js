/** 오디오 파일 판별(드롭/업로드 공용) — MIME 또는 확장자. */
export const isAudioFile = (f) =>
  !!f && (f.type?.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i.test(f.name || ''))

/**
 * audioSources — 립싱크 오디오 소스 열거(순수, 테스트 대상).
 * 후보: (1) 현재 슬라이드의 오디오 요소(mp3, type='audio'), (2) 노트에서 생성된 음성(notesAudio).
 * @param {Array} elements  현재 페이지 flat 요소
 * @param {string|null} noteAudioRef  현재 슬라이드 노트 음성 ref(idb://...)
 * @returns {Array<{id, kind:'audio-element'|'note', ref, label}>}
 */
export function listAudioSources(elements, noteAudioRef) {
  const out = []
  let n = 0
  for (const e of (elements || [])) {
    if (e?.type === 'audio' && e.content) {
      n++
      out.push({ id: e.id, kind: 'audio-element', ref: e.content, label: e.filename ? `🎵 ${e.filename}` : `🎵 오디오 ${n}` })
    }
  }
  if (noteAudioRef) out.push({ id: '__note', kind: 'note', ref: noteAudioRef, label: '🔊 노트 음성' })
  return out
}
