#!/usr/bin/env sh
# 네이티브 배포 zip 생성(mac) → music-server/dist/genitor-music-mac.zip
# 설치 스크립트 원본은 skills/genitor-music/scripts/install_mac.sh 하나다(스킬과 서버가 공유).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist"
mkdir -p "$OUT"
chmod +x "$DIR/mac/launch.command" "$DIR/../skills/genitor-music/scripts/install_mac.sh"

rm -f "$OUT/genitor-music-mac.zip"
( cd "$DIR" && zip -j "$OUT/genitor-music-mac.zip" server.py engine.py requirements.txt \
    mac/launch.command ../skills/genitor-music/scripts/install_mac.sh >/dev/null )
echo "생성: dist/genitor-music-mac.zip"
echo "==> GitHub Releases(태그 latest)에 업로드:"
echo "    gh release upload latest \"$OUT/genitor-music-mac.zip\" --clobber"
