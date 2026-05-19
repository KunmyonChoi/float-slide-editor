#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$SCRIPT_DIR/pptx-server/.venv"
SERVER_DIR="$SCRIPT_DIR/pptx-server"

# Check Python availability
PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PYTHON="$cmd"; break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[pptx-server] Python not found. PPTX export will use browser fallback."
  sleep infinity
fi

# Create venv if needed
if [ ! -d "$VENV_DIR" ]; then
  echo "[pptx-server] Creating virtual environment..."
  "$PYTHON" -m venv "$VENV_DIR"
fi

# Install deps if needed
if [ ! -f "$VENV_DIR/.installed" ]; then
  echo "[pptx-server] Installing dependencies..."
  "$VENV_DIR/bin/pip" install -q -r "$SERVER_DIR/requirements.txt"
  touch "$VENV_DIR/.installed"
fi

echo "[pptx-server] Starting on port 8321..."
export PYTHONPATH="$SERVER_DIR"
exec "$VENV_DIR/bin/uvicorn" server:app --host 127.0.0.1 --port 8321
