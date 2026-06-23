import { create } from 'zustand'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getApiKey, setApiKey, getModel, setModel, getImageModel, setImageModel } from '../core/OpenAIClient'
import {
  isLocalLlmEnabled, setLocalLlmEnabled, getLocalLlmModel, setLocalLlmModel,
  checkOllama, hasLocalModel, detectOS, ollamaInstall, ollamaServeWithOrigin,
} from '../core/LlmBackendClient'

/**
 * AI 설정 모달 — OpenAI(ChatGPT) API 키/모델 입력.
 *
 * 앱 어딘가에 <AiSettingsHost />를 한 번 마운트하고, 어디서든 openAiSettings()로 연다.
 * 키는 OpenAIClient가 localStorage에 보관한다(서버 없음).
 */

const useAiSettingsStore = create(() => ({ open: false }))

export function openAiSettings() {
  useAiSettingsStore.setState({ open: true })
}

function closeAiSettings() {
  useAiSettingsStore.setState({ open: false })
}

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
// 품질 차이가 커서 image-2 계통만 노출(생성=gpt-image-2; 편집은 미지원 시 1.5로 자동 폴백)
const IMAGE_MODEL_OPTIONS = ['gpt-image-2']

export function AiSettingsHost() {
  const open = useAiSettingsStore(s => s.open)
  if (!open) return null
  return <AiSettingsDialog />
}

function AiSettingsDialog() {
  // 열릴 때만 마운트 → 저장값을 useState 초기화로 읽는다(effect 불필요).
  const [key, setKey] = useState(() => getApiKey())
  const [model, setModelState] = useState(() => getModel())
  const [imageModel, setImageModelState] = useState(() => getImageModel())
  const [reveal, setReveal] = useState(false)
  const inputRef = useRef(null)

  // 로컬 LLM(Ollama)
  const [llmOn, setLlmOn] = useState(() => isLocalLlmEnabled())
  const [llmModel, setLlmModelState] = useState(() => getLocalLlmModel())
  const [llmStatus, setLlmStatus] = useState(null)
  const refreshLlm = useCallback(async () => { setLlmStatus(await checkOllama(true)) }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); refreshLlm() })
    return () => cancelAnimationFrame(id)
  }, [refreshLlm])

  const save = () => {
    setApiKey(key)
    setModel(model)
    setImageModel(imageModel)
    setLocalLlmEnabled(llmOn)
    setLocalLlmModel(llmModel)
    closeAiSettings()
  }

  const labelClass = { fontSize: 12, color: '#94a3b8', marginBottom: 4 }
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
    background: 'rgba(255,255,255,0.06)', color: '#f1f5f9',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, outline: 'none',
  }
  // 드롭다운 항목 — OS 기본 흰 배경에 밝은 글자가 묻히는 것 방지
  const optionStyle = { background: '#1e293b', color: '#f1f5f9' }

  return createPortal(
    <div
      onMouseDown={closeAiSettings}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(480px, 92vw)',
          background: 'rgba(15,23,42,0.98)', color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>AI 설정 (OpenAI)</div>

        <div>
          <div style={labelClass}>API 키</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type={reveal ? 'text' : 'password'}
              value={key}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
              style={{ ...fieldStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setReveal(v => !v)}
              style={{
                padding: '0 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
              }}
            >{reveal ? '숨김' : '표시'}</button>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
            키는 이 브라우저(localStorage)에만 저장되며 외부로 전송되지 않습니다(OpenAI 호출 시에만 사용).
            공용 PC에서는 사용 후 비워두는 것을 권장합니다.
          </div>
        </div>

        <div>
          <div style={labelClass}>텍스트 모델 (분석·프롬프트)</div>
          <select
            value={model}
            onChange={e => setModelState(e.target.value)}
            style={fieldStyle}
          >
            {MODEL_OPTIONS.map(m => <option key={m} value={m} style={optionStyle}>{m}</option>)}
            {!MODEL_OPTIONS.includes(model) && <option value={model} style={optionStyle}>{model}</option>}
          </select>
        </div>

        <div>
          <div style={labelClass}>이미지 모델 (이미지 생성)</div>
          <select
            value={imageModel}
            onChange={e => setImageModelState(e.target.value)}
            style={fieldStyle}
          >
            {IMAGE_MODEL_OPTIONS.map(m => <option key={m} value={m} style={optionStyle}>{m}</option>)}
            {!IMAGE_MODEL_OPTIONS.includes(imageModel) && <option value={imageModel} style={optionStyle}>{imageModel}</option>}
          </select>
        </div>

        {/* 로컬 LLM (Ollama) — 오프라인 텍스트 AI */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={llmOn} onChange={e => setLlmOn(e.target.checked)} />
            로컬 LLM 사용 (Ollama · 오프라인)
          </label>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
            켜면 텍스트 AI(요약·번역·프롬프트 등)가 로컬 Ollama로 동작(인터넷·OpenAI 키 불필요). 이미지 생성/편집은 OpenAI 유지.
          </div>
          {llmOn && (() => {
            const os = detectOS()
            const inst = ollamaInstall(os)
            const ready = llmStatus?.ok && hasLocalModel(llmModel)
            const codeStyle = { display: 'block', userSelect: 'text', fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '6px 8px', borderRadius: 6, marginTop: 4, wordBreak: 'break-all' }
            return (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <div style={labelClass}>모델</div>
                  <input value={llmModel} onChange={e => setLlmModelState(e.target.value)} placeholder="qwen2.5:14b" spellCheck={false} style={fieldStyle} />
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>품질 <code>qwen2.5:14b</code> · 가벼움 <code>qwen2.5:7b</code></div>
                </div>
                <div style={{ fontSize: 12 }}>
                  상태:{' '}
                  {!llmStatus ? '확인 중…'
                    : llmStatus.ok
                      ? <span style={{ color: ready ? '#16a34a' : '#d97706' }}>
                          실행 중 (v{llmStatus.version}{ready ? `, ${llmModel} 설치됨` : `, ${llmModel} 미설치`})
                        </span>
                      : <span style={{ color: '#dc2626' }}>미연결</span>}
                  <button type="button" onClick={refreshLlm} style={{ marginLeft: 8, fontSize: 11, padding: '1px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}>다시 확인</button>
                </div>
                {!ready && (
                  <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.6, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 }}>
                    <b>설치 안내 ({os})</b>
                    <div style={{ marginTop: 4 }}>① Ollama 설치:{inst.type === 'cmd'
                      ? <code style={codeStyle}>{inst.text}</code>
                      : <> <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" style={{ color: '#a5b4fc' }}>{inst.text}</a></>}</div>
                    <div style={{ marginTop: 6 }}>② 모델 받기:<code style={codeStyle}>ollama pull {llmModel}</code></div>
                    <div style={{ marginTop: 6 }}>③ 이 앱(공개 주소)이 호출하려면 Origin 허용 후 실행:<code style={codeStyle}>{ollamaServeWithOrigin()}</code></div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => { setApiKey(''); setKey('') }}
            style={{
              padding: '7px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8',
            }}
          >키 삭제</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={closeAiSettings}
              style={{
                padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1',
              }}
            >취소</button>
            <button
              type="button"
              onClick={save}
              style={{
                padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
                border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600,
              }}
            >저장</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
