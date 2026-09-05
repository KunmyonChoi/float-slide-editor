---
name: genitor-slides
description: >-
  Generate editable slide decks — slides, speaker notes, and the motion that
  matches them — as a single self-contained HTML file in the exact format that
  the Genitor slide editor (float-editor) imports losslessly. Use this when a
  user wants to draft slides in Claude (Design / Code / Web) and then continue
  editing or presenting them in Genitor — e.g. "make a 5-slide deck I can edit
  in Genitor", "export these slides as Genitor HTML", "add speaker notes and
  build animations". Output extracts cleanly into editable text/shape/image
  elements because the markup mirrors Genitor's own HTML export; notes ride in
  a <script class="fe-notes"> per slide and motion in data-anim attributes.
---

# Genitor 슬라이드 HTML 작성 규약

Genitor(float-editor)는 HTML을 받아 **편집 가능한 flat 요소(text·shape·image·table)**로
변환한다. 추출기는 HTML을 iframe에 렌더한 뒤 각 요소의 **computed geometry**를 읽는다.
임의의 웹페이지 HTML도 열리긴 하지만, flexbox 수축·반응형 단위·JS 레이아웃 때문에
배치가 어긋날 수 있다. **가장 확실한 방법은 Genitor가 스스로 내보내는 포맷과 똑같이
쓰는 것** — 즉 고정 크기 캔버스 위에 `position:absolute`로 배치된 인라인 스타일 div들.

> **덱 하나 = 화면 + 원고 + 모션.** 슬라이드만 그리고 끝내지 말 것. 장마다 발표자가 말할
> 원고(`.fe-notes`)를 쓰고, 그 원고의 흐름에 맞춰 요소가 등장하도록 모션(`data-anim`)을 건다
> (→ "발표자 노트", "모션" 절). 사용자가 "노트는 필요 없다"고 말하지 않는 한 기본으로 포함한다.

> **형식(form)은 고정, 스타일(style)은 매번 새로.** 아래 규칙(고정 캔버스·`position:absolute`·
> `.slide.active`·px 좌표)은 추출 정확도를 위해 **항상 동일하게** 지킨다. 반면 색/폰트/레이아웃은
> 주제마다 **새로 디자인**한다. 이 문서의 색·치수·레이아웃은 *형식을 보여주는 예시일 뿐*이며,
> 그대로 복제하면 모든 덱이 똑같아진다(→ "스타일 다양성" 절 참고).

## 핸드오프 (사용자가 Genitor로 가져가는 법)

생성한 HTML을 사용자가 다음 중 하나로 가져간다:
1. **붙여넣기** — HTML 소스 전체를 복사해 Genitor 캔버스에서 `Ctrl/Cmd+V`. (온전한
   `<!DOCTYPE html>` 문서일 때만 덱 가져오기로 인식한다.)
2. **드래그&드롭** — `.html` 파일을 캔버스에 떨군다.
3. **파일 열기** — File 메뉴 ▸ "HTML 열기".
4. **URL 임포트 링크** (Claude Desktop처럼 파일 저장·드래그가 마땅치 않은 환경에 권장) —
   생성한 HTML 문서 전체를 `encodeURIComponent`로 URL 인코딩해
   `<Genitor 앱 주소>#import=<인코딩된 HTML>` 형태의 링크를 만들어 사용자에게
   클릭 가능한 링크로 전달한다. Genitor는 페이지 로드 시 `#import=` 해시를 감지하면
   그 자리에서 자동으로 디코드해 덱을 가져온다(서버 왕복 없음, 새로고침 방지를 위해
   가져온 뒤 해시는 주소창에서 즉시 제거됨).
   - Genitor 앱 주소를 모르면 사용자에게 먼저 물어본다(예: `https://your-genitor.app/`).
     경로 뒤에 그대로 `#import=...`만 붙이면 되고, 이미 있는 쿼리스트링은 유지해도 된다.
   - 인코딩은 정확해야 하므로(한글·특수문자 다수) **가능하면 코드 실행으로 처리** —
     예: `python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open('deck.html').read(), safe=''))"`.
     코드 실행이 없는 환경에서 직접 손으로 퍼센트 인코딩하지 말 것(누락·오류 위험).
   - 인코딩 후 URL이 매우 길어지면(이미지 base64 데이터 URL을 다량 인라인한 경우 등)
     브라우저·클라이언트가 링크를 잘라먹을 수 있다. 그런 덱은 방법 1~3(붙여넣기/드래그/파일
     열기)을 대신 권장한다.

따라서 출력은 **항상 단일 자립형(self-contained) `.html` 문서**여야 한다(외부 JS 의존 금지,
폰트만 CDN `<link>` 허용).

## 정본 스캐폴드 (이 골격을 그대로 사용)

- 캔버스 기본값 **1920×1080**(FHD, 16:9). `<body>`와 각 `.slide`의 width/height를 동일하게.
- 슬라이드마다 `<div class="slide">`, **첫 장만 `active`**.
- 요소는 모두 `.slide` 안에서 `position:absolute; left/top/width/height(px)`.
- `box-sizing:border-box` 전역 적용(스캐폴드에 포함).
- 슬라이드마다 발표자 노트 `<script type="text/plain" class="fe-notes">` 하나,
  요소에는 흐름에 맞는 `data-anim`.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Deck</title>
<!-- 웹폰트가 필요하면 여기 link. 주제에 맞춰 폰트를 고른다(예시일 뿐). -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1920px; height: 1080px; overflow: hidden; position: relative; background: #0f172a; }
.slide { position: absolute; inset: 0; display: none; overflow: hidden; background: #fff; }
.slide.active { display: block; }
</style>
</head>
<body>

  <div class="slide active" style="width:1920px;height:1080px;background:#0f172a;">
    <!-- 요소들 (등장 순서가 있으면 data-anim) -->
    <script type="text/plain" class="fe-notes">
      이 장에서 발표자가 말할 원고. 문단(빈 줄)이 곧 등장 단계다.
    </script>
  </div>

  <div class="slide" style="width:1920px;height:1080px;background:#0f172a;">
    <!-- 다음 장 요소들 -->
    <script type="text/plain" class="fe-notes">
      다음 장 원고.
    </script>
  </div>

</body>
</html>
```

> 여러 장이면 `.slide` div를 이어 붙이면 된다(첫 장만 `active`). 내비/스크립트는 넣지 않아도
> Genitor가 각 장을 페이지로 인식한다. 굳이 미리보기 네비를 넣고 싶다면 `position:fixed` +
> `onclick` 요소로 — 그런 요소는 추출 시 자동 제외되므로 슬라이드 내용에 섞이지 않는다.
>
> 캔버스는 16:9이기만 하면 다른 크기(예: 1280×720)도 되지만, **한 덱 안에선 body·slide·요소
> 좌표를 하나의 기준으로 통일**한다. 기본은 1920×1080을 권장.

## 스타일 다양성 (단조로움 방지) — 중요

이 문서의 예시는 **배선(wiring)을 보여주는 형식 데모**다. 색·폰트·레이아웃을 그대로 베끼지 말고,
매 덱마다 주제·청중·톤에서 **새로 디자인**한다.

- **팔레트**: 다크 슬레이트만 반복하지 말 것. 주제에 맞게 라이트/컬러풀/모노/브랜드 컬러 등에서
  고른다. 배경 1~2색 + 본문색 + **강조색 1개**. 슬라이드별로 배경을 바꿔도 좋다.
- **레이아웃 다양화**: 장마다 다른 구조를 섞는다 — 표지(센터/좌측), 풀블리드 이미지,
  좌우 분할(텍스트│이미지), 카드 그리드(2×2·3열), 큰 숫자 통계, 인용구, 타임라인/스텝,
  2열 비교, 다이어그램. **모든 장을 같은 3카드로 채우지 말 것.**
- **타이포**: 주제에 맞는 폰트 패밀리·굵기. 제목은 과감하게 크게(예: 96~180px), 본문은
  가독 크기(예: 36~52px), 충분한 행간·여백. 대비를 준다.
- **여백·리듬**: 요소를 빽빽이 채우지 말고 호흡을 둔다. 강조 요소는 크게, 보조는 작게.
- **형식만은 항상 동일**: 고정 캔버스 + `position:absolute` + px 좌표 + `.slide.active`.

## 요소 레시피 (각 요소 = `.slide` 직계 자식 div)

모든 요소는 `position:absolute`와 정수 px 좌표를 가진다. 겹치지 않게 직접 배치한다.
**아래 색·치수는 예시값** — 주제에 맞게 바꾼다.

**제목/본문 텍스트** — div에 직접 텍스트 + 텍스트 스타일:
```html
<div style="position:absolute;left:120px;top:135px;width:1680px;height:180px;
            font-family:'Noto Sans KR',sans-serif;font-size:96px;font-weight:900;
            color:#f8fafc;line-height:1.1;text-align:left;">
  제목을 여기에
</div>
```

**색 박스 / 카드 (shape)** — 텍스트 없는 div는 도형으로 추출:
```html
<div style="position:absolute;left:120px;top:360px;width:780px;height:450px;
            background:#1e293b;border:1px solid rgba(255,255,255,0.1);
            border-radius:24px;box-shadow:0 15px 45px rgba(0,0,0,0.3);"></div>
```

**카드 + 텍스트(병합)** — 배경/테두리가 있는 div에 **텍스트 노드 한 줄만** 있을 때, 하나의
편집 가능한 텍스트 요소로 병합된다. 카드 안의 글은 중앙정렬이 깔끔. **이 레시피는 한 줄짜리
카드 전용이다.** `<br>`이나 두 개 이상의 `<strong>`/`<span>`이 필요해지는 순간 아래
"여러 줄 카드"로 갈아탈 것:
```html
<div style="position:absolute;left:120px;top:360px;width:780px;height:240px;
            background:#1e293b;border-radius:24px;padding:36px;
            display:flex;align-items:center;justify-content:center;
            font-family:'Noto Sans KR',sans-serif;font-size:36px;color:#e2e8f0;text-align:center;">
  카드 본문 텍스트
</div>
```

**여러 줄 카드 (라벨 + 제목 + 수치 + 본문)** — 카드는 **텍스트 없는 도형 하나**로 두고,
그 위에 텍스트를 **각각 독립된 절대 위치 블록**으로 쌓는다. flex를 쓰지 않으므로 브라우저
렌더와 Genitor 추출 결과가 일치하고, 라벨·제목·수치·본문이 각각 하나의 편집 요소로 들어간다.
세로 중앙 정렬이 필요하면 flex 대신 좌표를 계산해서 top을 정한다:
```html
<!-- 카드(도형) -->
<div style="position:absolute;left:120px;top:318px;width:393px;height:450px;
            background:#f8fafc;border:1px solid #e5e7eb;border-radius:20px;"></div>
<!-- 그 위에 얹는 텍스트들 (좌표 = 카드 좌표 + 패딩, 아래로 누적) -->
<div style="position:absolute;left:153px;top:357px;width:327px;height:32px;
            font-size:21px;font-weight:700;color:#EA002C;line-height:1.5;">최대 할인</div>
<div style="position:absolute;left:153px;top:401px;width:327px;height:41px;
            font-size:28px;font-weight:700;color:#111827;line-height:1.4;">삼성카드 T프리미엄</div>
<div style="position:absolute;left:153px;top:450px;width:327px;height:57px;
            font-size:42px;font-weight:900;color:#EA002C;line-height:1.35;">96만 원</div>
<div style="position:absolute;left:153px;top:525px;width:327px;height:119px;
            font-size:23px;color:#6b7280;line-height:1.75;">월 3만 5천 원 × 24개월<br>+ 캐시백 12만 원<br>전월 실적 80만 원 ↑</div>
```

> 블록 높이는 `줄 수 × font-size × line-height`로 계산해 넣는다. 텍스트가 많은 덱이라면
> 이 좌표 누적을 손으로 하지 말고 작은 생성 스크립트(파이썬 등)로 뽑는 편이 훨씬 안전하다.

**리치 텍스트** — `<strong>` `<em>` `<span style>` `<br>`는 보존된다:
```html
<div style="position:absolute;left:120px;top:645px;width:1680px;height:135px;
            font-size:42px;color:#cbd5e1;line-height:1.5;">
  핵심은 <strong style="color:#818cf8;">강조</strong>와 <em>뉘앙스</em>입니다.
</div>
```

**글머리 목록** — `<ul>/<li>`의 마커(•)가 보존된다(각 li가 텍스트 요소로):
```html
<div style="position:absolute;left:120px;top:360px;width:1680px;height:450px;
            font-size:45px;color:#e2e8f0;line-height:1.8;">
  <ul style="padding-left:1.2em;">
    <li>첫 번째 항목</li>
    <li>두 번째 항목</li>
  </ul>
</div>
```

**이미지** — div로 감싸 `<img>`를 object-fit으로 채운다. **테두리·라운드·그림자는 래퍼가 아니라 `<img>`에 직접** 준다:
```html
<div style="position:absolute;left:1020px;top:360px;width:780px;height:450px;overflow:hidden;border-radius:24px;">
  <img src="https://example.com/photo.jpg" alt=""
       style="width:100%;height:100%;object-fit:cover;display:block;
              border-radius:24px;border:1px solid rgba(255,255,255,0.15);box-sizing:border-box;" />
</div>
```

> **미디어를 도형이 덮지 않게 하라(중요).** Genitor는 클릭 시 **최상위 요소**를 선택한다. 이미지/영상
> 위에 전면 오버레이·테두리 도형을 얹거나, 래퍼 div에 배경/테두리/그림자를 주면 **래퍼가 "도형"으로
> 추출돼 미디어를 덮는다** → 미디어 대신 그 도형이 선택되어 "이미지가 도형으로 로드"되고 이미지
> AI(설명으로 편집·전경 분리 등)도 안 뜬다. 그러므로:
> - **래퍼 div엔 `overflow`·`border-radius`만.** 배경·테두리·그림자는 `<img>`/`<video>` 요소에 직접.
> - 가독성용 그라디언트 오버레이는 **전체가 아니라 하단 스트립 등 부분만** 덮어 미디어의 클릭 영역을 남긴다.

**영상** — 이미지와 동일(테두리는 `<video>`에 직접). `<video>`의 재생 속성은 보존된다:
```html
<div style="position:absolute;left:120px;top:180px;width:780px;height:450px;overflow:hidden;border-radius:24px;">
  <video src="https://example.com/clip.mp4" autoplay muted loop playsinline
         style="width:100%;height:100%;object-fit:cover;display:block;border-radius:24px;"></video>
</div>
```

**아이콘** — Font Awesome 등 아이콘 폰트는 클래스가 있어야 글리프가 추출된다. `<head>`에
해당 폰트 CSS를 link하고 `<i class="fas fa-star"></i>` 형태로. 클래스 없는 빈 `<i>`는 깨진다.
인라인 `<svg>`도 텍스트 안에서 보존된다.

## 발표자 노트 (기본으로 항상 쓴다)

덱은 화면만이 아니라 **발표**다. 슬라이드마다 발표자가 실제로 말할 원고를 함께 쓴다.
슬라이드 안에 `<script type="text/plain" class="fe-notes">` 하나를 넣으면 Genitor가
그 장의 발표자 노트로 가져간다(화면에는 렌더되지 않고, 추출 요소로도 잡히지 않는다).

```html
<div class="slide active" style="width:1920px;height:1080px;background:#0f172a;">
  <!-- 요소들 … -->
  <script type="text/plain" class="fe-notes">
    작년 이맘때 우리는 이 지표를 반으로 줄이겠다고 했습니다.

    결과부터 말씀드리면, 38% 줄었습니다. 목표엔 못 미쳤지만 방향은 맞았습니다.

    왜 그랬는지, 그리고 다음 분기에 무엇을 바꿀지 세 가지로 정리했습니다.
  </script>
</div>
```

**쓰는 법**
- **말할 문장 그대로** 쓴다. 슬라이드 텍스트의 요약("매출 성장 38% 설명")이 아니라
  입 밖으로 나올 말("결과부터 말씀드리면, 38% 줄었습니다")을 쓴다. Genitor에서 이 원고가
  그대로 TTS 내레이션·STT 카라오케 자막·PPTX 슬라이드 노트로 이어진다.
- **빈 줄로 문단(beat)을 나눈다.** 한 문단 = 하나의 이야기 덩어리 ≈ 등장 단계 하나(아래 "모션" 절).
- 한 장에 3~6문장(약 30~60초)이 적당하다. 넘치면 슬라이드를 쪼갠다.
- `type="text/plain"`을 꼭 붙인다(빠뜨리면 브라우저가 원고를 JS로 실행하려 든다).
- 원고 안에 `</script>` 문자열은 넣지 않는다.
- 들여쓰기는 자동으로 벗겨지므로 HTML 안에서 보기 좋게 들여써도 된다.
- 노트는 `<script>`이므로 `#import=` URL 인코딩에도 그대로 실려 간다.

## 모션 (발표 흐름에 맞춰 요소를 등장시킨다)

요소 div에 `data-anim` 속성을 달면 Genitor의 요소 애니메이션으로 들어간다. 발표 모드에서
클릭(또는 →)마다 다음 단계가 재생된다. **CSS `@keyframes`로 직접 등장 효과를 만들지 말 것** —
추출 시 최종 상태로 고정돼 사라지고, 발표 모드의 단계 재생과도 충돌한다. 모션은 `data-anim`으로만.

```html
<div data-anim="fadeIn" data-anim-trigger="auto" data-anim-name="title"
     style="position:absolute;left:120px;top:360px;…">2026 1분기 리뷰</div>
<div data-anim="slideIn" data-anim-dir="up" data-anim-trigger="after" data-anim-ref="title"
     data-anim-delay="150" style="position:absolute;left:120px;top:600px;…">성장 지표와 다음 분기 방향</div>
```

| 속성 | 값 | 기본값 |
|---|---|---|
| `data-anim` | `fadeIn` `slideIn` `scaleIn` `pop` `fadeOut` `slideOut` `scaleOut` | (없으면 모션 없음) |
| `data-anim-dir` | `left` `right` `up` `down` — **`slideIn`/`slideOut`만** (화살표 = 요소가 움직이는 방향) | `up` |
| `data-anim-duration` | ms (50~10000) | `500` |
| `data-anim-delay` | ms | `0` |
| `data-anim-trigger` | `click` `auto` `with` `after` | `click` |
| `data-anim-name` | 이 요소의 이름(다른 요소가 참조용으로 씀) | — |
| `data-anim-ref` | `with`/`after`가 가리킬 상대의 `data-anim-name` | — |

**트리거 4종**
- `click` — **새 단계**. 발표자가 클릭할 때 등장. 단계 수 = click 요소 수.
- `auto` — 장에 들어서는 즉시 자동 재생(단계에 포함되지 않음). 표지·배경·제목처럼
  "이미 떠 있어야 하는" 것에 쓴다.
- `with` — `data-anim-ref` 대상과 **같은 단계에서 동시에**.
- `after` — 대상이 끝난 뒤 `data-anim-delay`만큼 두고 **자동으로 이어서**. 같은 단계 안의 연쇄.

**노트의 문단과 클릭 단계를 맞춘다 (핵심)**

이 스킬의 기본값은 "발표 흐름 연동"이다. 노트 원고의 문단(beat) 수와 그 장의 **click 단계 수를
같게** 만들어, 발표자가 그 말을 시작할 때 해당 요소가 뜨게 한다.

```
노트 문단 1: "작년 이맘때 …"        → (제목·배경은 auto — 이미 떠 있음)
노트 문단 2: "결과부터 말씀드리면…"  → 카드 ①  data-anim-trigger="click"
노트 문단 3: "왜 그랬는지 …"         → 카드 ②  data-anim-trigger="click"
```

- 장의 **배경·제목·머리기호는 `auto`**, 청중이 따라와야 하는 **본문 항목은 `click`**.
- 한 덩어리로 움직여야 하는 것(아이콘+숫자+캡션)은 대표 요소만 `click`, 나머지는
  `with`(동시) 또는 `after`(살짝 늦게)로 묶는다.
- 카드 3장을 한 번에 다 보여줄 거면 3장 모두 하나의 단계로 묶고, 하나씩 짚어갈 거면 각각 `click`.

**절제**
- 한 장의 click 단계는 **1~4개**. 그보다 많으면 슬라이드를 쪼갠다.
- 덱 전체에서 효과는 **1~2종으로 통일**한다(예: 등장은 `fadeIn`, 강조는 `slideIn` up).
  장마다 다른 효과를 쓰면 산만하다.
- `fadeOut`/`slideOut`/`scaleOut`(퇴장)은 "앞에 있던 걸 치우고 다음을 보여줄 때"만.
- 지속시간은 400~700ms가 자연스럽다. 1초를 넘기지 않는다.
- 정보 전달이 목적인 덱(문서형)은 모션 없이 노트만 써도 된다.

**슬라이드 전환** — `.slide`에 선언한다(선택).

```html
<div class="slide" data-transition="fade" data-transition-duration="400" …>
```

| 속성 | 값 | 기본값 |
|---|---|---|
| `data-transition` | `fade` `slide` `zoom` | (없으면 전환 없음) |
| `data-transition-dir` | `left` `right` `up` `down` — `slide`만 | `right` |
| `data-transition-duration` | ms (50~3000) | `400` |

**주의**
- `data-anim`은 **`.slide` 직계 자식**(=하나의 요소)에 단다. 그 안의 여러 조각(li·아이콘 등)이
  각각 추출되면 **모두 한 단계로 함께** 움직인다. 항목별로 따로 등장시키려면 항목마다 요소를
  분리해 각각 `data-anim`을 단다.
- `data-anim-ref`가 가리키는 이름이 **같은 슬라이드 안**에 없으면 그 요소는 독립 클릭 단계로
  떨어진다(조용히 어긋나므로 검증 스크립트로 확인할 것).
- 배경(풀캔버스 도형)에는 모션을 걸지 않는다.

## 좌표·배치 규칙

- 캔버스는 **1920×1080** 기준(16:9면 다른 크기도 가능, 단 body·slide·요소를 한 기준으로 통일).
- 안전 여백 ~120px. 요소끼리 겹치지 않게, px로 직접 레이아웃(그리드를 머릿속으로 계산).
- `z-index`로 앞뒤 제어(겹치는 경우). 회전이 필요하면 요소 div에
  `transform:rotate(Ndeg);transform-origin:center center;`.
- 색/그림자/라운드/패딩/letter-spacing/text-shadow/배경 그라데이션 등 인라인 스타일은 보존된다.

## 해야 할 것 / 피할 것

**해야 할 것**
- 단일 `<!DOCTYPE html>` 자립 문서. 모든 요소에 명시적 px 위치·크기.
- 의미 태그 사용은 자유지만 **배치는 `position:absolute`로** 고정(flex는 카드 내부 정렬 정도만).
- 웹폰트는 `<head>`의 `<link>`로 선언하고 `font-family`를 인라인으로 지정.
- 텍스트 색·배경은 인라인 스타일에 직접(클래스 기반 색은 computed 값으로만 들어옴).
- **슬라이드 배경은 `.slide`에 한 번만.** `<body>`와 `.slide` 양쪽에 배경을 주면 풀캔버스
  배경 도형이 두 장(중복) 잡힌다 — 무해하나, 보이는 배경은 `.slide`에 두고 body는 어두운
  레터박스(스캐폴드 기본값)로 남기면 깔끔하다.
- **장마다 레이아웃·강조를 바꿔** 단조로움을 피한다("스타일 다양성" 절).
- **장마다 발표자 노트**를 쓰고(말할 문장 그대로), 그 문단 흐름에 맞춰 `data-anim`을 건다.

**피할 것 (추출이 망가지는 패턴)**
- **`display:flex` 카드 안에 자식 요소를 넣기** → `<strong>` `<span>` `<br>`이 전부 개별 flex
  item이 되어 **가로로 늘어선다.** `<br>`은 폭 0짜리 아이템이라 줄바꿈이 되지 않고, 각 조각은
  좁게 수축돼 내부에서 강제로 줄바꿈되며, 아이템 사이에 공백이 없어 글자가 붙어 보인다.
  (예: 262px 카드가 `①`(24px) + `T 나는 폰교체`(99px) + 본문(97px) 3열로 쪼개짐.)
  여러 줄이 필요하면 위의 "여러 줄 카드" 패턴을 쓸 것.
- 레이아웃을 **JS로** 잡기, `<canvas>`/WebGL 그리기 → 추출 안 됨.
- 반응형 단위(`vw`,`vh`,`%` 폭, `clamp()`)로 핵심 배치 → 폭/줄바꿈이 어긋남. px로.
- `opacity:0`로 내용 숨기기 → 숨김 처리되어 사라짐(보일 내용만 둘 것).
- **CSS `@keyframes`/`animation`으로 등장 효과 직접 구현** → 추출 시 최종 상태로 고정되고
  발표 모드의 단계 재생과 충돌한다. 모션은 `data-anim`으로만("모션" 절).
- 발표자 노트를 화면 위 텍스트 요소나 `display:none` div로 넣기 → 각각 슬라이드에 보이거나
  통째로 사라진다. 노트는 `<script type="text/plain" class="fe-notes">` 하나로.
- `<script class="fe-notes">`에서 `type="text/plain"` 빠뜨리기 → 브라우저가 원고를 JS로
  실행하려 한다.
- `position:fixed`/`onclick` 요소에 **슬라이드 콘텐츠**를 담기 → 내비로 간주되어 제외됨.
- `scale()` 외 복합 transform(skew/3D) → scale만 반영되고 나머지 소실.
- `::before content:attr()/counter()/url()`, `<input>` placeholder → 추출 안 됨.
- 이미지/영상 **래퍼 div에 배경·테두리·그림자** → 래퍼가 도형으로 추출돼 미디어를 덮는다(미디어 선택·이미지 AI 불가). 장식은 `<img>`/`<video>`에 직접.
- 이미지/영상 **위에 전면 오버레이/테두리 도형**을 얹기 → 최상위 도형이 선택돼 미디어를 못 고른다. 오버레이는 부분(스트립)만.

## 내보내기 전 검증 (코드 실행이 가능한 환경이면 필수)

폭 계산을 머리로 하면 flex가 레이아웃을 뒤집는 것 같은 문제를 놓친다. 반드시 실제로 렌더해서
확인한다. `scripts/verify_deck.py`가 레이아웃 네 가지를 잡아준다:

1. **FLEX+children** — 자식 요소를 가진 flex 컨테이너(위의 치명적 패턴)
2. **WRAP** — 선언한 `<br>` 수보다 실제 렌더된 줄 수가 많은 요소(의도치 않은 줄바꿈)
3. **OVERFLOW** — `scrollHeight`가 지정 height를 넘는 요소
4. **OUTSIDE** — 캔버스(기본 1920×1080, 다른 크기는 `--size`로 지정) 밖으로 나간 요소

노트·모션 규약도 함께 검사한다 — 이쪽은 조용히 어긋나므로(가져가 봐야 안다) 특히 중요하다:

5. **ANIM** — 알 수 없는 효과/트리거/방향, 중복된 `data-anim-name`
6. **ANIM-REF** — `with`/`after`가 가리킬 `data-anim-ref`가 없거나 같은 슬라이드에 그 이름이 없음
7. **NOTES** — `<script class="fe-notes">`에 `type="text/plain"`이 없거나 한 슬라이드에 둘 이상
8. **경고** — 노트 없는 슬라이드, click 단계가 너무 많은 슬라이드, 중첩된 `data-anim`

```bash
pip install playwright --break-system-packages && playwright install chromium   # 최초 1회
python3 scripts/verify_deck.py deck.html                # 문제 목록 출력, 없으면 "OK" (기본 1920x1080)
python3 scripts/verify_deck.py deck.html --size 1280x720   # 캔버스가 1920x1080이 아닐 때
python3 scripts/verify_deck.py deck.html --shots out/      # 슬라이드별 PNG + 컨택트시트
```

출력이 비어 있어야 사용자에게 넘긴다(경고는 의도한 것이면 넘어가도 된다). `--shots`로 뽑은
이미지를 눈으로도 한 번 볼 것 — 숫자 검증은 통과해도 카드 안 여백이 한쪽으로 쏠리는 등은
보이지 않는다. 모션은 정적 스크린샷에 안 나오므로, 각 장의 노트 문단 수와 click 단계 수가
맞는지는 스크립트 요약(`슬라이드별 노트/단계`)으로 확인한다.

## 형식 데모 (2장 — 배선 확인용. 색·레이아웃은 복제하지 말 것)

> 화면·노트·모션이 한 파일에서 어떻게 맞물리는지 보여주는 최소 예시다.

> 아래는 *형식이 맞는지* 보여주는 최소 예시다. 실제 덱은 주제에 맞는 팔레트·폰트와
> **장마다 다른 레이아웃**으로 새로 디자인한다("스타일 다양성" 절).

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>분기 리뷰</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1920px; height: 1080px; overflow: hidden; position: relative; background: #0f172a; }
.slide { position: absolute; inset: 0; display: none; overflow: hidden; background: #fff; }
.slide.active { display: block; }
</style>
</head>
<body>

  <div class="slide active" data-transition="fade" style="width:1920px;height:1080px;background:linear-gradient(135deg,#0f172a,#1e293b);font-family:'Noto Sans KR',sans-serif;">
    <div data-anim="fadeIn" data-anim-trigger="auto" data-anim-name="title" style="position:absolute;left:120px;top:360px;width:1500px;height:210px;font-size:108px;font-weight:900;color:#f8fafc;line-height:1.05;">2026 1분기 리뷰</div>
    <div data-anim="slideIn" data-anim-dir="up" data-anim-trigger="after" data-anim-ref="title" data-anim-delay="150" style="position:absolute;left:120px;top:600px;width:1350px;height:90px;font-size:42px;color:#94a3b8;">성장 지표와 다음 분기 방향</div>
    <div style="position:absolute;left:120px;top:180px;width:96px;height:12px;background:#818cf8;border-radius:6px;"></div>
    <script type="text/plain" class="fe-notes">
      안녕하세요. 2026년 1분기 리뷰를 시작하겠습니다.

      오늘은 성장 지표를 먼저 보고, 그다음 분기에 무엇을 바꿀지 말씀드리겠습니다.
    </script>
  </div>

  <div class="slide" style="width:1920px;height:1080px;background:#0f172a;font-family:'Noto Sans KR',sans-serif;">
    <div data-anim="fadeIn" data-anim-trigger="auto" style="position:absolute;left:120px;top:120px;width:1680px;height:105px;font-size:72px;font-weight:900;color:#f8fafc;">핵심 지표</div>
    <div data-anim="slideIn" data-anim-dir="up" data-anim-name="m1" style="position:absolute;left:120px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#818cf8;font-size:84px;font-weight:900;">+38%</div>
    <div data-anim="fadeIn" data-anim-trigger="with" data-anim-ref="m1" style="position:absolute;left:120px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">매출 성장</div>
    <div data-anim="slideIn" data-anim-dir="up" data-anim-name="m2" style="position:absolute;left:690px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;align-items:center;justify-content:center;color:#34d399;font-size:84px;font-weight:900;">12.4k</div>
    <div data-anim="fadeIn" data-anim-trigger="with" data-anim-ref="m2" style="position:absolute;left:690px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">신규 사용자</div>
    <div data-anim="slideIn" data-anim-dir="up" data-anim-name="m3" style="position:absolute;left:1260px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;align-items:center;justify-content:center;color:#f472b6;font-size:84px;font-weight:900;">96%</div>
    <div data-anim="fadeIn" data-anim-trigger="with" data-anim-ref="m3" style="position:absolute;left:1260px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">유지율</div>
    <script type="text/plain" class="fe-notes">
      매출은 38% 늘었습니다. 목표는 45%였으니 조금 못 미쳤습니다.

      신규 사용자는 1만 2천 4백 명. 작년 같은 기간의 두 배입니다.

      유지율은 96%로, 세 지표 중 유일하게 목표를 넘겼습니다. 여기가 다음 분기의 출발점입니다.
    </script>
  </div>

</body>
</html>
```

이대로 사용자가 복사 → Genitor 캔버스에 붙여넣기 하면 각 텍스트/도형/이미지가 편집 가능한
요소로 들어가고, 첫 장·둘째 장이 페이지로 분리된다. 노트는 노트 패널에, `data-anim`은 요소
애니메이션 탭에 들어가 발표 모드에서 클릭 단계로 재생된다. 둘째 장은 노트 문단이 3개,
click 단계도 3개(지표 카드 셋)로 서로 맞물린다. 실제 덱에선 이 골격은 유지하되
**색·폰트·장별 레이아웃을 주제에 맞게 새로** 디자인한다.
