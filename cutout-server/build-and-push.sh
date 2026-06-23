#!/usr/bin/env sh
# float-cutout 이미지 빌드 + Docker Hub 푸시.
#   GPU(CUDA, linux/amd64):  dilly97/float-cutout:gpu
#   CPU(멀티아키 amd64/arm64): dilly97/float-cutout:cpu  (+ :latest)
#
# 사용:
#   docker login                 # 최초 1회(Docker Hub 자격증명)
#   sh cutout-server/build-and-push.sh           # gpu + cpu 모두
#   sh cutout-server/build-and-push.sh cpu       # cpu만
#   sh cutout-server/build-and-push.sh gpu       # gpu만
set -e

IMAGE="dilly97/float-cutout"
DIR="$(dirname "$0")"
TARGET="${1:-all}"

if [ "$TARGET" = "gpu" ] || [ "$TARGET" = "all" ]; then
  echo "==> GPU 이미지 빌드/푸시 (linux/amd64): $IMAGE:gpu"
  docker build -f "$DIR/Dockerfile" -t "$IMAGE:gpu" "$DIR"
  docker push "$IMAGE:gpu"
fi

if [ "$TARGET" = "cpu" ] || [ "$TARGET" = "all" ]; then
  echo "==> CPU 멀티아키 이미지 빌드/푸시 (amd64+arm64): $IMAGE:cpu, :latest"
  # buildx 빌더 준비(없으면 생성)
  docker buildx use float-cutout-builder 2>/dev/null || docker buildx create --use --name float-cutout-builder
  docker buildx build --platform linux/amd64,linux/arm64 \
    -f "$DIR/Dockerfile.cpu" \
    -t "$IMAGE:cpu" -t "$IMAGE:latest" \
    --push "$DIR"
fi

echo "==> 완료."
