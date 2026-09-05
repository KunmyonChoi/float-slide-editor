# 표(table)와 HTML 경로 — 양방향 손실과 복원 설계

> 상태: **구현 완료**. 별도 기능(마크다운 임포트) 작업 중 발견했지만, 그 기능과 무관하게
> 이미 사용자에게 노출돼 있던 손실이다 — 표 삽입 기능(2026-06-10)이 들어온 뒤로 줄곧.
>
> 구현: `FlatExporter.tableHtml`(내보내기), `FlatExtractor.extractTableData`(가져오기),
> `slideTable.js`의 `normFractions`/`MAX_ROWS`/`MAX_COLS` 공개. 테스트 `src/test/tableRoundtrip.test.js`(16개).

Genitor의 표는 `type:'table'` flat 요소(`src/core/slideTable.js`)로, 화면 렌더·PPTX 내보내기·
`.flatproj` 저장은 정상이다. 그런데 **HTML 경로에서는 양방향 모두 깨진다.**

## 1. 현상

### ① 내보내기 — 표가 빈 도형이 된다 (데이터 손실)

`FlatExporter.renderElement`에 `table` 분기가 없어, 표가 마지막 fallthrough(도형)로 떨어진다.
실제로 3×3 표 요소 하나를 `exportFlatHtml`에 넣어보면:

```html
<div style="position:absolute;left:120px;top:240px;width:1680px;height:400px;z-index:2;
            box-sizing:border-box;overflow:hidden;background-color:rgba(0,0,0,0);border:none"></div>
```

셀 텍스트("영역", "편집 기반" …)는 **결과 HTML에 한 글자도 남지 않는다**(`<table>` 태그도 없음).

영향: 파일 ▸ **HTML 내보내기**(`ExportMenu.jsx:252`), **전체 페이지 HTML 내보내기**(`:261`),
`ExportValidator`/`FixtureManager`의 비교 파이프라인. `.flatproj`(ProjectSerializer)와 공유 링크
(ShareLink는 .flatproj 기반)와 PPTX(`PptExporter.addTable`)는 **정상**이다.

### ② 가져오기 — `<table>`이 셀 단위 텍스트로 분해된다

`FlatExtractor`에 `table` 분기가 없어(`ElementRegistry`는 `table/thead/tr`을 일반 컨테이너로
취급), 9행 3열 표 하나가 **텍스트 요소 27개 + 배경 도형**으로 들어온다(테두리는 소실).
행 추가·열 폭 조정 같은 표 편집을 잃고, PPTX 내보내기에서도 네이티브 표가 되지 않는다.

### ③ 문서와 구현의 불일치

`skills/genitor-slides/SKILL.md`는 "HTML을 **text·shape·image·table**로 변환한다"고 안내한다.
실제로는 table이 없다 — Claude가 만든 덱의 표도 셀 텍스트 다발로 들어온다.

## 2. 복원은 가능한가 — PoC 결과

렌더된 `<table>`에서 `type:'table'`에 필요한 값이 **computed로 전부 복원된다**.
ROADMAP 덱의 9×3 표로 확인:

| 필요한 값 | 복원 방법 | PoC 결과 |
|---|---|---|
| rect | `table.getBoundingClientRect()` | `x120 y234 1680×657` |
| `colFractions` | 첫 행 셀 rect width ÷ 표 width | `[0.2469, 0.1003, 0.6523]` (합 0.9995 → 정규화) |
| `rowFractions` | 각 `tr` rect height ÷ 표 height | 합 0.9992 → 정규화 |
| `headerRow` | `<thead>` 존재 또는 첫 행이 `<th>` | `true` |
| `border` | 셀 computed `borderTopWidth/Color` | `1px, rgb(226,232,240)` |
| 셀 서식 | 셀 computed `fontSize/color/textAlign/verticalAlign/background` | `27.17px, rgb(51,65,85), start` |
| 셀 텍스트·병합 | `textContent`, `colSpan`/`rowSpan` | 정상 |

**덤**: 브라우저가 내용에 맞게 잡아준 열 폭이 그대로 `colFractions`가 된다 — 균등 분할보다 낫다.

## 3. 구현

### (A) 내보내기 — `FlatExporter.tableHtml`

`FlatElementRenderer.jsx:372-401`의 렌더 구조를 그대로 문자열로 옮긴다(스타일 계산은
`slideTable.js`의 `tableContainerStyle`/`cellStyle`을 **그대로 재사용** — 이미 순수 함수다).

```html
<div style="{flatStyle(el)}">
  <table style="{tableContainerStyle}">
    <colgroup><col style="width:24.7%">…</colgroup>
    <tbody>
      <tr style="height:11.1%">
        <td style="{cellStyle(t,r,c)}" colspan="2">셀</td>   <!-- covered 셀은 출력하지 않음 -->
      </tr>
    </tbody>
  </table>
</div>
```

- 스타일 객체 → 문자열은 camelCase→kebab 변환 헬퍼 하나면 된다.
- 헤더 행은 `<thead><th>`로 내보내 (B)가 `headerRow`를 그대로 복원하게 한다.
- **행 높이는 `%`가 아니라 px로** 낸다. `%`로 내면 브라우저가 내용 기준으로 재분배해
  왕복 시 비율이 밀린다(균등 0.25 → 0.09/0.30/0.30/0.30으로 어긋나는 것을 실측).

### (B) 가져오기 — `FlatExtractor.extractTableData`

- 순회 중 `tagName === 'TABLE'`을 만나면 **서브트리로 내려가지 않고** 하나의 `type:'table'`
  요소를 만든다(§2 표의 매핑 그대로).
- `colFractions`/`rowFractions`는 합이 1이 되도록 정규화한다(`slideTable.js`의 `normFractions` 재사용).
- 병합 셀: `colSpan`/`rowSpan`을 셀에 싣고, 가려지는 자리는 `covered: true`로 채운다
  (렌더러가 `cell.covered`를 이미 기대한다).
- 상한(`MAX_ROWS 30`, `MAX_COLS 12`)을 넘는 표는 기존처럼 텍스트로 분해(회귀 방지).
- 표 안에 이미지·중첩 표가 있으면 텍스트 분해로 폴백한다(v1 범위 밖).

### 회귀 위험

지금까지 `<table>`을 가져오면 셀별 텍스트 요소가 나왔다. (B) 이후 하나의 표 요소가 되므로,
**셀을 개별 텍스트로 편집하던 기존 사용자 흐름이 바뀐다.** 표 요소도 셀 단위 편집이 가능하므로
(`FlatTableEditor.jsx`) 기능 손실은 아니지만, 릴리스 노트에 적을 변화다.

## 4. 검증 결과

브라우저에서 **표 요소 → HTML 내보내기 → `prepareHtmlForEditor` → iframe 렌더 → 추출**을 돌린 결과
(4행 3열, 마지막 행에 `colspan=2` 병합 포함):

```
내보낸 HTML에 <table>: True / 셀 텍스트: True
추출 요소: 2개 ['shape', 'table']          ← 이전에는 셀별 텍스트 다발
위치·크기: x120 y240 1680×481             (원본 120,240 1680×480)
rows/cols 4×3, headerRow True
colFractions [0.25, 0.15, 0.6]            (원본과 동일)
rowFractions [0.25, 0.25, 0.25, 0.25]     (px 지정 후 균등 유지)
border {width: 1, color: 'rgb(203,213,225)'}
병합: cells[3][1].colSpan=2, cells[3][2].covered=true
```

md2slide 흐름 배치 덱의 표 슬라이드도 **요소 31개 → 5개(표 1개)**로 바뀌었다.

## 5. 테스트

- `exportFlatHtml`이 표 요소에서 `<table>`·셀 텍스트·`colgroup` 비율을 내보내는지(문자열 단언).
- 표 요소 → HTML → `prepareHtmlForEditor` → `extractFlatElements` **라운드트립**에서
  rows/cols/텍스트/`headerRow`/`colFractions`(오차 ±0.01)가 보존되는지(브라우저 필요 —
  `scripts/md2slide-proto/extract-check.py`와 같은 하네스).
- 병합 셀(colspan/rowspan) 왕복.
- 상한 초과 표가 기존처럼 텍스트로 분해되는지(회귀).
- PPTX: 라운드트립한 표가 네이티브 표로 나가는지.

## 6. 발견 경위

마크다운 문서를 슬라이드로 변환하는 기능을 설계하며 "흐름 배치 HTML을 추출기에 맡길 수 있는가"를
실험하다가, 표만 셀 단위로 흩어지는 것을 보고 내보내기 쪽까지 함께 확인해 드러났다.
그 기능과의 의존 관계는 없다 — (A)는 표 삽입 기능이 들어온 뒤로 줄곧 있던 데이터 손실이고,
(B)는 외부 HTML(스킬 산출물·웹페이지) 임포트에도 그대로 해당한다.
