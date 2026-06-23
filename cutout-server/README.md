# float-cutout — 피사체(전경) 분리 서버

이미지에서 인물/객체(전경)를 알파 PNG로 분리한다. **BiRefNet(MIT)** 을 PyTorch로 실행 —
브라우저(WebGPU 셰이더 버퍼 한도 / WASM 메모리)에서 막혔던 BiRefNet을 서버에서 고품질로 처리한다.
에디터의 "피사체 뒤 텍스트" 기능 백엔드.

디바이스 자동 감지: **CUDA(NVIDIA) > MPS(Apple Silicon 네이티브) > CPU**.

## API
- `GET  /api/health` → `{ status, build, device, model, input_size, ready }`
- `POST /api/segment` (multipart `image`) → 전경 알파 PNG (`image/png`, 헤더 `X-Inference-Ms`)

## 이미지 태그 (Docker Hub: `dilly97/float-cutout`)
| 태그 | 내용 | 용도 |
|------|------|------|
| `:gpu` | CUDA, linux/amd64 | NVIDIA GPU 리눅스 (즉시·최고속) |
| `:cpu` / `:latest` | CPU, 멀티아키(amd64·arm64) | macOS·GPU 없는 환경 등 어디서나(느림) |

## 로컬 실행
### GPU (NVIDIA 리눅스)
전제: NVIDIA 드라이버 + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
```bash
docker run -d --gpus all -p 8322:8322 --name float-cutout dilly97/float-cutout:gpu
curl http://localhost:8322/api/health    # {"device":"cuda",...}
```

### macOS / GPU 없는 환경 (CPU)
```bash
docker run -d -p 8322:8322 --name float-cutout dilly97/float-cutout:cpu
```
⚠️ **Docker on macOS는 Mac GPU(Metal/MPS)를 쓸 수 없습니다** — 컨테이너는 CPU만 사용(장당 수 초).
Apple Silicon에선 `:cpu`가 arm64 네이티브로 동작(에뮬레이션 X).

### macOS에서 GPU(MPS) 가속을 원하면 → 도커 대신 네이티브 실행
```bash
cd cutout-server
python3 -m venv .venv && . .venv/bin/activate
pip install torch torchvision          # macOS는 기본 휠이 MPS 지원
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8322   # device=mps 자동 선택
```

## Docker Hub에 올리기(빌드+푸시)
```bash
docker login                                   # 최초 1회
sh cutout-server/build-and-push.sh             # gpu + cpu(멀티아키) 모두
# 또는: sh cutout-server/build-and-push.sh cpu   /   gpu
```
멀티아키 CPU 빌드는 `docker buildx`(Docker Desktop 기본 포함)를 사용한다.

## 빌드만(푸시 없이)
```bash
docker build -t dilly97/float-cutout:gpu cutout-server                    # GPU
docker build -f cutout-server/Dockerfile.cpu -t dilly97/float-cutout:cpu cutout-server  # CPU(현재 아키)
```

## 프론트 연동
프론트는 `http://localhost:8322` 를 직접 호출(CORS + Private Network Access 허용).
URL 오버라이드: 브라우저 `localStorage['cutout-backend-url']` 또는 빌드 시 `VITE_CUTOUT_BACKEND_URL`.
- 베이스 이미지 태그·모델은 호스트에 맞춰 조정 가능(`CUTOUT_MODEL`, `CUTOUT_INPUT_SIZE`).
- 모델(BiRefNet, MIT)은 최초 실행 시 HF Hub에서 1회 다운로드되어 캐시된다.
