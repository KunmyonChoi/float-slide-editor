import { useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'

const EMBED_RE = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i

/**
 * MediaPreview — 속성 패널에서 오디오 요소는 미리듣기, 비디오 요소는 미리보기.
 *
 * 캔버스의 오디오 요소는 편집 중 정적 비주얼라이저라 소리를 들을 수 없고, 영상도 자동재생이 꺼져 있으면
 * 멈춘 프레임만 보인다. 발표에 들어가지 않고 내용을 확인하도록 기본 컨트롤 플레이어를 띄운다.
 * idb 참조는 BlobStore가 캐시한 blob URL로 푼다(해제는 BlobStore 몫). 임베드 영상(YouTube 등)은
 * 직접 재생할 수 없어 안내만 한다.
 */
export default function MediaPreview({ el }) {
  const content = el.content || ''
  const isIdb = BlobStore.isIdbRef(content)
  const isEmbed = el.type === 'video' && EMBED_RE.test(content)
  const [resolved, setResolved] = useState({ ref: null, url: null })

  useEffect(() => {
    if (!isIdb) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content))
      .then(u => { if (!cancelled) setResolved({ ref: content, url: u || null }) })
      .catch(() => { if (!cancelled) setResolved({ ref: content, url: null }) })
    return () => { cancelled = true }
  }, [content, isIdb])

  if (!content) return null
  if (isEmbed) {
    return <p className="text-[10px] text-slate-500">임베드 영상(YouTube 등)은 여기서 미리볼 수 없습니다 — 발표 모드에서 재생하세요.</p>
  }
  const url = isIdb ? (resolved.ref === content ? resolved.url : null) : content
  if (!url) {
    return <p className="text-[10px] text-slate-500">{isIdb && resolved.ref !== content ? '불러오는 중…' : '미디어를 불러올 수 없습니다.'}</p>
  }
  return el.type === 'audio'
    ? <audio key={url} src={url} controls preload="metadata" className="w-full" style={{ height: 36 }} />
    : (
      <video key={url} src={url} controls playsInline preload="metadata"
        className="w-full rounded" style={{ maxHeight: 200, background: '#000' }} />
    )
}
