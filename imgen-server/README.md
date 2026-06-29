# float-imgen — Ideogram 4 레이아웃 이미지 생성 서버

에디터에서 **텍스트 박스 여러 개를 선택**해 만든 JSON 캡션(bbox + 텍스트 쌍)을 받아, 정밀한
레이아웃 이미지를 고품질로 생성한다. **Ideogram 4 (fp8)** 를 PyTorch/CUDA로 실행 —
`magic-prompt`는 끈다(캡션을 우리가 직접 만들기 때문 = **Ideogram API 키 불필요**).

> ⚠️ **하드웨어**: 추론 피크 VRAM **~32GB**(fp8, 1024²) → **40GB급 이상 NVIDIA GPU 필요**(예: A6000/A100/RTX 6000 Ada 48GB). 24GB 카드는 OOM. CPU/Apple은 비현실적 → **CUDA 전용**.
> ⚠️ **모델 라이선스**: Ideogram 4는 **게이트 + 비상업** 라이선스. HF에서 라이선스 동의 후 **HF 토큰** 필요. 로컬/개인 사용 전제.

## API
- `GET  /api/health` → `{ status, build, device, model, presets, ready }`
- `POST /api/generate` (JSON `{ caption, width?, height?, preset?, seed? }`) → PNG (`image/png`, 헤더 `X-Inference-Ms`)
  - `caption`: Ideogram 4 JSON 캡션. bbox는 `[y_min,x_min,y_max,x_max]` 0–1000 정규화.
  - `preset`: `V4_TURBO_12`(기본·~28s) | `V4_DEFAULT_20`(~50s) | `V4_QUALITY_48`(~127s)

## 성능(참고, 단일 48GB GPU, 1024²)
- 모델 로드(서버 기동 1회): **~3.6분** → 시작 시 워밍업으로 첫 요청 콜드스타트 제거(모델 상주).
- 요청당 추론: TURBO 12스텝 **~28s** / DEFAULT 20 **~50s** / QUALITY 48 **~127s**.

---

## Docker (권장: NVIDIA 리눅스)
가중치(~20GB)는 이미지에 굽지 않고 **런타임에 HF에서 1회 다운로드** → HF 토큰 + 캐시 볼륨 마운트.

```bash
docker login   # 메인테이너 푸시 시 1회

# 실행 — 유효한 HF 토큰(라이선스 동의 계정) + HF 캐시 볼륨(재다운로드 방지)
docker run -d --gpus all -p 8323:8323 --name float-imgen \
  -e HF_TOKEN=hf_xxxxxxxx \
  -v "$HOME/.cache/huggingface:/app/.hf-cache" \
  dilly97/float-imgen

curl http://localhost:8323/api/health   # 로드 끝나면 ready:true (기동 후 수 분)
```

빌드/푸시(메인테이너):
```bash
sh imgen-server/build-and-push.sh   # dilly97/float-imgen:latest (amd64/CUDA)
```

## 개발(비도커) 실행
```bash
cd imgen-server
python3 -m venv .venv && . .venv/bin/activate
pip install "ideogram-4 @ git+https://github.com/ideogram-oss/ideogram4"
pip install -r requirements.txt
# HF_TOKEN env가 무효면 무시되고 저장 토큰(hf auth login) 사용됨에 주의
uvicorn server:app --host 0.0.0.0 --port 8323
```

## 프론트 연동
프론트는 `http://localhost:8323` 직접 호출(CORS + Private Network Access 허용).
URL 오버라이드: `localStorage['imagen-backend-url']` 또는 빌드 시 `VITE_IMAGEN_BACKEND_URL`
→ 원격(예: 사내 GPU 서버/RunPod 프록시) 엔드포인트로 전환 가능.

환경변수: `IMGEN_WEIGHTS_REPO`(기본 `ideogram-ai/ideogram-4-fp8`), `IMGEN_DEVICE`(기본 `cuda`),
`IMGEN_WARM_PRESET`(워밍업 더미 생성 프리셋, 기본 `V4_TURBO_12`; ''면 로드만).
