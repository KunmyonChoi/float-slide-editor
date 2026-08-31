# 가라오케 자막(STT 기반) 기능

발표자 노트 음성(AI TTS로 생성했든, 사람이 녹음했든)을 텍스트로 인식해, 발표 중 재생 시간에 맞춰
단어를 하나씩 하이라이트하는 자막을 보여준다. 발표 모드(`FlatPresenter`) 좌하단 나레이션 컨트롤에
`CC` 토글 버튼으로 켜고 끌 수 있다.

## 사용 흐름

1. 슬라이드 노트 패널에서 노트를 쓰고, AI 음성을 생성하거나(✨ 나레이션 음성) 직접 녹음/업로드한다.
2. F5로 발표를 시작하면 나레이션 컨트롤(좌하단)에 `CC` 버튼이 나타난다.
3. `CC`를 누르면 현재 슬라이드 음성을 whisper-1로 전사해 단어별 타임스탬프를 받고, 화면 하단에
   자막을 표시한다. 활성 단어는 노란색으로 강조된다.
4. 같은 음성은 브라우저(localStorage)에 전사 결과를 캐시하므로, 같은 덱을 다시 발표할 때는
   API를 재호출하지 않는다(음성을 교체하면 캐시가 자연히 무효화된다).

## 사용한 API와 선택 이유

- **OpenAI `/v1/audio/transcriptions`, 모델 `whisper-1`.**
  단어 단위 타임스탬프(`timestamp_granularities=word`)를 지원하는 OpenAI 호스팅 모델은 이 저장소
  조사 시점(2026-08) 기준 whisper-1이 유일하다. `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`는
  전반적인 인식 정확도는 더 높지만 `verbose_json`과 타임스탬프 세분화를 지원하지 않아, 가라오케처럼
  단어 단위 타이밍이 필요한 용도로는 쓸 수 없다.
- 이미 이 저장소가 OpenAI 키(TTS·이미지·챗 공용, `src/core/OpenAIClient.js`)로 통합돼 있어, 같은 키로
  바로 쓸 수 있는 OpenAI STT를 선택했다. 별도 STT 벤더(Deepgram, AssemblyAI, Google/Azure STT 등)는
  키·과금 계정이 추가로 필요해 이번 범위에서는 제외했다 — 다만 `SttClient.js`의 `transcribeSpeech()`
  시그니처(`Blob → {text, words}`)는 다른 벤더로 교체해도 호출부(`FlatPresenter`, `KaraokeCaptions`)를
  건드리지 않도록 의도적으로 벤더 중립적으로 설계했다.
- 업로드 제한 25MB, 지원 포맷(mp3/mp4/m4a/wav/webm/ogg/flac 등)은 OpenAI 문서 기준.

## 정확도 측정 방법론

`scripts/measure-stt-accuracy.mjs`로 두 가지 방식을 지원한다.

1. **왕복(round-trip) 모드(기본)** — 발표자 노트 스타일 한국어 샘플 문장을 OpenAI TTS로 음성화한 뒤
   whisper-1로 다시 전사해 원문과 비교한다. 사람이 정답 스크립트를 만들 필요가 없어 반복 실행하기
   쉬운 회귀 테스트에 가깝다. **단, "깨끗한 OpenAI TTS 음성"에 대한 정확도**이며, 실제 사람이
   녹음한 나레이션(주변 잡음, 발음, 마이크 품질, 사투리 등)의 정확도를 그대로 대변하지는 않는다.
2. **manifest 모드** — 실제 녹음 파일 + 사람이 만든 정답 텍스트 쌍(JSON)을 주면 그 오디오를 그대로
   전사해 비교한다. 실사용에 가까운 정확도를 재려면 이 모드를 쓴다.

두 모드 모두 다음 지표를 낸다(`src/core/karaoke.js`):

- **WER(Word Error Rate)** — 공백 기준 토큰 단위 편집거리 / 정답 단어 수. 영어권에서 흔히 쓰는 표준
  지표.
- **CER(Character Error Rate)** — 문자(코드포인트) 단위 편집거리 / 정답 글자 수(기본은 공백 제외).
  한국어는 형태소 경계가 공백과 정확히 일치하지 않아(예: 조사 결합) WER만으로는 오차가 부풀려질 수
  있다 — CER을 보조 지표로 함께 본다.

```bash
OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs
OPENAI_API_KEY=sk-... node scripts/measure-stt-accuracy.mjs --manifest samples/manifest.json --out report.json
```

이 저장소의 실행 환경에는 `OPENAI_API_KEY`가 없어 이번 변경에서 실제 API를 호출해 수치를 내지는
못했다 — 위 명령을 키를 가진 환경에서 직접 실행해 확인해야 한다. 대신 WER/CER 계산 로직 자체는
`src/test/karaoke.test.js`에서 알려진 편집(치환/삽입/삭제) 케이스로 단위 테스트했다.

## 자막 줄 나누기(karaoke.js)

단어 배열을 화면에 함께 표시할 자막 줄(cue)로 묶을 때, 다음 기준 중 먼저 오는 것으로 끊는다:

- 단어가 문장부호(`. ! ? … 。`)로 끝남 — whisper-1은 대개 문장부호를 단어에 그대로 붙여 반환한다.
- 이전 단어와 1초 이상 침묵(문장부호가 없는 구간을 보완).
- 자막 줄이 최대 단어수(기본 10)에 도달.

한국어 종결어미(다/요)만으로 문장 끝을 판단하지는 않는다 — "근데요", "그래요"처럼 문장 중간에도
흔히 나타나 오탐이 많기 때문이다.

## 알려진 한계 / 다음 단계

- 전사 결과는 프로젝트 파일(`.flatproj`)에 저장되지 않는 파생 캐시다(같은 브라우저에서만 유지).
  프로젝트를 다른 기기로 옮기면 다시 전사된다 — 필요하면 `.flatproj` 스키마에 편입하는 후속 작업으로
  분리할 수 있다.
- whisper-1은 화자 분리(diarization)를 지원하지 않는다 — 발표자 1인 나레이션을 전제로 한다.
- 단어 타임스탬프 자체의 정밀도(예: ±100ms 오차)는 API가 검증 수단을 제공하지 않아 이 도구로 직접
  측정하지 않는다. 텍스트 정확도(WER/CER)만 측정한다.
