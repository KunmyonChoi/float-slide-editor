#!/bin/sh
# fonts.txt 매니페스트의 폰트를 /usr/share/fonts/custom 에 설치.
# 이미 있으면 건너뛰고(skip), 다운로드 실패는 경고만 하고 빌드는 계속한다.
set -eu
DEST=/usr/share/fonts/custom
MANIFEST="${1:-/tmp/fonts.txt}"
mkdir -p "$DEST"

[ -f "$MANIFEST" ] || { echo "no manifest: $MANIFEST"; exit 0; }

while IFS='|' read -r name url; do
  # 주석/빈 줄 스킵
  case "$name" in ''|\#*) continue ;; esac
  url=$(printf '%s' "$url" | tr -d '\r' | sed 's/^ *//; s/ *$//')
  name=$(printf '%s' "$name" | sed 's/^ *//; s/ *$//')
  [ -z "$url" ] && continue
  if [ -f "$DEST/$name" ]; then
    echo "skip (exists): $name"
    continue
  fi
  echo "download: $name"
  if ! curl -fsSL "$url" -o "$DEST/$name"; then
    echo "WARN: download failed, skipping: $name"
    rm -f "$DEST/$name"
  fi
done < "$MANIFEST"

fc-cache -f "$DEST" >/dev/null 2>&1 || true
echo "fonts installed in $DEST:"
ls -1 "$DEST" 2>/dev/null || true
