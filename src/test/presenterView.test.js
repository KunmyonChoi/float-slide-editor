import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openChannel, newSessionId, audienceSessionFromUrl } from '../core/presenterChannel'
import { pickAudienceScreen, openAudienceWindow, screensSupported } from '../core/screenPlacement'

// 화면 정의 헬퍼 — index는 listScreens()가 붙이는 순번
const screen = (index, over = {}) => ({
  index, label: `모니터 ${index + 1}`,
  left: 0, top: 0, width: 1920, height: 1080,
  isPrimary: false, isInternal: false, isCurrent: false,
  ...over,
})

describe('presenterChannel — 발표자 창 ↔ 청중 창', () => {
  it('세션 id는 매번 다르고 URL에 실을 수 있는 문자만 쓴다', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSessionId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('보낸 쪽에는 오지 않고 받는 쪽에만 타입별로 전달된다', async () => {
    const sid = newSessionId()
    const presenter = openChannel(sid)
    const audience = openChannel(sid)

    const onState = vi.fn()
    const onDeck = vi.fn()
    const echoed = vi.fn()
    audience.on('state', onState)
    audience.on('deck', onDeck)
    presenter.on('state', echoed) // 자기가 보낸 건 자기에게 오지 않아야 한다

    presenter.post('state', { state: { slide: 3 } })
    await new Promise(r => setTimeout(r, 0))

    expect(onState).toHaveBeenCalledTimes(1)
    expect(onState.mock.calls[0][0].state).toEqual({ slide: 3 })
    expect(onDeck).not.toHaveBeenCalled()
    expect(echoed).not.toHaveBeenCalled()

    presenter.close(); audience.close()
  })

  it('한 타입에 여러 구독이 붙고, 해제 함수로 개별 해제된다', async () => {
    const sid = newSessionId()
    const a = openChannel(sid)
    const b = openChannel(sid)
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = b.on('alive', first)
    b.on('alive', second)

    a.post('alive')
    await new Promise(r => setTimeout(r, 0))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    offFirst()
    a.post('alive')
    await new Promise(r => setTimeout(r, 0))
    expect(first).toHaveBeenCalledTimes(1)   // 해제됨
    expect(second).toHaveBeenCalledTimes(2)

    a.close(); b.close()
  })

  it('한 구독자가 던져도 나머지 구독자에게는 전달된다 — 발표 중 한 곳의 오류가 동기화를 끊지 않게', async () => {
    const sid = newSessionId()
    const a = openChannel(sid)
    const b = openChannel(sid)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ok = vi.fn()
    b.on('state', () => { throw new Error('구독자 오류') })
    b.on('state', ok)

    a.post('state', { state: {} })
    await new Promise(r => setTimeout(r, 0))
    expect(ok).toHaveBeenCalledTimes(1)

    warn.mockRestore()
    a.close(); b.close()
  })

  it('구조화 복제가 안 되는 값을 보내도 발표를 죽이지 않는다', () => {
    const sid = newSessionId()
    const ch = openChannel(sid)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 함수는 복제 불가 — 던지지 않고 경고만 남겨야 한다
    expect(() => ch.post('deck', { pages: { fn: () => {} } })).not.toThrow()
    warn.mockRestore()
    ch.close()
  })

  it('타입이 없는 메시지는 무시한다', async () => {
    const sid = newSessionId()
    const raw = new BroadcastChannel(`genitor-present-${sid}`)
    const ch = openChannel(sid)
    const seen = vi.fn()
    ch.on('state', seen)

    raw.postMessage('문자열')
    raw.postMessage({ noType: 1 })
    await new Promise(r => setTimeout(r, 0))
    expect(seen).not.toHaveBeenCalled()

    raw.close(); ch.close()
  })
})

describe('audienceSessionFromUrl', () => {
  const original = window.location.search
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname + original)
  })

  it('?audience=<id>가 있으면 그 값을, 없으면 null을 준다', () => {
    window.history.replaceState(null, '', '/?audience=abc123')
    expect(audienceSessionFromUrl()).toBe('abc123')
    window.history.replaceState(null, '', '/')
    expect(audienceSessionFromUrl()).toBe(null)
  })

  it('공유 링크 같은 다른 파라미터와 섞여 있어도 골라낸다', () => {
    window.history.replaceState(null, '', '/?share=xyz&audience=s1')
    expect(audienceSessionFromUrl()).toBe('s1')
  })
})

describe('pickAudienceScreen — 청중 화면 고르기', () => {
  it('화면이 하나뿐이면 자동 배치할 곳이 없다(리허설 경로)', () => {
    expect(pickAudienceScreen([screen(0, { isCurrent: true, isInternal: true })], 0)).toBe(null)
    expect(pickAudienceScreen([], -1)).toBe(null)
  })

  it('발표자가 보고 있는 화면은 고르지 않는다', () => {
    const screens = [screen(0, { isCurrent: true, isInternal: true }), screen(1)]
    expect(pickAudienceScreen(screens, 0).index).toBe(1)
  })

  it('외장 디스플레이(프로젝터)를 내장 화면보다 우선한다', () => {
    // 0=현재(내장), 1=또 다른 내장, 2=외장 → 2번이 청중 화면
    const screens = [
      screen(0, { isCurrent: true, isInternal: true }),
      screen(1, { isInternal: true }),
      screen(2, { isInternal: false }),
    ]
    expect(pickAudienceScreen(screens, 0).index).toBe(2)
  })

  it('외장이 하나도 없으면 현재 화면이 아닌 첫 화면을 쓴다', () => {
    const screens = [
      screen(0, { isCurrent: true, isInternal: true }),
      screen(1, { isInternal: true }),
    ]
    expect(pickAudienceScreen(screens, 0).index).toBe(1)
  })
})

describe('openAudienceWindow — 청중 창 열기', () => {
  let opened
  beforeEach(() => {
    opened = []
    vi.stubGlobal('open', vi.fn((url, name, feats) => {
      opened.push({ url, name, feats })
      return { closed: false }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('세션 id를 URL과 창 이름에 함께 실어, 다시 열기가 같은 창을 재사용하게 한다', () => {
    openAudienceWindow({ sessionId: 's1', screen: null })
    expect(opened[0].url).toContain('?audience=s1')
    expect(opened[0].name).toBe('genitor-audience-s1')
  })

  it('화면이 지정되면 그 좌표·크기로 열고 전체화면 힌트를 준다', () => {
    openAudienceWindow({ sessionId: 's1', screen: screen(1, { left: 1512, top: 25, width: 1920, height: 1080 }) })
    const f = opened[0].feats
    expect(f).toContain('left=1512')
    expect(f).toContain('top=25')
    expect(f).toContain('width=1920')
    expect(f).toContain('height=1080')
    expect(f).toContain('fullscreen=yes')
  })

  it('화면 정보가 없으면 좌표 없이 기본 크기 창으로 연다 — 사용자가 끌어다 놓는 수동 배치', () => {
    openAudienceWindow({ sessionId: 's1', screen: null })
    const f = opened[0].feats
    expect(f).toContain('width=1280')
    expect(f).not.toContain('left=')
    expect(f).not.toContain('fullscreen')
  })

  it('팝업이 차단되면 null을 돌려줘 호출부가 안내로 넘어갈 수 있게 한다', () => {
    vi.stubGlobal('open', vi.fn(() => null))
    expect(openAudienceWindow({ sessionId: 's1', screen: null })).toBe(null)
  })

  it('window.open이 예외를 던져도 발표 진입을 깨뜨리지 않는다', () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('차단됨') }))
    expect(openAudienceWindow({ sessionId: 's1', screen: null })).toBe(null)
  })
})

describe('screensSupported', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('getScreenDetails가 없는 브라우저(Safari·Firefox)에서는 false — 수동 배치 경로로 간다', () => {
    expect(screensSupported()).toBe(false)
  })

  it('있으면 true', () => {
    vi.stubGlobal('getScreenDetails', () => Promise.resolve({ screens: [], currentScreen: null }))
    expect(screensSupported()).toBe(true)
  })
})
