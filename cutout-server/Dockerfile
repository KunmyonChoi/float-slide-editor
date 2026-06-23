# float-editor 피사체 분리 서버 (FastAPI + BiRefNet, GPU)
# 빌드: docker build -t dilly97/float-cutout cutout-server
# 실행: docker run -d --gpus all -p 8322:8322 dilly97/float-cutout
#
# 참고:
# - GPU 실행에는 호스트에 NVIDIA 드라이버 + nvidia-container-toolkit 필요(`--gpus all`).
# - 베이스 이미지 태그는 호스트 CUDA/드라이버에 맞춰 조정 가능(아래는 CUDA 12.1 런타임).
# - 모델(BiRefNet, MIT)은 최초 실행 시 HF Hub에서 1회 다운로드되어 컨테이너에 캐시된다.
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

# Pillow/일부 비전 라이브러리 런타임 의존
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# HF 모델 캐시를 앱 폴더 안에 두어 재실행 시 재다운로드 방지
ENV HF_HOME=/app/.hf-cache

EXPOSE 8322
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 8322"]
