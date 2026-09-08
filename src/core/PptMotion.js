/**
 * PptMotion — 슬라이드 전환(p:transition)과 요소 등장(p:timing)을 PPTX에 싣는다.
 *
 * 왜 후처리인가: pptxgenjs에는 애니메이션 API가 없다(dist에 p:timing 문자열이 없다).
 * 그래서 생성된 zip을 열어 각 slideN.xml 끝에 두 조각을 직접 끼워 넣는다.
 *
 * 도형 식별: 내보낼 때 애니메이션 있는 요소에만 objectName을 `anim:<요소id>`로 달아두고,
 * 여기서 `<p:cNvPr id="N" name="anim:...">`를 찾아 그 N을 spid로 쓴다. 도형 순서로
 * 맞추면 그라데이션 래스터·부분채움처럼 요소 하나가 도형 여럿을 낳는 경우에 어긋난다.
 *
 * 단계 구성은 발표 모드와 같은 규칙을 쓰려고 slideAnimation.computeSteps를 그대로 쓴다.
 */
import JSZip from 'jszip'
import { computeSteps, DEFAULT_DUR } from './slideAnimation'

/** 애니메이션 대상 도형에 붙일 이름 — 내보내기와 후처리가 공유하는 약속. */
export const animObjectName = (elId) => `anim:${elId}`

// Genitor 효과 → PowerPoint 나타내기/끝내기 프리셋.
// presetID는 파워포인트 UI의 효과 번호, filter는 animEffect가 실제로 그리는 방식.
const EFFECT_MAP = {
  fadeIn: { presetID: 10, cls: 'entr', filter: () => 'fade' },
  fadeOut: { presetID: 10, cls: 'exit', filter: () => 'fade' },
  slideIn: { presetID: 22, cls: 'entr', filter: (dir) => `wipe(${dir || 'up'})` },
  slideOut: { presetID: 22, cls: 'exit', filter: (dir) => `wipe(${dir || 'up'})` },
  scaleIn: { presetID: 23, cls: 'entr', filter: () => 'zoom(in)' },
  scaleOut: { presetID: 23, cls: 'exit', filter: () => 'zoom(out)' },
  // pop은 확대 등장의 과장판 — 파워포인트엔 대응이 없어 zoom으로 보낸다.
  pop: { presetID: 23, cls: 'entr', filter: () => 'zoom(in)' },
}

const DIR_ATTR = { left: 'l', right: 'r', up: 'u', down: 'd' }

/** 전환 속도 — PowerPoint는 3단계뿐이라 ms를 여기에 접는다. */
function speedOf(ms) {
  if (!ms || ms <= 300) return 'fast'
  return ms <= 600 ? 'med' : 'slow'
}

/**
 * 페이지 전환 → `<p:transition>`. 전환이 없으면 ''.
 * @param {{type:string, durationMs?:number, dir?:string}|null} t
 */
export function buildTransitionXml(t) {
  if (!t || !t.type || t.type === 'none') return ''
  const spd = speedOf(t.durationMs)
  let inner
  if (t.type === 'fade') inner = '<p:fade/>'
  else if (t.type === 'slide') inner = `<p:push dir="${DIR_ATTR[t.dir] || 'l'}"/>`
  else if (t.type === 'zoom') inner = '<p:zoom dir="in"/>'
  else return ''
  return `<p:transition spd="${spd}">${inner}</p:transition>`
}

/** 효과 하나 → `<p:par>` 조각. ids는 cTn id를 계속 발급하는 카운터 객체. */
function effectPar({ spid, anim, delay, nodeType }, ids) {
  const map = EFFECT_MAP[anim.effect]
  if (!map) return ''
  const dur = Math.max(1, anim.durationMs || DEFAULT_DUR)
  const filter = map.filter(anim.dir)
  const isExit = map.cls === 'exit'
  const setNode = (val) =>
    '<p:set><p:cBhvr>' +
    `<p:cTn id="${ids.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    `</p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`
  const effectNode =
    `<p:animEffect transition="${isExit ? 'out' : 'in'}" filter="${filter}"><p:cBhvr>` +
    `<p:cTn id="${ids.next()}" dur="${dur}"/>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    '</p:cBhvr></p:animEffect>'

  return '<p:par>' +
    `<p:cTn id="${ids.next()}" presetID="${map.presetID}" presetClass="${map.cls}" presetSubtype="0"` +
    ` fill="hold" grpId="0" nodeType="${nodeType}">` +
    `<p:stCondLst><p:cond delay="${Math.max(0, Math.round(delay))}"/></p:stCondLst>` +
    '<p:childTnLst>' +
    // 나타내기는 보이기 → 효과, 끝내기는 효과 → 숨기기 순서다.
    (isExit ? effectNode + setNode('hidden') : setNode('visible') + effectNode) +
    '</p:childTnLst></p:cTn></p:par>'
}

/** 한 단계(클릭 한 번 또는 자동 시작) → 2겹 par로 감싼다. */
function stepPar(effects, { autoStart }, ids) {
  if (!effects.length) return ''
  const inner = effects.map((e, i) => effectPar({
    ...e, nodeType: i === 0 ? (autoStart ? 'afterEffect' : 'clickEffect') : 'withEffect',
  }, ids)).join('')
  return '<p:par>' +
    `<p:cTn id="${ids.next()}" fill="hold">` +
    `<p:stCondLst><p:cond delay="${autoStart ? '0' : 'indefinite'}"/></p:stCondLst>` +
    '<p:childTnLst><p:par>' +
    `<p:cTn id="${ids.next()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
    `<p:childTnLst>${inner}</p:childTnLst>` +
    '</p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
}

/**
 * 요소들의 anim → `<p:timing>`. 애니메이션이 하나도 없으면 ''.
 * @param {Array} elements flat 요소 (anim 있는 것만 쓴다)
 * @param {Map<string, number>} spidOf 요소 id → 슬라이드 도형 id
 */
export function buildTimingXml(elements, spidOf) {
  const usable = (elements || []).filter(e => e?.anim && EFFECT_MAP[e.anim.effect] && spidOf.get(e.id)?.length)
  if (!usable.length) return ''

  const info = computeSteps(usable)
  const byId = new Map(usable.map(e => [e.id, e]))
  let seed = 2 // 1·2는 tmRoot·mainSeq가 쓴다
  const ids = { next: () => ++seed }

  // 요소 하나가 도형 여럿이면 같은 단계에서 함께 움직인다(앱과 동일).
  const expand = (id, delay) =>
    spidOf.get(id).map(spid => ({ spid, anim: byId.get(id).anim, delay }))

  const steps = []
  // 자동 시작 묶음 — 슬라이드가 열리자마자 각자의 delay로 시작한다.
  const autoIds = Object.keys(info.autoOffsets)
  if (autoIds.length) {
    steps.push({
      autoStart: true,
      effects: autoIds
        .sort((a, b) => (byId.get(a).anim.seq || 0) - (byId.get(b).anim.seq || 0))
        .flatMap(id => expand(id, info.autoOffsets[id])),
    })
  }
  // 클릭 단계
  for (let s = 0; s < info.stepCount; s++) {
    const stepIds = info.order.filter(id => info.stepOf[id] === s)
    if (!stepIds.length) continue
    steps.push({
      autoStart: false,
      effects: stepIds.flatMap(id => expand(id, info.offsetOf[id] || 0)),
    })
  }
  if (!steps.length) return ''

  const body = steps.map(st => stepPar(st.effects, { autoStart: st.autoStart }, ids)).join('')
  const bld = [...new Set(usable.flatMap(e => spidOf.get(e.id)))]
    .map(spid => `<p:bldP spid="${spid}" grpId="0" animBg="1"/>`).join('')

  return '<p:timing><p:tnLst><p:par>' +
    '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek">' +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn>` +
    '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
    '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>' +
    '</p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst>' +
    `<p:bldLst>${bld}</p:bldLst>` +
    '</p:timing>'
}

/**
 * 슬라이드 XML에서 `anim:<id>` 이름표를 단 도형들의 spid를 요소별로 걷는다.
 * 요소 하나가 도형 여럿을 낳을 수 있어(그라데이션 래스터 + 텍스트 상자 등) 배열이다.
 */
export function readSpids(slideXml) {
  const out = new Map()
  for (const m of slideXml.matchAll(/<p:cNvPr id="(\d+)" name="anim:([^"]*)"/g)) {
    if (!out.has(m[2])) out.set(m[2], [])
    out.get(m[2]).push(Number(m[1]))
  }
  return out
}

/** 한 장 분량 주입 — 스키마상 transition·timing은 p:sld의 마지막 자식이다. */
export function injectSlideMotion(slideXml, page) {
  const spidOf = readSpids(slideXml)
  const transition = buildTransitionXml(page?.transition)
  const timing = buildTimingXml(page?.elements, spidOf)
  if (!transition && !timing) return slideXml
  return slideXml.replace('</p:sld>', `${transition}${timing}</p:sld>`)
}

/**
 * pptxgenjs가 만든 파일에 모션을 싣는다.
 * @param {Blob|ArrayBuffer|Uint8Array} pptxData
 * @param {Array} pagesInOrder 슬라이드 순서와 같은 페이지 배열({elements, transition})
 * @returns {Promise<Blob>}
 */
export async function applyMotionToPptx(pptxData, pagesInOrder) {
  const zip = await JSZip.loadAsync(pptxData)
  for (let i = 0; i < pagesInOrder.length; i++) {
    const name = `ppt/slides/slide${i + 1}.xml`
    const file = zip.file(name)
    if (!file) continue
    const xml = await file.async('string')
    zip.file(name, injectSlideMotion(xml, pagesInOrder[i]))
  }
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}
