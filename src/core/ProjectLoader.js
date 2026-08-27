/**
 * ProjectLoader — ProjectSerializer가 반환한 프로젝트 데이터를 스토어에 적용
 * 로컬 .flatproj 열기(ExportMenu)와 공유 링크로 불러오기(App) 양쪽에서 공유하는 로직.
 */
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

export function applyLoadedProject(data) {
  // 이전 HTML 덱(slideHtml/요소/reveal 구조) 초기화 — 안 하면 HTML 모드에 이전 프로젝트 내용이 남는다.
  // (.flatproj는 HTML 원본을 저장하지 않으므로 flat 스크래치 상태로 둔다)
  useEditorStore.getState().resetDeck()
  useFlatStore.getState().loadAllPages(data.pages, data.currentPageKey)
  useFlatStore.getState().setCustomTheme(data.customTheme)
  useFlatStore.getState().setThemeId(data.themeId)
  useFlatStore.getState().setHtmlSourceName(null) // 프로젝트명이 기본 파일명 기준이 됨
  useEditorStore.getState().setHtmlImported(false)
  if (useFlatStore.getState().viewMode === 'html') useFlatStore.getState().setViewMode('flat')
}
