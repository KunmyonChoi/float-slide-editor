/**
 * FilePicker — File System Access API 기반 저장/열기 헬퍼.
 *
 * 지원 브라우저(Chromium)에서는 시스템 팝업으로 파일명 선택(저장)과 확장자 필터(열기)를
 * 제공하고, 미지원(Firefox/Safari)에서는 앵커 다운로드 / 임시 input으로 폴백한다.
 */

// 핸들에 쓰기 권한 확보(필요 시 사용자 제스처에서 요청). 거부 시 false.
async function ensureWritePermission(handle) {
  if (!handle?.queryPermission) return true
  const opts = { mode: 'readwrite' }
  if (await handle.queryPermission(opts) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

/**
 * Blob 저장. handle을 주면 그 파일에 바로 덮어쓴다(같은 파일 재저장).
 * 없으면 저장 팝업으로 새 파일을 만든다(미지원 시 다운로드).
 * @param {Blob} blob
 * @param {{ suggestedName: string, description?: string, accept?: Record<string,string[]>, handle?: FileSystemFileHandle }} opts
 * @returns {Promise<FileSystemFileHandle|null>} 사용한 파일 핸들(폴백/취소 시 null)
 */
export async function saveBlob(blob, { suggestedName, description = '파일', accept, handle } = {}) {
  // 1) 기존 핸들에 바로 덮어쓰기(같은 파일 재저장)
  if (handle && handle.createWritable) {
    try {
      if (await ensureWritePermission(handle)) {
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return handle
      }
      // 권한 거부 → 새 저장 팝업으로 폴백
    } catch (e) {
      if (e?.name === 'AbortError') return null
      // 그 외(핸들 무효 등) → 새 저장 팝업으로 폴백
    }
  }
  // 2) 저장 팝업으로 새 파일
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({
        suggestedName,
        types: accept ? [{ description, accept }] : undefined,
      })
      const writable = await h.createWritable()
      await writable.write(blob)
      await writable.close()
      return h
    } catch (e) {
      if (e?.name === 'AbortError') return null // 사용자가 취소
      // 그 외(권한 등)는 폴백으로 진행
    }
  }
  // 3) 폴백: 앵커 다운로드(파일명 선택/덮어쓰기 불가)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return null
}

/**
 * 파일 열기 — 시스템 열기 팝업에 확장자 필터 적용(미지원 시 임시 input).
 * @param {{ description?: string, accept?: Record<string,string[]>, acceptAttr?: string, withHandle?: boolean, excludeAll?: boolean }} opts
 *   accept: FS Access API용({'text/html': ['.html']}), acceptAttr: input[accept] 폴백용('.html,.htm')
 *   withHandle: true면 { file, handle } 반환(handle은 미지원/폴백 시 null) — 같은 파일 재저장용.
 *   excludeAll: '모든 파일' 옵션 제외 여부. 기본은 accept 유무. false면 커스텀 확장자가
 *     OS 타입 매칭으로 회색 처리돼도 사용자가 직접 선택할 수 있는 탈출구를 남긴다.
 * @returns {Promise<File|null|{file:File|null, handle:FileSystemFileHandle|null}>}
 */
export async function openFile({ description = '파일', accept, acceptAttr, withHandle = false, excludeAll } = {}) {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: accept ? [{ description, accept }] : undefined,
        excludeAcceptAllOption: excludeAll === undefined ? !!accept : excludeAll,
        multiple: false,
      })
      const file = await handle.getFile()
      return withHandle ? { file, handle } : file
    } catch (e) {
      if (e?.name === 'AbortError') return withHandle ? { file: null, handle: null } : null
      // 그 외는 폴백으로 진행
    }
  }
  // 폴백: 임시 input[type=file] (핸들 없음)
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    if (acceptAttr) input.accept = acceptAttr
    input.style.display = 'none'
    input.onchange = () => {
      const f = input.files?.[0] || null
      input.remove()
      resolve(withHandle ? { file: f, handle: null } : f)
    }
    document.body.appendChild(input)
    input.click()
  })
}
