/**
 * AI 이미지 레터링 프리셋 — 스타일/위치/배경.
 * 선택 텍스트를 방송용 레터링(타이포)으로 렌더하는 gpt-image 프롬프트에 주입된다.
 * directive/prompt는 영어(모델 지시문). 폰트명 대신 일반 타이포 용어를 쓴다(gpt-image 권장).
 */

/** 레터링 스타일(방송/유튜브 등). directive = 타이포·색·트리트먼트 지시. */
export const LETTERING_STYLES = [
  { id: 'youtube', label: '유튜브 썸네일', directive: 'huge bold heavy sans-serif lettering, thick contrasting outline/stroke, strong drop shadow, high-saturation punchy colors, maximum legibility even at small size, clickbait thumbnail energy' },
  { id: 'news', label: '시사프로', directive: 'clean authoritative broadcast sans-serif, navy and white with a red accent, credible and serious news-graphic tone, crisp and restrained' },
  { id: 'promo', label: '프로모션', directive: 'sleek modern motion-graphic title, smooth gradient, dynamic premium look, glossy highlights' },
  { id: 'variety', label: '예능', directive: 'playful chunky rounded letters, colorful cutout/sticker caption style, bouncy energetic Korean variety-show subtitle vibe, cheerful' },
  { id: 'title', label: '타이틀(시네마틱)', directive: 'elegant minimal cinematic title, wide letter-spacing, refined and understated, subtle glow' },
  { id: 'travel', label: '해외여행', directive: 'airy warm travel-vlog lettering, tasteful handwritten script accents, postcard/sunny mood' },
  { id: 'finance', label: '경제프로', directive: 'crisp data-driven lettering, blue and green palette, ticker/chart motif accents, professional financial-news tone' },
  { id: 'breaking', label: '뉴스속보', directive: 'urgent breaking-news lettering, bold condensed white type on a red bar, high alarm energy' },
  { id: 'sports', label: '스포츠', directive: 'dynamic italic impact lettering, metallic/chrome sheen, high-energy stadium sports-broadcast feel' },
]

/**
 * 방송 위치 프리셋(방송 타이틀 모드). prompt = 배치 지시(타이틀 세이프 반영).
 * 세이프에어리어: 타이틀 세이프 90%(여백 ~5%). 로어서드는 하단 자막존.
 */
export const LETTERING_POSITIONS = [
  { id: 'lower-third', label: '하단 자막(로어서드)', prompt: 'placed in the lower-third band, horizontally centered, with its bottom edge about 8% above the frame bottom, entirely inside the title-safe area' },
  { id: 'top-center', label: '상단 중앙', prompt: 'placed as a headline across the top-center, inside the title-safe top margin (~5%)' },
  { id: 'center', label: '중앙(대형)', prompt: 'placed large and centered in the frame as a hero title' },
  { id: 'top-left', label: '좌상단', prompt: 'placed in the top-left corner within the title-safe margin (~5%)' },
  { id: 'top-right', label: '우상단', prompt: 'placed in the top-right corner within the title-safe margin (~5%)' },
  { id: 'bottom-left', label: '좌하단', prompt: 'placed in the bottom-left corner within the title-safe margin' },
  { id: 'bottom-right', label: '우하단', prompt: 'placed in the bottom-right corner within the title-safe margin' },
  { id: 'left', label: '좌측 세로', prompt: 'placed as a vertical panel along the left side, inside the title-safe area' },
  { id: 'right', label: '우측 세로', prompt: 'placed as a vertical panel along the right side, inside the title-safe area' },
  { id: 'full', label: '전체', prompt: 'filling the frame as a full-frame poster-style title' },
]

/** 배경 소스. 'scene'=캔버스 캡처(editImage), 'black'/'white'=단색 베이스(generateImage). */
export const LETTERING_BG = [
  { id: 'scene', label: '캔버스(씬 정합)', prompt: 'keep the existing background scene coherent behind the lettering' },
  { id: 'black', label: '검정 배경', prompt: 'on a solid pure black (#000000) background, nothing else' },
  { id: 'white', label: '흰 배경', prompt: 'on a solid pure white (#FFFFFF) background, nothing else' },
]

export const findLetteringStyle = (id) => LETTERING_STYLES.find(s => s.id === id) || LETTERING_STYLES[0]
export const findLetteringPosition = (id) => LETTERING_POSITIONS.find(p => p.id === id) || LETTERING_POSITIONS[0]
export const findLetteringBg = (id) => LETTERING_BG.find(b => b.id === id) || LETTERING_BG[0]
