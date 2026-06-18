// .flatproj 파일의 요소/그룹 데이터 무결성 진단
// 사용법: node scripts/diagnose-flatproj.mjs <파일경로> [페이지키|페이지번호]
// 예:    node scripts/diagnose-flatproj.mjs ~/Downloads/Newscast.flatproj 5
import fs from 'node:fs'
import JSZip from 'jszip'

const path = process.argv[2]
const onlyArg = process.argv[3] // 특정 페이지만(키 '4-0' 또는 번호 5)
if (!path) { console.error('사용법: node scripts/diagnose-flatproj.mjs <파일.flatproj> [페이지]'); process.exit(1) }

const buf = fs.readFileSync(path)
let data
if (buf[0] === 0x50 && buf[1] === 0x4b) { // PK = ZIP
  const zip = await JSZip.loadAsync(buf)
  const json = await zip.file('project.json')?.async('string')
  if (!json) { console.error('project.json 없음'); process.exit(1) }
  data = JSON.parse(json)
} else {
  data = JSON.parse(buf.toString('utf8'))
}

const pageKeys = Object.keys(data.pages || {}).sort((a, b) => {
  const [ap, av] = a.split('-').map(Number), [bp, bv] = b.split('-').map(Number)
  return ap - bp || av - bv
})

console.log(`프로젝트: ${path}`)
console.log(`총 ${pageKeys.length}페이지\n`)

function analyzePage(key, idx) {
  const page = data.pages[key]
  const els = page.elements || []
  const cs = page.canvasSize || { w: 1280, h: 720 }

  const idCount = {}, groupCount = {}
  for (const e of els) {
    idCount[e.id] = (idCount[e.id] || 0) + 1
    if (e.groupId) groupCount[e.groupId] = (groupCount[e.groupId] || 0) + 1
  }
  const dupIds = Object.entries(idCount).filter(([, n]) => n > 1).map(([id]) => id)
  const singletonGroups = Object.entries(groupCount).filter(([, n]) => n < 2).map(([g]) => g)
  const byId = Object.fromEntries(els.map(e => [e.id, e]))
  const danglingConnectors = els.filter(e => e.shapeType === 'connector' && e.connection &&
    [e.connection.start, e.connection.end].some(end => end?.elementId && !byId[end.elementId]))
  const fullCanvasNonBg = els.filter(e =>
    !(e.isBackground || e.sourceId === '__bg') &&
    Math.abs(e.width - cs.w) < 2 && Math.abs(e.height - cs.h) < 2 && Math.abs(e.x) < 2 && Math.abs(e.y) < 2)

  const issues = dupIds.length || singletonGroups.length || danglingConnectors.length || fullCanvasNonBg.length
  const flag = issues ? ' ⚠' : ''
  console.log(`── [${idx + 1}] page ${key} — 요소 ${els.length}개${flag}`)
  if (dupIds.length) console.log(`   중복 id: ${dupIds.join(', ')}`)
  if (singletonGroups.length) {
    console.log(`   단독 멤버 그룹(꼬임) ${singletonGroups.length}개:`)
    for (const g of singletonGroups) {
      const m = els.find(e => e.groupId === g)
      console.log(`      group=${g}  →  ${m?.id} (${m?.shapeType || m?.type})`)
    }
  }
  if (danglingConnectors.length) console.log(`   끊긴 커넥터(없는 도형 참조): ${danglingConnectors.map(e => e.id).join(', ')}`)
  if (fullCanvasNonBg.length) {
    console.log(`   전체화면이나 배경 아님(FULL) ${fullCanvasNonBg.length}개:`)
    for (const e of fullCanvasNonBg) console.log(`      ${e.id} (${e.shapeType || e.type}) z=${e.zIndex} group=${e.groupId || '-'}`)
  }
  if (onlyArg) {
    // 상세 덤프(특정 페이지 지정 시)
    console.log('   [요소 목록 z순]')
    for (const e of [...els].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))) {
      console.log(`      z=${e.zIndex}  ${(e.shapeType || e.type).padEnd(10)} id=${e.id} group=${e.groupId || '-'}` +
        ` ${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}×${Math.round(e.height)}`)
    }
  }
}

const targetKeys = onlyArg
  ? pageKeys.filter((k, i) => k === onlyArg || String(i + 1) === String(onlyArg))
  : pageKeys
if (targetKeys.length === 0) console.log(`페이지 '${onlyArg}'를 찾지 못함. 사용 가능한 키: ${pageKeys.join(', ')}`)
targetKeys.forEach((k) => analyzePage(k, pageKeys.indexOf(k)))
