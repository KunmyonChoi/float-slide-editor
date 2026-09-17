import { describe, it, expect } from 'vitest'
import { alignWordsToReference, correctTranscriptWithNotes, alignTokens, MAX_ALIGN_CER } from '../core/captionAlign'

// STT 단어 만들기 — 0.5초 간격으로 늘어놓는다.
function sttWords(text) {
  return text.split(' ').map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }))
}

const NOTES = 'Genitor는 HTML 슬라이드를 직접 편집하는 도구입니다.'

describe('captionAlign — 노트 원문으로 STT 오인식 교정', () => {
  it('오인식된 고유명사를 노트 원문 표기로 바로잡는다', () => {
    const words = sttWords('제니터는 HTML 슬라이드를 직접 편집하는 도구입니다.')
    const { words: fixed, applied, changed } = alignWordsToReference(words, NOTES)

    expect(applied).toBe(true)
    expect(changed).toBeGreaterThan(0)
    expect(fixed.map(w => w.word).join(' ')).toBe(NOTES)
  })

  it('타임스탬프는 STT의 것을 그대로 살린다', () => {
    const words = sttWords('제니터는 HTML 슬라이드를 직접 편집하는 도구입니다.')
    const { words: fixed } = alignWordsToReference(words, NOTES)

    expect(fixed).toHaveLength(words.length)
    fixed.forEach((w, i) => {
      expect(w.start).toBeCloseTo(words[i].start, 5)
      expect(w.end).toBeCloseTo(words[i].end, 5)
    })
  })

  it('STT가 통째로 놓친 단어는 앞뒤 사이 시간을 나눠 끼워 넣는다', () => {
    // '직접'을 못 들은 경우
    const words = sttWords('Genitor는 HTML 슬라이드를 편집하는 도구입니다.')
    const { words: fixed } = alignWordsToReference(words, NOTES)

    expect(fixed.map(w => w.word).join(' ')).toBe(NOTES)
    const inserted = fixed.find(w => w.word === '직접')
    expect(inserted).toBeTruthy()
    // 앞 단어 끝 ≤ 끼워 넣은 단어 ≤ 뒤 단어 시작 (시간 순서가 깨지지 않는다)
    const idx = fixed.indexOf(inserted)
    expect(inserted.start).toBeGreaterThanOrEqual(fixed[idx - 1].end - 1e-6)
    expect(inserted.end).toBeLessThanOrEqual(fixed[idx + 1].start + 1e-6)
  })

  it('STT가 헛들은 군더더기 단어는 버리고 그 시간은 앞 단어가 물려받는다', () => {
    const words = sttWords('Genitor는 어 HTML 슬라이드를 직접 편집하는 도구입니다.')
    const { words: fixed } = alignWordsToReference(words, NOTES)

    expect(fixed.map(w => w.word).join(' ')).toBe(NOTES)
    // 버려진 '어'의 끝 시간(0.9)까지 앞 단어가 이어받아 자막에 빈 구간이 없다
    expect(fixed[0].end).toBeCloseTo(0.9, 5)
  })

  it('노트가 음성과 전혀 다르면 교정하지 않는다', () => {
    const words = sttWords('오늘 점심은 김치찌개를 먹었습니다.')
    const res = alignWordsToReference(words, NOTES)

    expect(res.applied).toBe(false)
    expect(res.reason).toBe('too-different')
    expect(res.cer).toBeGreaterThan(MAX_ALIGN_CER)
    expect(res.words).toEqual(words) // 원본 그대로
  })

  it('노트가 비어 있으면 손대지 않는다', () => {
    const words = sttWords('아무 말이나')
    expect(alignWordsToReference(words, '').applied).toBe(false)
    expect(alignWordsToReference(words, '   ').reason).toBe('no-reference')
  })

  it('정렬 연산은 일치/치환/삭제/삽입을 순서대로 낸다', () => {
    const ops = alignTokens(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])
    expect(ops.map(o => o.op)).toEqual(['match', 'sub', 'match', 'ins'])
  })
})

describe('correctTranscriptWithNotes — 저장 직전 단계', () => {
  it('교정 결과와 표시가 함께 남는다', () => {
    const transcript = { text: '제니터는 좋아요', words: sttWords('제니터는 좋아요'), language: 'ko' }
    const out = correctTranscriptWithNotes(transcript, 'Genitor는 좋아요')

    expect(out.text).toBe('Genitor는 좋아요')
    expect(out.notesAligned).toBe(true)
    expect(out.notesAlignChanged).toBeGreaterThan(0)
    expect(out.language).toBe('ko') // 나머지 필드는 보존
  })

  it('교정을 건너뛴 경우에도 이유를 남겨 다시 시도하지 않는다', () => {
    const transcript = { text: '완전히 다른 내용입니다', words: sttWords('완전히 다른 내용입니다') }
    const out = correctTranscriptWithNotes(transcript, NOTES)

    expect(out.notesAligned).toBe(false)
    expect(out.notesAlignSkipped).toBe('too-different')
    expect(out.words).toEqual(transcript.words)
  })

  it('단어가 없으면 그대로 돌려준다', () => {
    const t = { text: '', words: [] }
    expect(correctTranscriptWithNotes(t, NOTES)).toBe(t)
  })
})

describe('노트의 마크다운 기호는 자막에 실리지 않는다', () => {
  it('불릿·강조 표시를 벗겨서 맞춘다', () => {
    const notes = '- **핵심**\n- 두 번째 항목'
    const words = sttWords('핵심 두 번째 항목')
    const { words: fixed, applied } = alignWordsToReference(words, notes)

    expect(applied).toBe(true)
    expect(fixed.map(w => w.word)).toEqual(['핵심', '두', '번째', '항목'])
  })

  it('기호만 있는 토막은 자막 단어로 끼워 넣지 않는다', () => {
    const notes = '#  제목\n>  인용'
    const { words: fixed } = alignWordsToReference(sttWords('제목 인용'), notes)
    expect(fixed.map(w => w.word)).toEqual(['제목', '인용'])
  })
})

describe('비슷하게 들리는 낱말 오인식 (done ↔ dumb)', () => {
  const NOTE_EN = 'The package is done and ready to ship.'

  it('한 낱말만 잘못 들은 경우 그 낱말만 바로잡고 나머지는 건드리지 않는다', () => {
    const words = sttWords('The package is dumb and ready to ship.')
    const { words: fixed, applied, changed } = alignWordsToReference(words, NOTE_EN)

    expect(applied).toBe(true)
    expect(changed).toBe(1)
    expect(fixed.map(w => w.word).join(' ')).toBe(NOTE_EN)
  })

  it('바로잡은 낱말도 STT가 들려준 시각을 그대로 쓴다', () => {
    const words = sttWords('The package is dumb and ready to ship.')
    const { words: fixed } = alignWordsToReference(words, NOTE_EN)

    const dumb = words[3], done = fixed[3]
    expect(done.word).toBe('done')
    expect(done.start).toBe(dumb.start)
    expect(done.end).toBe(dumb.end)
  })

  it('노트가 그 한 문장뿐이어도(짧아서 CER이 튀어도) 교정한다', () => {
    const { words: fixed, applied } = alignWordsToReference(sttWords('package is dumb'), 'package is done')
    expect(applied).toBe(true)
    expect(fixed.map(w => w.word).join(' ')).toBe('package is done')
  })
})
