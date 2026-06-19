import { useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { hasApiKey, generateSpeakerNotes, NOTES_TONES, NOTES_LENGTHS } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import { slidePageDigest } from '../core/slideTextDigest'

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

  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState('friendly')
  const [length, setLength] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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

  const sel = {
    background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 12,
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 6px', outline: 'none',
  }

  return (
    <div style={{ flexShrink: 0, background: '#0f172a', borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
      {/* AI 초안 버튼(우상단 오버레이) */}
      <div style={{ position: 'absolute', top: 6, right: 8, zIndex: 2 }} data-export-ignore="true">
        <button
          onClick={() => setOpen(o => !o)}
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
            position: 'absolute', top: 28, right: 0, padding: 10, width: 220,
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
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="이 슬라이드의 발표자 노트를 입력하세요…  (✨ AI 초안으로 자동 작성 가능)"
        autoFocus
        spellCheck={false}
        style={{
          display: 'block', width: '100%', height: 140, resize: 'vertical',
          boxSizing: 'border-box', margin: 0, padding: '8px 10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}
