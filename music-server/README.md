# genitor-music — 음악 생성 서버 (YuE2)

텍스트 박스 내용을 지시문으로 **배경음악(연주곡)** 이나 **노래**를 만든다. 오픈 모델
[YuE2](https://github.com/multimodal-art-projection/YuE) (`m-a-p/YuE2-3B`)를 **Apple Silicon Mac의 GPU(MPS)** 로 돌린다.
에디터의 텍스트 박스 ▸ **✨ AI ▸ 음악 생성…** 의 백엔드이다. 포트는 **8326**이다.

- 연주곡: YuE2가 악보(ABC)를 쓰고, Vocal 음표를 Ins로 옮긴 뒤 렌더링한다(원본 `yue2-music` 스킬의 기본 흐름).
- 노래: style + 가사(`[Verse]` 등 구간 태그)로 `cot="full"` 생성한다.
- 길이: YuE2 플래너는 구간 태그를 그대로 따르지 않는다('짧게'에 226초 악보를 쓴 적이 있다). 그래서 악보를 쓴 뒤 `short` ≤ 75초, `medium` ≤ 120초, `long` ≤ 200초로 자른다. 자를 때는 1~4마디 그룹 단위로 앞부분을 남기고 마지막 구간(엔딩)을 붙이며, 붙임줄이 열린 곳에서는 자르지 않는다(`engine.fit_length`). 노래는 가사 길이를 따른다.
- M1 16 GB 실측: 47초 분량에 약 8분, 61초 분량에 약 12분 30초(실시간의 10~12배)가 걸리고, GPU 메모리는 최대 약 8 GB를 쓴다. 큐는 하나이고 한 번에 한 곡씩 만든다.

## API
- `GET  /api/health` → `{ status, build, device, ready, torch, detail, running, queued }`
- `POST /api/jobs` JSON `{ mode: "instrumental"|"song", style, lyrics?, length?: "short"|"medium"|"long", seed? }` → `{ id, status, ... }`
- `GET  /api/jobs/{id}` → `{ status: queued|running|done|failed|cancelled, stage, progress, error, result }`
- `GET  /api/jobs/{id}/audio?format=mp3|flac` → 결과 오디오(48 kHz 스테레오)
- `GET  /api/jobs/{id}/score` → 생성에 쓴 ABC 악보(연주곡은 Vocal→Ins 변환본)
- `POST /api/jobs/{id}/cancel`

## 설치·실행 (macOS, Apple Silicon)
1. `genitor-music-mac.zip`을 받아 압축을 푼다.
2. `launch.command`를 더블클릭한다. 미서명이라 차단되면 우클릭 → "열기"를 누르고, 그래도 막히면 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기"를 누른다.
3. 첫 실행에서는 `install_mac.sh`가 다음을 자동 설치한다. 이후 실행은 확인만 하고 바로 시작한다.
   - uv와 Python 3.12
   - YuE2 소스(검증된 커밋으로 고정)
   - torch 2.13 이상(MPS용)
   - 모델 약 7.8 GB

설치 위치는 `~/Library/Application Support/genitor-music`이다(`GENITOR_MUSIC_HOME`으로 바꿀 수 있다). 모델은 Hugging Face 캐시에 받는다.
torch는 패키지 고정값(2.10)보다 높게 설치한다. **torch 2.12 이하는 MPS에서 BF16 causal attention 버그가 있어** 결과가 아무 경고 없이 틀어진다(YuE issue #176).

설치 스크립트 원본은 **`skills/genitor-music/scripts/install_mac.sh` 하나**이고, Claude 스킬(genitor-music)과 이 서버가 함께 쓴다.

```bash
sh skills/genitor-music/scripts/install_mac.sh --check   # 설치 상태만 확인 (exit 0 = 준비 완료)
```

## 테스트
```bash
"$HOME/Library/Application Support/genitor-music/.venv/bin/python" -m unittest discover music-server/tests
```

## 배포 zip 만들기 (메인테이너)
```bash
sh music-server/package-native.sh     # → music-server/dist/genitor-music-mac.zip
gh release upload latest music-server/dist/genitor-music-mac.zip --clobber
```
앱의 설치 안내는 `releases/latest/download/genitor-music-mac.zip`을 링크한다.

## 개발 실행
```bash
sh skills/genitor-music/scripts/install_mac.sh
cd music-server && "$HOME/Library/Application Support/genitor-music/.venv/bin/python" -m uvicorn server:app --port 8326
```
프론트엔드는 `http://localhost:8326`을 직접 호출한다(CORS와 Private Network Access 허용). URL은 `localStorage['music-backend-url']` 또는 `VITE_MUSIC_BACKEND_URL`로 바꿀 수 있다.

## 라이선스
YuE2 코드와 이 서버 코드는 Apache-2.0이다. **모델 가중치는 CC BY-NC 4.0에 창작자 추가 허용 조항이 붙어 있다.** 개인과 크리에이터는 생성물을 수익화할 수 있다. 기업이 상업적으로 쓰려면 YuE2 저자에게 별도 라이선스를 받아야 한다.
