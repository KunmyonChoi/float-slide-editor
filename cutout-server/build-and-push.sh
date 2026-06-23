#!/usr/bin/env sh
# float-cutout 단일 멀티플랫폼 이미지 빌드 + Docker Hub 푸시.
#   amd64=CUDA(GPU 가능), arm64=CPU → 하나의 태그 dilly97/float-cutout:latest
#
# 사용:
#   docker login                          # 최초 1회(Docker Hub 자격증명)
#   sh cutout-server/build-and-push.sh
set -e
IMAGE="dilly97/float-cutout"
DIR="$(dirname "$0")"

# buildx 빌더 준비(없으면 생성)
docker buildx use float-cutout-builder 2>/dev/null || docker buildx create --use --name float-cutout-builder

docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$IMAGE:latest" \
  --push "$DIR"

echo "==> 푸시 완료: $IMAGE:latest  (amd64=CUDA/GPU, arm64=CPU)"
