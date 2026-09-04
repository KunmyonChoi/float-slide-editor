# 덱 HTML 규약 — 발표자 노트 + 모션

가져오는 HTML에 **발표자 노트**와 **요소 모션**을 실어 나르는 규약. 화면에 보이는 것만 넘어오던
임포트 경로에, 발표에 필요한 나머지 절반(할 말과 등장 순서)을 함께 태운다.

- 저자(Claude 스킬 `genitor-slides`)가 쓰는 쪽 규칙 → `skills/genitor-slides/SKILL.md`
- 파서/직렬화기 → `src/core/deckMotion.js` (프레임워크 무의존, 순수)
- 읽는 쪽 → `src/core/FlatExtractor.js` → `src/store/flatStore.js`
- 쓰는 쪽 → `src/core/FlatExporter.js` (라운드트립)

## HTML 표현

```html
<div class="slide active" data-transition="fade" data-transition-duration="400">
  <div data-anim="fadeIn" data-anim-trigger="auto" data-anim-name="title" style="…">제목</div>
  <div data-anim="slideIn" data-anim-dir="up" data-anim-trigger="after" data-anim-ref="title"
       data-anim-delay="150" style="…">부제</div>
  <script type="text/plain" class="fe-notes">
    발표자가 실제로 말할 원고. 빈 줄로 나뉜 문단이 곧 등장 단계다.
  </script>
</div>
```

| 위치 | 속성 | 내부 모델 |
|---|---|---|
| 요소 | `data-anim` `data-anim-dir` `data-anim-duration` `data-anim-delay` `data-anim-trigger` `data-anim-name` `data-anim-ref` | `element.anim` (`src/core/slideAnimation.js`) |
| `.slide` | `data-transition` `data-transition-dir` `data-transition-duration` | `page.transition` |
| `.slide` 안 | `<script type="text/plain" class="fe-notes">` | `page.notes` |

브라우저 렌더에는 영향이 없다(데이터 속성 + 실행되지 않는 스크립트). 값이 유효하지 않으면
조용히 무시된다 — 검증은 `skills/genitor-slides/scripts/verify_deck.py`가 한다.

## 임포트 경로

`extractFlatElements(doc, win)`이 활성 슬라이드(`revealPresent` → `.slide.active` → `.slide` →
`body`)를 루트로 잡고:

1. `readSlideNotes` / `parseTransitionAttrs`로 페이지 단위 값을 읽어 결과에 실어 보낸다
   (`{ elements, canvasSize, fontImports, notes, transition }`).
2. `setupAnimContext`가 루트 안의 `[data-anim]` 호스트를 문서 순서로 모은다.
3. 요소를 만드는 지점마다 `animIdxFor(el)`(= `el.closest('[data-anim]')`)로 **어느 호스트에서
   나왔는지**만 `_animIdx`에 기록한다. 생성 지점이 여러 갈래라 인자 대신 모듈 스코프
   컨텍스트를 쓴다(플랫 ID 카운터와 같은 패턴).
4. 마지막에 `resolveAnimSpecs`가 `seq`(호스트 순서)와 `trigger.ref`(이름 → flat id)를 확정하고
   `_animIdx`를 지운다. 한 호스트가 여러 요소를 낳으면 첫 요소만 선언된 트리거를 갖고 나머지는
   `with`로 묶여 **한 단계**가 된다.

`flatStore`는 추출 결과의 `notes`/`transition`을 페이지 캐시에 넣는다. 이미 노트가 있는
페이지를 재추출·재생성할 때는 **사용자 노트가 우선**이고, 비어 있을 때만 HTML 선언값을 받는다
(`buildRegeneratedCache`).

## 익스포트(라운드트립)

`exportFlatHtml` / `exportFlatHtmlAllPages`가 `animToAttrs`·`transitionToAttrs`·`notesToScript`로
같은 규약을 다시 써낸다. `with`/`after` 참조는 flat id 대신 `buildAnimNameMap`이 발급한
짧은 이름(`a1`, `a2`…)으로 직렬화되어, 내보낸 HTML을 다시 가져와도 참조가 이어진다.
기본값(500ms·click)은 속성으로 쓰지 않아 HTML이 깔끔하게 유지된다.

## 회귀 검사

추출기는 브라우저 레이아웃(`getBoundingClientRect`/`getComputedStyle`)을 읽으므로 jsdom
단위 테스트로 덮이지 않는다. 그 공백에서 **병합 카드(플렉스 + 텍스트 한 줄)가 `data-anim`을
통째로 잃는 버그**가 났었다 — `tryMergeContainerText`가 만든 리터럴에 `_animIdx`가 없었다.
같은 실수를 막기 위해 실제 Chrome에서 추출기를 돌리는 검사를 둔다:

```bash
npm run check:motion       # scripts/check-deck-motion.mjs — 설치된 Chrome 사용
```

앱과 똑같이 `prepareHtmlForEditor`로 덱을 준비해 띄운 뒤, 병합 카드의 모션·참조 해소·목록
묶음·노트 유출 여부를 확인한다. 요소를 만드는 지점을 새로 추가하면 `animField(el)`를 함께
넣고 이 검사를 돌릴 것.

## 한계

- 모션은 `.slide` 안에서만 유효하다(페이지 간 연쇄 없음).
- `::before/::after` 장식은 본체와 같은 단계로 따라가지만, 별도 지정은 안 된다.
- 노트는 슬라이드당 하나(`.fe-notes` 첫 번째)만 읽는다.
