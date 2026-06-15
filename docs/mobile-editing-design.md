# 모바일 텍스트 편집 & 상호작용 개선 — 2층 설계

> 상태: 설계(미구현). 데스크톱 동작 무회귀를 전제로, 모바일(`pointer: coarse`)만 분기한다.

## 0. 배경 — 해결할 현상

| # | 현상 | 근본 원인 | 관련 코드 |
|---|---|---|---|
| ① | 텍스트 더블탭 진입 시 **전체선택** → 플로팅 메뉴가 글씨 가림 | 진입 시 무조건 `selectNodeContents`+`addRange` | `FlatInlineEditor.jsx:99-104` |
| ② | 가상 키보드가 열리며 화면이 밀리고 **플로팅 메뉴가 텍스트를 가림** | 메뉴 위치를 `window.innerHeight` 기준 `position:fixed`로 계산, `visualViewport` 미사용 | `FlatInlineEditor.jsx:476-481, 487-539`, `FlatAiBar.jsx:138-148` |
| ③ | 컨텍스트 메뉴가 뜬 상태에서 다른 요소 탭 → **플로팅 메뉴 중첩** | 닫힘 감지가 `mousedown`만 청취(터치 미동작) + 단일-오버레이 원칙 부재 | `FlatContextMenu.jsx:96` |
| — | (모바일) 롱프레스가 **컨텍스트 메뉴 / 텍스트 단어선택** 두 의미로 과부하 | 모바일에서 `contextmenu` 이벤트가 롱프레스로 발생 | `FlatCanvas.jsx:804-816, 829` |
| — | (모바일) **다중선택 불가** | Shift 키가 없음 | — |

## 1. 설계 원칙

1. **데스크톱 무회귀** — 모든 신동작은 `pointer: coarse`(터치)에서만. 마우스/펜은 기존 그대로.
2. **제스처 과부하 제거** — 모호한 롱프레스 대신 **명시적 버튼**. 롱프레스는 "편집 중 텍스트 단어선택"만 남긴다.
3. **단일 활성 오버레이** — 한 번에 하나의 컨텍스트/팝오버만. 새로 열 때 나머지 닫음. 닫힘 감지는 `pointerdown`(공용).
4. **키보드 인지** — 떠다니는 UI는 `visualViewport` 가시영역 안에서만 배치(키보드 위 도킹).

---

## 2. 하부 — 공통 인프라 (Layer 1)

### 2.1 터치 분기 `isCoarsePointer()` / `useIsTouch()`
- 신규 `src/core/pointerEnv.js`
  - `isCoarsePointer()` = `window.matchMedia('(pointer: coarse)').matches`
  - `useIsTouch()` — 위를 구독해 리액티브하게 반환(데스크톱+터치 겸용 기기 대응; `change` 이벤트 구독).
- UA 스니핑 금지. 기능 감지만 사용.

### 2.2 `useVisualViewport()` 훅
- 신규 `src/components/useVisualViewport.js`
- 반환: `{ height, offsetTop, keyboardOverlap, isKeyboardOpen }`
  - `vv = window.visualViewport`
  - `keyboardOverlap = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height))` — 레이아웃 뷰포트에서 키보드가 가린 하단 px.
  - `isKeyboardOpen = keyboardOverlap > 120`(휴리스틱).
- `vv`의 `resize`/`scroll` 구독, `requestAnimationFrame`으로 throttle. `vv` 미지원 환경은 `{ keyboardOverlap:0, isKeyboardOpen:false }` 폴백.
- 떠다니는 UI 공통 배치 규칙:
  - **하단 고정 요소**: `position: fixed; bottom: max(keyboardOverlap, env(safe-area-inset-bottom))`.
  - **선택 위 도킹 요소**: top을 `[vv.offsetTop+8, vv.offsetTop+vv.height-요소높이-8]`로 클램프.

### 2.3 진입 캐럿 (전체선택 분기) — 현상 ①
- `FlatInlineEditor.jsx:99-104` 수정:
  ```js
  if (isCoarsePointer()) {
    // 터치: 끝(또는 탭 지점)에 캐럿만
    range.selectNodeContents(ref.current); range.collapse(false)
  } else {
    // 데스크톱: 기존 전체선택
    range.selectNodeContents(ref.current)
  }
  sel.removeAllRanges(); sel.addRange(range)
  ```
- (개선 옵션) 진입 탭 좌표를 `document.caretRangeFromPoint(x,y)`로 변환해 **탭한 지점**에 캐럿. 좌표는 `setEditingFlat` 호출 시 함께 저장(`FlatElementRenderer.jsx:59-67` → store에 `editEntryPoint` 추가). 미지원 시 끝으로 폴백. **v1은 "끝 캐럿"만, 좌표 캐럿은 후속.**
- 효과: 진입 직후 선택 없음 → OS 선택 핸들/메뉴·우리 툴바가 안 뜸. 부분선택은 사용자가 롱프레스/핸들로 *의도적으로* 수행(OS 네이티브 그대로).

### 2.4 롱프레스 재정의 — 과부하 제거
- `FlatCanvas.jsx:804-816 handleContextMenu`:
  - **모바일**: `e.preventDefault()`만 하고 컨텍스트 메뉴를 **열지 않음**(하단 바 ⋯버튼으로 대체).
  - **편집 중(`editingFlatId`)**: 어떤 경우든 컨텍스트 메뉴 열지 않음(텍스트 단어선택 보존).
  - 데스크톱: 기존 우클릭 메뉴 유지.

### 2.5 단일 오버레이 닫힘 — 현상 ③
- `FlatContextMenu.jsx:96` `mousedown` → **`pointerdown`** 으로 변경(터치/마우스/펜 공용). `keydown(Esc)` 유지.
- 추가 닫힘 트리거: **선택 변경**(`selectedFlatIds` 변동) 및 **편집 진입**(`editingFlatId` set) 시 컨텍스트 메뉴/AI바 닫기.
- 경량 코디네이터: store에 `activeOverlay`(`'none'|'context'|'aibar'|'barPopover'`) 도입 — 새 오버레이 열 때 이전 것 닫음. (대안: 각 오버레이가 `pointerdown` 바깥 클릭으로 자기-닫힘. v1은 후자 + 위 트리거로 충분, store 필드는 Layer 2에서 도입.)

### 2.6 기존 플로팅의 키보드 도킹 — 현상 ②
- `SelectionToolbar`(`FlatInlineEditor.jsx:543-590`)·`EditAccessory`(487-539):
  - **모바일+키보드 열림**: `computeSelToolbarPos` 대신 **키보드 바로 위 도킹** — `top = vv.offsetTop + vv.height - 툴바높이 - 8`, 가로 중앙. 즉 선택 위치를 따라가지 않고 키보드 위에 고정 → 글씨 안 가림.
  - 데스크톱: 기존 `computeSelToolbarPos` 유지.
- `FlatAiBar`(138-148): 편집 중엔 비표시라 우선순위 낮음. 단 위치 클램프를 `window.innerHeight`→`vv` 가시영역으로 교체(안전).

> **Layer 1만으로 현상 ①②③이 모두 해소된다.** Layer 2는 그 위에 명시적 UX와 다중선택을 얹는다.

---

## 3. 상부 — 모바일 하단 컨텍스트 액션바 (Layer 2)

### 3.1 컴포넌트 & 마운트
- 신규 `src/components/MobileActionBar.jsx` — `createPortal(…, document.body)`, `position: fixed`.
- `App.jsx`에 마운트. 표시 조건: `isCoarsePointer() && mode !== 'present'`.
- 하단 오프셋: `useVisualViewport().keyboardOverlap` 반영(키보드 열리면 키보드 위로). 세이프에어리어 합산.

### 3.2 상태기계 (컨텍스트별 버튼셋)
선택/편집 상태로 버튼 그룹 전환:

| 상태 (store에서 파생) | 버튼 |
|---|---|
| 선택 없음 | ＋삽입 · 텍스트 · 도형 · 이미지 · ⋯더보기 |
| 단일 선택 | 복사 · 삭제 · 정렬 · z-순서 · **다중선택** · ⋯더보기 |
| 다중선택 모드 | 선택수 배지 · 그룹/해제 · 정렬 · 분배 · **완료** |
| 텍스트 편집 중 | B · I · U · 글머리 · 글자색 · 전체선택 · 키보드닫기 |

- 파생 상태: `selectedFlatIds.length`, `editingFlatId`, `multiSelectMode`(신규 store 플래그).
- 액션은 **기존 store/명령 재사용**: `removeSelectedElements`, 정렬(`computeAlignmentChanges`), z-order, 그룹 등.

### 3.3 다중선택 모델 — 신규 기능
- store에 `multiSelectMode: false` + `setMultiSelectMode`.
- "다중선택" 버튼 → 모드 ON. 모드 중 `FlatElementRenderer`의 탭은 `selectFlat`(치환) 대신 **`toggleSelectFlat`**(누적). 그룹 인식은 기존 `expandSelectionToGroups` 재사용.
- 피드백: 선택 요소 테두리 + 바의 선택수 배지. "완료" 또는 빈 캔버스 탭으로 종료.
- 데스크톱은 Shift-클릭 그대로(모드 불필요).

### 3.4 키보드 도킹 위치
- 바 컨테이너: `bottom: max(keyboardOverlap, safeAreaInset)`. 키보드가 오르면 바가 키보드 바로 위에 붙음.
- **텍스트 편집 중에는 바 = 서식 바**로 전환(아래 3.6) → 떠다니는 SelectionToolbar와 이중 표시 방지.

### 3.5 팝오버(⋯더보기 / 색상 / 정렬)
- ⋯더보기 = 기존 `FlatContextMenu` 항목을 **바텀시트**로 재사용(모바일 표현만 다름, 액션 동일).
- 색상 = 기존 `ColorPicker` 팝오버.
- 모든 팝오버는 2.5 단일-오버레이 규칙 적용(바깥 `pointerdown` 닫힘, 새 팝오버 열 때 이전 닫힘).

### 3.6 기존 플로팅 ↔ 바 매핑 (모바일)
| 기존(데스크톱 유지) | 모바일 처리 |
|---|---|
| `FlatContextMenu`(우클릭) | ⋯더보기 바텀시트로 흡수 |
| `FlatAiBar`(텍스트 선택 액션) | 바의 "AI" 버튼으로 흡수(후속) |
| `SelectionToolbar`/`EditAccessory`(서식) | **Phase C**에서 편집 중 바(서식)로 흡수. 그 전까진 2.6 키보드 도킹으로 임시 운용 |

- 서식 명령 브리지: `FlatInlineEditor`가 자신의 명령 API(`applyCmd`, `changeFontSize`, …)를 마운트 시 store(`inlineEditorApi`)에 노출 → 바가 호출. (Phase C 범위)

---

## 4. 파일별 변경 요약

**신규**
- `src/core/pointerEnv.js` — `isCoarsePointer`, `useIsTouch`
- `src/components/useVisualViewport.js` — 키보드/뷰포트 훅
- `src/components/MobileActionBar.jsx` — 하단 액션바(+팝오버/바텀시트)

**수정**
- `FlatInlineEditor.jsx` — 진입 캐럿 분기(99-104), SelectionToolbar/EditAccessory 키보드 도킹(476-539), (Phase C)명령 API 노출
- `FlatCanvas.jsx` — `handleContextMenu` 모바일/편집중 가드(804-816), `FlatAiBar` 클램프
- `FlatContextMenu.jsx` — `mousedown`→`pointerdown`(96), 선택/편집 변경 시 닫힘
- `FlatAiBar.jsx` — 위치 클램프 `vv` 기준(138-148)
- `flatStore.js` — `multiSelectMode`, (Layer2)`activeOverlay`, (PhaseC)`inlineEditorApi`, `editEntryPoint`
- `FlatElementRenderer.jsx` — 다중선택 모드 시 toggle, (옵션)진입 좌표 전달(59-67)
- `App.jsx` — `MobileActionBar` 마운트

---

## 5. 단계적 구현 (PR/브랜치 분할)

- **Phase A — 인프라 & 버그픽스(현상 ①②③ 해소)**: 2.1~2.6. 바 없이도 3대 현상 해결. *우선 머지 가치 큼.*
- **Phase B — 하단 액션바 + 다중선택**: 3.1~3.5(서식 흡수 제외). 명시적 버튼 UX, 다중선택 신규.
- **Phase C — 서식 바 통합**: 3.6 + 명령 브리지. 편집 중 바가 서식 담당, 모바일 SelectionToolbar 은퇴.

각 Phase 별도 브랜치 → `--no-ff` 머지 → 브랜치 삭제. (메모리 규칙)

## 6. 테스트 / 검증

- **단위(vitest+jsdom)**: `useVisualViewport`(키보드 오버랩 계산/이벤트), `isCoarsePointer`(matchMedia 모킹), 진입 캐럿 분기(coarse 시 collapse), 컨텍스트 메뉴 `pointerdown` 닫힘, 다중선택 토글.
- **수동(실기기/DevTools 디바이스모드)** *필수*: 더블탭 진입 시 선택 없음 / 키보드 위 도킹 / 롱프레스 단어선택 / 컨텍스트 메뉴 중첩 없음 / 다중선택 누적 / 세이프에어리어.
  - *터치 동작은 jsdom으로 못 잡음 → 머지 전 브라우저 확인(메모리 규칙 `feedback_verify_extraction_in_browser`와 동일 원칙).*

## 7. 리스크 / 오픈 이슈

- `caretRangeFromPoint` 브라우저 차이 → v1은 "끝 캐럿" 폴백.
- `visualViewport` 미지원/사파리 구버전 → 폴백 시 기존 동작 유지(가림 가능성은 남되 회귀 아님).
- 바 높이만큼 캔버스 세로 공간 감소 → 발표 모드 숨김, 필요 시 자동 축소.
- 서식 명령 브리지(Phase C)는 `FlatInlineEditor` 생명주기와 결합 → store 노출 시 정리(unmount 시 null).
- 데스크톱+터치 겸용 기기: `pointer: coarse`가 트랙패드에서 false라 안전. 터치스크린 노트북은 양쪽 경로 공존 검증 필요.

## 8. 오픈 결정 사항 (구현 전 확정)

1. 다중선택: "버튼 누른 동안 추가" vs **"모드 토글 후 탭마다 추가"**(문서 가정: 토글).
2. 진입 캐럿: **끝** vs 탭 지점(`caretRangeFromPoint`). (문서 가정: v1 끝)
3. 편집 중 서식: Phase A 임시 도킹 후 Phase C 통합 시점.
