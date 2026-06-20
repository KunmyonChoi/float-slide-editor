/**
 * textHash — 짧은 결정적 문자열 해시(djb2). 노트↔생성된 음성의 일치(스테일) 판단용.
 */
export function textHash(s) {
  let h = 5381
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}
