import { useState } from 'react'

/**
 * EmojiPicker — 카테고리 탭 + 검색 그리드.
 * 인라인 편집 중 caret 위치에 이모지를 삽입하기 위한 팝오버.
 * - 이모지 버튼은 mousedown preventDefault로 에디터 포커스를 유지한다.
 * - 검색 input은 포커스를 가져가므로, 부모(FlatInlineEditor)가
 *   data-edit-accessory + blur relatedTarget 체크로 커밋을 보류한다.
 */

const CATEGORIES = [
  {
    label: '표정', icon: '😀',
    items: [
      { e: '😀', k: 'smile grin 웃음 미소' }, { e: '😃', k: 'happy 행복' },
      { e: '😄', k: 'laugh 웃음' }, { e: '😁', k: 'beam 활짝' },
      { e: '😆', k: 'lol 깔깔' }, { e: '😅', k: 'sweat 진땀' },
      { e: '😂', k: 'joy tears 눈물 웃음' }, { e: '🙂', k: 'slight 살짝' },
      { e: '😉', k: 'wink 윙크' }, { e: '😊', k: 'blush 수줍' },
      { e: '😍', k: 'love heart eyes 사랑' }, { e: '😘', k: 'kiss 뽀뽀' },
      { e: '😎', k: 'cool sunglasses 멋짐' }, { e: '🤔', k: 'think 생각 고민' },
      { e: '😴', k: 'sleep 잠' }, { e: '😢', k: 'cry 슬픔 눈물' },
      { e: '😭', k: 'sob 울음' }, { e: '😡', k: 'angry 화남' },
      { e: '🥳', k: 'party 축하' }, { e: '😱', k: 'scream 놀람' },
    ],
  },
  {
    label: '손/사람', icon: '👍',
    items: [
      { e: '👍', k: 'thumbs up good 좋아요 따봉' }, { e: '👎', k: 'thumbs down bad 싫어요' },
      { e: '👏', k: 'clap 박수' }, { e: '🙌', k: 'raise 만세' },
      { e: '🙏', k: 'pray thanks 감사 부탁' }, { e: '👌', k: 'ok 오케이' },
      { e: '✌️', k: 'victory peace 브이' }, { e: '🤝', k: 'handshake 악수' },
      { e: '💪', k: 'muscle strong 힘 근육' }, { e: '👈', k: 'left 왼쪽' },
      { e: '👉', k: 'right 오른쪽' }, { e: '👆', k: 'up 위' },
      { e: '👇', k: 'down 아래' }, { e: '👋', k: 'wave hi 안녕 인사' },
      { e: '🫶', k: 'heart hands 손하트' },
    ],
  },
  {
    label: '기호', icon: '❤️',
    items: [
      { e: '❤️', k: 'red heart love 빨강 하트 사랑' }, { e: '🧡', k: 'orange heart 주황' },
      { e: '💛', k: 'yellow heart 노랑' }, { e: '💚', k: 'green heart 초록' },
      { e: '💙', k: 'blue heart 파랑' }, { e: '💜', k: 'purple heart 보라' },
      { e: '🖤', k: 'black heart 검정' }, { e: '🤍', k: 'white heart 흰색' },
      { e: '💯', k: '100 perfect 백점' }, { e: '✅', k: 'check done 체크 완료' },
      { e: '❌', k: 'x cross wrong 엑스 틀림' }, { e: '⭐', k: 'star 별' },
      { e: '🔥', k: 'fire hot 불 인기' }, { e: '✨', k: 'sparkle 반짝' },
      { e: '💫', k: 'dizzy 별빛' }, { e: '❓', k: 'question 물음표' },
      { e: '❗', k: 'exclamation 느낌표' },
    ],
  },
  {
    label: '자연', icon: '🌈',
    items: [
      { e: '🌟', k: 'glow star 빛나는 별' }, { e: '🌈', k: 'rainbow 무지개' },
      { e: '☀️', k: 'sun 해 맑음' }, { e: '🌙', k: 'moon 달' },
      { e: '⚡', k: 'lightning 번개' }, { e: '❄️', k: 'snow 눈' },
      { e: '🐶', k: 'dog 개 강아지' }, { e: '🐱', k: 'cat 고양이' },
      { e: '🦊', k: 'fox 여우' }, { e: '🐻', k: 'bear 곰' },
      { e: '🐼', k: 'panda 판다' }, { e: '🌸', k: 'blossom 벚꽃' },
      { e: '🌺', k: 'flower 꽃' }, { e: '🍀', k: 'clover luck 클로버 행운' },
      { e: '🌍', k: 'earth world 지구' },
    ],
  },
  {
    label: '음식', icon: '🍕',
    items: [
      { e: '🍎', k: 'apple 사과' }, { e: '🍌', k: 'banana 바나나' },
      { e: '🍕', k: 'pizza 피자' }, { e: '🍔', k: 'burger 햄버거' },
      { e: '🍟', k: 'fries 감자튀김' }, { e: '🍣', k: 'sushi 초밥' },
      { e: '🍩', k: 'donut 도넛' }, { e: '🍰', k: 'cake 케이크' },
      { e: '☕', k: 'coffee 커피' }, { e: '🍺', k: 'beer 맥주' },
      { e: '🍷', k: 'wine 와인' }, { e: '🥂', k: 'cheers toast 건배' },
    ],
  },
  {
    label: '사물', icon: '🎉',
    items: [
      { e: '🎉', k: 'party tada 축하 파티' }, { e: '🎁', k: 'gift 선물' },
      { e: '🎈', k: 'balloon 풍선' }, { e: '🏆', k: 'trophy 우승 트로피' },
      { e: '🎯', k: 'target 목표 과녁' }, { e: '📌', k: 'pin 핀 고정' },
      { e: '📎', k: 'clip 클립' }, { e: '💡', k: 'idea bulb 아이디어 전구' },
      { e: '📈', k: 'chart up 상승 그래프' }, { e: '📉', k: 'chart down 하락' },
      { e: '🔔', k: 'bell 알림 종' }, { e: '💻', k: 'laptop 노트북' },
      { e: '📱', k: 'phone 폰' }, { e: '🚀', k: 'rocket 로켓' },
      { e: '⏰', k: 'clock alarm 시계 알람' },
    ],
  },
]

// 기호 — 이모지와 달리 텍스트 색/굵기/크기를 "상속"하는 일반 유니코드 문자
const SYMBOL_CATEGORIES = [
  {
    label: '화살표', icon: '→',
    items: [
      { e: '→', k: 'arrow right 오른쪽 화살표' }, { e: '←', k: 'arrow left 왼쪽' },
      { e: '↑', k: 'arrow up 위' }, { e: '↓', k: 'arrow down 아래' },
      { e: '↔', k: 'arrow leftright 좌우' }, { e: '↕', k: 'arrow updown 상하' },
      { e: '⇒', k: 'double arrow right 이중' }, { e: '⇐', k: 'double left' },
      { e: '⇔', k: 'double leftright 동치' }, { e: '➜', k: 'arrow heavy 굵은 화살표' },
      { e: '▶', k: 'play triangle right 재생' }, { e: '◀', k: 'triangle left' },
      { e: '▲', k: 'triangle up 위 삼각' }, { e: '▼', k: 'triangle down 아래 삼각' },
      { e: '↩', k: 'return back 되돌림' }, { e: '↪', k: 'forward 앞으로' },
    ],
  },
  {
    label: '원/번호', icon: '①',
    items: [
      { e: '①', k: 'circle 1 원 번호 일' }, { e: '②', k: 'circle 2 이' },
      { e: '③', k: 'circle 3 삼' }, { e: '④', k: 'circle 4 사' },
      { e: '⑤', k: 'circle 5 오' }, { e: '⑥', k: 'circle 6 육' },
      { e: '⑦', k: 'circle 7 칠' }, { e: '⑧', k: 'circle 8 팔' },
      { e: '⑨', k: 'circle 9 구' }, { e: '⑩', k: 'circle 10 십' },
      { e: '❶', k: 'filled circle 1 검정 원' }, { e: '❷', k: 'filled 2' },
      { e: '❸', k: 'filled 3' }, { e: 'ⓐ', k: 'circle a 원 에이' },
      { e: 'ⓑ', k: 'circle b' }, { e: 'ⓒ', k: 'circle c' },
      { e: 'Ⓐ', k: 'circle A 대문자' }, { e: 'Ⓑ', k: 'circle B' },
    ],
  },
  {
    label: '수학', icon: '×',
    items: [
      { e: '×', k: 'times multiply 곱하기' }, { e: '÷', k: 'divide 나누기' },
      { e: '±', k: 'plusminus 플러스마이너스' }, { e: '∓', k: 'minusplus' },
      { e: '≤', k: 'less equal 이하' }, { e: '≥', k: 'greater equal 이상' },
      { e: '≠', k: 'not equal 다름' }, { e: '≈', k: 'approx 근사' },
      { e: '∞', k: 'infinity 무한' }, { e: '√', k: 'sqrt root 루트' },
      { e: '∑', k: 'sum sigma 합' }, { e: '∏', k: 'product 곱' },
      { e: '∫', k: 'integral 적분' }, { e: 'π', k: 'pi 파이' },
      { e: '°', k: 'degree 도 각도' }, { e: '₩', k: 'won 원화' },
      { e: '$', k: 'dollar 달러' }, { e: '€', k: 'euro 유로' },
      { e: '£', k: 'pound 파운드' }, { e: '¥', k: 'yen 엔' },
      { e: '%', k: 'percent 퍼센트' }, { e: '‰', k: 'permil 퍼밀' },
    ],
  },
  {
    label: '기타', icon: '★',
    items: [
      { e: '★', k: 'star filled 별 채움' }, { e: '☆', k: 'star empty 빈 별' },
      { e: '✓', k: 'check 체크' }, { e: '✔', k: 'check heavy 굵은 체크' },
      { e: '✗', k: 'x cross 엑스' }, { e: '✘', k: 'x heavy' },
      { e: '•', k: 'bullet dot 점 불릿' }, { e: '▪', k: 'square small 작은 사각' },
      { e: '▫', k: 'square small empty' }, { e: '◆', k: 'diamond 다이아' },
      { e: '◇', k: 'diamond empty' }, { e: '■', k: 'square 사각' },
      { e: '□', k: 'square empty 빈 사각' }, { e: '§', k: 'section 섹션' },
      { e: '※', k: 'reference 참고 표' }, { e: '™', k: 'trademark 상표' },
      { e: '©', k: 'copyright 저작권' }, { e: '®', k: 'registered 등록' },
      { e: '…', k: 'ellipsis 줄임표' }, { e: '·', k: 'middle dot 가운뎃점' },
      { e: '「', k: 'bracket 낫표' }, { e: '」', k: 'bracket close' },
      { e: '『', k: 'bracket double 겹낫표' }, { e: '』', k: 'bracket double close' },
    ],
  },
]

const SEGMENTS = [
  { key: 'emoji', label: '이모지', categories: CATEGORIES },
  { key: 'symbol', label: '기호', categories: SYMBOL_CATEGORIES },
]

export default function EmojiPicker({ onPick, style }) {
  const [seg, setSeg] = useState(0)
  const [cat, setCat] = useState(0)
  const [query, setQuery] = useState('')

  const categories = SEGMENTS[seg].categories
  const segItems = categories.flatMap(c => c.items)
  const q = query.trim().toLowerCase()
  const items = q
    ? segItems.filter(it => it.e === q || it.k.toLowerCase().includes(q))
    : categories[cat].items

  const switchSeg = (i) => { setSeg(i); setCat(0) }

  // 이모지 버튼: mousedown preventDefault로 에디터 포커스/선택 유지
  const pick = (e) => (ev) => { ev.preventDefault(); onPick(e) }

  return (
    <div
      data-edit-accessory="true"
      onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault() }}
      style={{
        width: 264,
        background: 'rgba(15,23,42,0.98)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: 8,
        ...style,
      }}
    >
      {/* 세그먼트: 이모지 | 기호 */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
        {SEGMENTS.map((sg, i) => (
          <button
            key={sg.key}
            onMouseDown={(e) => { e.preventDefault(); switchSeg(i) }}
            style={{
              flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              color: i === seg ? '#fff' : '#94a3b8',
              background: i === seg ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)',
            }}
          >
            {sg.label}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={seg === 0 ? '이모지 검색 (예: 하트, fire)' : '기호 검색 (예: 화살표, 원)'}
        autoFocus
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 6,
          padding: '5px 8px', borderRadius: 6,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#e2e8f0', fontSize: 12, outline: 'none',
        }}
      />

      {/* 카테고리 탭 (검색 중엔 숨김) — 채워진 바로 묶어 제어영역임을 표시 */}
      {!q && (
        <div style={{
          display: 'flex', gap: 2, padding: 3, marginBottom: 6,
          background: 'rgba(255,255,255,0.05)', borderRadius: 7,
        }}>
          {categories.map((c, i) => (
            <button
              key={c.label}
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); setCat(i) }}
              style={{
                flex: 1, padding: '3px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                fontSize: 15, lineHeight: 1, color: '#e2e8f0',
                background: i === cat ? 'rgba(99,102,241,0.55)' : 'transparent',
              }}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      {/* 구분선 + 현재 섹션 라벨 (탭바와 그리드 경계 명확화) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid rgba(255,255,255,0.1)', padding: '5px 2px 4px', marginBottom: 2,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>
          {q ? '검색 결과' : categories[cat].label}
        </span>
        <span style={{ fontSize: 10, color: '#64748b' }}>{items.length}</span>
      </div>

      {/* 그리드 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1,
        maxHeight: 168, overflowY: 'auto', overflowX: 'hidden',
        scrollbarGutter: 'stable',
      }}>
        {items.map((it, i) => (
          <button
            key={it.e + i}
            title={it.k}
            onMouseDown={pick(it.e)}
            style={{
              padding: 4, borderRadius: 5, border: 'none', cursor: 'pointer',
              fontSize: 19, lineHeight: 1, background: 'transparent', color: '#e2e8f0',
              minWidth: 0, boxSizing: 'border-box', overflow: 'hidden',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {it.e}
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#64748b', fontSize: 12, padding: '16px 0' }}>
            결과 없음
          </div>
        )}
      </div>
    </div>
  )
}
