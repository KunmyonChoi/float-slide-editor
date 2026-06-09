# SlideDeck 공개 계약 스펙 (v1.0)

PPTX 엔진의 **유일한 외부 API**. 소비 SW는 이 `SlideDeck` JSON만 만들어
엔진(Docker `dilly97/float-pptx` 또는 라이브러리)에 넘기면 `.pptx`를 얻는다.
내부 표현(FlatElement)은 어댑터 뒤에 숨겨져 있으므로 신경 쓸 필요 없다.

## 단위 규약
- 좌표·크기: **CSS px**, 좌상단(0,0) 기준.
- `style.fontSize`: **px 숫자**(예: `32`). 엔진이 ×0.75로 pt 변환.
- 색: **hex 문자열**(`#RRGGBB`). rgba가 필요하면 엔진이 배경 블렌딩 처리.
- `rotation`: 도(deg).

## 구조

```jsonc
{
  "schemaVersion": "1.0",                 // 필수. 엔진이 호환성 검증
  "canvasSize": { "w": 1280, "h": 720 },  // 덱 기본 크기
  "fonts": [                              // 선택. 임베딩용(없으면 시스템 폰트)
    { "type": "google-import", "url": "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700" },
    { "type": "font-face", "family": "Inter", "url": "https://.../inter.woff2", "weight": 400, "style": "normal" }
  ],
  "pages": [
    {
      "canvasSize": { "w": 1280, "h": 720 },   // 선택. 페이지 오버라이드
      "elements": [
        {
          "type": "text",                       // text | image | shape | svg
          "x": 100, "y": 80, "width": 600, "height": 80,
          "rotation": 0, "z": 1,
          "text": { "html": "<b>제목</b> 일반" },// type=text
          "link": { "href": "https://...", "target": "_blank" },
          "style": {
            "color": "#222222", "fontSize": 40, "fontFamily": "Noto Sans KR",
            "fontWeight": 700, "italic": false, "align": "center",
            "background": "#ffffff", "radius": 8,
            "padding": [8, 16, 8, 16], "lineHeight": 1.4, "opacity": 1
          }
        },
        { "type": "image", "x": 0, "y": 0, "width": 1280, "height": 720,
          "z": 0, "src": "data:image/png;base64,..." }
      ]
    }
  ]
}
```

### 타입별 필드
| type | 필수 | 비고 |
|---|---|---|
| `text` | `text.html`(또는 `text.plain`) | html은 인라인 서식(`<b>`,`<span style>`,`<ul>` 등) 허용 |
| `image` | `src` | `data:` 권장(서버는 외부 URL 미지원) |
| `svg` | `src` | `data:image/svg...` |
| `shape` | — | `points`로 선/도형 |

### style 키 (정제판 — 자주 쓰는 것)
`color, fontSize(px 숫자), fontFamily, fontWeight, italic, align,
background, radius, padding[t,r,b,l], lineHeight, opacity, shadow, gradient`
그 외 고급 CSS는 어댑터가 내부 표현으로 매핑(SPEC 확장 예정).

## 사용법

### 1) 빌더로 생성 (자체 모델 매핑)
```js
import { deck, page, text, image, validateDeck } from '@float/slide-contract/schema.js'

const d = deck({ canvasSize: { w: 1280, h: 720 },
  fonts: [{ type: 'google-import', url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700' }],
  pages: [
    page([
      image('data:image/png;base64,...', { x:0, y:0, width:1280, height:720, z:0 }),
      text('<b>안녕하세요</b>', { x:140, y:300, width:1000, height:120, z:1,
        style: { color:'#fff', fontSize:64, fontFamily:'Noto Sans KR', fontWeight:700, align:'center' } }),
    ]),
  ],
})
const { valid, errors } = validateDeck(d)
```

### 2) 엔진 호출 (Docker HTTP)
```bash
docker run -p 8321:8321 dilly97/float-pptx     # 엔진 실행

curl -X POST http://localhost:8321/api/export/pptx \
  -H 'Content-Type: application/json' \
  -d @deck.json --output out.pptx
```
> 전환기: 엔진은 공개 `SlideDeck`와 기존 internal payload를 모두 수용(14.4 ③).

## 버전
- `SCHEMA_VERSION = "1.0"`. 호환 불가 변경 시 major를 올린다.
- 엔진은 다른 버전 수신 시 경고하고 best-effort 처리.
