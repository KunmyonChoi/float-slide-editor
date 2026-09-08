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
import { AUDIO_TERM } from './usePresentationEngine'

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

/**
 * 한 단계 → 2겹 par로 감싼다.
 * autoStart면 앞 단계가 끝나는 대로 이어서(=파워포인트 '이전 효과 다음에'),
 * 아니면 클릭을 기다린다. groupDelay는 단계 시작 전 텀(ms).
 */
function stepPar(effects, { autoStart, groupDelay = 0 }, ids) {
  if (!effects.length) return ''
  const inner = effects.map((e, i) => effectPar({
    ...e, nodeType: i === 0 ? (autoStart ? 'afterEffect' : 'clickEffect') : 'withEffect',
  }, ids)).join('')
  return '<p:par>' +
    `<p:cTn id="${ids.next()}" fill="hold">` +
    `<p:stCondLst><p:cond delay="${autoStart ? '0' : 'indefinite'}"/></p:stCondLst>` +
    '<p:childTnLst><p:par>' +
    `<p:cTn id="${ids.next()}" fill="hold"><p:stCondLst><p:cond delay="${Math.max(0, Math.round(groupDelay))}"/></p:stCondLst>` +
    `<p:childTnLst>${inner}</p:childTnLst>` +
    '</p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
}

/**
 * 요소들의 anim(+나레이션) → `<p:timing>`. 실을 게 없으면 ''.
 *
 * autoChain: 클릭 단계를 '이전 효과 다음에'로 바꿔 원고가 흐르는 동안 저절로 진행시킨다.
 * 발표 모드가 음성 있는 슬라이드에서 하는 것과 같다(단계 사이 AUDIO_TERM 텀까지 동일).
 *
 * @param {Array} elements flat 요소 (anim 있는 것만 쓴다)
 * @param {Map<string, number[]>} spidOf 요소 id → 슬라이드 도형 id들
 * @param {{spid:number, volume?:number}|null} [audio] 슬라이드 진입 시 자동 재생할 나레이션
 * @param {{autoChain?:boolean}} [opts]
 */
export function buildTimingXml(elements, spidOf, audio = null, { autoChain = false } = {}) {
  const usable = (elements || []).filter(e => e?.anim && EFFECT_MAP[e.anim.effect] && spidOf.get(e.id)?.length)
  if (!usable.length && !audio) return ''

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
  // 클릭 단계 — autoChain이면 클릭 대신 앞 단계에 이어서 자동 진행한다.
  for (let s = 0; s < info.stepCount; s++) {
    const stepIds = info.order.filter(id => info.stepOf[id] === s)
    if (!stepIds.length) continue
    steps.push({
      autoStart: autoChain,
      groupDelay: autoChain ? AUDIO_TERM : 0,
      effects: stepIds.flatMap(id => expand(id, info.offsetOf[id] || 0)),
    })
  }
  if (!steps.length && !audio) return ''

  const body = steps.map(st => stepPar(st.effects, { autoStart: st.autoStart, groupDelay: st.groupDelay }, ids)).join('')
  const seq = steps.length
    ? '<p:seq concurrent="1" nextAc="seek">' +
      `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn>` +
      '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>' +
      '</p:seq>'
    : ''
  const audioNode = audio ? audioMediaNode(audio, ids) : ''
  const bld = [...new Set(usable.flatMap(e => spidOf.get(e.id)))]
    .map(spid => `<p:bldP spid="${spid}" grpId="0" animBg="1"/>`).join('')

  return '<p:timing><p:tnLst><p:par>' +
    '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
    seq + audioNode +
    '</p:childTnLst></p:cTn></p:par></p:tnLst>' +
    (bld ? `<p:bldLst>${bld}</p:bldLst>` : '') +
    '</p:timing>'
}

/**
 * 나레이션 → 슬라이드가 뜨는 즉시 재생되는 오디오 노드.
 * showWhenStopped="0" 이라 발표 중에는 스피커 아이콘이 보이지 않는다.
 */
function audioMediaNode({ spid, volume = 1 }, ids) {
  const vol = Math.round(Math.min(1, Math.max(0, volume)) * 100000)
  return '<p:audio>' +
    `<p:cMediaNode vol="${vol}" showWhenStopped="0">` +
    `<p:cTn id="${ids.next()}" fill="hold" display="0">` +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst>' +
    '<p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>' +
    '</p:cTn>' +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    '</p:cMediaNode></p:audio>'
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
export function injectSlideMotion(slideXml, page, audio = null) {
  const spidOf = readSpids(slideXml)
  const transition = buildTransitionXml(page?.transition)
  // 나레이션이 실린 장은 앱 발표 모드처럼 저절로 흐르게 한다(클릭 없이).
  const timing = buildTimingXml(page?.elements, spidOf, audio, { autoChain: !!audio })
  if (!transition && !timing) return slideXml
  return slideXml.replace('</p:sld>', `${transition}${timing}</p:sld>`)
}

// 오디오 도형에 필요한 미리보기 이미지(1x1 투명 PNG) — PowerPoint가 blipFill을 요구한다.
const POSTER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const POSTER_PATH = 'ppt/media/narration-poster.png'
const EMU_PER_INCH = 914400

/** [Content_Types].xml에 확장자 기본값이 없으면 넣는다. */
function ensureDefault(ctXml, ext, type) {
  if (new RegExp(`Extension="${ext}"`, 'i').test(ctXml)) return ctXml
  return ctXml.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${type}"/>`)
}

/** rels에 관계를 추가하고 부여한 Id를 돌려준다. */
function addRel(relsXml, type, target) {
  const used = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]))
  const id = `rId${(used.length ? Math.max(...used) : 0) + 1}`
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`
  return { xml: relsXml.replace('</Relationships>', `${rel}</Relationships>`), id }
}

const REL_AUDIO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio'
const REL_MEDIA = 'http://schemas.microsoft.com/office/2007/relationships/media'
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/** 슬라이드 안에서 아직 안 쓴 도형 id. */
function nextShapeId(slideXml) {
  const used = [...slideXml.matchAll(/<p:cNvPr id="(\d+)"/g)].map(m => Number(m[1]))
  return (used.length ? Math.max(...used) : 1) + 1
}

/**
 * 나레이션 오디오 도형을 슬라이드에 심는다(우하단 구석, 발표 중에는 숨김).
 * @returns {{xml:string, spid:number}}
 */
function insertAudioPic(slideXml, { spid, audioRid, mediaRid, posterRid, name, slideW, slideH }) {
  const size = Math.round(0.3 * EMU_PER_INCH)
  const x = Math.max(0, slideW - size - Math.round(0.1 * EMU_PER_INCH))
  const y = Math.max(0, slideH - size - Math.round(0.1 * EMU_PER_INCH))
  const pic = '<p:pic><p:nvPicPr>' +
    `<p:cNvPr id="${spid}" name="${name}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>' +
    `<p:nvPr><a:audioFile r:link="${audioRid}"/><p:extLst>` +
    '<p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">' +
    `<p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${mediaRid}"/>` +
    '</p:ext></p:extLst></p:nvPr>' +
    '</p:nvPicPr>' +
    `<p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${size}" cy="${size}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '</p:pic>'
  return { xml: slideXml.replace('</p:spTree>', `${pic}</p:spTree>`), spid }
}

/** presentation.xml에서 슬라이드 크기(EMU)를 읽는다. */
function readSlideSize(presXml) {
  const m = presXml?.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 9144000, h: 6858000 }
}

/**
 * pptxgenjs가 만든 파일에 모션(전환·등장)과 나레이션을 싣는다.
 * @param {Blob|ArrayBuffer|Uint8Array} pptxData
 * @param {Array} pagesInOrder 슬라이드 순서와 같은 페이지 배열({elements, transition})
 * @param {Array<{bytes:ArrayBuffer|Uint8Array, ext:string, volume?:number}|null>} [narration]
 *        페이지별 나레이션. 없는 장은 null.
 * @returns {Promise<Blob>}
 */
export async function applyMotionToPptx(pptxData, pagesInOrder, narration = []) {
  const zip = await JSZip.loadAsync(pptxData)
  const hasNarration = narration.some(Boolean)
  let ct = await zip.file('[Content_Types].xml')?.async('string')
  const size = readSlideSize(await zip.file('ppt/presentation.xml')?.async('string'))

  if (hasNarration && ct) {
    for (const ext of new Set(narration.filter(Boolean).map(n => n.ext))) {
      ct = ensureDefault(ct, ext, ext === 'wav' ? 'audio/wav' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg')
    }
    ct = ensureDefault(ct, 'png', 'image/png')
    zip.file('[Content_Types].xml', ct)
    zip.file(POSTER_PATH, POSTER_PNG_B64, { base64: true })
  }

  for (let i = 0; i < pagesInOrder.length; i++) {
    const name = `ppt/slides/slide${i + 1}.xml`
    const file = zip.file(name)
    if (!file) continue
    let xml = await file.async('string')
    let audio = null

    const nar = narration[i]
    if (nar?.bytes) {
      const mediaPath = `ppt/media/narration${i + 1}.${nar.ext}`
      zip.file(mediaPath, nar.bytes)
      const relsName = `ppt/slides/_rels/slide${i + 1}.xml.rels`
      let rels = await zip.file(relsName)?.async('string')
      if (rels) {
        const target = `../media/narration${i + 1}.${nar.ext}`
        const a = addRel(rels, REL_AUDIO, target); rels = a.xml
        const m = addRel(rels, REL_MEDIA, target); rels = m.xml
        const p = addRel(rels, REL_IMAGE, '../media/narration-poster.png'); rels = p.xml
        zip.file(relsName, rels)
        const spid = nextShapeId(xml)
        xml = insertAudioPic(xml, {
          spid, audioRid: a.id, mediaRid: m.id, posterRid: p.id,
          name: `narration${i + 1}.${nar.ext}`, slideW: size.w, slideH: size.h,
        }).xml
        audio = { spid, volume: nar.volume ?? 1 }
      }
    }

    zip.file(name, injectSlideMotion(xml, pagesInOrder[i], audio))
  }
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}
