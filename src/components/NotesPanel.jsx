import { useState, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { hasApiKey, generateSpeakerNotes, NOTES_TONES, NOTES_LENGTHS, synthesizeSpeech, TTS_VOICES, getTtsVoice, setTtsVoice } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import { slidePageDigest } from '../core/slideTextDigest'
import { textHash } from '../core/textHash'
import { BlobStore } from '../core/BlobStore'

function sortKeys(pages) {
  return Object.keys(pages || {}).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || (aV || 0) - (bV || 0)
  })
}

/**
 * NotesPanel — 프리뷰 하단 발표자 노트 작성 영역(토글은 PageBar 좌측).
 * AI 발표 원고 초안 생성(현재/전체) 지원.
 */
export default function NotesPanel() {
  const mode = useEditorStore(s => s.mode)
  const notes = useFlatStore(s => s.pageNotes)
  const collapsed = useFlatStore(s => s.notesCollapsed)
  const setNotes = useFlatStore(s => s.setPageNotes)
  const audioRef = useFlatStore(s => s.pageNotesAudio)
  const audioHash = useFlatStore(s => s.pageNotesAudioHash)

  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState('friendly')
  const [length, setLength] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [audioOpen, setAudioOpen] = useState(false)
  const [voice, setVoice] = useState(() => getTtsVoice())
  const taRef = useRef(null)

  // 단축키(\)로 열렸을 때만 텍스트영역에 포커스 — 버튼으로 열면 포커스 가로채지 않음
  useEffect(() => {
    if (collapsed) return
    if (useFlatStore.getState().notesAutofocus) {
      taRef.current?.focus()
      useFlatStore.setState({ notesAutofocus: false })
    }
  }, [collapsed])

  if (mode === 'present' || collapsed) return null

  const genCurrent = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusy(true); setErr(''); setOpen(false)
    try {
      const els = useFlatStore.getState().flatElements
      const d = slidePageDigest(els)
      const res = await generateSpeakerNotes({ slides: [{ index: 0, title: d.title, text: d.text }], tone, length })
      const text = res[0] ?? Object.values(res)[0] // 모델이 다른 index를 줘도 첫 값 사용
      if (text) setNotes(text)
      else setErr('생성 결과가 비어 있습니다.')
    } catch (e) {
      setErr(e.message || 'AI 생성 실패')
    } finally { setBusy(false) }
  }

  const genAll = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusy(true); setErr(''); setOpen(false)
    try {
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      const keys = sortKeys(pages)
      const slides = keys.map((k, i) => {
        const d = slidePageDigest(pages[k].elements)
        return { index: i, title: d.title, text: d.text }
      })
      const byIndex = await generateSpeakerNotes({ slides, tone, length })
      const notesByKey = {}
      keys.forEach((k, i) => { if (byIndex[i] != null) notesByKey[k] = byIndex[i] })
      if (!Object.keys(notesByKey).length) { setErr('생성 결과가 비어 있습니다.'); return }
      useFlatStore.getState().applyNotesToPages(pages, notesByKey)
    } catch (e) {
      setErr(e.message || 'AI 생성 실패')
    } finally { setBusy(false) }
  }

  const pickVoice = (v) => { setVoice(v); setTtsVoice(v) }

  const genAudioCurrent = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    const text = (useFlatStore.getState().pageNotes || '').trim()
    if (!text) { setErr('음성으로 만들 노트가 없습니다.'); return }
    setBusy(true); setErr(''); setAudioOpen(false)
    try {
      const blob = await synthesizeSpeech(text, { voice })
      const key = await BlobStore.put(blob)
      useFlatStore.getState().setPageNotesAudio(BlobStore.toRef(key), textHash(text))
    } catch (e) { setErr(e.message || '음성 생성 실패') } finally { setBusy(false) }
  }

  const genAudioAll = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusy(true); setErr(''); setAudioOpen(false)
    try {
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      const audioByKey = {}
      for (const k of sortKeys(pages)) {
        const text = (pages[k].notes || '').trim()
        if (!text) continue
        const blob = await synthesizeSpeech(text, { voice })
        const key = await BlobStore.put(blob)
        audioByKey[k] = { ref: BlobStore.toRef(key), hash: textHash(text) }
      }
      if (!Object.keys(audioByKey).length) { setErr('음성으로 만들 노트가 없습니다.'); return }
      useFlatStore.getState().applyAudioToPages(audioByKey)
    } catch (e) { setErr(e.message || '음성 생성 실패') } finally { setBusy(false) }
  }

  const previewAudio = async () => {
    if (!audioRef) return
    try {
      const url = await BlobStore.getUrl(BlobStore.parseRef(audioRef))
      if (url) new Audio(url).play()
    } catch { /* 재생 실패 무시 */ }
  }

  // 스테일 판정은 생성 시와 동일하게 trim 기준으로 비교(공백 차이로 오탐 방지)
  const audioStale = !!audioRef && audioHash !== textHash((notes || '').trim())

  const sel = {
    background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 12,
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 6px', outline: 'none',
  }

  return (
    <div style={{ flexShrink: 0, background: '#0f172a', borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
      {/* AI 초안 + 음성 버튼(우하단 오버레이 — 텍스트 가림 최소화, 팝업은 위로 열림) */}
      <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 2, display: 'flex', gap: 6 }} data-export-ignore="true">
        {/* 음성(TTS) */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setAudioOpen(o => !o); setOpen(false) }}
            disabled={busy}
            title="발표자 노트 음성(TTS)"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
              background: audioRef && !audioStale ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
              border: '1px solid ' + (audioRef && !audioStale ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)'),
              borderRadius: 6, color: audioRef && !audioStale ? '#6ee7b7' : '#cbd5e1',
              fontSize: 12, cursor: busy ? 'default' : 'pointer',
            }}
          >🔊 음성{audioStale ? ' ⚠' : ''} ▾</button>
          {audioOpen && !busy && (
            <div style={{
              position: 'absolute', bottom: 30, right: 0, padding: 10, width: 210,
              background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                음성
                <select value={voice} onChange={e => pickVoice(e.target.value)} style={sel}>
                  {TTS_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
              {audioRef && (
                <button onClick={previewAudio} style={{ ...sel, cursor: 'pointer', padding: '5px 0' }}>
                  ▶ 미리듣기{audioStale ? ' (노트 변경됨 — 재생성 권장)' : ''}
                </button>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={genAudioCurrent} style={{ flex: 1, ...sel, background: 'rgba(16,185,129,0.22)', color: '#6ee7b7', cursor: 'pointer', padding: '6px 0' }}>현재 페이지</button>
                <button onClick={genAudioAll} style={{ flex: 1, ...sel, background: 'rgba(16,185,129,0.22)', color: '#6ee7b7', cursor: 'pointer', padding: '6px 0' }}>전체</button>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => { setOpen(o => !o); setAudioOpen(false) }}
          disabled={busy}
          title="AI 발표 원고 초안"
          style={{
            display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
            background: busy ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.22)',
            border: '1px solid rgba(99,102,241,0.4)', borderRadius: 6,
            color: '#c7d2fe', fontSize: 12, cursor: busy ? 'default' : 'pointer',
          }}
        >✨ {busy ? '생성 중…' : 'AI 초안 ▾'}</button>
        {open && !busy && (
          <div style={{
            position: 'absolute', bottom: 30, right: 0, padding: 10, width: 220,
            background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              톤
              <select value={tone} onChange={e => setTone(e.target.value)} style={sel}>
                {NOTES_TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              길이
              <select value={length} onChange={e => setLength(e.target.value)} style={sel}>
                {NOTES_LENGTHS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button onClick={genCurrent} style={{ flex: 1, ...sel, background: 'rgba(99,102,241,0.25)', color: '#c7d2fe', cursor: 'pointer', padding: '6px 0' }}>현재 페이지</button>
              <button onClick={genAll} style={{ flex: 1, ...sel, background: 'rgba(99,102,241,0.25)', color: '#c7d2fe', cursor: 'pointer', padding: '6px 0' }}>전체</button>
            </div>
            {notes.trim() && <p style={{ fontSize: 10, color: '#64748b', margin: 0 }}>기존 노트는 새 원고로 대체됩니다.</p>}
          </div>
        )}
      </div>

      {err && (
        <div style={{ padding: '4px 10px', color: '#fca5a5', fontSize: 11, background: 'rgba(239,68,68,0.08)' }}>{err}</div>
      )}

      <textarea
        ref={taRef}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() } }}
        placeholder="이 슬라이드의 발표자 노트를 입력하세요…  (✨ AI 초안으로 자동 작성 가능)"
        spellCheck={false}
        style={{
          display: 'block', width: '100%', height: 140, resize: 'vertical',
          boxSizing: 'border-box', margin: 0, padding: '8px 10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0,
          color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}
