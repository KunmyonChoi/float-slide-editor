# float-editor 비디오 매팅 서버 — RVM(Robust Video Matting) → 알파 WebM(투명 영상)
#   amd64: CUDA torch(cu121) — NVIDIA GPU는 `--gpus all`로 가속, 없으면 자동 CPU 폴백
#   arm64: CPU torch
# RVM 모델은 torch.hub(GitHub) 로드 → 빌드 시 미리 받아 런타임 네트워크 제거.
# ffmpeg(libvpx)로 영상 디코드 + 알파 WebM(VP8/VP9 yuva420p) 인코드.
#
# 멀티아치 빌드/푸시:
#   docker buildx build --platform linux/amd64,linux/arm64 -t dilly97/float-matte --push video-matting-server
# 단일 아키 로컬 빌드:
#   docker build -t dilly97/float-matte video-matting-server
FROM python:3.12-slim
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# 아키텍처별 torch: amd64=CUDA(cu121, GPU 가능), 그 외=CPU
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121; \
    else \
      pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu; \
    fi \
 && pip install --no-cache-dir -r requirements.txt

COPY . .
ENV TORCH_HOME=/app/.torch-cache

# RVM 모델(mobilenetv3) 사전 다운로드 → 첫 요청 콜드스타트/런타임 네트워크 제거
RUN python -c "import torch; torch.hub.load('PeterL1n/RobustVideoMatting','mobilenetv3',trust_repo=True)"

EXPOSE 8325
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 8325"]
