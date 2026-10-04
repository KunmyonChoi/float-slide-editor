/**
 * MusicInstallModal — 음악 생성(YuE2) 서버 설치 안내. CutoutInstallModal과 같은 구성.
 * YuE2는 Apple Silicon Mac의 GPU(MPS)에서만 검증했다 → macOS 네이티브 런처만 안내한다.
 * 서버가 localhost:8326에 뜨면 기능이 자동 연결된다.
 * status: 'missing'(서버 없음) | 'preparing'(서버는 떴지만 설치·모델 다운로드 중)
 */
import { createPortal } from 'react-dom'
import { MUSIC_DOWNLOADS, getMusicBase } from '../core/MusicBackendClient'
import { detectCutoutOS } from '../core/CutoutBackendClient'

export default function MusicInstallModal({ onClose, status = 'missing', detail = null }) {
  const os = detectCutoutOS()
  const isMac = os === 'mac'

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
          <div style={{ fontSize: 15, fontWeight: 700 }}>음악 생성 서버 설치</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {status === 'preparing' ? (
          <div style={{ fontSize: 12.5, color: '#fbbf24', lineHeight: 1.6 }}>
            서버는 실행 중이지만 아직 준비되지 않았습니다 — 모델(약 9 GB)을 받는 중이거나 설치가 끝나지 않았습니다.
            서버 창에 <b>설치 완료</b>가 표시된 뒤 다시 시도하세요.
            {detail && <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8', wordBreak: 'break-all' }}>{detail}</div>}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
            음악 생성은 <b style={{ color: '#cbd5e1' }}>YuE2</b> 모델을 내 컴퓨터의 GPU로 돌리는 로컬 서버가 필요합니다
            (데이터가 외부로 나가지 않습니다). 한 번만 설치하면 됩니다. 서버 주소 <b>{getMusicBase()}</b>
          </div>
        )}

        {!isMac && (
          <div style={{ fontSize: 12.5, color: '#fca5a5', lineHeight: 1.6 }}>
            지금은 <b>Apple Silicon(M1 이상) Mac</b>만 지원합니다. 현재 환경: <b>{os}</b>
          </div>
        )}

        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(99,102,241,0.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>네이티브 설치 (macOS · Apple GPU)</div>
          <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
            <li><a href={MUSIC_DOWNLOADS.mac} style={{ color: '#a5b4fc', fontWeight: 600 }} download>패키지 다운로드 (mac)</a></li>
            <li>압축 해제 후 <b>launch.command</b> 더블클릭</li>
            <li>
              미서명 경고로 차단되면: 우클릭 → "열기", 그래도 막히면
              <b> 시스템 설정 → 개인정보 보호 및 보안 → '보안' 섹션의 "그래도 열기"</b> 후 다시 실행하세요.
            </li>
            <li>첫 실행은 Python·torch·YuE2와 <b>모델 약 9 GB</b>(음악 생성 7.8 GB + 가사 정렬 1.3 GB)를 받습니다(회선에 따라 수십 분). 이후엔 바로 시작합니다.</li>
            <li>창에 <b>http://localhost:8326</b> 시작 표시가 뜨면 준비 완료 — 이 창에서 다시 시도하세요.</li>
          </ol>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
            메모리 16 GB 이상 권장 — 생성 중 GPU 메모리를 약 8 GB 씁니다. M1 기준 1분 분량에 10~13분이 걸립니다.
            디스크 여유 15 GB 이상이 필요합니다.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
