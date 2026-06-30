# Genitor 레이아웃 이미지 생성 서버 — Ideogram 4 (fp8). amd64/CUDA 전용.
#   ideogram-4 패키지가 torch>=2.11(cu13 휠) + transformers + bitsandbytes + accelerate를 끌어온다.
#   CUDA 런타임은 pip torch 휠에 포함 → slim 베이스로 충분(호스트엔 NVIDIA 드라이버 + nvidia-container-toolkit).
#   ⚠️ 추론 피크 VRAM ~32GB(fp8, 1024²) → 40GB급 이상 NVIDIA GPU 필요. `--gpus all` 필수.
#   ⚠️ 게이트·비상업 라이선스 모델 → 가중치는 이미지에 굽지 않고 런타임에 HF에서 받는다(HF_TOKEN 필요).
#
# 빌드/푸시:
#   sh imgen-server/build-and-push.sh        # dilly97/float-imgen:latest (amd64)
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# ideogram-4(커스텀 파이프라인 + torch/transformers/bitsandbytes 의존)를 git에서 설치 후 서버 의존성.
RUN pip install --no-cache-dir "ideogram-4 @ git+https://github.com/ideogram-oss/ideogram4" \
 && pip install --no-cache-dir -r requirements.txt

COPY . .
# HF 캐시 — 볼륨 마운트(-v ~/.cache/huggingface:/app/.hf-cache)로 ~20GB 재다운로드 방지 권장
ENV HF_HOME=/app/.hf-cache

EXPOSE 8323
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 8323"]
