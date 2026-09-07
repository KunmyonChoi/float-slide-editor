import { useEffect } from 'react'

/**
 * 덱이 쓰는 @import 웹폰트를 문서 head에 주입한다 — 발표하는 창마다 따로 필요하다.
 * 청중 창에서 빠지면 그쪽에서만 글자가 달라 보인다.
 */
export function useWebFontImports(allPages, sortedKeys) {
  useEffect(() => {
    if (!allPages) return
    const allImports = new Set()
    for (const key of sortedKeys) {
      for (const imp of (allPages[key]?.fontImports || [])) allImports.add(imp)
    }
    const injected = []
    for (const imp of allImports) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        const href = urlMatch[1]
        if (document.querySelector(`link[href="${href}"]`)) continue
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.flatPresent = 'true'
        document.head.appendChild(link)
        injected.push(link)
      }
    }
    return () => { for (const el of injected) el.remove() }
  }, [allPages, sortedKeys])
}
