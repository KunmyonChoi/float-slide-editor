# float-cutout — 피사체(전경) 분리 서버

이미지에서 인물/객체(전경)를 알파 PNG로 분리한다. **BiRefNet(MIT)** 을 PyTorch로 실행 —
브라우저(WebGPU 셰이더 버퍼 한도 / WASM 메모리)에서 막혔던 BiRefNet을 서버에서 고품질로 처리한다.
에디터의 "피사체 뒤 텍스트" 기능 백엔드. 디바이스 자동 감지: **CUDA(NVIDIA) > MPS(Apple Silicon) > CPU**.

## API
- `GET  /api/health` → `{ status, build, device, model, input_size, ready }`
- `POST /api/segment` (multipart `image`) → 전경 알파 PNG (`image/png`, 헤더 `X-Inference-Ms`)

---

## 설치/실행 방법 — 두 갈래

### A. 네이티브 런처 (권장: 데스크톱 + GPU) — Docker 불필요
`uv`로 Python·의존성·모델을 첫 실행 때 자동 설치. **GPU 가속**(mac=MPS, win=CUDA).
- **macOS**: `genitor-cutout-mac.zip` 받아 압축 해제 → `launch.command` 더블클릭(첫 실행은 우클릭→열기)
- **Windows(NVIDIA)**: `genitor-cutout-win.zip` 받아 압축 해제 → `launch.bat` 더블클릭(SmartScreen→추가 정보→실행)

배포 zip 만들기(메인테이너):
```bash
sh cutout-server/package-native.sh         # → cutout-server/dist/genitor-cutout-{mac,win}.zip
gh release create latest cutout-server/dist/genitor-cutout-*.zip --title "cutout server" --notes "native launchers"
# 갱신 시: gh release upload latest cutout-server/dist/genitor-cutout-*.zip --clobber
```
앱(인앱 설치 안내)은 `releases/latest/download/genitor-cutout-{mac,win}.zip` 를 링크한다.

### B. Docker (권장: 서버/NVIDIA 리눅스, 재현성)
**단일 멀티플랫폼 이미지** `dilly97/float-cutout` (amd64=CUDA, arm64=CPU). GPU는 `--gpus all`로 opt-in.
```bash
# NVIDIA 리눅스 (GPU)
docker run -d --gpus all -p 8322:8322 --name float-cutout dilly97/float-cutout
# 그 외 (CPU) — macOS·Windows의 Docker는 GPU 불가라 CPU
docker run -d -p 8322:8322 --name float-cutout dilly97/float-cutout
curl http://localhost:8322/api/health
```

빌드/푸시(메인테이너):
```bash
docker login
sh cutout-server/build-and-push.sh             # 기본: amd64 단일(빠름) → dilly97/float-cutout:latest
sh cutout-server/build-and-push.sh multiarch   # amd64+arm64 (arm64는 QEMU라 느림 — Mac은 네이티브 런처 권장)
```

> ⚠️ **Docker on macOS/Windows는 GPU(Metal/CUDA)를 못 씁니다 → CPU(느림).** Mac/Win에서 GPU를 원하면 **A(네이티브)** 를 쓰세요.

---

## 개발(비도커) 실행
```bash
cd cutout-server
python3 -m venv .venv && . .venv/bin/activate
pip install torch torchvision         # mac=MPS / NVIDIA는 --index-url .../whl/cu121
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8322
```

## 프론트 연동
프론트는 `http://localhost:8322` 직접 호출(CORS + Private Network Access 허용).
URL 오버라이드: `localStorage['cutout-backend-url']` 또는 빌드 시 `VITE_CUTOUT_BACKEND_URL`.
모델·해상도 조절: 환경변수 `CUTOUT_MODEL`(기본 `ZhengPeng7/BiRefNet`), `CUTOUT_INPUT_SIZE`(기본 1024).
모델(BiRefNet, MIT)은 최초 실행 시 HF Hub에서 1회 다운로드되어 캐시된다.
