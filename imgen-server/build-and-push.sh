#!/usr/bin/env sh
# float-imgen 이미지 빌드 + Docker Hub 푸시. amd64/CUDA 전용(9.3B fp8은 사실상 NVIDIA GPU 필요 →
# arm64/Apple 멀티아치 무의미). 최초 1회 docker login 필요.
#   sh imgen-server/build-and-push.sh
set -e
IMAGE="dilly97/float-imgen"
DIR="$(dirname "$0")"

docker build -t "$IMAGE:latest" "$DIR"
docker push "$IMAGE:latest"
echo "==> 푸시 완료(amd64): $IMAGE:latest"
