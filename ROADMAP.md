# Float Editor Roadmap

> 목적: **PowerPoint 없이 발표 도구로 손색이 없는 브라우저 기반 슬라이드 편집기**

## 현황 요약

| 영역 | 상태 | 비고 |
|------|------|------|
| 편집 기반(선택/변형/정렬/스타일) | ✅ 견고 | 핵심 부분은 PowerPoint급 |
| 텍스트/도형/이미지/영상 콘텐츠 | ✅ 견고 | 리스트·링크·표·차트만 빠짐 |
| 페이지 관리 | ✅ 충분 | 썸네일 sorter view만 추가하면 완성 |
| 입출력(PPT/HTML/PNG/JSON) | ✅ 견고 | 다른 도구 대비 강점 |
| 발표 모드(Present) | ⚠️ **취약** | "슬라이드 넘김"만 됨 — 실제 강의에 부족 |
| 콘텐츠 표현력(표/차트/링크) | ❌ 빈 곳 | 강의자료 핵심 도구 미흡 |
| 협업/공유 | ❌ 없음 | 본 골드 목표 외 |

→ 가장 큰 부족: **발표 경험**(Phase 9) + **콘텐츠 다양성**(Phase 10)

## 작업 원칙

- **Phase별 브랜치** — 각 Phase는 `phase/<n>-<slug>` 브랜치에서 작업, 머지 시 README 업데이트
- **상세 설계 후 구현** — Phase 진입 시 본 문서의 항목별 데이터 모델·UI 스케치를 출발점으로 별도 설계 노트 작성
- **PowerPoint 호환 우선** — PPTX export 가능 여부를 가능한 항목마다 명시 (별도 폴리필 필요시 백엔드 변경 포함)
- **점진적 도입** — 한 Phase 안에서도 데이터 모델 → UI → 발표 모드 적용 순서로 이슈를 좁힘

---

## Done (Phase 1~8 + 최근 fix)

### Phase 1~7 (편집기 기초 — 기 완료)
텍스트 인라인 편집 → 복사/붙여넣기 → 속성 패널 → 다중 선택 → 스냅/정렬 → 컨텍스트 메뉴 → split 모드 동기화

### Phase 8 (최근 안정화 — 진행 중 마무리)
- 코드 블록 모드 도입 후 revert (복잡도 ↓, 일반 멀티라인 텍스트 유지)
- HTML 재로드 시 flat 변환 재트리거
- 화살표 끝 모양 / 원형 넘버링 flex 중앙 정렬
- split 모드 페이지 이동 iframe 동기화
- 프로젝트 소개 슬라이드 추가

### Recent fixes (별도 phase 미할당, 본 ROADMAP과 같은 브랜치 `fix/flat-icons-and-bullets`)
- **F1** `<li>` 독립 추출 시 list 마커 prefix (`• ` / `N. `, `list-style:none`이면 `::before` content fallback)
- **F2** `<i>` Font Awesome 글리프 인라인 보존 (`::before` content 디코드)
- **F3** 컨테이너 직속 `<i>` 글리프를 글리프 텍스트 요소로 흡수
- **F4** 외부 stylesheet `<link>`를 메인 문서·flat presenter에 자동 주입
- PPT export 버튼 최상단 툴바로 분리 (백엔드 가용성 표기)
- Open Source/Apache 2.0 `<span class="tag">` 박스를 독립 텍스트 요소로 추출 (visual badge 감지)
- Embedded inline `<code>`는 부모 텍스트에 inline HTML로 유지(겹침 방지)
- PPT 텍스트 런 `highlight` (코드 박스/배지 배경) 보존 + 슬라이드 배경에 알파 블렌딩
- 파일 트리 ` ` 들여쓰기 보존 (`trim()` 대신 ASCII 전용 trim)
- "재생성" 버튼이 전체 페이지 다시 변환 (`regenerateAllPages`)
- 로드 전 선택한 캔버스 해상도 유지 (loadHtml에서 canvasSize 강제 리셋 제거)

---

## Phase 9 — Presentation Core (Tier 1)

> 가장 임팩트 큰 페이즈. 완료 시 "발표 도구로 통용 가능" 임계점 통과.

### 9.1 발표자 노트 (Speaker Notes)

**목표** 각 페이지에 메모를 부착하고 발표자 뷰에서 표시.

**데이터 모델**
```js
// flatStore _pageCache[pageKey] 확장
{
  elements: FlatElement[],
  canvasSize: { w, h },
  fontImports: string[],
  history: HistoryState,
+ notes: string,            // 마크다운 지원 검토 (h1~h3, list, code, bold/italic)
+ notesUpdatedAt: number,   // 동시 편집 시 lastWrite-wins 충돌 처리용 (협업 단계 대비)
}
```
`ProjectSerializer` 직렬화 포맷 v2로 bump, 마이그레이션은 누락 시 빈 문자열로 폴백.

**UI 스케치**
- 편집 모드 우측 패널 하단에 토글 가능한 "노트" 영역 (높이 조절 가능 200px 기본).
- 마크다운 라이브 프리뷰 — 좌측 `<textarea>`, 우측 렌더 결과 (또는 single editor + 토글).
- PageBar 페이지 카드에 작은 메모 아이콘으로 노트 유무 시각화.

**의존성** 없음 (단독 진행 가능).

**단축키** `Ctrl+Shift+N` — 노트 패널 토글 / 포커스

**PPTX 호환** python-pptx `notesSlide.notes_text_frame` 으로 export 가능. exporter 측 직접 작성.

---

### 9.2 발표자 뷰 (Presenter View, 듀얼 스크린)

**목표** 청중 창에는 슬라이드만, 발표자 창에는 현재/다음/노트/타이머.

**데이터 모델** 없음 — 두 윈도우 간 동기화만.

**UI 스케치**
- 발표 모드 진입 시 "발표자 화면 열기" 버튼 노출 (단축키 `S`).
- 새 `window.open(...)` 으로 `/present/speaker?id=<sessionId>` 라우트.
- 발표자 창 레이아웃 (1280×720 권장):
  ```
  ┌─────────────────┬──────────────────┐
  │                 │   Next slide     │
  │ Current slide   │   (썸네일)        │
  │ (대형)          │                  │
  ├─────────────────┼──────────────────┤
  │                 │   Timer 12:34    │
  │                 │   Wall clock     │
  │   Notes         │   현재 시각       │
  │   (스크롤)       │                  │
  └─────────────────┴──────────────────┘
  ```

**의존성** 9.1(노트), 9.3(타이머), 9.4(트랜지션은 동기화 대상)

**구현 노트**
- 동기화: `BroadcastChannel('flat-present-<sessionId>')` 또는 `localStorage` storage 이벤트.
- 청중 창은 풀스크린 모드의 기존 FlatPresenter 재사용 + 외부 page 변경 메시지 수신.
- 발표자 창은 별도 `SpeakerView.jsx` 컴포넌트.

**단축키**
- `S` — 발표자 뷰 토글
- `B` — blank/black slide (청중 창만 검게)
- `W` — white slide

---

### 9.3 타이머/경과시간

**목표** 발표 시작 시각 기준 경과시간 + 현재 시계 + 옵션으로 카운트다운.

**데이터 모델** 발표 세션 상태 (휘발성, 페이지 데이터엔 없음).
```js
// flatStore 또는 별도 presentStore
present: {
  startedAt: number | null,   // performance.now() 또는 Date.now()
  countdownMs: number | null, // 지정한 발표 시간 (10분 → 600000)
  paused: boolean,
}
```

**UI 스케치**
- 발표자 뷰 우상단에 모노스페이스 타이머 `12:34` (mm:ss).
- 카운트다운 시 남은 시간이 0에 가까워지면 색상 변화 (>20% 초록, 10~20% 호박색, <10% 빨강).
- 시작/일시정지/리셋 버튼.

**단축키**
- `T` — 타이머 시작/정지 토글
- `Shift+T` — 리셋

**의존성** 9.2 (발표자 뷰에 표시)

---

### 9.4 슬라이드 트랜지션

**목표** 페이지 전환 시 fade / slide-left / none.

**데이터 모델**
```js
// 페이지 데이터에 추가 (또는 덱 전역 default + 페이지별 override)
{
  ...
+ transition: 'none' | 'fade' | 'slide-left' | 'slide-right', // 기본 'none'
+ transitionDurationMs: number, // 기본 300
}
```

**UI 스케치**
- 우측 패널 페이지 속성 섹션에 드롭다운 + duration slider.
- 발표 모드 페이지 전환 시 CSS transition으로 적용 (FlatPresenter에 wrapper 추가).

**구현 노트**
- 현재 슬라이드와 다음 슬라이드를 동시에 렌더, CSS `transform` 또는 `opacity` 애니메이션 후 이전 페이지 unmount.
- `prefers-reduced-motion` 대응 (none으로 강등).

**의존성** 없음 (FlatPresenter 단독 수정).

**PPTX 호환** OOXML `<p:transition>` 으로 export 가능. exporter.py 신규 함수.

---

### 9.5 클릭 빌드 (Build / Step animation)

**목표** 한 슬라이드 내에서 요소를 순차적으로 노출 ("다음" 키로 진행).

**데이터 모델**
```js
// FlatElement에 추가
{
  ...
+ buildOrder: number | null,  // 0,1,2... null=항상 표시. 같은 값은 동시.
+ buildAction: 'appear' | 'fade' | 'slide-up' | 'slide-left', // 기본 'fade'
}
```

**UI 스케치**
- 요소 선택 시 우측 패널에 "빌드 순서" 입력 + 액션 드롭다운.
- 캔버스에서 buildOrder가 설정된 요소엔 좌상단에 번호 배지 표시 (편집 시만).
- "다음" 키 횟수에 따라 발표 모드에서 0, 1, 2... 단계 진행. 모두 노출되면 다음 슬라이드.

**의존성** FlatPresenter 진행 상태 머신 추가.

**단축키 (편집 모드)**
- `Ctrl+Shift+B` — 선택 요소를 다음 빌드 단계로 (없으면 0부터)
- `Ctrl+Shift+Alt+B` — 선택 요소의 빌드 제거

**단축키 (발표 모드)**
- 기존 `Space`/`→`가 빌드 단계 진행으로 변경, 모두 끝나면 다음 슬라이드.

**PPTX 호환** OOXML `<p:timing>` `<p:par>` 트리 매우 복잡 — 1차 export는 *시작 즉시 표시* 로 단순화, 2차 라운드에서 fade-in 등 매핑.

---

### 9.6 발표 중 포인터/펜

**목표** 라이브 강의 중 강조·주석.

**데이터 모델** 휘발성 (저장 안 함).

**UI 스케치**
- `L` 단축키 → 마우스 따라다니는 빨간 원 (laser dot, 반경 ~10px, drop-shadow).
- `P` 단축키 → 펜 모드, 드래그하면 SVG path 그림 (default 빨강 3px). 슬라이드 전환 시 자동 클리어.
- `E` 단축키 → 지우개. `C` → 모두 지움.

**의존성** 9.2 (발표자 뷰에서도 미러링 표시, 청중 창은 실제 ink overlay)

**구현 노트**
- 청중 창 위에 절대 위치 SVG overlay (`pointer-events: none` 기본, 펜 모드 active 시 `all`).
- 펜 path는 `Map<slideKey, SVGPath[]>` 휘발성 유지, 슬라이드 떠나면 옵션 ('clear on leave' 기본 true).

---

### Phase 9 완료 기준
- 발표자 뷰에서 노트·타이머·다음 슬라이드를 동시에 보면서 청중 창은 깨끗하게 진행.
- 트랜지션·빌드가 OOXML로 export.
- 라이브 발표 중 포인터/펜 사용 가능.

---

## Phase 10 — Content Variety (Tier 2)

> 강의자료를 본격적으로 작성 가능하도록.

### 10.1 텍스트 리스트 인라인 편집

**현재** flat 추출은 `<li>` 마커를 텍스트 prefix로 보존(F1). 그러나 **인라인 에디터에서 새 리스트 작성·편집 안 됨**.

**데이터 모델** content가 rich HTML이면 `<ul>/<ol><li>` 그대로 보존 (이미 가능).

**UI 스케치**
- `FlatInlineEditor`에 `Tab`/`Enter`/`Shift+Tab` 처리:
  - Enter: 같은 레벨 새 `<li>`.
  - Tab: 한 단계 들여쓰기 (nested `<ul>` 생성).
  - Shift+Tab: 한 단계 내어쓰기.
- 속성 패널 텍스트 섹션에 "리스트 토글" 버튼 추가 (`• ` / `1.` / 없음 순환).

**의존성** 없음.

**단축키** `Ctrl+Shift+8` — bullet, `Ctrl+Shift+7` — numbered

---

### 10.2 하이퍼링크

**데이터 모델**
- 텍스트 내부: `<a href="...">` 인라인 보존 (rich HTML 경로).
- 도형/이미지 wrapper: FlatElement에 `link: { href, target }` 추가.

**UI 스케치**
- 텍스트 선택 후 `Ctrl+K` → URL 입력 다이얼로그.
- 도형/이미지 선택 후 속성 패널 "링크" 섹션.
- 편집 모드에선 클릭 시 선택, 발표 모드에선 클릭 시 `window.open(href, target)`.

**의존성** 9.2 (발표 모드 클릭 핸들러 갱신)

**단축키** `Ctrl+K`

---

### 10.3 표 (Table)

**목표** PowerPoint급은 아니라도 강의 비교표 작성 가능.

**데이터 모델**
```js
{
  type: 'table',
  rows: number,
  cols: number,
  cells: string[][],          // rich HTML 가능
  colWidths: number[] | null, // null=균등
  rowHeights: number[] | null,
  styles: {
    headerRow: boolean,
    altRow: 'none' | 'zebra',
    borderColor, borderWidth,
    cellPadding,
    headerStyles: {...},
  },
}
```

**UI 스케치**
- "표 삽입" → 행/열 그리드 picker.
- 셀 클릭 → 인라인 편집 (`FlatInlineEditor` 재사용, 셀 단위).
- 셀 선택(Shift+클릭) → 정렬·병합 액션.
- Tab/Shift+Tab 셀 이동.

**의존성** 10.1 (셀 내부 텍스트 편집 풍성하게)

**PPTX 호환** `slide.shapes.add_table(...)` — exporter.py 신규 함수, 1차 단순 행/열만.

---

### 10.4 차트

**목표** bar/line/pie 3종, 데이터 그리드 입력.

**데이터 모델**
```js
{
  type: 'chart',
  chartType: 'bar' | 'line' | 'pie',
  series: Array<{ name: string, values: number[] }>,
  categories: string[],   // x축 라벨
  styles: { palette: 'default'|'mono'|..., showLegend, showGrid, ... },
}
```

**UI 스케치**
- "차트 삽입" → 종류 선택 + 샘플 데이터 채워진 그리드 다이얼로그.
- 차트 더블클릭 → 데이터 편집 그리드 + 옵션 패널.
- 렌더는 SVG 직접 (외부 라이브러리 회피 — 번들 크기).

**의존성** 없음 (별도 모듈).

**PPTX 호환** python-pptx `add_chart` 사용 가능. 1차는 chart 이미지 렌더 후 `add_picture` 폴백.

---

### 10.5 수식

**구현** KaTeX 동적 import (지연 로드), 텍스트 요소 내 `$...$` 인라인 렌더링.

**우선순위** 낮음 (이공계 강의 한정).

---

### Phase 10 완료 기준
- 강의 자료를 새로 만들 때 PowerPoint를 열 필요가 없음.
- 리스트·표·차트·링크 모두 PPTX export 가능.

---

## Phase 11 — Editor UX (Tier 3)

### 11.1 슬라이드 sorter (썸네일 그리드)

**목표** 페이지 navigation/순서변경/복제 시각화.

**구현**
- PageBar를 토글 가능한 세 가지 뷰: filmstrip(현재) / sidebar 썸네일 / sorter grid.
- 썸네일은 캔버스 DOM을 `html-to-image` 또는 자체 SVG 캡처로 생성, 캐시.
- 드래그로 순서 변경, `Ctrl+드래그` 복제.

**의존성** 없음.

### 11.2 페이지 복제

- 단축키 `Ctrl+Shift+D` → 현재 페이지를 다음 인덱스로 복제 (모든 요소 deep clone, 새 ID 발급).

### 11.3 슬라이드 마스터/템플릿

- 데이터 모델: `templates: TemplatePage[]` (덱 전역).
- "현재 페이지를 템플릿으로 저장" / "템플릿에서 새 페이지" 액션.
- 마스터 페이지 별도(공통 요소 상속) — 복잡, 11.3보다 후순위.

### 11.4 룰러/그리드 시각화

- 토글 가능한 상·좌 룰러 (px 또는 % 단위).
- 토글 가능한 격자 (default 24px, 캔버스 크기 비례).

### 11.5 영구 그룹화

- 다중 선택 → `Ctrl+G` → `group` 타입의 컨테이너 FlatElement 생성 (자식 ID 보유).
- `Ctrl+Shift+G` 해제.

---

## Phase 12 — Output (Tier 4)

### 12.1 PDF 직접 export

- 1차: 전체 페이지 PNG export → PDF 결합 (jsPDF, 페이지당 한 장).
- 2차: SVG 텍스트 보존 벡터 PDF (선택성).
- 우측 발표 모드/Export 메뉴 "PDF 다운로드".

### 12.2 발표 녹화/내레이션

- `MediaRecorder` API + 화면 캡처 + 마이크.
- 노트 자동 자막화는 후순위.

### 12.3 핸드아웃/노트 인쇄

- "노트 보기" — 슬라이드 + 노트가 한 페이지에 (2× 또는 3×)
- "유인물" — 페이지당 N개 슬라이드 그리드 (2/4/6)
- 둘 다 PDF로 export.

### 12.4 정적 HTML 발표 강화

- FlatExporter 결과물에 키보드 네비/카운터/풀스크린 토글 자동 부착.
- 노트는 발표자 윈도우용 `?speaker` 라우트로 분리.

---

## Phase 13 — Collaboration (Tier 5)

> 본 도구의 단독 발표 목표 충족 후 검토.

### 13.1 실시간 멀티유저 편집

- CRDT (Yjs) + WebSocket 서버.
- 마우스 커서 미러링, 색상별 사용자 표시.

### 13.2 댓글

- 요소 단위 코멘트 스레드.
- 발표자 뷰에서 "리뷰 답글" 알림.

### 13.3 공유 링크

- "보기 전용" / "발표 모드" / "편집" 권한 분리.

---

## Phase 14 — Reusable Core (Packaging)

> 목표: **HTML 슬라이드 로딩 → flat 변환 → PPT export** 파이프라인을 다른 **브라우저 앱(React/Vue/바닐)** 에서 재사용 가능하도록 프레임워크 비의존 코어로 분리. (이번 라운드는 *설계 문서화*만, 구현은 별도 브랜치.)

### 14.0 현황 진단 (결합도 실측)

대부분 단계가 이미 React/Zustand와 분리되어 있고, 진짜 결합은 **입력 어댑터 1곳 + 저장소 호출부**에만 있다.

| 단계 | 파일 | React/Zustand | 브라우저 의존 | 재사용성 |
|------|------|---------------|---------------|----------|
| HTML 로딩/파싱 | `SlideParser.js` | 없음 | `DOMParser`만 | ✅ 그대로 |
| flat 변환 | `FlatExtractor.js` | 없음* | **iframe + `getBoundingClientRect`/`getComputedStyle`** | ⚠️ 시그니처만 변경 |
| HTML→런 변환 | `HtmlToTextRuns.js` | 없음 | `DOMParser`만 | ✅ 그대로 |
| PPT export (JS) | `PptExporter.js` | 없음 | 없음(pptxgenjs) | ✅ 그대로 |
| PPT export (서버) | `pptx-server/` | — | — | ✅ 이미 HTTP 서비스 |
| export 버튼/메뉴 | `*.jsx` | ✅✅ | — | ❌ 앱 어댑터로 잔류 |

\* `FlatExtractor`는 React를 import하지 않는다. `extractFlatElements(iframeRef)`로 **React ref**를 받을 뿐이라, `extractFlatElements(document, window)`로 바꾸면 코어로 분리된다. Zustand 결합은 `flatStore.js`의 *호출부*에만 있다.

**핵심 제약 — flat 변환은 실제 레이아웃 엔진이 필요하다.** `getBoundingClientRect`/`getComputedStyle`는 실제 렌더 결과를 읽으므로 jsdom으로는 불가. 다행히 **본 목표(브라우저 앱)** 에서는 브라우저가 레이아웃을 제공하므로 추가 부담이 없다. (서버/CLI 재사용은 Phase 14 범위 밖 — 그때는 Playwright 헤드리스 래퍼 필요.)

### 14.1 패키지 경계

```
packages/
  slide-core/                  ← 프레임워크 0 의존 (npm 배포 가능)
    src/
      slide-parser.js          (SlideParser 이동 — 무수정)
      flat-extractor.js        (extractFlatElements(document, window) 로 시그니처 변경)
      html-to-text-runs.js     (이동 — 무수정)
      ppt-exporter.js          (PptExporter 이동 — pptxgenjs는 peerDependency)
      gradient-parser.js       (GradientParser 이동)
      schema.js                ← FlatElement / ParsedDeck / ExportPayload 계약 + SCHEMA_VERSION
      index.js                 ← 공개 API 배럴
    package.json               (type:module, exports, peerDeps: pptxgenjs)
apps/
  float-editor/                ← 현재 앱. React 컴포넌트 + Zustand는 slide-core를 "호출만"
    src/store/flatStore.js     (extractFlatElements 어댑터: iframeRef → (doc, win) 풀어서 전달)
    src/components/*.jsx        (잔류)
services/
  pptx-server/                 ← 이미 독립. text_runs.py는 html-to-text-runs.js의 미러
```

리포 구조는 단순 폴더 분리(상대 import)로 시작하고, 외부 배포가 필요해지면 npm workspaces로 승격한다.

### 14.2 공개 API 표면 (`slide-core`)

```js
// 1) 로딩/파싱 (순수)
parseSlideDeck(deckHtml: string): { slides, globalStyles, slideCount }
wrapSlideAsDocument(slide, globalStyles): string

// 2) flat 변환 (DOM/레이아웃 필요 — 호출자가 렌더된 document/window 제공)
extractFlatElements(document: Document, window: Window):
  { elements: FlatElement[], canvasSize: { w, h } }

// 3) export
htmlToTextRuns(html, baseStyles?): TextRun[]
exportToPptx(pages, defaultCanvasSize): Promise<Blob|void>   // pptxgenjs 경로
buildExportPayload(pages, defaultCanvasSize): ExportPayload  // 서버 POST 본문 빌더(신규, 순수)

// 4) 계약
SCHEMA_VERSION: string
```

`buildExportPayload`를 코어로 끌어올려, **HTTP 호출(fetch)·다운로드 트리거는 앱**, **페이로드 구성은 코어**로 분리한다. (현재 `PptxBackendClient.js`가 둘을 섞고 있음.)

### 14.3 스키마 계약 (`schema.js`) — 재사용성의 실질적 핵심

지금 `HtmlToTextRuns.js`(JS)와 `text_runs.py`(Python)가 **같은 변환을 이중 구현**한다. 단계 간 데이터 형태를 한 곳에 버전과 함께 고정해야 두 구현·외부 앱이 같은 계약을 따르는지 보증된다.

- `FlatElement` 형태(아래) + `SCHEMA_VERSION` (예: `"flat-1"`).
- `ExportPayload` = `{ schemaVersion, pages: {[k]: {elements, canvasSize, fontImports}}, defaultCanvasSize, fonts }`.
- 단위 규약 명시: 좌표/크기 = CSS px, 폰트 = px(런 변환 시 ×0.75 → pt), 색 = 6자리 hex.
- JS↔Python 변환 규칙(색→hex, px→pt, font-family 첫 항목, rgba 불투명 블렌딩)을 **계약 문서**로 박제 → 두 구현의 회귀 테스트 기준.

```js
// FlatElement (현행 buildFlatElement 산출물 기준)
{
  id, sourceId, type: 'text'|'image'|'shape'|'svg'|'video',
  x, y, width, height, rotation, zIndex,
  content, isRich,
  styles: { backgroundColor, color, fontSize, fontFamily, ... },
  points?, link?,            // (Phase 10.2 이후)
}
```

### 14.4 단계별 작업 계획 (구현 시 — 별도 브랜치)

1. **`refactor/flat-extractor-signature`** — `extractFlatElements(iframeRef)` → `(document, window)`. `flatStore.js`에서 `iframeRef.current.contentDocument/contentWindow`를 풀어서 전달. **동작 무변경** 리팩터(회귀 확인 지점: flat 재생성·F1~F4 보존).
2. **`refactor/schema-module`** — `schema.js` 신설, `SCHEMA_VERSION`·타입 주석·단위 규약 작성. `buildExportPayload` 추출(`PptxBackendClient`에서 페이로드 구성 분리).
3. **`refactor/extract-slide-core`** — 위 순수 모듈들을 `packages/slide-core/`로 이동, `index.js` 배럴 + `package.json` 작성. 앱은 상대경로 import로 전환. (단순 이동 + import 경로 수정 위주.)
4. **(옵션) `docs/slide-core-readme`** — 외부 앱용 최소 사용 예제(파싱→iframe 렌더→추출→export) + JS/Python 계약 문서.

### 14.5 완료 기준
- 다른 브라우저 앱이 `slide-core`만 의존해 (자신의 iframe 렌더 결과로) flat 변환·PPT export를 수행 가능.
- React/Zustand 의존 코드가 `apps/float-editor/`에만 존재.
- `SCHEMA_VERSION`이 페이로드에 포함되고, JS·Python 두 export 경로가 같은 계약 문서를 참조.

**의존성** 없음(다른 Phase와 독립). 단, 진행 시 `refactor/flat-extractor-signature`를 먼저 머지해 다른 Phase의 회귀 위험을 줄인다.

---

## Phase별 의존성 그래프

```
Phase 8 (완료) ──┐
                 ├─→ Phase 9 (발표 코어)──┬─→ Phase 10 (콘텐츠)──┐
Recent fixes ────┘                        │                      ├─→ Phase 11 (UX) ──→ Phase 12 (출력) ──→ Phase 13 (협업)
                                          └──────────────────────┘
```

- Phase 9, 10은 병렬 가능 (서로 다른 표면).
- Phase 11은 Phase 9·10의 새 데이터 타입을 sorter/그룹화 대상에 포함해야 하므로 후행.

## 단축키 신규 추가 표 (Phase 9~11)

| 단축키 | 동작 | Phase |
|--------|------|-------|
| `Ctrl+Shift+N` | 발표자 노트 패널 토글 | 9.1 |
| `S` | 발표 모드에서 발표자 뷰 토글 | 9.2 |
| `B` | 발표 모드 — blank/black 슬라이드 | 9.2 |
| `W` | 발표 모드 — white 슬라이드 | 9.2 |
| `T` | 발표 모드 — 타이머 시작/정지 | 9.3 |
| `Shift+T` | 발표 모드 — 타이머 리셋 | 9.3 |
| `Ctrl+Shift+B` | 선택 요소 다음 빌드 단계로 | 9.5 |
| `Ctrl+Shift+Alt+B` | 선택 요소 빌드 제거 | 9.5 |
| `L` | 발표 모드 — laser pointer 토글 | 9.6 |
| `P` | 발표 모드 — 펜 토글 | 9.6 |
| `E` | 발표 모드 — 지우개 | 9.6 |
| `C` | 발표 모드 — 그림 모두 지움 | 9.6 |
| `Ctrl+Shift+8` | 텍스트 — bullet 리스트 토글 | 10.1 |
| `Ctrl+Shift+7` | 텍스트 — numbered 리스트 토글 | 10.1 |
| `Ctrl+K` | 하이퍼링크 추가/편집 | 10.2 |
| `Ctrl+Shift+D` | 페이지 복제 | 11.2 |
| `Ctrl+G` / `Ctrl+Shift+G` | 그룹화 / 해제 | 11.5 |

## 권장 첫 작업 (가장 임팩트 큰 페어)

**9.1 + 9.2 + 9.3** (노트 + 발표자 뷰 + 타이머) — 한 페이즈로 묶어 단일 PR.
- 한 번에 "발표 도구로 인식되는 임계점" 통과.
- 데이터 모델은 9.1만 추가 (노트 string), 나머진 UI 작업.
- 예상 분량 1~2주 (전업 기준), 2~3주 (파트타임 기준).

---

*이 문서는 살아있는 계획서입니다. Phase 진입 시 별도 설계 노트를 만들고 본 문서를 갱신해주세요.*
