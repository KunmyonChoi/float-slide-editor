#!/bin/sh
# Genitor 피사체 분리 서버 — macOS 네이티브 실행기(더블클릭).
# 첫 실행 시 uv로 Python·의존성 자동 설치(선설치 불필요). Apple Silicon은 MPS GPU 가속.
# 무거운 토치/모델은 첫 실행 때만 받고 이후엔 바로 시작된다.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APPSUP="$HOME/Library/Application Support/genitor-cutout"
VENV="$APPSUP/.venv"
mkdir -p "$APPSUP"
export PATH="$HOME/.local/bin:$PATH"

echo "── Genitor 피사체 분리 서버 (macOS) ──"

# uv(파이썬·패키지 관리자) 확보 — 없으면 설치(Python까지 자동 확보)
if ! command -v uv >/dev/null 2>&1; then
  echo "uv 설치 중…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# venv + 의존성(최초 1회, 이후 빠르게 통과). macOS 기본 torch 휠 = MPS 지원.
[ -d "$VENV" ] || uv venv --python 3.12 "$VENV"
. "$VENV/bin/activate"
echo "의존성 확인/설치 중… (최초 실행은 수 분 — torch 다운로드)"
uv pip install --quiet torch torchvision
uv pip install --quiet -r "$DIR/requirements.txt"

cd "$DIR"
echo "서버 시작 → http://localhost:8322   (이 창을 닫거나 Ctrl+C 로 종료)"
exec uvicorn server:app --host 0.0.0.0 --port 8322
