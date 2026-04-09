/**
 * ProjectSerializer — .flatproj 프로젝트 파일 직렬화/역직렬화
 */

const CURRENT_VERSION = 1

/**
 * store 상태를 프로젝트 JSON 문자열로 직렬화
 */
export async function serializeProject(store) {
  const { pages, currentPageKey } = await store.getAllPagesAsync()

  const project = {
    version: CURRENT_VERSION,
    pages,
    currentPageKey,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  }
  return JSON.stringify(project)
}

/**
 * JSON 문자열을 프로젝트 데이터로 역직렬화 (검증 포함)
 */
export function deserializeProject(jsonString) {
  const data = JSON.parse(jsonString)

  if (!data.version || typeof data.version !== 'number') {
    throw new Error('프로젝트 버전 정보가 없습니다')
  }
  if (data.version > CURRENT_VERSION) {
    throw new Error(`지원하지 않는 프로젝트 버전입니다 (v${data.version})`)
  }
  if (!data.pages || typeof data.pages !== 'object' || Object.keys(data.pages).length === 0) {
    throw new Error('페이지 데이터가 없습니다')
  }

  // 각 페이지 검증
  for (const [key, page] of Object.entries(data.pages)) {
    if (!Array.isArray(page.elements)) {
      throw new Error(`페이지 ${key}에 elements 배열이 없습니다`)
    }
    if (!page.canvasSize || typeof page.canvasSize.w !== 'number') {
      throw new Error(`페이지 ${key}에 canvasSize가 없습니다`)
    }
  }

  return {
    pages: data.pages,
    currentPageKey: data.currentPageKey || Object.keys(data.pages)[0],
    metadata: data.metadata || {},
  }
}

/**
 * JSON 문자열을 Blob으로 다운로드
 */
export function downloadProject(jsonString, filename = 'project.flatproj') {
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * File 객체에서 프로젝트 데이터 로드
 */
export function loadProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = deserializeProject(ev.target.result)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
    reader.readAsText(file)
  })
}
