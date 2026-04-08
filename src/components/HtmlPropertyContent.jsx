import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import StyleEditor from './StyleEditor'
import AlignmentControls from './AlignmentControls'
import Breadcrumb from './Breadcrumb'

const TYPE_LABEL = { text: '텍스트', image: '이미지', container: '컨테이너' }
const TYPE_COLOR = {
  text: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  image: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  container: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
}

/**
 * HtmlPropertyContent — HTML 모드 속성 패널 콘텐츠
 * PropertyPanel 셸 안에 렌더링된다.
 */
export default function HtmlPropertyContent() {
  const { selectedId, elements } = useEditorStore()
  const meta = selectedId ? elements.get(selectedId) : null

  if (!meta) return null

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${TYPE_COLOR[meta.type]}`}>
          {TYPE_LABEL[meta.type]}
        </span>
        <code className="text-xs text-slate-500">&lt;{meta.tag}&gt;</code>
      </div>
      <Breadcrumb id={meta.id} />
      <div>
        <p className="text-xs text-slate-500 mb-1">요소 ID</p>
        <p className="text-xs font-mono text-slate-300 bg-white/5 rounded px-2 py-1.5 truncate">
          {meta.id}
        </p>
      </div>
      {meta.type === 'text' && (
        <div className="pt-1 border-t border-white/5">
          <TextEditor id={meta.id} />
        </div>
      )}
      {meta.type === 'image' && (
        <div className="pt-1 border-t border-white/5">
          <ImageEditor id={meta.id} />
        </div>
      )}
      <div className="pt-1 border-t border-white/5">
        <AlignmentControls id={meta.id} />
      </div>
      <div className="pt-1 border-t border-white/5">
        <StyleEditor id={meta.id} />
      </div>
      <div className="pt-1 border-t border-white/5">
        <StructureControls id={meta.id} type={meta.type} />
      </div>
    </div>
  )
}

// ── 서브 컴포넌트 ───────────────────────────────────

function StructureControls({ id, type }) {
  const { moveElement, removeElement } = useEditorStore()

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">구조</p>
      <div className="flex gap-1.5">
        <button
          onClick={() => moveElement(id, -1)}
          className={structBtnClass}
          title="위로 이동"
        >
          <ArrowUpIcon />
        </button>
        <button
          onClick={() => moveElement(id, 1)}
          className={structBtnClass}
          title="아래로 이동"
        >
          <ArrowDownIcon />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => removeElement(id)}
          className="flex items-center justify-center text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg px-2.5 py-1.5 border border-red-500/20 transition-colors"
          title="요소 삭제"
        >
          <TrashIcon />
          <span className="ml-1">삭제</span>
        </button>
      </div>
    </div>
  )
}

const structBtnClass = 'flex items-center justify-center w-8 h-8 text-slate-400 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors'

function TextEditor({ id }) {
  const { readText, previewText, applyText } = useEditorStore()
  const [text, setText] = useState('')
  const originRef = useRef('')

  useEffect(() => {
    const current = readText(id)
    setText(current)
    originRef.current = current
  }, [id, readText])

  const handleChange = useCallback((e) => {
    const val = e.target.value
    setText(val)
    previewText(id, val)
  }, [id, previewText])

  const handleCommit = useCallback(() => {
    applyText(id, text)
  }, [id, text, applyText])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCommit()
      e.target.blur()
    }
    if (e.key === 'Escape') {
      setText(originRef.current)
      previewText(id, originRef.current)
      e.target.blur()
    }
  }, [handleCommit, id, previewText])

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">텍스트 편집</p>
      <textarea
        value={text}
        onChange={handleChange}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        rows={3}
        className="w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-2 border border-white/10 outline-none resize-none focus:border-indigo-500/50 transition-colors"
        style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
        placeholder="텍스트를 입력하세요"
      />
      <p className="text-xs text-slate-600">Enter 확정 · Shift+Enter 줄바꿈 · Esc 취소</p>
    </div>
  )
}

function ImageEditor({ id }) {
  const { readAttribute, applyAttribute } = useEditorStore()
  const fileRef = useRef(null)
  const [src, setSrc] = useState('')
  const [alt, setAlt] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  useEffect(() => {
    setSrc(readAttribute(id, 'src'))
    setAlt(readAttribute(id, 'alt'))
    setUrlInput('')
    setShowUrlInput(false)
  }, [id, readAttribute])

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result
      applyAttribute(id, 'src', dataUrl)
      setSrc(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [id, applyAttribute])

  const handleUrlApply = useCallback(() => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    applyAttribute(id, 'src', trimmed)
    setSrc(trimmed)
    setUrlInput('')
    setShowUrlInput(false)
  }, [id, urlInput, applyAttribute])

  const handleAltCommit = useCallback(() => {
    applyAttribute(id, 'alt', alt)
  }, [id, alt, applyAttribute])

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-slate-500">이미지 교체</p>

      <div
        className="w-full rounded-lg overflow-hidden border border-white/10"
        style={{ background: 'rgba(255,255,255,0.03)', maxHeight: 120 }}
      >
        <img
          src={src}
          alt={alt}
          style={{ width: '100%', maxHeight: 120, objectFit: 'contain', display: 'block' }}
          onError={(e) => { e.target.style.display = 'none' }}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 text-xs text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 border border-white/10 transition-colors"
        >
          파일 선택
        </button>
        <button
          onClick={() => setShowUrlInput(v => !v)}
          className="flex-1 text-xs text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 border border-white/10 transition-colors"
        >
          URL 입력
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {showUrlInput && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlApply()}
            placeholder="https://..."
            className="flex-1 text-xs text-slate-200 bg-white/5 rounded-lg px-2 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors"
          />
          <button
            onClick={handleUrlApply}
            className="text-xs text-indigo-300 bg-indigo-500/20 hover:bg-indigo-500/30 rounded-lg px-2.5 py-1.5 border border-indigo-500/30 transition-colors"
          >
            적용
          </button>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-slate-500">대체 텍스트 (alt)</p>
        <input
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onBlur={handleAltCommit}
          onKeyDown={(e) => e.key === 'Enter' && (handleAltCommit(), e.target.blur())}
          className="w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors"
          placeholder="이미지 설명"
        />
      </div>
    </div>
  )
}

// ── 아이콘 ─────────────────────────────────────────

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  )
}
