#!/bin/sh
# YuE2(음악 생성 모델)를 Linux + NVIDIA GPU에서 쓸 수 있게 준비한다. 여러 번 실행해도 안전하다.
#
#   sh install_linux.sh --yue /path/to/YuE   # 이미 있는 YuE 체크아웃(.venv 포함)을 그대로 쓴다 — 다운로드 없음
#   sh install_linux.sh                      # 고정 커밋 소스를 받아 새 venv에 설치(+모델 다운로드)
#   sh install_linux.sh --check              # 준비 상태만 확인 (exit 0 = 준비 완료)
#   ... --claude-skill                       # 원본 yue2-music 스킬도 ~/.claude/skills 에 링크
#
# 설정은 $GENITOR_MUSIC_HOME/env.sh (기본 ~/.local/share/genitor-music/env.sh)에 남는다:
#   YUE2_HOME          YuE 체크아웃(yue2-infer 소스와 yue2-music 스킬 스크립트)
#   GENITOR_MUSIC_PY   그 체크아웃을 설치한 venv의 python
# 모델 가중치(약 7.8 GB)는 Hugging Face 캐시(~/.cache/huggingface)를 공유한다.
# macOS(Apple Silicon)는 install_mac.sh를 쓴다.
set -e

YUE_REPO="multimodal-art-projection/YuE"
YUE_COMMIT="ab2e5a3c47c3aed2902bd5a72a2765db880d0f1a"   # install_mac.sh와 같은 검증 커밋
HOME_DIR="${GENITOR_MUSIC_HOME:-$HOME/.local/share/genitor-music}"
ENV_FILE="$HOME_DIR/env.sh"
export PATH="$HOME/.local/bin:$PATH"

CHECK_ONLY=0
LINK_SKILL=0
YUE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --claude-skill) LINK_SKILL=1 ;;
    --yue) shift; YUE_ARG="$1" ;;
    --yue=*) YUE_ARG="${1#--yue=}" ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
  shift
done

# 지금 쓸 체크아웃·python — 인자 > 기존 설정 > 기본 설치 위치
if [ -n "$YUE_ARG" ]; then
  YUE="$(cd "$YUE_ARG" && pwd)"; PY="$YUE/.venv/bin/python"
elif [ -f "$ENV_FILE" ]; then
  . "$ENV_FILE"; YUE="$YUE2_HOME"; PY="$GENITOR_MUSIC_PY"
else
  YUE="$HOME_DIR/YuE"; PY="$HOME_DIR/.venv/bin/python"
fi

# 런타임 확인: CUDA·BF16 GPU, yue2 패키지, 원본 스킬 스크립트, 고정 리비전 모델(오프라인)
runtime_ready() {
  [ -x "$PY" ] && [ -f "$YUE/skills/yue2-music/instrumental/scripts/instrumental.py" ] || return 1
  "$PY" - "$YUE" <<'EOF'
import json, sys
from pathlib import Path
import torch
import yue2  # noqa: F401
from huggingface_hub import snapshot_download
if not torch.cuda.is_available():
    sys.exit("CUDA를 쓸 수 없습니다")
caps = [torch.cuda.get_device_capability(i)[0] for i in range(torch.cuda.device_count())]
if max(caps) < 8:
    sys.exit("BF16 가능한 GPU(compute capability 8 이상)가 없습니다")
release = json.loads((Path(sys.argv[1]) / "skills/yue2-music/instrumental/assets/release.json").read_text())
for spec in release["models"].values():
    snapshot_download(spec["repo"], revision=spec["revision"], local_files_only=True)
print(f"torch {torch.__version__} · GPU {torch.cuda.device_count()}개 · 모델 캐시 준비됨")
EOF
}

if [ "$CHECK_ONLY" = 1 ]; then
  if runtime_ready 2>/dev/null; then echo "ready: YUE2_HOME=$YUE"; exit 0; fi
  echo "not ready: YUE2_HOME=$YUE"; exit 1
fi

echo "── Genitor 음악 생성(YuE2) 설치 · Linux + NVIDIA ──"
if [ "$(uname -s)" != "Linux" ]; then
  echo "Linux 전용입니다. macOS(Apple Silicon)는 install_mac.sh를 쓰세요." >&2; exit 1
fi
command -v nvidia-smi >/dev/null 2>&1 || { echo "NVIDIA 드라이버(nvidia-smi)가 없습니다." >&2; exit 1; }
mkdir -p "$HOME_DIR"

if [ -z "$YUE_ARG" ] && [ ! -x "$PY" ]; then
  # 새로 설치 — 고정 커밋 tarball + uv venv(Python 3.12) + 체크아웃의 yue2-infer(torch 포함)
  FREE_GB=$(df -BG "$HOME_DIR" | awk 'NR==2 {gsub("G","",$4); print $4}')
  if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 20 ]; then
    echo "디스크 여유 공간이 ${FREE_GB}GB입니다. 라이브러리·모델에 약 15GB가 필요합니다." >&2; exit 1
  fi
  command -v uv >/dev/null 2>&1 || { echo "uv 설치 중…"; curl -LsSf https://astral.sh/uv/install.sh | sh; }
  if [ ! -f "$YUE/.commit" ] || [ "$(cat "$YUE/.commit")" != "$YUE_COMMIT" ]; then
    echo "YuE2 소스 받는 중… ($YUE_COMMIT)"
    rm -rf "$YUE.tmp" && mkdir -p "$YUE.tmp"
    curl -fsSL "https://codeload.github.com/$YUE_REPO/tar.gz/$YUE_COMMIT" | tar -xz -C "$YUE.tmp" --strip-components 1
    rm -rf "$YUE" && mv "$YUE.tmp" "$YUE" && echo "$YUE_COMMIT" > "$YUE/.commit"
  fi
  VENV="$(dirname "$PY")/.."
  [ -x "$PY" ] || uv venv --python 3.12 "$VENV"
  echo "라이브러리 설치 중… (최초 1회 수 분 — torch 다운로드)"
  ( cd "$YUE" && VIRTUAL_ENV="$VENV" uv pip install --quiet . )
elif [ -n "$YUE_ARG" ] && [ ! -x "$PY" ]; then
  echo "$YUE/.venv/bin/python 이 없습니다. 그 체크아웃에서 먼저 venv를 만들고 'pip install .' 하세요." >&2; exit 1
fi

# 모델 — 고정 리비전. 캐시에 있으면 건너뛰고, 끊겨도 다시 실행하면 이어 받는다.
"$PY" - "$YUE" <<'EOF'
import json, sys
from pathlib import Path
from huggingface_hub import snapshot_download
release = json.loads((Path(sys.argv[1]) / "skills/yue2-music/instrumental/assets/release.json").read_text())
for name, spec in release["models"].items():
    try:
        snapshot_download(spec["repo"], revision=spec["revision"], local_files_only=True)
        print(f"  {name}: 캐시에 있음")
    except Exception:
        print(f"  {name}: 내려받는 중… ({spec['revision'][:7]})")
        snapshot_download(spec["repo"], revision=spec["revision"])
EOF

runtime_ready

cat > "$ENV_FILE" <<EOF
# genitor-music (Linux) — install_linux.sh가 쓴다
export YUE2_HOME="$YUE"
export GENITOR_MUSIC_PY="$PY"
EOF

if [ "$LINK_SKILL" = 1 ]; then
  mkdir -p "$HOME/.claude/skills"
  ln -sfn "$YUE/skills/yue2-music" "$HOME/.claude/skills/yue2-music"
  echo "Claude 스킬 링크: ~/.claude/skills/yue2-music → $YUE/skills/yue2-music"
fi

echo "설치 완료: YUE2_HOME=$YUE"
echo "  Python: $PY"
echo "  설정:   $ENV_FILE"
