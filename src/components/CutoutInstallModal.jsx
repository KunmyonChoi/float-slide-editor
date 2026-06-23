/**
 * CutoutInstallModal — '피사체 뒤 텍스트'용 분리 서버 설치 안내(소스 없이 앱에서 자가설치).
 * OS를 감지해 권장 설치법을 먼저 보여준다:
 *   mac → 네이티브 런처(Apple GPU/MPS) / win → 네이티브 런처(NVIDIA CUDA) / linux·기타 → Docker
 * 어느 경우든 Docker 대안도 함께 제공. 서버가 localhost:8322에 뜨면 기능이 자동 연결된다.
 */
import { createPortal } from 'react-dom'
import { useState } from 'react'
import {
  CUTOUT_DOWNLOADS, detectCutoutOS, cutoutDockerRunCommand, getCutoutBase,
} from '../core/CutoutBackendClient'

function CopyRow({ text }) {
  const [done, setDone] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 6 }}>
      <code style={{
        flex: 1, fontSize: 11.5, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', userSelect: 'text',
        wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.12)',
      }}>{text}</code>
      <button
        onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
        style={{ fontSize: 12, padding: '0 10px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.85)', color: '#fff', whiteSpace: 'nowrap' }}
      >{done ? '복사됨' : '복사'}</button>
    </div>
  )
}

function Section({ title, children, recommended }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: recommended ? 'rgba(99,102,241,0.08)' : 'transparent' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
        {title}{recommended && <span style={{ marginLeft: 8, fontSize: 11, color: '#a5b4fc' }}>권장</span>}
      </div>
      {children}
    </div>
  )
}

function NativeSection({ os, recommended }) {
  const url = CUTOUT_DOWNLOADS[os]
  const isMac = os === 'mac'
  return (
    <Section title={isMac ? '네이티브 설치 (macOS · Apple GPU 가속)' : '네이티브 설치 (Windows · NVIDIA GPU 가속)'} recommended={recommended}>
      <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
        <li>
          <a href={url} style={{ color: '#a5b4fc', fontWeight: 600 }} download>
            패키지 다운로드 ({isMac ? 'mac' : 'windows'})
          </a>
        </li>
        <li>압축 해제 후 <b>{isMac ? 'launch.command' : 'launch.bat'}</b> 더블클릭</li>
        {isMac ? (
          <li>
            미서명 경고로 차단되면: 우클릭 → "열기"를 시도하고, 그래도 막히면
            <b> 시스템 설정 → 개인정보 보호 및 보안 → 아래 '보안' 섹션의 "그래도 열기"</b>를 누른 뒤 다시 실행하세요.
            그 후 Python·라이브러리·모델이 자동 설치됩니다.
          </li>
        ) : (
          <li>SmartScreen 경고 시 "추가 정보 → 실행". Python·라이브러리·모델이 자동 설치됩니다.</li>
        )}
        <li>검은 창에 <b>http://localhost:8322</b> 시작 표시가 뜨면 준비 완료 — 이 창에서 다시 시도하세요.</li>
      </ol>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
        런처가 <b>uv(파이썬 관리자)</b>를 자동 설치하고 <b>Python</b>까지 자동 확보합니다(둘 다 수동 설치 불필요).
        최초 1회만 수 분(토치·모델 다운로드), 이후엔 즉시 시작.
      </div>
      <details style={{ marginTop: 6, fontSize: 11.5, color: '#94a3b8' }}>
        <summary style={{ cursor: 'pointer' }}>자동 설치가 막히면 — uv를 먼저 수동 설치</summary>
        <div style={{ marginTop: 4 }}>
          아래를 {isMac ? '터미널' : 'PowerShell'}에 붙여 실행한 뒤, 다시 런처를 실행하세요. (Python은 uv가 알아서 받습니다.)
          <CopyRow text={isMac
            ? 'curl -LsSf https://astral.sh/uv/install.sh | sh'
            : 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'} />
        </div>
      </details>
    </Section>
  )
}

function DockerSection({ recommended, gpu }) {
  return (
    <Section title="Docker로 실행" recommended={recommended}>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
        Docker가 설치돼 있으면 한 줄로 실행됩니다{gpu ? ' (NVIDIA GPU는 --gpus all로 가속)' : ''}:
      </div>
      <CopyRow text={cutoutDockerRunCommand({ gpu })} />
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
        ⚠️ macOS·Windows의 Docker는 GPU를 쓸 수 없어 CPU(느림)로 동작합니다 — GPU가 필요하면 네이티브 설치를 권장.
      </div>
    </Section>
  )
}

export default function CutoutInstallModal({ onClose }) {
  const os = detectCutoutOS()
  const nativeOs = os === 'win' ? 'win' : 'mac' // 네이티브 런처 제공 OS
  const showNative = os === 'mac' || os === 'win'

  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10070, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto',
          background: 'rgba(15,23,42,0.99)', color: '#e2e8f0', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>피사체 분리 서버 설치</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
          "피사체 뒤 텍스트"는 이미지에서 인물/객체를 분리하는 로컬 서버가 필요합니다(데이터가 외부로 안 나가고 GPU로 빠름).
          아래 방법으로 한 번만 설치하면 됩니다. 현재 환경: <b>{os}</b> · 서버 주소 <b>{getCutoutBase()}</b>
        </div>

        {showNative && <NativeSection os={nativeOs} recommended />}
        <DockerSection recommended={!showNative} gpu={os === 'linux'} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
