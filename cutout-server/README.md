# float-cutout — 피사체(전경) 분리 서버

이미지에서 인물/객체(전경)를 알파 PNG로 분리한다. **BiRefNet(MIT)** 을 PyTorch로 GPU에서 실행 —
브라우저(WebGPU 셰이더 버퍼 한도 / WASM 메모리)에서 막혔던 BiRefNet을 서버에서 고품질로 처리한다.
에디터의 "피사체 뒤 텍스트" 기능 백엔드.

## API
- `GET  /api/health` → `{ status, build, device, model }`
- `POST /api/segment` (multipart `image`) → 전경 알파 PNG (`image/png`)

## 로컬 실행 (Docker, GPU)
전제: NVIDIA 드라이버 + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

```bash
docker build -t dilly97/float-cutout cutout-server
docker run -d --gpus all -p 8322:8322 --name float-cutout dilly97/float-cutout
curl http://localhost:8322/api/health    # {"status":"ok","device":"cuda",...}
```

- 베이스 이미지 태그(`pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime`)는 호스트 CUDA에 맞춰 조정 가능.
- 모델은 최초 실행 시 HF Hub에서 1회 다운로드(컨테이너에 캐시).
- GPU 없이 테스트하려면 `--gpus all` 생략 → CPU로 동작(느림).

## 개발(비도커) 실행
```bash
cd cutout-server
python -m venv .venv && . .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8322
```

## 프론트 연동
프론트는 `http://localhost:8322` 를 직접 호출(CORS + Private Network Access 허용).
URL 오버라이드: 브라우저 `localStorage['cutout-backend-url']` 또는 빌드 시 `VITE_CUTOUT_BACKEND_URL`.
