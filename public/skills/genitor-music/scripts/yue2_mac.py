#!/usr/bin/env python3
"""Run yue2-music's instrumental workflow on Apple Silicon (MPS).

The original instrumental.py refuses non-CUDA devices and pins yue2-infer 0.1.5.
This wrapper imports it unchanged and swaps only open_pipeline for an MPS loader,
so planning, Vocal->Ins conversion, prefix/ABC checks, verify and share all stay
the original code. Weights are still checked against the frozen release SHA-256.

    "$GENITOR_MUSIC_HOME/.venv/bin/python" yue2_mac.py <instrumental.py args...>
    e.g. ... yue2_mac.py run --style "..." --output work/x --offline
"""
import os
import platform
import subprocess
import sys
from pathlib import Path

GENITOR_MUSIC_HOME = Path(os.environ.get("GENITOR_MUSIC_HOME", Path.home() / "Library/Application Support/genitor-music"))
YUE2_HOME = Path(os.environ.get("YUE2_HOME", GENITOR_MUSIC_HOME / "YuE"))
SCRIPTS = YUE2_HOME / "skills/yue2-music/instrumental/scripts"
sys.path.insert(0, str(SCRIPTS))

import torch  # noqa: E402
import instrumental  # noqa: E402
from common import read_json  # noqa: E402


def chip():
    try:
        return subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                              capture_output=True, text=True).stdout.strip()
    except OSError:
        return platform.machine()


def open_pipeline_mps(args):
    from yue2 import YuE2Pipeline
    if not torch.backends.mps.is_available():
        raise RuntimeError("MPS is not available on this machine")
    major, minor = (int(x) for x in torch.__version__.split(".")[:2])
    if (major, minor) < (2, 13):
        # torch <= 2.12 leaks future keys in BF16 is_causal SDPA on MPS (YuE issue #176)
        raise RuntimeError(f"torch {torch.__version__} has the MPS causal-attention bug; install torch>=2.13")
    release = read_json(instrumental.ROOT / "assets/release.json")
    if args.models_root:
        model, vae = args.models_root / "YuE2-3B", args.models_root / "YuE2-Vae"
    else:
        model, vae = release["models"]["YuE2-3B"]["repo"], release["models"]["YuE2-Vae"]["repo"]
    pipe = YuE2Pipeline.from_pretrained(model, vae=vae, device="mps",
                                        local_files_only=args.offline, memory_budget_gib=16)
    try:
        for name, role in (("YuE2-3B", "mot"), ("YuE2-Vae", "vae")):
            if pipe.weights[role]["files"]["model.safetensors"]["sha256"] != release["models"][name]["weights_sha256"]:
                raise ValueError(f"{name} weights differ from the frozen recipe")
    except Exception:
        pipe.close()
        raise
    return pipe


instrumental.open_pipeline = open_pipeline_mps
# generate() records the device name through torch.cuda; report the Mac chip instead.
torch.cuda.get_device_name = lambda *_: f"{chip()} (mps, torch {torch.__version__})"

if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv and argv[0] in {"run", "cover", "generate"} and "--device" not in argv:
        argv += ["--device", "mps"]
    sys.argv = [str(SCRIPTS / "instrumental.py"), *argv]
    raise SystemExit(instrumental.main())
