#!/bin/sh
# YuE2(음악 생성 모델)를 Apple Silicon Mac에 설치한다. 여러 번 실행해도 안전하다(설치된 단계는 건너뜀).
#
#   sh install_mac.sh                 # 설치(+모델 다운로드) 후 MPS 동작 확인
#   sh install_mac.sh --claude-skill  # 위 + 원본 yue2-music 스킬을 ~/.claude/skills 에 링크
#   sh install_mac.sh --check         # 설치 상태만 확인 (exit 0 = 준비 완료)
#
# 설치 위치: ~/Library/Application Support/genitor-music  (GENITOR_MUSIC_HOME 으로 변경 가능)
#   YuE/    YuE2 소스(검증된 커밋 고정) — yue2-infer 패키지와 yue2-music 스킬 스크립트
#   .venv/  Python 3.12 + torch(MPS)
# 모델 가중치(약 7.8 GB)는 Hugging Face 캐시(~/.cache/huggingface)에 받는다 — 다른 설치와 공유된다.
#
# torch는 패키지 고정값(2.10.0)보다 높은 2.13 이상으로 설치한다. torch 2.12 이하는 MPS에서
# BF16 causal attention이 미래 토큰을 보는 버그가 있어(YuE issue #176) 결과가 조용히 틀어진다.
set -e

YUE_REPO="multimodal-art-projection/YuE"
YUE_COMMIT="ab2e5a3c47c3aed2902bd5a72a2765db880d0f1a"   # 이 커밋으로 M1(macOS 27)에서 생성 검증
HOME_DIR="${GENITOR_MUSIC_HOME:-$HOME/Library/Application Support/genitor-music}"
YUE="$HOME_DIR/YuE"
VENV="$HOME_DIR/.venv"
PY="$VENV/bin/python"
MARKER="$HOME_DIR/installed-$YUE_COMMIT"
export PATH="$HOME/.local/bin:$PATH"

CHECK_ONLY=0
LINK_SKILL=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --claude-skill) LINK_SKILL=1 ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 2 ;;
  esac
done

models_ready() {
  "$PY" - <<'EOF' 2>/dev/null
from huggingface_hub import snapshot_download
for repo in ("m-a-p/YuE2-3B", "m-a-p/YuE2-Vae"):
    snapshot_download(repo, local_files_only=True)
EOF
}

if [ "$CHECK_ONLY" = 1 ]; then
  if [ -f "$MARKER" ] && [ -x "$PY" ] && models_ready; then
    echo "ready: $HOME_DIR"; exit 0
  fi
  echo "not installed: $HOME_DIR"; exit 1
fi

echo "── Genitor 음악 생성(YuE2) 설치 · macOS ──"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Apple Silicon(M1 이상) Mac에서만 설치할 수 있습니다. (현재: $(uname -s) $(uname -m))" >&2
  exit 1
fi

MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ "$MEM_GB" -lt 16 ]; then
  echo "경고: 메모리 ${MEM_GB}GB — 생성 중 GPU 메모리를 약 8GB 씁니다. 16GB 이상을 권장합니다."
fi

mkdir -p "$HOME_DIR"
FREE_GB=$(df -g "$HOME_DIR" | awk 'NR==2 {print $4}')
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 15 ]; then
  echo "디스크 여유 공간이 ${FREE_GB}GB입니다. 모델·라이브러리에 약 12GB가 필요합니다." >&2
  exit 1
fi

# 1) uv (Python·패키지 관리자) — 없으면 설치. Python 3.12도 uv가 받는다.
if ! command -v uv >/dev/null 2>&1; then
  echo "uv 설치 중…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# 2) YuE2 소스 — git 없이 고정 커밋 tarball로 받는다.
if [ ! -f "$YUE/.commit" ] || [ "$(cat "$YUE/.commit")" != "$YUE_COMMIT" ]; then
  echo "YuE2 소스 받는 중… ($YUE_COMMIT)"
  rm -rf "$YUE.tmp" && mkdir -p "$YUE.tmp"
  curl -fsSL "https://codeload.github.com/$YUE_REPO/tar.gz/$YUE_COMMIT" | tar -xz -C "$YUE.tmp" --strip-components 1
  rm -rf "$YUE" && mv "$YUE.tmp" "$YUE"
  echo "$YUE_COMMIT" > "$YUE/.commit"
  rm -f "$HOME_DIR"/installed-*
fi

# 3) Python 환경 + yue2-infer + torch>=2.13 (MPS) + 음악 서버 의존성
if [ ! -f "$MARKER" ]; then
  [ -x "$PY" ] || uv venv --python 3.12 "$VENV"
  echo "torch>=2.13" > "$HOME_DIR/torch-override.txt"
  echo "라이브러리 설치 중… (최초 1회 수 분 — torch 다운로드)"
  # 경로에 공백(Application Support)이 있어 uv가 경로를 요구사항 문자열로 쪼갠다 → 폴더 안에서 "."로 설치.
  ( cd "$YUE" && VIRTUAL_ENV="$VENV" uv pip install --quiet . "torch>=2.13" \
      "fastapi>=0.115" "uvicorn>=0.32" --override ../torch-override.txt )
fi

"$PY" - <<'EOF'
import torch
major, minor = (int(x) for x in torch.__version__.split(".")[:2])
assert (major, minor) >= (2, 13), f"torch {torch.__version__} < 2.13 (MPS causal attention 버그)"
assert torch.backends.mps.is_available(), "MPS(Apple GPU)를 사용할 수 없습니다"
print(f"torch {torch.__version__} · MPS 사용 가능")
EOF

# 4) 모델 가중치 — 끊겨도 다시 실행하면 이어 받는다.
if ! models_ready; then
  echo "모델 내려받는 중… (약 7.8 GB, 회선에 따라 수십 분)"
  "$PY" - <<'EOF'
from huggingface_hub import snapshot_download
for repo in ("m-a-p/YuE2-Vae", "m-a-p/YuE2-3B"):
    print(" ", repo, "→", snapshot_download(repo))
EOF
fi

touch "$MARKER"

if [ "$LINK_SKILL" = 1 ]; then
  mkdir -p "$HOME/.claude/skills"
  ln -sfn "$YUE/skills/yue2-music" "$HOME/.claude/skills/yue2-music"
  echo "Claude 스킬 링크: ~/.claude/skills/yue2-music → $YUE/skills/yue2-music"
fi

echo "설치 완료: $HOME_DIR"
echo "  Python: $PY"
