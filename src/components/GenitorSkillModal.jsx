import { create } from 'zustand'
import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Claude 슬라이드 스킬 설치 안내 모달 — 파일 메뉴에서 openGenitorSkill()로 연다.
 * Claude Code용 스킬 2종(genitor-slides, genitor-higgsfield)을 zip으로 내려받아
 * ~/.claude/skills/ 에 설치하는 방법을 안내한다. 스킬 원본은 /public/skills/ 에서 서빙된다.
 */
const useStore = create(() => ({ open: false }))
// eslint-disable-next-line react-refresh/only-export-components -- 모달 오프너(CapabilitiesModal와 동일 패턴)
export function openGenitorSkill() { useStore.setState({ open: true }) }
function close() { useStore.setState({ open: false }) }

// 배포 zip에 담길 스킬 목록(폴더명 = 스킬명). 원본은 public/skills/<name>/SKILL.md 로 서빙.
const SKILLS = [
  {
    name: 'genitor-slides',
    title: 'genitor-slides',
    desc: 'Claude(Design/Code/Web)에서 Genitor가 손실 없이 가져오는 형식으로 편집 가능한 슬라이드 덱 HTML을 작성하는 규약.',
  },
  {
    name: 'genitor-higgsfield',
    title: 'genitor-higgsfield',
    desc: 'Higgsfield AI 이미지·영상을 덱에 임베드하는 브리지. 생성은 공식 Higgsfield(Claude Code=CLI / Desktop=MCP 커넥터)에 위임하고, 임베딩 규약만 담당. genitor-slides에 의존하므로 함께 설치.',
  },
]

const base = import.meta.env.BASE_URL || '/'
const skillUrl = (name) => `${base}skills/${name}/SKILL.md`

async function fetchSkill(name) {
  const text = await fetch(skillUrl(name)).then(r => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`)
    return r.text()
  })
  return { name, text }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Claude Code용: 두 스킬을 폴더 2개 담은 하나의 zip으로 (unzip → ~/.claude/skills/).
async function downloadZip(setBusy) {
  setBusy('all')
  try {
    const files = await Promise.all(SKILLS.map(s => fetchSkill(s.name)))
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const f of files) zip.file(`${f.name}/SKILL.md`, f.text)
    triggerDownload(await zip.generateAsync({ type: 'blob' }), 'genitor-claude-skills.zip')
  } catch (e) {
    alert('스킬 파일을 준비하지 못했습니다: ' + (e?.message || e) + '\n아래 개별 다운로드 링크를 사용하세요.')
  } finally {
    setBusy(false)
  }
}

// Claude Desktop·웹(claude.ai)용: 스킬 하나만 담은 zip (Settings ▸ Features 업로드는 스킬당 zip).
async function downloadSkillZip(name, setBusy) {
  setBusy(name)
  try {
    const f = await fetchSkill(name)
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file(`${f.name}/SKILL.md`, f.text)
    triggerDownload(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
  } catch (e) {
    alert('스킬 zip을 준비하지 못했습니다: ' + (e?.message || e))
  } finally {
    setBusy(false)
  }
}

function CopyRow({ text }) {
  const [done, setDone] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 6 }}>
      <code style={{
        flex: 1, fontSize: 11.5, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', userSelect: 'text',
        wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.12)',
      }}>{text}</code>
      <button type="button"
        onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}
        style={{ fontSize: 12, padding: '0 10px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.85)', color: '#fff', whiteSpace: 'nowrap' }}
      >{done ? '복사됨' : '복사'}</button>
    </div>
  )
}

function Section({ title, badge, children }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
        {title}{badge && <span style={{ marginLeft: 8, fontSize: 11, color: '#a5b4fc' }}>{badge}</span>}
      </div>
      {children}
    </div>
  )
}

export function GenitorSkillHost() {
  const open = useStore(s => s.open)
  if (!open) return null
  return <Dialog />
}

function Dialog() {
  const [busy, setBusy] = useState(false)

  return createPortal(
    <div onMouseDown={close} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>✨ Claude 슬라이드 스킬</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.6 }}>
          <b style={{ color: '#cbd5e1' }}>Claude Code</b>(터미널) 또는 <b style={{ color: '#cbd5e1' }}>Claude Desktop·웹(claude.ai)</b>에
          설치하는 스킬입니다. Claude에게 “Genitor에서 편집할 슬라이드 만들어줘”라고 하면 이 규약대로 덱 HTML을 작성하고,
          필요하면 Higgsfield AI로 이미지·영상을 생성해 넣어 줍니다. 결과 HTML을 이 앱의
          <b style={{ color: '#cbd5e1' }}> 파일 ▸ 가져오기</b> 또는 캔버스에 붙여넣기(Ctrl/Cmd+V)로 가져오면 됩니다.
        </div>

        <Section title="1. 스킬 다운로드">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SKILLS.map(s => (
              <div key={s.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <button type="button" disabled={!!busy} onClick={() => downloadSkillZip(s.name, setBusy)}
                  style={{ ...ghostBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
                  {busy === s.name ? '준비 중…' : `⬇ ${s.title}.zip`}
                </button>
                <span style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>{s.desc}</span>
              </div>
            ))}
            <button type="button" disabled={!!busy} onClick={() => downloadZip(setBusy)}
              style={{ ...primaryBtn, alignSelf: 'flex-start', marginTop: 2, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
              {busy === 'all' ? '준비 중…' : '⬇ 두 스킬 함께 (Claude Code용 zip)'}
            </button>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              Claude Code는 <b style={{ color: '#94a3b8' }}>함께 zip</b>(폴더 2개)을, Claude Desktop·웹은
              <b style={{ color: '#94a3b8' }}> 스킬별 zip</b>을 받아 각각 업로드합니다(아래 참고).
            </div>
          </div>
        </Section>

        <Section title="2. Claude Code에 설치">
          <ol style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.75 }}>
            <li><b>genitor-claude-skills.zip</b> 압축 해제 (폴더 2개가 나옵니다).</li>
            <li>두 폴더를 아래 위치에 복사:
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                전역 사용 → <b>~/.claude/skills/</b> · 특정 프로젝트만 → 그 프로젝트의 <b>.claude/skills/</b>
              </div>
              <CopyRow text="mkdir -p ~/.claude/skills && unzip -o genitor-claude-skills.zip -d ~/.claude/skills/" />
            </li>
            <li>Claude Code를 재시작하면 스킬이 로드됩니다. “Genitor용 슬라이드 만들어줘”처럼 요청하면 자동 사용됩니다.</li>
          </ol>
        </Section>

        <Section title="3. Claude Desktop·웹(claude.ai)에 설치">
          <ol style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.75 }}>
            <li>위에서 <b>스킬별 zip</b>(genitor-slides.zip, genitor-higgsfield.zip)을 각각 내려받습니다.</li>
            <li><b>Settings ▸ Features</b>에서 커스텀 스킬로 <b>각 zip을 하나씩 업로드</b>합니다.
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                Pro·Max·Team·Enterprise 플랜 + 코드 실행(code execution) 활성화 필요. 스킬은 사용자별로 저장됩니다.
              </div>
            </li>
            <li>“Genitor용 슬라이드 만들어줘”처럼 요청하거나 <b>/</b>로 직접 호출하면 사용됩니다.</li>
          </ol>
        </Section>

        <Section title="4. Higgsfield 사전 준비" badge="AI 이미지·영상을 쓸 때만">
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            genitor-higgsfield는 생성을 <b style={{ color: '#cbd5e1' }}>공식 Higgsfield</b>에 위임합니다.
            환경에 따라 한쪽만 준비하면 됩니다(계정 로그인이면 되고 API 키는 필요 없습니다).
          </div>
          <div style={{ fontSize: 11.5, color: '#cbd5e1', marginTop: 10, fontWeight: 700 }}>Claude Code — CLI</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>① 설치 ② 로그인 ③ 워크스페이스 선택(미선택 시 명령 실패)</div>
          <CopyRow text="curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh" />
          <CopyRow text="higgsfield auth login" />
          <CopyRow text="higgsfield workspace list" />
          <CopyRow text="higgsfield workspace set <workspace_id>" />
          <div style={{ fontSize: 11.5, color: '#cbd5e1', marginTop: 12, fontWeight: 700 }}>Claude Desktop·웹 — MCP 커넥터</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.6 }}>
            <b>Settings ▸ Connectors ▸ Add custom connector</b>에 아래 URL을 넣고 Connect → Higgsfield 계정 로그인(OAuth).
          </div>
          <CopyRow text="https://mcp.higgsfield.ai/mcp" />
        </Section>

        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          가져온 덱의 원격 이미지·영상은 자동으로 앱 내부 저장소로 내려받아 자립형이 됩니다.
          영구 보존하려면 가져온 뒤 <b style={{ color: '#94a3b8' }}>프로젝트 저장(.flatproj)</b>을 권장합니다.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={close} style={primaryBtn}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(540px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
const ghostBtn = { padding: '5px 10px', fontSize: 12, borderRadius: 8, border: '1px solid rgba(129,140,248,0.5)', background: 'rgba(99,102,241,0.14)', color: '#c7d2fe', fontWeight: 600, whiteSpace: 'nowrap' }
