---
name: genitor-higgsfield
description: >-
  Generate a Genitor-editable slide deck whose imagery and video are produced by
  Higgsfield AI. Use this when a user wants a deck for the Genitor editor
  (float-editor) that needs original AI visuals — e.g. "make a 6-slide pitch deck
  with AI hero images I can edit in Genitor", "build Genitor slides and generate
  the product shots with Higgsfield", "animate the cover with Higgsfield and put
  it in a Genitor deck". This skill is the BRIDGE: it drives the Higgsfield CLI
  to create assets, then embeds the returned hosted URLs into the exact HTML
  format Genitor imports losslessly (see the genitor-slides skill for that
  format). The user then hands off the single HTML file to Genitor.
---

# Genitor × Higgsfield 핸드오프 브리지

이 스킬은 두 도구를 **합성**한다:

1. **Higgsfield CLI** — 이미지/영상/오디오를 생성하고 **hosted URL**을 돌려준다.
2. **Genitor 슬라이드 규약**(`genitor-slides` 스킬) — 그 URL을 고정 캔버스 위
   `position:absolute` 인라인 div에 꽂아 **단일 자립형 `.html` 덱**으로 출력한다.

결과 HTML을 사용자가 Genitor 캔버스에 **붙여넣기(Ctrl/Cmd+V)** 하면 각 텍스트·도형·
이미지·비디오가 편집 가능한 요소로 들어간다. Genitor는 import 시 원격 이미지/영상 URL을
가능한 경우 내부 저장소로 내려받아 **덱을 자립형으로** 만든다(아래 "URL 내구성" 참고).

> **먼저 `genitor-slides` 스킬을 읽어라.** 캔버스 크기(1280×720 또는 1920×1080),
> `position:absolute` px 배치, 카드+텍스트 병합, 추출이 깨지는 패턴 등 **레이아웃 규약은
> 전부 그 스킬이 정본**이다. 이 스킬은 "그 규약 + Higgsfield 자산"만 추가로 다룬다.

## 0. 사전 준비 (한 번)

```bash
# Higgsfield CLI 설치
curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
# 브라우저 device-flow 로그인 (API 키 불필요, ~/.config/higgsfield/credentials.json 저장)
higgsfield auth login
```

설치가 안 됐거나 `higgsfield: command not found`면 위 두 줄을 먼저 실행하도록 안내한다.
인증이 안 되어 있으면 `higgsfield auth login`을 실행하게 한다. **직접 API 호출 금지** —
CLI만 사용한다(인증·재시도·검증을 CLI가 처리).

## 1. 워크플로

1. **덱 뼈대부터 설계** — `genitor-slides` 규약대로 슬라이드 수·레이아웃·각 요소의
   `left/top/width/height`(px)를 먼저 확정한다. **어떤 요소가 이미지/영상인지, 그 박스의
   정확한 px 크기와 종횡비**를 여기서 정한다(생성 해상도를 이 박스에 맞추기 위함).
2. **필요한 자산만 생성** — 각 이미지/영상 요소마다 Higgsfield CLI를 호출한다.
   `--wait`로 완료까지 블록하고 결과 URL을 받는다. 여러 자산이 필요하면 순차로,
   한 번에 하나씩 만든다(배치 질문 금지).
3. **URL 임베드** — 받은 hosted URL을 해당 요소의 `<img src>` / `<video src>`에 넣는다.
4. **단일 HTML로 출력** — `genitor-slides` 스캐폴드에 모든 요소를 합쳐 하나의
   `<!DOCTYPE html>` 문서로 내보낸다.
5. **핸드오프 안내** — "이 HTML 소스를 복사해 Genitor 캔버스에서 Ctrl/Cmd+V" 또는
   `.html`로 저장해 드래그&드롭/파일 열기.

## 2. 자산 생성 명령 (요소 박스에 맞춰)

박스가 `width:520px; height:300px`(≈16:9)면 그 종횡비로 생성한다. Higgsfield는 정확한
px가 아니라 **종횡비 + 해상도 프리셋**을 받는다 — 요소 박스에 가장 가까운 종횡비를 고른다.

**이미지 (기본 `gpt_image_2`):**

```bash
higgsfield generate create gpt_image_2 \
  --prompt "editorial product hero shot of a matte-black espresso machine on concrete, soft window light, muted palette" \
  --aspect_ratio 16:9 --resolution 2k --wait
```

- 흔한 종횡비: `16:9`(와이드/히어로), `1:1`(아이콘/정사각 카드), `4:3`, `3:4`/`9:16`(세로).
- 요소 박스의 `width/height` 비율에 가장 가까운 것을 고른다(예: 520×300→16:9, 360×360→1:1).
- 캐릭터/일러스트 톤이면 `nano_banana_2`, 참조 이미지가 있으면 `--image ./ref.png`.

**영상 (기본 `seedance_2_0`):**

```bash
higgsfield generate create seedance_2_0 \
  --prompt "slow dolly-in across a foggy mountain ridge at dawn, cinematic" \
  --duration 8 --resolution 2k --wait
# 정지 이미지에서 시작(이미지→영상): --start-image ./cover.png
```

**모델/파라미터가 불확실하면** 먼저 카탈로그를 조회한다:

```bash
higgsfield model list --json          # 사용 가능한 모델(job_set_type)
higgsfield model get gpt_image_2 --json   # 특정 모델의 허용 파라미터
```

**CLI 사용 규칙 (Higgsfield 스킬과 동일):**
- `generate create ... --wait`를 항상 쓴다(완료까지 블록 + 결과 URL 출력).
- 결과에서 **최종 hosted URL**만 취해 HTML에 넣는다. raw job ID·JSON 덤프는 사용자에게 노출 금지.
- 한 번에 하나씩 생성하고, 합리적 기본값을 먼저 고른다.

## 3. 임베드 레시피 (genitor-slides 형식)

받은 URL을 요소 박스에 `object-fit:cover`로 채운다. **박스는 미리 정한 px 그대로.**

**이미지 요소:**

```html
<div style="position:absolute;left:680px;top:200px;width:520px;height:300px;
            border-radius:16px;overflow:hidden;">
  <img src="https://media.higgsfield.ai/…/result.png" alt=""
       style="width:100%;height:100%;object-fit:cover;display:block;" />
</div>
```

**영상 요소** (Genitor가 `<video>`의 src·재생 속성을 보존한다):

```html
<div style="position:absolute;left:80px;top:120px;width:1120px;height:480px;
            border-radius:16px;overflow:hidden;">
  <video src="https://media.higgsfield.ai/…/result.mp4"
         autoplay muted loop playsinline
         style="width:100%;height:100%;object-fit:cover;display:block;"></video>
</div>
```

**전체 배경 이미지**(슬라이드를 꽉 채우는 히어로) — 배경은 `.slide` 위에 풀캔버스 박스로:

```html
<div style="position:absolute;left:0;top:0;width:1280px;height:720px;overflow:hidden;z-index:0;">
  <img src="https://media.higgsfield.ai/…/hero.png" alt=""
       style="width:100%;height:100%;object-fit:cover;display:block;" />
</div>
<!-- 그 위에 가독성용 반투명 오버레이 + 텍스트를 z-index로 얹는다 -->
<div style="position:absolute;left:0;top:0;width:1280px;height:720px;
            background:linear-gradient(180deg,rgba(15,23,42,.1),rgba(15,23,42,.75));z-index:1;"></div>
<div style="position:absolute;left:80px;top:520px;width:900px;height:120px;z-index:2;
            font-family:'Noto Sans KR',sans-serif;font-size:56px;font-weight:900;color:#fff;">제목</div>
```

## 4. URL 내구성 (중요)

Higgsfield hosted URL은 **영구·공개 보장이 아닐 수 있다**(만료/접근제한 가능).
Genitor는 덱 import 시 원격 이미지/영상 URL을 가능한 한 내부 저장소(idb)로 내려받아
덱을 자립형으로 만든다 — 단 **Higgsfield CDN이 cross-origin(CORS) 접근을 허용할 때만**
성공한다. 따라서:

- **사용자에게 안내**: 생성된 자산이 든 덱은 **Genitor로 가져온 뒤 곧바로 `.flatproj`로
  저장**하면 원격 URL 만료와 무관하게 보존된다.
- URL이 만료돼 이미지가 깨져 보이면, 해당 자산을 다시 생성해 URL을 교체한다.
- (에이전트가 로컬에 자산이 필요하면 URL을 파일로 내려받아 둘 수 있으나, **덱 HTML에는
  data: URI 대신 hosted URL을 넣는다** — 거대한 base64는 Genitor 편집 성능을 해친다.)

## 5. 하지 말 것

- **직접 Higgsfield API 호출**(REST) — CLI만. 공개 API 키가 없고 CLI가 인증을 쥔다.
- **data: URI로 이미지 임베드** — 붙여넣기 시 거대 base64가 편집 히스토리에 복제돼 성능 저하.
  hosted URL을 쓰고 내구성은 Genitor의 저장/materialize에 맡긴다.
- **반응형 단위/JS 레이아웃** — `genitor-slides` 규약대로 px 고정 배치만.
- **한 번에 여러 자산을 몰아 질문** — 하나씩, 기본값 우선.

## 6. 최소 예시 (표지 1장)

사용자: "Genitor에서 편집할 표지 한 장 만들어줘. 배경은 새벽 산맥 시네마틱 이미지를 Higgsfield로."

```bash
higgsfield generate create gpt_image_2 \
  --prompt "cinematic foggy mountain ridge at dawn, muted teal palette, wide" \
  --aspect_ratio 16:9 --resolution 2k --wait
# → https://media.higgsfield.ai/…/dawn.png
```

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><title>표지</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1280px; height: 720px; overflow: hidden; position: relative; background: #0f172a; }
.slide { position: absolute; inset: 0; display: none; overflow: hidden; background: #fff; }
.slide.active { display: block; }
</style>
</head>
<body>
  <div class="slide active" style="width:1280px;height:720px;font-family:'Noto Sans KR',sans-serif;">
    <div style="position:absolute;left:0;top:0;width:1280px;height:720px;overflow:hidden;z-index:0;">
      <img src="https://media.higgsfield.ai/…/dawn.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
    </div>
    <div style="position:absolute;left:0;top:0;width:1280px;height:720px;z-index:1;background:linear-gradient(180deg,rgba(15,23,42,.15),rgba(15,23,42,.8));"></div>
    <div style="position:absolute;left:80px;top:470px;width:1000px;height:110px;z-index:2;font-size:64px;font-weight:900;color:#f8fafc;line-height:1.05;">새벽의 능선</div>
    <div style="position:absolute;left:80px;top:600px;width:900px;height:50px;z-index:2;font-size:26px;color:#cbd5e1;">2026 브랜드 필름 제안</div>
  </div>
</body>
</html>
```

→ 사용자에게: "이 HTML 소스를 복사해 Genitor 캔버스에서 Ctrl/Cmd+V 하세요. 가져온 뒤
바로 `.flatproj`로 저장하면 이미지가 영구 보존됩니다."
