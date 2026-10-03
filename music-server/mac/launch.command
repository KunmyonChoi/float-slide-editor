#!/bin/sh
# Genitor 음악 생성 서버(YuE2) — macOS 네이티브 실행기(더블클릭).
# 첫 실행 시 install_mac.sh가 uv·Python·torch(MPS)·YuE2·모델(약 7.8 GB)을 자동 설치한다.
# 이후 실행은 설치 확인만 하고 바로 서버를 띄운다.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${GENITOR_MUSIC_HOME:-$HOME/Library/Application Support/genitor-music}"
PORT="${MUSIC_PORT:-8326}"

echo "── Genitor 음악 생성 서버 (YuE2 · macOS) ──"
sh "$DIR/install_mac.sh"

export GENITOR_MUSIC_HOME="$HOME_DIR"
cd "$DIR"
echo "서버 시작 → http://localhost:$PORT   (이 창을 닫거나 Ctrl+C 로 종료)"
exec "$HOME_DIR/.venv/bin/python" -m uvicorn server:app --host 127.0.0.1 --port "$PORT"
