import { describe, it, expect } from 'vitest'
import {
  activeWordIndex, groupWordsIntoCues, cueIndexForTime,
  wordErrorRate, charErrorRate, presentationOrder,
} from '../core/karaoke'

const WORDS = [
  { word: '안녕하세요', start: 0.0, end: 0.8 },
  { word: '오늘은', start: 1.0, end: 1.4 },
  { word: '발표', start: 1.5, end: 1.9 },
  { word: '자막', start: 2.0, end: 2.3 },
  { word: '기능을', start: 2.4, end: 2.8 },
  { word: '소개합니다.', start: 2.9, end: 3.6 },
]

describe('activeWordIndex', () => {
  it('단어가 없으면 -1', () => {
    expect(activeWordIndex([], 1)).toBe(-1)
    expect(activeWordIndex(null, 1)).toBe(-1)
  })

  it('첫 단어 시작 전이면 -1', () => {
    expect(activeWordIndex(WORDS, -0.1)).toBe(-1)
  })

  it('정확히 어떤 단어의 start와 같으면 그 단어', () => {
    expect(activeWordIndex(WORDS, 1.0)).toBe(1)
  })

  it('단어 재생 구간 안이면 그 단어', () => {
    expect(activeWordIndex(WORDS, 1.7)).toBe(2) // '발표' [1.5,1.9)
  })

  it('침묵 구간(단어 사이 갭)에서도 직전 단어를 유지', () => {
    expect(activeWordIndex(WORDS, 0.9)).toBe(0) // '안녕하세요' 끝(0.8)~다음 시작(1.0) 사이
  })

  it('마지막 단어 이후에는 마지막 인덱스 유지', () => {
    expect(activeWordIndex(WORDS, 100)).toBe(WORDS.length - 1)
  })
})

describe('groupWordsIntoCues', () => {
  it('빈 입력은 빈 배열', () => {
    expect(groupWordsIntoCues([])).toEqual([])
    expect(groupWordsIntoCues(null)).toEqual([])
  })

  it('문장부호(마침표)로 끝나면 새 cue로 끊는다', () => {
    const cues = groupWordsIntoCues(WORDS, { maxWords: 100 })
    expect(cues).toHaveLength(1) // 이 샘플은 문장이 하나뿐(마지막에만 마침표)
    expect(cues[0].startIndex).toBe(0)
    expect(cues[0].endIndex).toBe(WORDS.length - 1)
    expect(cues[0].text).toContain('소개합니다.')
  })

  it('maxWords에 도달하면 문장 중간이라도 끊는다', () => {
    const cues = groupWordsIntoCues(WORDS, { maxWords: 3 })
    expect(cues.length).toBeGreaterThan(1)
    expect(cues[0].words).toHaveLength(3)
    expect(cues[0].startIndex).toBe(0)
    expect(cues[0].endIndex).toBe(2)
  })

  it('긴 침묵(pauseGapSec 초과)이 있으면 문장부호 없이도 끊는다', () => {
    const words = [
      { word: 'A', start: 0, end: 0.4 },
      { word: 'B', start: 0.5, end: 0.9 },
      { word: 'C', start: 5.0, end: 5.4 }, // B 끝(0.9) 이후 4.1초 침묵
    ]
    const cues = groupWordsIntoCues(words, { maxWords: 100, pauseGapSec: 1.0 })
    expect(cues).toHaveLength(2)
    expect(cues[0].words.map(w => w.word)).toEqual(['A', 'B'])
    expect(cues[1].words.map(w => w.word)).toEqual(['C'])
  })

  it('각 cue는 원본 단어 배열의 전역 인덱스를 보존한다(연속 커버리지 확인)', () => {
    const cues = groupWordsIntoCues(WORDS, { maxWords: 2 })
    let expected = 0
    for (const cue of cues) {
      expect(cue.startIndex).toBe(expected)
      expected = cue.endIndex + 1
    }
    expect(expected).toBe(WORDS.length)
  })
})

describe('cueIndexForTime', () => {
  const cues = groupWordsIntoCues(WORDS, { maxWords: 3 })

  it('빈 cue 목록이면 -1', () => {
    expect(cueIndexForTime([], 1)).toBe(-1)
  })

  it('첫 cue 시작 전이면 -1', () => {
    expect(cueIndexForTime(cues, -1)).toBe(-1)
  })

  it('각 cue 구간에서 해당 cue 인덱스를 반환', () => {
    expect(cueIndexForTime(cues, 0)).toBe(0)
    expect(cueIndexForTime(cues, cues[1].start)).toBe(1)
  })

  it('마지막 cue 이후에도 마지막 cue를 유지', () => {
    expect(cueIndexForTime(cues, 999)).toBe(cues.length - 1)
  })
})

describe('wordErrorRate', () => {
  it('완전 일치 → WER 0', () => {
    const r = wordErrorRate('안녕하세요 반갑습니다', '안녕하세요 반갑습니다')
    expect(r.wer).toBe(0)
    expect(r.substitutions + r.deletions + r.insertions).toBe(0)
  })

  it('대소문자·문장부호 차이는 무시', () => {
    const r = wordErrorRate('Hello, World!', 'hello world')
    expect(r.wer).toBe(0)
  })

  it('한 단어 치환', () => {
    const r = wordErrorRate('오늘 발표를 시작합니다', '오늘 발표를 종료합니다')
    expect(r.refWords).toBe(3)
    expect(r.substitutions).toBe(1)
    expect(r.wer).toBeCloseTo(1 / 3)
  })

  it('단어 삭제(STT 누락)', () => {
    const r = wordErrorRate('하나 둘 셋 넷', '하나 둘 넷')
    expect(r.deletions).toBe(1)
    expect(r.wer).toBeCloseTo(0.25)
  })

  it('단어 삽입(STT 환청)', () => {
    const r = wordErrorRate('하나 둘 셋', '하나 진짜 둘 셋')
    expect(r.insertions).toBe(1)
    expect(r.wer).toBeCloseTo(1 / 3)
  })

  it('reference가 비어있고 hypothesis도 비면 0, hypothesis 있으면 1', () => {
    expect(wordErrorRate('', '').wer).toBe(0)
    expect(wordErrorRate('', '뭔가 있음').wer).toBe(1)
  })

  it('hypothesis가 완전히 다르면 WER이 1에 가까움', () => {
    const r = wordErrorRate('가 나 다', 'X Y Z')
    expect(r.wer).toBe(1)
  })
})

describe('charErrorRate', () => {
  it('완전 일치 → CER 0', () => {
    expect(charErrorRate('안녕하세요', '안녕하세요').cer).toBe(0)
  })

  it('한 글자 치환(오타)', () => {
    const r = charErrorRate('안녕하세요', '안뇽하세요')
    expect(r.substitutions).toBe(1)
    expect(r.cer).toBeCloseTo(0.2)
  })

  it('공백 기본 제외 — 띄어쓰기 차이는 오류로 안 셈', () => {
    const r = charErrorRate('안녕 하세요', '안녕하세요')
    expect(r.cer).toBe(0)
  })

  it('includeSpaces:true면 띄어쓰기 차이도 오류', () => {
    const r = charErrorRate('안녕 하세요', '안녕하세요', { includeSpaces: true })
    expect(r.cer).toBeGreaterThan(0)
  })

  it('reference가 비어있으면 hypothesis 유무에 따라 0 또는 1', () => {
    expect(charErrorRate('', '').cer).toBe(0)
    expect(charErrorRate('', 'x').cer).toBe(1)
  })
})

describe('presentationOrder', () => {
  it('개수가 0 이하면 빈 배열', () => {
    expect(presentationOrder(0, 0)).toEqual([])
    expect(presentationOrder(2, -1)).toEqual([])
  })

  it('0에서 시작하면 그냥 순서대로', () => {
    expect(presentationOrder(0, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('중간에서 시작하면 끝까지 간 뒤 처음부터 순환', () => {
    expect(presentationOrder(2, 5)).toEqual([2, 3, 4, 0, 1])
  })

  it('마지막 슬라이드에서 시작해도 전체를 한 바퀴 돈다(Shift+F5로 마지막 페이지부터 발표하는 경우)', () => {
    expect(presentationOrder(4, 5)).toEqual([4, 0, 1, 2, 3])
  })

  it('범위를 벗어난 시작 인덱스는 모듈로 처리(음수 포함)', () => {
    expect(presentationOrder(5, 5)).toEqual([0, 1, 2, 3, 4]) // 5 % 5 = 0
    expect(presentationOrder(-1, 5)).toEqual([4, 0, 1, 2, 3])
  })

  it('슬라이드 1개면 그 인덱스만', () => {
    expect(presentationOrder(0, 1)).toEqual([0])
  })

  it('항상 0..count-1을 정확히 한 번씩 포함(중복/누락 없음)', () => {
    for (let start = 0; start < 6; start++) {
      const order = presentationOrder(start, 6)
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    }
  })
})
