/**
 * CutoutDevPage — 피사체 분리 서버(float-cutout) 개발 확인 페이지(실사용 UI 아님).
 * 접속: 개발 서버에서 `/?cutoutdev=1`
 *
 * 서버(BiRefNet, GPU)가 떠 있어야 한다 — cutout-server/README.md 참고.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import {
  segmentImage, checkCutoutBackend, getCutoutBase, getCutoutDevice,
  getCutoutBuild, cutoutDockerRunCommand,
} from '../core/CutoutBackendClient'

// 투명 영역이 보이도록 체커 배경
const CHECKER = {
  backgroundImage:
    'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0,0 10px,10px -10px,-10px 0',
  backgroundColor: '#fff',
}

export default function CutoutDevPage() {
  const [srcUrl, setSrcUrl] = useState(null)
  const [srcBlob, setSrcBlob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { url, ms }
  const [error, setError] = useState('')
  const [health, setHealth] = useState(null) // { ok, device, build }
  const resultUrlRef = useRef(null)

  const refreshHealth = useCallback(async () => {
    const ok = await checkCutoutBackend(true)
    setHealth({ ok, device: getCutoutDevice(), build: getCutoutBuild() })
  }, [])
  useEffect(() => { refreshHealth() }, [refreshHealth])

  const onFile = useCallback((e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setSrcBlob(f)
    setSrcUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
    setResult(null); setError('')
  }, [])

  const run = useCallback(async () => {
    if (!srcBlob || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      const r = await segmentImage(srcBlob)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = r.url
      setResult(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }, [srcBlob, busy])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif', userSelect: 'text', WebkitUserSelect: 'text' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>피사체 분리 서버 — 개발 확인 페이지</h1>
      <p style={{ color: '#64748b', fontSize: 13 }}>
        서버: <b>{getCutoutBase()}</b> · 상태:{' '}
        {!health ? '확인 중…'
          : health.ok
            ? <b style={{ color: '#16a34a' }}>정상 (device={health.device}, build={health.build})</b>
            : <b style={{ color: '#dc2626' }}>연결 안 됨</b>}
        &nbsp;<button onClick={refreshHealth} style={{ fontSize: 12, padding: '1px 8px' }}>재확인</button>
      </p>
      {health && !health.ok && (
        <p style={{ color: '#d97706', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          서버가 꺼져 있습니다. 실행:&nbsp;<code style={{ userSelect: 'text' }}>{cutoutDockerRunCommand()}</code>
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <input type="file" accept="image/*" onChange={onFile} />
        <button onClick={run} disabled={!srcBlob || busy}
          style={{ padding: '6px 14px', borderRadius: 8, background: busy ? '#94a3b8' : '#6366f1', color: '#fff', border: 0, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? '분리 중…' : '분리 실행'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#dc2626', fontSize: 13, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
          <button onClick={() => navigator.clipboard?.writeText(error)}
            style={{ marginRight: 8, fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', cursor: 'pointer' }}>
            오류 복사
          </button>
          오류: {error}
        </div>
      )}
      {result && <p style={{ color: '#16a34a', fontSize: 13 }}>완료 · {result.ms}ms</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
        <div>
          <p style={{ fontSize: 12, color: '#64748b' }}>원본</p>
          {srcUrl
            ? <img src={srcUrl} alt="원본" style={{ width: '100%', borderRadius: 8 }} />
            : <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: 8 }}>이미지를 선택하세요</div>}
        </div>
        <div>
          <p style={{ fontSize: 12, color: '#64748b' }}>전경 컷아웃(투명 배경)</p>
          {result
            ? <img src={result.url} alt="컷아웃" style={{ width: '100%', borderRadius: 8, ...CHECKER }} />
            : <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: 8 }}>결과 없음</div>}
        </div>
      </div>
    </div>
  )
}
