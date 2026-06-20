---
name: genitor-slides
description: >-
  Generate editable slide decks as a single self-contained HTML file in the
  exact format that the Genitor slide editor (float-editor) imports losslessly.
  Use this when a user wants to draft slides in Claude (Design / Code / Web) and
  then continue editing them in Genitor — e.g. "make a 5-slide deck I can edit in
  Genitor", "export these slides as Genitor HTML". Output extracts cleanly into
  editable text/shape/image elements because the markup mirrors Genitor's own
  HTML export.
---

# Genitor 슬라이드 HTML 작성 규약

Genitor(float-editor)는 HTML을 받아 **편집 가능한 flat 요소(text·shape·image·table)**로
변환한다. 추출기는 HTML을 iframe에 렌더한 뒤 각 요소의 **computed geometry**를 읽는다.
임의의 웹페이지 HTML도 열리긴 하지만, flexbox 수축·반응형 단위·JS 레이아웃 때문에
배치가 어긋날 수 있다. **가장 확실한 방법은 Genitor가 스스로 내보내는 포맷과 똑같이
쓰는 것** — 즉 고정 크기 캔버스 위에 `position:absolute`로 배치된 인라인 스타일 div들.

> **형식(form)은 고정, 스타일(style)은 매번 새로.** 아래 규칙(고정 캔버스·`position:absolute`·
> `.slide.active`·px 좌표)은 추출 정확도를 위해 **항상 동일하게** 지킨다. 반면 색/폰트/레이아웃은
> 주제마다 **새로 디자인**한다. 이 문서의 색·치수·레이아웃은 *형식을 보여주는 예시일 뿐*이며,
> 그대로 복제하면 모든 덱이 똑같아진다(→ "스타일 다양성" 절 참고).

## 핸드오프 (사용자가 Genitor로 가져가는 법)

생성한 HTML을 사용자가 셋 중 하나로 가져간다:
1. **붙여넣기** — HTML 소스 전체를 복사해 Genitor 캔버스에서 `Ctrl/Cmd+V`. (온전한
   `<!DOCTYPE html>` 문서일 때만 덱 가져오기로 인식한다.)
2. **드래그&드롭** — `.html` 파일을 캔버스에 떨군다.
3. **파일 열기** — File 메뉴 ▸ "HTML 열기".

따라서 출력은 **항상 단일 자립형(self-contained) `.html` 문서**여야 한다(외부 JS 의존 금지,
폰트만 CDN `<link>` 허용).

## 정본 스캐폴드 (이 골격을 그대로 사용)

- 캔버스 기본값 **1920×1080**(FHD, 16:9). `<body>`와 각 `.slide`의 width/height를 동일하게.
- 슬라이드마다 `<div class="slide">`, **첫 장만 `active`**.
- 요소는 모두 `.slide` 안에서 `position:absolute; left/top/width/height(px)`.
- `box-sizing:border-box` 전역 적용(스캐폴드에 포함).

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
    <!-- 요소들 -->
  </div>

  <div class="slide" style="width:1920px;height:1080px;background:#0f172a;">
    <!-- 다음 장 요소들 -->
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

**카드 + 텍스트(병합)** — 배경/테두리가 있는 div에 텍스트 하나면 **하나의 편집 가능한
텍스트 요소**로 병합된다. 카드 안의 글은 중앙정렬이 깔끔:
```html
<div style="position:absolute;left:120px;top:360px;width:780px;height:240px;
            background:#1e293b;border-radius:24px;padding:36px;
            display:flex;align-items:center;justify-content:center;
            font-family:'Noto Sans KR',sans-serif;font-size:36px;color:#e2e8f0;text-align:center;">
  카드 본문 텍스트
</div>
```

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

**이미지** — div 안에 `<img>`, object-fit으로 채움:
```html
<div style="position:absolute;left:1020px;top:360px;width:780px;height:450px;border-radius:24px;overflow:hidden;">
  <img src="https://example.com/photo.jpg" alt=""
       style="width:100%;height:100%;object-fit:cover;display:block;" />
</div>
```

**아이콘** — Font Awesome 등 아이콘 폰트는 클래스가 있어야 글리프가 추출된다. `<head>`에
해당 폰트 CSS를 link하고 `<i class="fas fa-star"></i>` 형태로. 클래스 없는 빈 `<i>`는 깨진다.
인라인 `<svg>`도 텍스트 안에서 보존된다.

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

**피할 것 (추출이 망가지는 패턴)**
- 레이아웃을 **JS로** 잡기, `<canvas>`/WebGL 그리기 → 추출 안 됨.
- 반응형 단위(`vw`,`vh`,`%` 폭, `clamp()`)로 핵심 배치 → 폭/줄바꿈이 어긋남. px로.
- `opacity:0`로 내용 숨기기 → 숨김 처리되어 사라짐(보일 내용만 둘 것).
- `position:fixed`/`onclick` 요소에 **슬라이드 콘텐츠**를 담기 → 내비로 간주되어 제외됨.
- `scale()` 외 복합 transform(skew/3D) → scale만 반영되고 나머지 소실.
- `::before content:attr()/counter()/url()`, `<input>` placeholder → 추출 안 됨.

## 형식 데모 (2장 — 배선 확인용. 색·레이아웃은 복제하지 말 것)

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

  <div class="slide active" style="width:1920px;height:1080px;background:linear-gradient(135deg,#0f172a,#1e293b);font-family:'Noto Sans KR',sans-serif;">
    <div style="position:absolute;left:120px;top:360px;width:1500px;height:210px;font-size:108px;font-weight:900;color:#f8fafc;line-height:1.05;">2026 1분기 리뷰</div>
    <div style="position:absolute;left:120px;top:600px;width:1350px;height:90px;font-size:42px;color:#94a3b8;">성장 지표와 다음 분기 방향</div>
    <div style="position:absolute;left:120px;top:180px;width:96px;height:12px;background:#818cf8;border-radius:6px;"></div>
  </div>

  <div class="slide" style="width:1920px;height:1080px;background:#0f172a;font-family:'Noto Sans KR',sans-serif;">
    <div style="position:absolute;left:120px;top:120px;width:1680px;height:105px;font-size:72px;font-weight:900;color:#f8fafc;">핵심 지표</div>
    <div style="position:absolute;left:120px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#818cf8;font-size:84px;font-weight:900;">+38%</div>
    <div style="position:absolute;left:120px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">매출 성장</div>
    <div style="position:absolute;left:690px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;align-items:center;justify-content:center;color:#34d399;font-size:84px;font-weight:900;">12.4k</div>
    <div style="position:absolute;left:690px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">신규 사용자</div>
    <div style="position:absolute;left:1260px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;align-items:center;justify-content:center;color:#f472b6;font-size:84px;font-weight:900;">96%</div>
    <div style="position:absolute;left:1260px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">유지율</div>
  </div>

</body>
</html>
```

이대로 사용자가 복사 → Genitor 캔버스에 붙여넣기 하면 각 텍스트/도형/이미지가 편집 가능한
요소로 들어가고, 첫 장·둘째 장이 페이지로 분리된다. 실제 덱에선 이 골격은 유지하되
**색·폰트·장별 레이아웃을 주제에 맞게 새로** 디자인한다.
