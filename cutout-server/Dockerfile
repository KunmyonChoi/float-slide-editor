# float-editor 피사체 분리 서버 — 단일 멀티플랫폼 이미지 (BiRefNet, MIT)
#   amd64: CUDA torch(cu121) — NVIDIA GPU는 `--gpus all`로 가속, 없으면 자동 CPU 폴백
#   arm64: CPU torch — Apple Silicon/arm 리눅스 (Docker는 GPU 미지원이라 CPU)
# CUDA 런타임은 pip torch 휠에 포함되므로 slim 베이스로 충분(호스트엔 NVIDIA 드라이버 + nvidia-container-toolkit만 필요).
#
# 멀티아치 빌드/푸시:
#   docker buildx build --platform linux/amd64,linux/arm64 -t dilly97/float-cutout --push cutout-server
# 단일 아키 로컬 빌드:
#   docker build -t dilly97/float-cutout cutout-server
FROM python:3.12-slim
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
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
ENV HF_HOME=/app/.hf-cache

EXPOSE 8322
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 8322"]
