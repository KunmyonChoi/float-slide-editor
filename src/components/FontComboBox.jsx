import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'

/**
 * 시스템 폰트 목록 — PPT 호환성을 위해 Windows/Mac 기본 설치 폰트 위주
 * 카테고리별로 분류하여 빠른 선택 지원
 */
const FONT_CATALOG = [
  {
    category: '한글 (시스템)',
    fonts: [
      { name: 'Malgun Gothic', label: '맑은 고딕' },
      { name: 'Apple SD Gothic Neo', label: 'Apple SD 고딕 Neo' },
      { name: 'Nanum Gothic', label: '나눔고딕' },
      { name: 'Nanum Myeongjo', label: '나눔명조' },
      { name: 'Noto Sans KR', label: 'Noto Sans KR' },
      { name: 'Pretendard', label: 'Pretendard' },
    ],
  },
  {
    category: '고딕 (Sans-serif)',
    fonts: [
      { name: 'Arial', label: 'Arial' },
      { name: 'Calibri', label: 'Calibri' },
      { name: 'Segoe UI', label: 'Segoe UI' },
      { name: 'Helvetica', label: 'Helvetica' },
      { name: 'Verdana', label: 'Verdana' },
      { name: 'Tahoma', label: 'Tahoma' },
      { name: 'Trebuchet MS', label: 'Trebuchet MS' },
      { name: 'Roboto', label: 'Roboto' },
      { name: 'Open Sans', label: 'Open Sans' },
    ],
  },
  {
    category: '명조 (Serif)',
    fonts: [
      { name: 'Times New Roman', label: 'Times New Roman' },
      { name: 'Georgia', label: 'Georgia' },
      { name: 'Cambria', label: 'Cambria' },
      { name: 'Palatino Linotype', label: 'Palatino' },
      { name: 'Book Antiqua', label: 'Book Antiqua' },
    ],
  },
  {
    category: '고정폭 (Monospace)',
    fonts: [
      { name: 'Courier New', label: 'Courier New' },
      { name: 'Consolas', label: 'Consolas' },
      { name: 'Fira Code', label: 'Fira Code' },
      { name: 'JetBrains Mono', label: 'JetBrains Mono' },
    ],
  },
  {
    category: '디스플레이',
    fonts: [
      { name: 'Impact', label: 'Impact' },
      { name: 'Comic Sans MS', label: 'Comic Sans MS' },
      { name: 'Lucida Console', label: 'Lucida Console' },
    ],
  },
]

// 전체 폰트 flat 배열 (검색용)
const ALL_FONTS = FONT_CATALOG.flatMap(cat => cat.fonts)

/**
 * FontComboBox — 텍스트 입력 + 드롭다운 폰트 선택
 * - 타이핑으로 필터링/검색
 * - 카테고리별 폰트 목록
 * - 폰트 미리보기 (해당 폰트로 렌더링)
 * - 직접 입력도 허용 (커스텀 폰트명)
 */
export default function FontComboBox({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const flatElements = useFlatStore(s => s.flatElements)

  // 현재 폰트명에서 첫 번째 폰트만 추출 (fallback 제거)
  const displayValue = (value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')

  // 현재 문서에서 사용 중인 폰트 수집 (카탈로그에 없는 것만)
  const catalogNames = useMemo(() => new Set(ALL_FONTS.map(f => f.name)), [])
  const docFonts = useMemo(() => {
    const found = new Set()
    for (const el of flatElements) {
      const ff = el.styles?.fontFamily
      if (!ff) continue
      const primary = ff.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
      if (primary && !catalogNames.has(primary)) found.add(primary)
    }
    return [...found].sort()
  }, [flatElements, catalogNames])

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleInputChange = useCallback((e) => {
    setQuery(e.target.value)
    if (!open) setOpen(true)
  }, [open])

  const handleInputFocus = useCallback(() => {
    setOpen(true)
    setQuery('')
  }, [])

  const handleSelect = useCallback((fontName) => {
    onChange(fontName)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }, [onChange])

  const handleKeyDown = useCallback((e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      // 직접 입력한 폰트명 적용
      const val = query.trim() || displayValue
      if (val) onChange(val)
      setOpen(false)
      setQuery('')
      e.target.blur()
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      e.target.blur()
    }
  }, [query, displayValue, onChange])

  // 문서 사용 폰트 카테고리 (카탈로그에 없는 것만)
  const docFontCategory = docFonts.length > 0
    ? { category: '현재 문서', fonts: docFonts.map(name => ({ name, label: name })) }
    : null

  // 필터링
  const lowerQuery = query.toLowerCase()
  const allCategories = docFontCategory ? [docFontCategory, ...FONT_CATALOG] : FONT_CATALOG
  const filtered = lowerQuery
    ? allCategories.map(cat => ({
        ...cat,
        fonts: cat.fonts.filter(f =>
          f.name.toLowerCase().includes(lowerQuery) ||
          f.label.toLowerCase().includes(lowerQuery)
        ),
      })).filter(cat => cat.fonts.length > 0)
    : allCategories

  return (
    <div ref={containerRef} className="relative">
      <p className="text-xs text-slate-500 mb-0.5">글꼴</p>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={open ? query : displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={displayValue || '폰트 검색...'}
          className="flex-1 min-w-0 text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors"
          style={{ fontFamily: displayValue || 'inherit' }}
        />
        <button
          onClick={() => { setOpen(!open); setQuery('') }}
          className="text-xs text-slate-400 bg-white/5 rounded-lg px-1.5 py-1.5 border border-white/10 hover:bg-white/10 transition-colors shrink-0"
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-slate-800 border border-white/10 rounded-lg shadow-xl">
          {filtered.length === 0 && query && (
            <div
              className="px-3 py-2 text-xs text-slate-400 hover:bg-white/5 cursor-pointer"
              onClick={() => handleSelect(query)}
            >
              "{query}" 직접 사용
            </div>
          )}
          {filtered.map(cat => (
            <div key={cat.category}>
              <div className="px-3 py-1 text-[10px] text-slate-500 bg-white/3 sticky top-0">
                {cat.category}
              </div>
              {cat.fonts.map(f => (
                <div
                  key={f.name}
                  className={`px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center justify-between ${
                    displayValue === f.name
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                  onClick={() => handleSelect(f.name)}
                >
                  <span style={{ fontFamily: `"${f.name}", sans-serif` }}>
                    {f.label}
                  </span>
                  {f.name !== f.label && (
                    <span className="text-[10px] text-slate-500 ml-2 truncate">
                      {f.name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 폰트 카탈로그를 외부에서 접근할 수 있도록 export */
export { FONT_CATALOG, ALL_FONTS }
