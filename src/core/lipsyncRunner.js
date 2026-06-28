import { useAiJobStore } from '../store/aiJobStore'

/**
 * lipsyncRunner — 립싱크 생성 작업을 전역 aiJobStore에 시작한다.
 *
 * 비디오 요소(구동 영상) + 오디오 소스를 받아 백그라운드 job으로 등록한다.
 * 결과 적용 대상은 현재 선택이 아니라 (pageKey + videoEl.id)에 바인딩되므로,
 * 사용자가 도중에 다른 요소/페이지로 가도 트레이에서 진행·결과를 확인할 수 있다.
 *
 * ⚠️ Phase 3: Worker 팝업+postMessage 백엔드는 아직 미연동(Phase 4에서 이 함수 본문 교체).
 * 지금은 job을 만들고 잠시 후 '미연동' 실패로 표시해 전체 흐름(바→트레이)을 검증한다.
 *
 * @param {{ videoEl, audioSource:{ref,label,kind}, pageKey:string, now?:number }} args
 * @returns {string} jobId
 */
export function startLipsyncJob({ videoEl, audioSource, pageKey, now = Date.now() }) {
  const store = useAiJobStore.getState()
  const id = store.startJob({
    kind: 'lipsync',
    label: `립싱크 — ${audioSource?.label || '음성'}`,
    targetPageKey: pageKey || null,
    targetElementId: videoEl?.id || null,
    createdAt: now,
    // Phase 4: apply 콜백 = 결과 영상 blob을 대상 페이지에 비디오 요소로 삽입.
  })
  store.updateJob(id, { statusText: '백엔드 준비 중…' })

  // === Phase 4 교체 지점 ===
  // 여기서 Worker SPA 팝업을 열고(인증), 비디오/오디오 blob 업로드(videoKey/audioKey),
  // /api/generate → /api/status 폴링, 진행률 updateJob, 완료 시 completeJob(result),
  // abort 훅 등록. 현재는 미연동이므로 안내 후 실패 처리.
  setTimeout(() => {
    const j = useAiJobStore.getState().jobs.find(x => x.id === id)
    if (!j || j.status !== 'running') return // 이미 취소됨 등
    useAiJobStore.getState().failJob(id, '립싱크 백엔드(Worker 팝업)는 다음 단계에서 연동됩니다.')
  }, 800)

  return id
}
