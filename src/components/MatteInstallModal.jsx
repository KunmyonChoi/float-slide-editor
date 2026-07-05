/**
 * MatteInstallModal — 영상 전경 분리(B2, 고품질) 서버(float-matte, RVM) 설치 안내.
 * 서버가 localhost:8325에 뜨면 기능이 자동 연결된다. (이미지용 CutoutInstallModal 미러)
 */
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { matteDockerRunCommand, getMatteBase, detectMatteOS } from '../core/VideoMatteBackendClient'

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

export default function MatteInstallModal({ onClose }) {
  const os = detectMatteOS()
  const gpu = os === 'linux'
  return createPortal(
    <div onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10070, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto',
          background: 'rgba(15,23,42,0.99)', color: '#e2e8f0', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>영상 전경 분리 서버 설치</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
          영상에서 사람만 남긴 <b style={{ color: '#cbd5e1' }}>투명 배경 영상(알파 WebM)</b>을 만드는 로컬 서버가
          필요합니다(RVM, 시간적 일관성). 브라우저 실시간 분리(속성 패널 ▸ 배경 제거 ▸ AI 자동)보다 품질이 높고
          결과가 베이크됩니다. 현재 환경: <b>{os}</b> · 서버 주소 <b>{getMatteBase()}</b>
        </div>

        <Section title="Docker로 실행" recommended>
          <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
            Docker가 설치돼 있으면 한 줄로 실행됩니다{gpu ? ' (NVIDIA GPU는 --gpus all로 가속)' : ''}:
          </div>
          <CopyRow text={matteDockerRunCommand({ gpu })} />
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            ⚠️ macOS·Windows의 Docker는 GPU를 못 써 CPU(느림)로 동작합니다. 최초 1회 토치·모델 다운로드(수 분).
          </div>
        </Section>

        <Section title="소스에서 직접 실행 (개발/서버)">
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            레포의 <b>video-matting-server/</b>에서(ffmpeg 필요). 학습 중 GPU를 피하려면 CPU 강제:
          </div>
          <CopyRow text={'CUDA_VISIBLE_DEVICES="" MATTE_DEVICE=cpu uvicorn server:app --port 8325'} />
        </Section>

        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          Safari는 투명 WebM을 지원하지 않습니다 — 그 경우 실시간 <b style={{ color: '#94a3b8' }}>AI 자동(B1)</b>을 사용하세요.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
