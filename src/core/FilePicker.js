/**
 * FilePicker — File System Access API 기반 저장/열기 헬퍼.
 *
 * 지원 브라우저(Chromium)에서는 시스템 팝업으로 파일명 선택(저장)과 확장자 필터(열기)를
 * 제공하고, 미지원(Firefox/Safari)에서는 앵커 다운로드 / 임시 input으로 폴백한다.
 */

/**
 * Blob 저장 — 시스템 저장 팝업에서 파일명을 고른다(미지원 시 다운로드).
 * @param {Blob} blob
 * @param {{ suggestedName: string, description?: string, accept?: Record<string,string[]> }} opts
 * @returns {Promise<boolean>} 저장됨 true / 사용자 취소 false
 */
export async function saveBlob(blob, { suggestedName, description = '파일', accept } = {}) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: accept ? [{ description, accept }] : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (e) {
      if (e?.name === 'AbortError') return false // 사용자가 취소
      // 그 외(권한 등)는 폴백으로 진행
    }
  }
  // 폴백: 앵커 다운로드(파일명 선택 불가)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}

/**
 * 파일 열기 — 시스템 열기 팝업에 확장자 필터 적용(미지원 시 임시 input).
 * @param {{ description?: string, accept?: Record<string,string[]>, acceptAttr?: string }} opts
 *   accept: FS Access API용({'text/html': ['.html']}), acceptAttr: input[accept] 폴백용('.html,.htm')
 * @returns {Promise<File|null>} 선택 파일 / 취소 시 null
 */
export async function openFile({ description = '파일', accept, acceptAttr } = {}) {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: accept ? [{ description, accept }] : undefined,
        excludeAcceptAllOption: !!accept, // 필터를 확실히 적용(모든 파일 옵션 제거)
        multiple: false,
      })
      return await handle.getFile()
    } catch (e) {
      if (e?.name === 'AbortError') return null // 사용자가 취소
      // 그 외는 폴백으로 진행
    }
  }
  // 폴백: 임시 input[type=file]
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    if (acceptAttr) input.accept = acceptAttr
    input.style.display = 'none'
    input.onchange = () => {
      const f = input.files?.[0] || null
      input.remove()
      resolve(f)
    }
    document.body.appendChild(input)
    input.click()
  })
}
