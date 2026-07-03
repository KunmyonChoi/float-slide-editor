---
name: genitor-higgsfield
description: >-
  Generate a Genitor-editable slide deck whose imagery and video are produced by
  Higgsfield AI. Use this when a user wants a deck for the Genitor editor
  (float-editor) that needs original AI visuals — e.g. "make a 6-slide pitch deck
  with AI hero images I can edit in Genitor", "build Genitor slides and generate
  the product shots with Higgsfield", "animate the cover with Higgsfield and put
  it in a Genitor deck". This skill is the BRIDGE only: it delegates the actual
  generation to whatever Higgsfield surface is available (the official Higgsfield
  Generate skill or CLI in Claude Code; the Higgsfield MCP connector in Claude
  Desktop / claude.ai), then embeds the returned hosted URLs into the exact HTML
  format Genitor imports losslessly (see the genitor-slides skill for that
  format). The user then hands off the single HTML file to Genitor.
---

# Genitor × Higgsfield 핸드오프 브리지

이 스킬은 **합성(bridge)만** 담당한다. **자산 생성 자체는 다시 가르치지 않고 위임한다.**

- **생성 = Higgsfield의 공식 도구**(Generate 스킬 / CLI / MCP)가 정본. 모델명·플래그·인증은
  전부 그쪽이 소유한다. 이 스킬은 그걸 재기술하지 않는다(플래그가 바뀌어도 안 낡도록).
- **이 스킬이 소유하는 것 = Genitor 고유 계약**: 요소 박스 크기·종횡비에 맞춘 생성 요청,
  받은 hosted URL을 genitor-slides 스캐폴드에 임베드, URL 내구성, 핸드오프.

> **먼저 `genitor-slides` 스킬을 읽어라.** 캔버스 크기(1280×720 또는 1920×1080),
> `position:absolute` px 배치, 카드+텍스트 병합, 추출이 깨지는 패턴 등 **레이아웃 규약은
> 전부 그 스킬이 정본**이다. 이 스킬은 "그 규약 + Higgsfield 자산"만 추가로 다룬다.

결과 HTML을 사용자가 Genitor 캔버스에 **붙여넣기(Ctrl/Cmd+V)** 하면 각 텍스트·도형·
이미지·비디오가 편집 가능한 요소로 들어간다. Genitor는 import 시 원격 이미지/영상 URL을
가능한 경우 내부 저장소로 내려받아 **덱을 자립형으로** 만든다(아래 "URL 내구성" 참고).

## 0. 생성 경로 고르기 (환경에 따라 위임)

지금 도는 환경에서 쓸 수 있는 Higgsfield 표면을 하나 고른다. **어느 쪽이든 이 스킬은
"박스에 맞는 종횡비로 자산 하나 생성 → 최종 hosted URL 회수"까지만 요구**한다.

- **Claude Code (셸 있음)** — 공식 **Higgsfield Generate 스킬**이나 **CLI**를 쓴다.
  - 공식 스킬 설치: `npx skills add higgsfield-ai/skills`
  - 인증(한 번): `higgsfield auth login` → 이어서 `higgsfield workspace list` 후
    `higgsfield workspace set <workspace_id>` (워크스페이스 미선택 시 명령이 실패한다).
  - 모델·플래그는 공식 스킬/CLI가 정본. 확실치 않으면 `higgsfield model list --json`,
    `higgsfield model get <model> --json`로 **직접 조회**한다(이 문서에 외우지 않는다).
- **Claude Desktop / claude.ai (셸 없음)** — **Higgsfield MCP 커넥터**를 쓴다.
  - 연결(한 번): Settings ▸ Connectors ▸ Add custom connector →
    URL `https://mcp.higgsfield.ai/mcp` → Connect → Higgsfield 계정 로그인(OAuth, API 키 불필요).
  - 연결되면 이미지/영상 생성 도구가 대화에서 바로 호출된다.

**공통 규칙**: 한 번에 자산 하나씩, 합리적 기본값 먼저. 결과에서 **최종 hosted URL만** 취하고
raw job ID·JSON 덤프는 사용자에게 노출하지 않는다. **직접 REST API 호출 금지**(공개 키 없음 —
인증은 공식 도구가 쥔다).

## 1. 워크플로

1. **덱 뼈대부터 설계** — `genitor-slides` 규약대로 슬라이드 수·레이아웃·각 요소의
   `left/top/width/height`(px)를 먼저 확정한다. **어떤 요소가 이미지/영상인지, 그 박스의
   정확한 px 크기와 종횡비**를 여기서 정한다(생성 종횡비를 이 박스에 맞추기 위함).
2. **필요한 자산만 생성** — 각 이미지/영상 요소마다 위에서 고른 Higgsfield 표면으로
   자산을 하나씩 만들고 hosted URL을 받는다. **박스 종횡비에 맞춰 요청**한다(아래 표).
3. **URL 임베드** — 받은 hosted URL을 해당 요소의 `<img src>` / `<video src>`에 넣는다.
4. **단일 HTML로 출력** — `genitor-slides` 스캐폴드에 모든 요소를 합쳐 하나의
   `<!DOCTYPE html>` 문서로 내보낸다.
5. **핸드오프 안내** — "이 HTML 소스를 복사해 Genitor 캔버스에서 Ctrl/Cmd+V" 또는
   `.html`로 저장해 드래그&드롭/파일 열기.

## 2. 박스 → 종횡비 매핑 (이 스킬이 소유하는 유일한 생성 파라미터)

Higgsfield는 정확한 px가 아니라 **종횡비 + 해상도 프리셋**을 받는다. 요소 박스의
`width/height` 비율에 **가장 가까운 종횡비**를 골라 생성 도구에 넘긴다:

| 요소 박스(예) | 비율 | 요청 종횡비 |
|---|---|---|
| 520×300, 1120×630, 풀캔버스 1280×720 | ≈16:9 | `16:9` |
| 360×360 카드, 아이콘 | 1:1 | `1:1` |
| 640×480 | 4:3 | `4:3` |
| 360×640 세로 히어로, 모바일 | 9:16 | `9:16` |
| 세로 카드 | 3:4 | `3:4` |

- 해상도는 넉넉히(예: 2K) — Genitor에서 박스에 `object-fit:cover`로 채운다.
- 참조 이미지가 있으면 공식 도구의 image/start-image 파라미터로 전달한다(플래그명은 공식 도구 참조).
- 정지 이미지 → 영상(image-to-video)도 마찬가지로 공식 도구의 start-image 입력을 쓴다.

> 구체적 CLI 예시가 필요하면 공식 Higgsfield Generate 스킬을 참조한다. 이 문서는 명령을
> 외우지 않는다 — 요구는 "박스 비율에 맞는 자산 하나 + 최종 URL"뿐이다.

## 3. 임베드 레시피 (genitor-slides 형식 — 이 스킬의 핵심)

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

- **직접 Higgsfield REST API 호출** — 공개 API 키가 없다. 인증은 공식 도구(스킬/CLI/MCP)가 쥔다.
- **생성 명령·모델명·플래그를 이 스킬에 하드코딩** — 공식 도구가 정본. 낡으면 그쪽을 따른다.
- **data: URI로 이미지 임베드** — 붙여넣기 시 거대 base64가 편집 히스토리에 복제돼 성능 저하.
  hosted URL을 쓰고 내구성은 Genitor의 저장/materialize에 맡긴다.
- **반응형 단위/JS 레이아웃** — `genitor-slides` 규약대로 px 고정 배치만.
- **한 번에 여러 자산을 몰아 질문** — 하나씩, 기본값 우선.

## 6. 최소 예시 (표지 1장)

사용자: "Genitor에서 편집할 표지 한 장 만들어줘. 배경은 새벽 산맥 시네마틱 이미지를 Higgsfield로."

1. 표지 레이아웃 확정(풀캔버스 배경 1280×720 → 비율 **16:9**).
2. 현재 환경의 Higgsfield 표면으로 16:9 이미지 하나 생성(Claude Code면 공식 Generate 스킬/CLI,
   Desktop이면 MCP 커넥터) → 예: `https://media.higgsfield.ai/…/dawn.png`.
3. genitor-slides 스캐폴드에 임베드:

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
