import { describe, it, expect } from 'vitest'
import { toBbox, buildCaption, buildStyle, normalizeCaption, boundingBox } from '../core/ideogramCaption'

const CANVAS = { w: 1280, h: 720 }

describe('ideogramCaption — bbox 정규화', () => {
  it('px 박스 → [y_min,x_min,y_max,x_max] 0–1000 정규화', () => {
    // x=128(10%w) y=72(10%h) w=640(50%) h=360(50%) → [100,100,600,600]
    const el = { x: 128, y: 72, width: 640, height: 360 }
    expect(toBbox(el, CANVAS)).toEqual([100, 100, 600, 600])
  })

  it('범위 밖 좌표는 0–1000으로 클램프', () => {
    const el = { x: -50, y: -50, width: 5000, height: 5000 }
    expect(toBbox(el, CANVAS)).toEqual([0, 0, 1000, 1000])
  })

  it('canvasSize 누락/0이어도 안전(NaN/Infinity 방지)', () => {
    const bbox = toBbox({ x: 10, y: 10, width: 10, height: 10 }, undefined)
    expect(bbox.every(v => Number.isInteger(v) && v >= 0 && v <= 1000)).toBe(true)
  })

  it('frame(x,y 오프셋) 기준 정규화 — 선택 영역 프레이밍', () => {
    // 프레임 (100,100)~(500,300) 안의 요소 (200,150,w100,h50) → 프레임 상대 (100,50)~(200,100)
    const el = { x: 200, y: 150, width: 100, height: 50 }
    const frame = { x: 100, y: 100, w: 400, h: 200 }
    // 상대: x 100~200 /400 → 250,500 · y 50~100 /200 → 250,500. [y_min,x_min,y_max,x_max]
    expect(toBbox(el, frame)).toEqual([250, 250, 500, 500])
  })
})

describe('ideogramCaption — boundingBox', () => {
  it('요소 묶음 bbox {x,y,w,h}', () => {
    const els = [
      { x: 100, y: 200, width: 300, height: 50 },
      { x: 500, y: 100, width: 200, height: 400 },
    ]
    expect(boundingBox(els)).toEqual({ x: 100, y: 100, w: 600, h: 400 })
  })
  it('빈 목록도 안전', () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('ideogramCaption — buildCaption', () => {
  const t1 = { id: 'a', type: 'text', content: '<strong>Title</strong>', x: 128, y: 72, width: 1024, height: 144 }
  const t2 = { id: 'b', type: 'text', content: 'Subtitle here', x: 128, y: 360, width: 800, height: 72 }

  it('텍스트 요소 → compositional_deconstruction.elements (키 순서 type,bbox,text)', () => {
    const cap = buildCaption([t1, t2], CANVAS, { description: 'A slide' })
    expect(cap.high_level_description).toBe('A slide')
    const els = cap.compositional_deconstruction.elements
    expect(els).toHaveLength(2)
    expect(Object.keys(els[0])).toEqual(['type', 'bbox', 'text']) // 순서 보존, desc 없음
    expect(els[0].type).toBe('text')
    expect(els[0].text).toBe('Title')      // htmlToPlain로 태그 제거
    expect(els[1].text).toBe('Subtitle here')
  })

  it('type!=text 제외, 빈 텍스트 제외', () => {
    const img = { id: 'i', type: 'image', content: 'idb://x', x: 0, y: 0, width: 10, height: 10 }
    const empty = { id: 'e', type: 'text', content: '   ', x: 0, y: 0, width: 10, height: 10 }
    const cap = buildCaption([t1, img, empty], CANVAS)
    expect(cap.compositional_deconstruction.elements).toHaveLength(1)
  })

  it('descById로 요소별 desc 주입(키 순서 type,bbox,text,desc)', () => {
    const cap = buildCaption([t1], CANVAS, { descById: { a: 'bold headline' } })
    const e = cap.compositional_deconstruction.elements[0]
    expect(Object.keys(e)).toEqual(['type', 'bbox', 'text', 'desc'])
    expect(e.desc).toBe('bold headline')
  })

  it('description 없으면 high_level_description 생략, style 있으면 포함', () => {
    const style = buildStyle({ aesthetics: 'minimal', lighting: 'soft', medium: 'graphic_design', art_style: 'flat' })
    const cap = buildCaption([t1], CANVAS, { style })
    expect('high_level_description' in cap).toBe(false)
    expect(cap.style_description).toBe(style)
  })

  it('JSON 직렬화 시 키 순서 유지(모델 스키마 준수)', () => {
    const cap = buildCaption([t1], CANVAS, { description: 'd' })
    const s = JSON.stringify(cap)
    expect(s.indexOf('"high_level_description"')).toBeLessThan(s.indexOf('"compositional_deconstruction"'))
    // 키 형태(":" 포함)로 비교 — "text"만 쓰면 "type":"text"의 값과 먼저 매칭됨
    expect(s.indexOf('"type":')).toBeLessThan(s.indexOf('"bbox":'))
    expect(s.indexOf('"bbox":')).toBeLessThan(s.indexOf('"text":'))
  })
})

describe('ideogramCaption — normalizeCaption (LLM 출력 정규화)', () => {
  it('style_description 키순서 보정 + elements 키순서/bbox 정수화', () => {
    const raw = {
      high_level_description: 'A scene',
      style_description: { color_palette: ['#FFFFFF'], medium: 'illustration', aesthetics: 'clean', art_style: 'flat', lighting: 'soft' },
      compositional_deconstruction: {
        background: 'sky',
        elements: [{ desc: 'a tree', bbox: [10.4, 20.6, 800, 900], type: 'obj', junk: 1 }],
      },
    }
    const c = normalizeCaption(raw)
    expect(Object.keys(c.style_description)).toEqual(['aesthetics', 'lighting', 'medium', 'art_style', 'color_palette'])
    const e = c.compositional_deconstruction.elements[0]
    expect(Object.keys(e)).toEqual(['type', 'bbox', 'desc']) // junk 제거, 키순서
    expect(e.bbox).toEqual([10, 21, 800, 900]) // 정수 반올림
  })

  it('text 요소는 text 키 포함, obj는 미포함', () => {
    const c = normalizeCaption({ compositional_deconstruction: { elements: [
      { type: 'text', bbox: [0, 0, 100, 100], text: 'Hi', desc: 'label' },
      { type: 'obj', bbox: [0, 0, 100, 100], desc: 'thing' },
    ] } })
    expect(Object.keys(c.compositional_deconstruction.elements[0])).toEqual(['type', 'bbox', 'text', 'desc'])
    expect('text' in c.compositional_deconstruction.elements[1]).toBe(false)
  })

  it('compositional_deconstruction 누락 시 안전 기본값', () => {
    const c = normalizeCaption({ high_level_description: 'x' })
    expect(c.compositional_deconstruction).toEqual({ background: '', elements: [] })
  })

  it('비객체 입력도 크래시 없이 기본 구조', () => {
    expect(normalizeCaption(null).compositional_deconstruction.elements).toEqual([])
  })
})

describe('ideogramCaption — buildStyle 키 순서', () => {
  it('non-photo: aesthetics,lighting,medium,art_style,color_palette', () => {
    const s = buildStyle({ aesthetics: 'a', lighting: 'l', medium: 'm', art_style: 'flat', color_palette: ['#FFFFFF'] })
    expect(Object.keys(s)).toEqual(['aesthetics', 'lighting', 'medium', 'art_style', 'color_palette'])
  })

  it('photo: aesthetics,lighting,photo,medium', () => {
    const s = buildStyle({ aesthetics: 'a', lighting: 'l', photo: 'dslr', medium: 'photography' })
    expect(Object.keys(s)).toEqual(['aesthetics', 'lighting', 'photo', 'medium'])
  })
})
