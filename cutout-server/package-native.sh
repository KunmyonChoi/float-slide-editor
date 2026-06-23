#!/usr/bin/env sh
# 네이티브 배포 zip 생성(mac/win) → cutout-server/dist/.
# 생성된 zip을 GitHub Releases(태그 latest)에 업로드하면, 앱(인앱 안내)이 해당 URL로 다운로드를 링크한다.
# (어느 OS에서 실행해도 됨 — zip만 만든다. zip 명령 필요.)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist"
mkdir -p "$OUT"
chmod +x "$DIR/mac/launch.command" 2>/dev/null || true

FILES="server.py segmenter.py requirements.txt"   # 런처와 함께 묶일 서버 소스

rm -f "$OUT/genitor-cutout-mac.zip"
( cd "$DIR" && zip -j "$OUT/genitor-cutout-mac.zip" $FILES mac/launch.command >/dev/null )
echo "생성: dist/genitor-cutout-mac.zip"

rm -f "$OUT/genitor-cutout-win.zip"
( cd "$DIR" && zip -j "$OUT/genitor-cutout-win.zip" $FILES win/launch.bat >/dev/null )
echo "생성: dist/genitor-cutout-win.zip"

echo "==> GitHub Releases(태그 latest)에 위 zip들을 업로드하세요."
echo "    gh release create latest \"$OUT/genitor-cutout-mac.zip\" \"$OUT/genitor-cutout-win.zip\" --title \"cutout server\" --notes \"native launchers\""
echo "    (이미 존재하면) gh release upload latest \"$OUT\"/genitor-cutout-*.zip --clobber"
