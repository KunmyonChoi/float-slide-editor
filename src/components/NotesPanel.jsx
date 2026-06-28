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
  const audioVolume = useFlatStore(s => s.pageNotesAudioVolume)

  const [open, setOpen] = useState(false)
  const [tone, setTone] = useState('friendly')
  const [length, setLength] = useState('medium')
  // 진행 중 작업 종류: 'draft'(AI 초안) | 'audio'(음성) | null. 각 버튼에 정확히 '생성 중' 표시.
  const [busyKind, setBusyKind] = useState(null)
  const busy = busyKind !== null
  const [err, setErr] = useState('')
  const [audioOpen, setAudioOpen] = useState(false)
  const [voice, setVoice] = useState(() => getTtsVoice())
  const [playing, setPlaying] = useState(false) // 미리듣기 재생 중 여부(토글·정지용)
  const [audioDragOver, setAudioDragOver] = useState(false) // mp3 드래그 오버(드롭존 하이라이트)
  const previewElRef = useRef(null) // 미리듣기용 단일 Audio (겹침 방지 위해 재사용)
  const audioFileRef = useRef(null) // 음성 직접 업로드용 숨김 input
  const taRef = useRef(null)

  // 단축키(\)로 열렸을 때만 텍스트영역에 포커스 — 버튼으로 열면 포커스 가로채지 않음
  useEffect(() => {
    if (collapsed) return
    if (useFlatStore.getState().notesAutofocus) {
      taRef.current?.focus()
      useFlatStore.setState({ notesAutofocus: false })
    }
  }, [collapsed])

  // 패널 언마운트 시 미리듣기 정지 — 조기 반환 전에 선언(훅 순서 고정)
  useEffect(() => () => { if (previewElRef.current) { try { previewElRef.current.pause() } catch { /* noop */ } } }, [])
  // 음성이 바뀌면(생성/업로드/삭제) 미리듣기 정지·상태 초기화
  useEffect(() => { if (previewElRef.current) { try { previewElRef.current.pause() } catch { /* noop */ } } setPlaying(false) }, [audioRef])
  // 재생 중 볼륨 슬라이더 변경을 라이브 반영
  useEffect(() => { if (previewElRef.current) previewElRef.current.volume = audioVolume ?? 1 }, [audioVolume])

  if (mode === 'present' || collapsed) return null

  const genCurrent = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusyKind('draft'); setErr(''); setOpen(false)
    try {
      const els = useFlatStore.getState().flatElements
      const d = slidePageDigest(els)
      const res = await generateSpeakerNotes({ slides: [{ index: 0, title: d.title, text: d.text }], tone, length })
      const text = res[0] ?? Object.values(res)[0] // 모델이 다른 index를 줘도 첫 값 사용
      if (text) setNotes(text)
      else setErr('생성 결과가 비어 있습니다.')
    } catch (e) {
      setErr(e.message || 'AI 생성 실패')
    } finally { setBusyKind(null) }
  }

  const genAll = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusyKind('draft'); setErr(''); setOpen(false)
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
    } finally { setBusyKind(null) }
  }

  const pickVoice = (v) => { setVoice(v); setTtsVoice(v) }

  const genAudioCurrent = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    const text = (useFlatStore.getState().pageNotes || '').trim()
    if (!text) { setErr('음성으로 만들 노트가 없습니다.'); return }
    setBusyKind('audio'); setErr(''); setAudioOpen(false)
    try {
      const blob = await synthesizeSpeech(text, { voice })
      const key = await BlobStore.put(blob)
      useFlatStore.getState().setPageNotesAudio(BlobStore.toRef(key), textHash(text))
    } catch (e) { setErr(e.message || '음성 생성 실패') } finally { setBusyKind(null) }
  }

  const genAudioAll = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    setBusyKind('audio'); setErr(''); setAudioOpen(false)
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
    } catch (e) { setErr(e.message || '음성 생성 실패') } finally { setBusyKind(null) }
  }

  // 미리듣기 토글 — 재생 중이면 정지, 아니면 처음부터 재생. 단일 Audio 재사용(겹침 방지).
  const previewAudio = async () => {
    if (!audioRef) return
    const a = previewElRef.current || (previewElRef.current = new Audio())
    if (playing) { a.pause(); setPlaying(false); return }
    try {
      const url = await BlobStore.getUrl(BlobStore.parseRef(audioRef))
      if (!url) return
      if (a.src !== url) a.src = url
      a.currentTime = 0
      a.volume = audioVolume ?? 1 // 발표 볼륨 슬라이더 반영(0이면 무음)
      a.onended = () => setPlaying(false)
      await a.play()
      setPlaying(true)
    } catch { setPlaying(false) }
  }

  // 음성 파일을 이 슬라이드 노트 음성으로 설정(업로드/드롭 공용). hash 빈값=노트변경 stale 제외.
  const setAudioFromFile = async (f) => {
    if (!f) return
    setBusyKind('audio'); setErr(''); setAudioOpen(false)
    try {
      const key = await BlobStore.put(f)
      useFlatStore.getState().setPageNotesAudio(BlobStore.toRef(key), '')
    } catch (err) { setErr(err.message || '업로드 실패') } finally { setBusyKind(null) }
  }
  const onUploadAudio = (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // 같은 파일 재선택 허용
    setAudioFromFile(f)
  }

  // 노트 영역에 mp3 드래그&드롭 → 업로드와 동일 처리. (캔버스 드롭=비주얼라이저와 별개 영역)
  const isAudioFile = (f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i.test(f.name)
  const onAudioDragOver = (e) => {
    if (!(e.dataTransfer?.types || []).includes('Files')) return // 텍스트 드래그는 기본 동작 유지
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    if (!audioDragOver) setAudioDragOver(true)
  }
  const onAudioDragLeave = () => setAudioDragOver(false)
  const onAudioDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return // 파일 아님 → 기본 동작(텍스트영역 입력)
    e.preventDefault(); setAudioDragOver(false)
    const audio = files.find(isAudioFile)
    if (audio) setAudioFromFile(audio)
    else setErr('음성 파일만 추가할 수 있습니다.')
  }
  // 음성 삭제 — 미리듣기 정지 후 이 페이지 음성 제거.
  const deleteAudio = () => {
    if (previewElRef.current) { try { previewElRef.current.pause() } catch { /* noop */ } }
    useFlatStore.getState().setPageNotesAudio(null, '')
    setAudioOpen(false)
  }

  // 스테일 판정: 생성 음성(hash 있음)만 노트변경과 비교. 업로드 음성(hash 빈값)은 제외.
  const audioStale = !!audioRef && !!audioHash && audioHash !== textHash((notes || '').trim())

  const sel = {
    background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 12,
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 6px', outline: 'none',
  }

  return (
    <div
      onDragOver={onAudioDragOver}
      onDragLeave={onAudioDragLeave}
      onDrop={onAudioDrop}
      style={{
        flexShrink: 0, background: '#0f172a', position: 'relative',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        outline: audioDragOver ? '2px dashed rgba(16,185,129,0.7)' : 'none', outlineOffset: -2,
      }}
    >
      {audioDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 150, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(16,185,129,0.10)', color: '#6ee7b7', fontSize: 13, fontWeight: 600,
        }}>🔊 음성 파일을 놓으면 이 슬라이드 노트 음성으로 추가됩니다</div>
      )}
      {/* AI 초안 + 음성 버튼(우하단 오버레이 — 텍스트 가림 최소화, 팝업은 위로 열림) */}
      {/* zIndex는 캔버스 배율 플로팅바(zIndex:60)보다 높게 — 팝업이 가려지지 않도록 */}
      <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 200, display: 'flex', gap: 6 }} data-export-ignore="true">
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
          >{busyKind === 'audio' ? '🔊 생성 중…' : `🔊 음성${audioStale ? ' ⚠' : ''} ▾`}</button>
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
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={previewAudio} style={{ flex: 1, ...sel, cursor: 'pointer', padding: '5px 0' }}>
                      {playing ? '⏸ 정지' : `▶ 미리듣기${audioStale ? ' ⚠' : ''}`}
                    </button>
                    <button onClick={deleteAudio} title="이 페이지 음성 삭제" style={{ ...sel, cursor: 'pointer', padding: '5px 8px', color: '#fca5a5' }}>🗑</button>
                  </div>
                  {/* 발표 재생 볼륨 — 0이면 영상(립싱크)이 소리 담당. 0이어도 자동진행은 동작 */}
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 28 }}>볼륨</span>
                    <input type="range" min="0" max="100" step="5" value={Math.round((audioVolume ?? 1) * 100)}
                      onChange={e => useFlatStore.getState().setPageNotesAudioVolume(Number(e.target.value) / 100)}
                      style={{ flex: 1, accentColor: '#10b981' }} />
                    <span style={{ width: 30, textAlign: 'right', color: '#cbd5e1' }}>{Math.round((audioVolume ?? 1) * 100)}%</span>
                  </label>
                  {(audioVolume ?? 1) === 0 && <p style={{ fontSize: 10, color: '#67738a', margin: 0 }}>무음 재생 — 영상이 소리를 담당(자동진행 유지)</p>}
                </>
              )}
              {audioStale && <p style={{ fontSize: 10, color: '#fbbd23', margin: 0 }}>노트가 변경됨 — 재생성 권장</p>}
              <div style={{ fontSize: 10.5, color: '#67738a' }}>AI 생성</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={genAudioCurrent} style={{ flex: 1, ...sel, background: 'rgba(16,185,129,0.22)', color: '#6ee7b7', cursor: 'pointer', padding: '6px 0' }}>현재 페이지</button>
                <button onClick={genAudioAll} style={{ flex: 1, ...sel, background: 'rgba(16,185,129,0.22)', color: '#6ee7b7', cursor: 'pointer', padding: '6px 0' }}>전체</button>
              </div>
              <div style={{ fontSize: 10.5, color: '#67738a' }}>또는 파일 사용</div>
              <button onClick={() => audioFileRef.current?.click()} style={{ ...sel, cursor: 'pointer', padding: '6px 0' }}>
                {audioRef ? '🔁 다른 파일로 교체' : '⬆ 음성 파일 업로드'}
              </button>
              <input ref={audioFileRef} type="file" accept="audio/*" onChange={onUploadAudio} style={{ display: 'none' }} />
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
        >✨ {busyKind === 'draft' ? '생성 중…' : 'AI 초안 ▾'}</button>
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
