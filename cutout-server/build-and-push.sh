#!/usr/bin/env sh
# float-cutout 이미지 빌드 + Docker Hub 푸시.
#
# 기본(amd64 단일): 빠름 — QEMU 없음 + 로컬 레이어 캐시. NVIDIA 리눅스 GPU + 일반 CPU 커버.
#   sh cutout-server/build-and-push.sh
# 멀티아치(amd64+arm64): arm64는 QEMU 에뮬레이션이라 매우 느림. Apple Silicon은 네이티브 런처 권장.
#   sh cutout-server/build-and-push.sh multiarch
#
# 최초 1회 docker login 필요.
set -e
IMAGE="dilly97/float-cutout"
DIR="$(dirname "$0")"
MODE="${1:-amd64}"

if [ "$MODE" = "multiarch" ]; then
  docker buildx use float-cutout-builder 2>/dev/null || docker buildx create --use --name float-cutout-builder
  docker buildx build --platform linux/amd64,linux/arm64 \
    --cache-to type=inline --cache-from "$IMAGE:latest" \
    -t "$IMAGE:latest" --push "$DIR"
  echo "==> 푸시 완료(멀티아치 amd64+arm64): $IMAGE:latest"
else
  # 로컬 빌드(레이어 캐시 활용) 후 푸시 — 재빌드 시 requirements 안 바뀌면 torch 레이어 캐시로 빠름
  docker build -t "$IMAGE:latest" "$DIR"
  docker push "$IMAGE:latest"
  echo "==> 푸시 완료(amd64): $IMAGE:latest"
fi
