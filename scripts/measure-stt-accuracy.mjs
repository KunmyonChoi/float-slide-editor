#!/usr/bin/env node
/**
 * measure-stt-accuracy.mjs — 가라오케 자막용 STT(whisper-1) 정확도 측정 도구.
 *
 * 두 가지 모드를 지원한다:
 *
 *  1) 왕복(round-trip) 모드(기본) — 발표자 노트 같은 한국어 샘플 문장을 OpenAI TTS로 음성화한
 *     뒤, 그 음성을 다시 whisper-1로 전사해 원문과 비교한다. 원문이 곧 정답이므로 사람이 정답
 *     스크립트를 만들 필요가 없다. 단, "깨끗한 OpenAI TTS 음성"에 대한 정확도이지, 실제 사람이
 *     녹음한 나레이션(잡음·억양·발음)의 정확도를 대변하진 않는다는 점에 주의.
 *
 *  2) manifest 모드 — 실제 녹음 파일 + 사람이 만든 정답 텍스트 쌍을 JSON으로 주면, 그 오디오를
 *     whisper-1로 전사해 실제 정확도를 잰다(더 현실적인 측정치).
 *     사용법: node scripts/measure-stt-accuracy.mjs --manifest path/to/manifest.json
 *     manifest.json 형식: [{ "audioPath": "samples/note1.wav", "referenceText": "...", "language": "ko" }, ...]
 *
 * 필요: OPENAI_API_KEY 환경변수(사용자 본인 키). 이 저장소의 다른 코드와 마찬가지로 whisper-1을
 * 사용한다 — word-level timestamp(가라오케용)를 지원하는 유일한 OpenAI 호스팅 STT 모델이기 때문
 * (src/core/SttClient.js 참고). 이 스크립트는 word-level timestamp 정확도가 아니라 "전체 텍스트가
 * 얼마나 맞았는가"(WER/CER)를 측정한다 — 단어 타임스탬프 자체의 정밀도는 API가 별도로 검증할
 * 방법을 제공하지 않는다.
 *
 * 실행:
 *   OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs
 *   OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs --manifest my-samples.json
 *   OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs --out report.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import { wordErrorRate, charErrorRate } from '../src/core/karaoke.js'

const TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech'
const TRANSCRIBE_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
const TTS_MODEL = 'gpt-4o-mini-tts'
const TTS_VOICE = 'alloy'
const STT_MODEL = 'whisper-1'

// 발표자 노트에 흔히 나오는 문체(짧은 구어체 ~ 긴 격식체, 숫자·고유명사 포함)를 두루 커버하는 샘플.
const DEFAULT_SAMPLES = [
  { id: 'short-greeting', text: '안녕하세요, 오늘 발표를 맡은 최근민입니다.' },
  { id: 'agenda', text: '오늘은 크게 세 가지를 말씀드리겠습니다. 먼저 배경, 다음으로 핵심 기능, 마지막으로 로드맵입니다.' },
  { id: 'numbers', text: '지난 분기 매출은 전년 대비 23퍼센트 증가한 45억 원을 기록했습니다.' },
  { id: 'jargon', text: 'STT API를 활용해 발표자 노트 음성에서 단어 단위 타임스탬프를 추출하고, 이를 카라오케 자막으로 표시합니다.' },
  { id: 'long-formal', text: '이번 슬라이드에서는 사용자 리서치 결과를 바탕으로 도출한 세 가지 핵심 인사이트를 순서대로 설명드리겠습니다. 첫째, 사용자는 반복적인 설정 작업에 큰 피로감을 느끼고 있었습니다. 둘째, 발표 직전에 노트를 다시 검토하는 경우가 매우 많았습니다. 셋째, 자막 기능에 대한 수요가 예상보다 높았습니다.' },
]

function parseArgs(argv) {
  const args = { manifest: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--manifest') args.manifest = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

async function synthesize(apiKey, text) {
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: 'mp3' }),
  })
  if (!res.ok) throw new Error(`TTS 실패 (${res.status}): ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function transcribe(apiKey, audioBuffer, filename, language) {
  const form = new FormData()
  form.append('file', new Blob([audioBuffer]), filename)
  form.append('model', STT_MODEL)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  if (language) form.append('language', language)
  const res = await fetch(TRANSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`STT 실패 (${res.status}): ${await res.text()}`)
  return res.json()
}

function pct(x) { return `${(x * 100).toFixed(1)}%` }

async function runRoundTrip(apiKey, samples) {
  const results = []
  for (const s of samples) {
    process.stdout.write(`[${s.id}] TTS 합성 중...`)
    const audio = await synthesize(apiKey, s.text)
    process.stdout.write(' STT 전사 중...')
    const t0 = Date.now()
    const data = await transcribe(apiKey, audio, `${s.id}.mp3`, 'ko')
    const ms = Date.now() - t0
    const hyp = data.text || ''
    const wer = wordErrorRate(s.text, hyp)
    const cer = charErrorRate(s.text, hyp)
    const wordCount = Array.isArray(data.words) ? data.words.length : 0
    console.log(` 완료 (${ms}ms, 단어 타임스탬프 ${wordCount}개)`)
    results.push({ id: s.id, reference: s.text, hypothesis: hyp, wer: wer.wer, cer: cer.cer, ms, wordCount })
  }
  return results
}

async function runManifest(apiKey, manifestPath) {
  const raw = await readFile(manifestPath, 'utf-8')
  const entries = JSON.parse(raw)
  const results = []
  for (const e of entries) {
    process.stdout.write(`[${e.audioPath}] STT 전사 중...`)
    const audio = await readFile(e.audioPath)
    const t0 = Date.now()
    const data = await transcribe(apiKey, audio, e.audioPath, e.language)
    const ms = Date.now() - t0
    const hyp = data.text || ''
    const wer = wordErrorRate(e.referenceText, hyp)
    const cer = charErrorRate(e.referenceText, hyp)
    console.log(` 완료 (${ms}ms)`)
    results.push({ id: e.audioPath, reference: e.referenceText, hypothesis: hyp, wer: wer.wer, cer: cer.cer, ms })
  }
  return results
}

function printReport(results, mode) {
  console.log(`\n=== STT 정확도 리포트 (${mode} 모드, 모델: ${STT_MODEL}) ===\n`)
  const rows = results.map(r => ({
    샘플: r.id,
    WER: pct(r.wer),
    CER: pct(r.cer),
    '응답시간(ms)': r.ms,
  }))
  console.table(rows)
  const avgWer = results.reduce((a, r) => a + r.wer, 0) / results.length
  const avgCer = results.reduce((a, r) => a + r.cer, 0) / results.length
  console.log(`평균 WER: ${pct(avgWer)}  /  평균 CER: ${pct(avgCer)}`)
  console.log('\n오류가 있던 샘플의 정답↔인식 비교:')
  for (const r of results) {
    if (r.wer > 0) console.log(`  [${r.id}]\n    정답: ${r.reference}\n    인식: ${r.hypothesis}\n`)
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY 환경변수가 필요합니다. 예) OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs')
    process.exit(1)
  }
  const args = parseArgs(process.argv.slice(2))
  const results = args.manifest
    ? await runManifest(apiKey, args.manifest)
    : await runRoundTrip(apiKey, DEFAULT_SAMPLES)

  printReport(results, args.manifest ? 'manifest' : 'round-trip')

  if (args.out) {
    await writeFile(args.out, JSON.stringify(results, null, 2))
    console.log(`\n상세 결과 저장: ${args.out}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
