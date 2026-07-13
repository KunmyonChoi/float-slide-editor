# AI 이미지 레터링 — 설계/계획

> 텍스트 요소를 선택하면 그 문구를 **방송용 위치·스타일의 레터링(타이포)**으로 렌더한 이미지를
> 생성한다. 기존 "설명으로 편집"(이미지 편집) 파이프라인을 재사용한다.
> 상태: **기획 확정(2026-07-13), 구현 착수.** 브랜치: `worktree-image-lettering`.

## 1. 개요 / 진입
- 텍스트 요소 단일 선택 시 `FlatAiBar`에 **"✨ 이미지 레터링 ▾"** 메뉴 추가.
- compose → loading → preview → apply FSM(기존 FlatImageAiBar 패턴 미러).

## 2. 확정 결정 (기획 세션)
1. **한글 렌더링 = AI 직접 레터링** — gpt-image-2가 텍스트를 그림. 부정확 대비 짧은 문구 유도 + 재생성.
2. **2가지 모드 모두 지원** (compose 상단 토글):
   - **제자리(기본)** — 선택 텍스트 박스 위치·크기에 생성 → 박스 영역 마스크로 `editImage` 제한 →
     박스 bbox 크롭 → 그 자리 이미지로 대체(기존 텍스트→이미지 교체 패턴). 위치 프리셋 불필요, 스타일만.
   - **방송 타이틀(풀캔버스)** — 선택 텍스트 숨겨 캡처 → 풀프레임 `editImage` → 풀캔버스 이미지 새 레이어.
     위치 프리셋 + 스타일.
3. **배경 소스 선택** (2모드 공통): `캔버스 캡처(씬 정합)` / `검정` / `흰색`.
4. **"글자만 남기기(투명 레터링)" — 3경로 모두 지원** (preview에서 선택):
   - **① 단색 배경 + 자동 크로마 키아웃** — gpt-image-2로 검정/흰 단색 배경에 생성 → 그 단색을
     크로마로 제거(기존 이미지 크로마 재사용). **무서버·안정**, 엣지 feather 보정. (단색 배경 시 기본)
   - **② gpt-image-1.5 투명 직접** — 모델을 전환해 `background:transparent` 네이티브 알파. 엣지 최상.
     (⚠️ **gpt-image-2는 투명 미지원** — OpenAI 문서 확정. 투명은 gpt-image-1 계열만.)
   - **③ cutout(BiRefNet `segmentImage`)** — 복잡/씬 배경. cutout-server 필요(없으면 설치 모달).

## 3. compose 패널
- 모드: `[제자리 | 방송 타이틀]`
- 배경: `[캔버스 캡처 · 검정 · 흰색]`
- 스타일 프리셋(아래) — 방송 타이틀이면 **위치 프리셋**도.
- 문구: 선택 텍스트 자동 채움(수정 가능, 짧게 권장 안내).

## 4. 프리셋
### 위치 (방송 타이틀 모드, 세이프에어리어 90%/여백5%)
로어서드(하단 자막바) · 좌/우상단 · 좌/우하단 · 상단중앙 · 중앙(대형) · 좌/우 세로 · 전체.

### 스타일 (각 = 레터링 directive; 폰트명 대신 일반 타이포 용어)
| id | label | directive 요지 |
|---|---|---|
| youtube | 유튜브 썸네일 | huge bold sans-serif, thick contrasting outline, drop shadow, high-saturation, max legibility |
| news | 시사프로 | clean authoritative sans-serif, navy/white/red, lower-third bar, serious/credible |
| promo | 프로모션 | sleek modern motion-graphic, gradient, dynamic, premium |
| variety | 예능 | playful chunky rounded letters, colorful cutout/sticker caption, energetic |
| title | 타이틀(시네마틱) | elegant minimal cinematic, wide letter-spacing, refined |
| travel | 해외여행 | airy warm, handwritten script accents, postcard/vlog mood |
| finance | 경제프로 | crisp data-driven, blue/green, ticker/chart motif, professional |
| breaking | 뉴스속보 | bold red "속보" bar, urgent, white condensed |
| sports | 스포츠 | dynamic italic, metallic/impact, stadium energy |

## 5. 프롬프트 설계 (verbatim 원칙 — 조사)
```
Render the text as stylized lettering: "<TEXT>".
Placement: <위치 지시(방송 타이틀) 또는 fill the frame(제자리)>.
Style: <스타일 directive>.
Background: <씬 유지 / solid black / solid white>.
Render the text VERBATIM exactly as written — no extra words, no duplicate text, no translation.
High contrast, legible. Keep it short.
```
- 텍스트 접근: `htmlToPlain(element.content)`.
- gpt-image 텍스트 렌더: 따옴표+verbatim, 짧게(3~5단어), 폰트명 지정 금지, 위치 명시.

## 6. 기술 아키텍처
### 재사용 (조사 완료 — file:line)
- 캡처: `captureElementRegion(bbox)` (`src/core/captureCanvasRegion.js`) → `ImageExporter.exportAsImage`(dom-to-image 2x).
- 편집/생성: `editImage(dataUrl,prompt,{width,height,mask})` / `generateImage(prompt,{...})` (`src/core/OpenAIClient.js`, gpt-image-2 기본; `IMAGE_ENDPOINT`, `getImageModel`).
- 투명: gpt-image-1.5 + `background:'transparent'`(body에 추가 필요) — generateImage에 background 파라미터 신설.
- 크로마 키아웃(①): `src/core/chromaKey.js` `applyChromaToImageData`/이미지 크로마 재사용.
- cutout(③): `segmentImage` (`src/core/CutoutBackendClient.js`), 설치 모달 `CutoutInstallModal`.
- 텍스트 바: `FlatAiBar.jsx` 드롭다운/compose/preview 패턴.
- 삽입: `BlobStore.toRef/put`, `addFlatElement`/`updateFlatElement`, `nextFlatId`.
- 스타일 배열 관례: `src/core/aiImageStyles.js` `IMAGE_STYLES`.

### 신규 (최소)
- `src/core/aiLetteringPresets.js` — `LETTERING_STYLES`, `LETTERING_POSITIONS`, `LETTERING_BG`.
- `src/core/letteringPrompt.js` — (mode, bg, position, style, text) → 프롬프트.
- `OpenAIClient.generateImage`에 `background` 옵션 추가(투명 경로 ②).
- `FlatAiBar` — "이미지 레터링" 메뉴 + compose 패널(모드·배경·위치·스타일) + preview(3경로 글자 분리).
- (선택) 결과 후처리 유틸: 단색 키아웃 bake(①), 크롭(제자리).

## 7. 단계 계획 (worktree 내 증분 커밋)
- **P0** 계획 문서(이 파일) 커밋.
- **P1** 프리셋 + 프롬프트 빌더 + `generateImage` background 옵션 (+ 유닛 테스트).
- **P2** FlatAiBar 메뉴 + compose 패널(모드·배경·스타일/위치) + 생성 파이프(캡처·edit/generate).
- **P3** preview: 재생성 + 글자만 남기기(①/②/③) + 적용(제자리 대체 / 새 레이어).
- **P4** 브라우저 검증(실 생성 몇 건 — 유효 OpenAI 키 필요), 리뷰, 머지.

## 8. 리스크
- **한글 렌더 정확도**(최대) → 짧은 문구·재생성.
- 유효 OpenAI 키 필요(현재 env 키 invalid) → 최종 품질 검증은 사용자 키로 인앱.
- ① 크로마 엣지 프린지 → feather/despill 보정. ② 모델 전환 시 품질/일관성 차이. ③ 서버 의존.
- 제자리 모드 배경 이중노출 → "글자만 남기기"로 투명화 시 해소.
