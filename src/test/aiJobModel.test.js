import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { useAiJobStore } from '../store/aiJobStore'

function el(id, extra = {}) {
  return { id, type: 'image', x: 0, y: 0, width: 100, height: 100, zIndex: 1, content: 'x', isRich: false, styles: { opacity: '1' }, ...extra }
}

// 0페이지(현재)·1페이지(캐시)로 멀티페이지 구성
function seedTwoPages() {
  useFlatStore.getState().loadAllPages({
    '0-0': { elements: [el('flat-1'), el('flat-2')], canvasSize: { w: 1280, h: 720 }, fontImports: [] },
    '1-0': { elements: [el('flat-10')], canvasSize: { w: 1280, h: 720 }, fontImports: [] },
  }, '0-0')
}

describe('flatStore 페이지-인지 적용(AI 작업 결과 반영)', () => {
  beforeEach(seedTwoPages)

  it('현재 페이지 요소: 라이브 flatElements가 갱신된다', () => {
    const ok = useFlatStore.getState().applyToElementOnPage('0-0', 'flat-2', { content: 'NEW' })
    expect(ok).toBe(true)
    const e = useFlatStore.getState().flatElements.find(e => e.id === 'flat-2')
    expect(e.content).toBe('NEW')
  })

  it('다른(캐시) 페이지 요소: 현재 화면 안 건드리고 캐시가 갱신된다', () => {
    const ok = useFlatStore.getState().applyToElementOnPage('1-0', 'flat-10', { content: 'CACHED' })
    expect(ok).toBe(true)
    // 현재 페이지(0) 라이브 요소엔 영향 없음
    expect(useFlatStore.getState().flatElements.some(e => e.id === 'flat-10')).toBe(false)
    // 1페이지로 이동하면 갱신이 반영돼 있어야 함
    useFlatStore.getState().goToFlatPage(1)
    const e = useFlatStore.getState().flatElements.find(e => e.id === 'flat-10')
    expect(e.content).toBe('CACHED')
  })

  it('styles는 중첩 머지된다(캐시 페이지)', () => {
    useFlatStore.getState().applyToElementOnPage('1-0', 'flat-10', { styles: { objectFit: 'cover' } })
    useFlatStore.getState().goToFlatPage(1)
    const e = useFlatStore.getState().flatElements.find(e => e.id === 'flat-10')
    expect(e.styles.objectFit).toBe('cover')
    expect(e.styles.opacity).toBe('1') // 기존 스타일 보존
  })

  it('없는 대상이면 false', () => {
    expect(useFlatStore.getState().applyToElementOnPage('0-0', 'nope', { content: 'x' })).toBe(false)
    expect(useFlatStore.getState().applyToElementOnPage('9-9', 'flat-10', { content: 'x' })).toBe(false)
  })

  it('addElementToPage: 캐시 페이지에 요소 추가', () => {
    const ok = useFlatStore.getState().addElementToPage('1-0', el('flat-99', { content: 'ADDED' }))
    expect(ok).toBe(true)
    expect(useFlatStore.getState().flatElements.some(e => e.id === 'flat-99')).toBe(false) // 현재 페이지 영향 없음
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().flatElements.some(e => e.id === 'flat-99')).toBe(true)
  })

  it('노트 음성 볼륨: 기본 1, 현재/다른 페이지 설정, 복원·직렬화 유지', async () => {
    expect(useFlatStore.getState().pageNotesAudioVolume).toBe(1) // 기본
    // 다른(캐시) 페이지에 0 설정 → 현재 상태 불변
    useFlatStore.getState().setPageNotesAudioVolume(0, '1-0')
    expect(useFlatStore.getState().pageNotesAudioVolume).toBe(1)
    useFlatStore.getState().goToFlatPage(1)
    expect(useFlatStore.getState().pageNotesAudioVolume).toBe(0) // 복원 시 반영
    // 현재 페이지 설정
    useFlatStore.getState().setPageNotesAudioVolume(0.5)
    expect(useFlatStore.getState().pageNotesAudioVolume).toBe(0.5)
    // 직렬화에 포함(발표/저장 경로)
    const { pages } = await useFlatStore.getState().getAllPagesAsync()
    expect(pages['1-0'].notesAudioVolume).toBe(0.5)
  })
})

describe('aiJobStore — 전역 AI 작업 모델', () => {
  beforeEach(() => useAiJobStore.setState({ jobs: [] }))

  it('startJob → running 상태로 추가, jobId 반환', () => {
    const id = useAiJobStore.getState().startJob({ kind: 'lipsync', targetPageKey: '0-0', targetElementId: 'flat-2', createdAt: 1 })
    const job = useAiJobStore.getState().jobs.find(j => j.id === id)
    expect(job.status).toBe('running')
    expect(job.targetElementId).toBe('flat-2')
  })

  it('진행률 갱신 → 완료(ready) → applied', () => {
    const id = useAiJobStore.getState().startJob({ kind: 'lipsync', createdAt: 1 })
    useAiJobStore.getState().updateJob(id, { progress: 50, statusText: '생성 중' })
    expect(useAiJobStore.getState().jobs[0].progress).toBe(50)
    useAiJobStore.getState().completeJob(id, { url: 'blob:x' })
    expect(useAiJobStore.getState().jobs[0].status).toBe('ready')
    expect(useAiJobStore.getState().jobs[0].result.url).toBe('blob:x')
    useAiJobStore.getState().markApplied(id)
    expect(useAiJobStore.getState().jobs[0].status).toBe('applied')
  })

  it('cancelJob은 abort 훅을 호출하고 cancelled로 표시', () => {
    let aborted = false
    const id = useAiJobStore.getState().startJob({ kind: 'lipsync', abort: () => { aborted = true }, createdAt: 1 })
    useAiJobStore.getState().cancelJob(id)
    expect(aborted).toBe(true)
    expect(useAiJobStore.getState().jobs[0].status).toBe('cancelled')
  })

  it('jobForElement: 대상의 진행/대기 작업만 반환', () => {
    const id = useAiJobStore.getState().startJob({ kind: 'lipsync', targetElementId: 'flat-2', createdAt: 1 })
    expect(useAiJobStore.getState().jobForElement('flat-2')?.id).toBe(id)
    useAiJobStore.getState().failJob(id, 'oops')
    expect(useAiJobStore.getState().jobForElement('flat-2')).toBe(null) // failed는 제외
  })

  it('applyJob: ready일 때만 apply 콜백 호출 후 applied, mode 전달', () => {
    let gotMode = null
    const id = useAiJobStore.getState().startJob({ kind: 'lipsync', apply: (_j, opts) => { gotMode = opts?.mode }, createdAt: 1 })
    // running 상태에선 적용 불가
    expect(useAiJobStore.getState().applyJob(id, { mode: 'replace' })).toBe(false)
    useAiJobStore.getState().completeJob(id, { url: 'blob:x' })
    expect(useAiJobStore.getState().applyJob(id, { mode: 'add' })).toBe(true)
    expect(gotMode).toBe('add') // opts.mode가 apply 콜백에 전달됨
    expect(useAiJobStore.getState().jobs[0].status).toBe('applied')
  })

  // 적용이 실패하면(대상 요소가 삭제된 경우 등) 결과를 버리지 않고 다시 적용할 수 있어야 한다.
  // 러너의 apply는 반드시 throw/reject해야 이 경로를 탄다 — 조용히 성공 처리하면 결과가 유실된다.
  it('applyJob: apply가 실패하면 ready를 유지하고 에러를 남긴다', async () => {
    const id = useAiJobStore.getState().startJob({
      kind: 'image-cutout',
      apply: () => Promise.reject(new Error('원본 이미지를 찾을 수 없습니다')),
      createdAt: 1,
    })
    useAiJobStore.getState().completeJob(id, { url: 'blob:x' })
    expect(useAiJobStore.getState().applyJob(id, { mode: 'replace' })).toBe(true)
    await Promise.resolve(); await Promise.resolve() // 마이크로태스크 소진
    const job = useAiJobStore.getState().jobs[0]
    expect(job.status).toBe('ready')                    // applied로 넘어가지 않는다
    expect(job.error).toMatch(/적용 실패/)
    expect(job.result.url).toBe('blob:x')               // 결과는 그대로 남아 재적용 가능
  })

  // 트레이의 '적용' 버튼 구성은 러너가 정한다 — startJob이 그대로 보관해야 한다.
  it('startJob: applyOptions를 job에 보관한다(없으면 null)', () => {
    const opts = [{ mode: 'add', label: '새 이미지로 추가' }, { mode: 'replace', label: '텍스트 박스 교체' }]
    const id = useAiJobStore.getState().startJob({ kind: 'image-gen', applyOptions: opts, createdAt: 1 })
    expect(useAiJobStore.getState().jobs.find(j => j.id === id).applyOptions).toEqual(opts)
    const id2 = useAiJobStore.getState().startJob({ kind: 'lipsync', createdAt: 2 })
    expect(useAiJobStore.getState().jobs.find(j => j.id === id2).applyOptions).toBe(null)
  })
})

describe('flatStore goToFlatPageByKey (트레이 보기)', () => {
  beforeEach(seedTwoPages)

  it('pageKey로 이동, 같은 페이지면 no-op true, 없는 키면 false', () => {
    const st = useFlatStore.getState()
    expect(st.goToFlatPageByKey('0-0')).toBe(true) // 이미 현재
    expect(st.goToFlatPageByKey('1-0')).toBe(true)
    expect(useFlatStore.getState().flatElements.some(e => e.id === 'flat-10')).toBe(true) // 1페이지 이동됨
    expect(useFlatStore.getState().goToFlatPageByKey('9-9')).toBe(false)
  })
})
