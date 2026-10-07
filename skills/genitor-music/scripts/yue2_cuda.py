#!/usr/bin/env python3
"""Run yue2-music's instrumental workflow on Linux with an NVIDIA GPU (CUDA).

The original instrumental.py already targets CUDA, but it pins yue2-infer 0.1.5,
while a YuE source checkout installs its own version (e.g. 0.1.6). This wrapper,
like yue2_mac.py, imports it unchanged and swaps only open_pipeline: the same CUDA
and BF16 checks and the same frozen weight checks (revision files + SHA-256), minus
the package-version pin. Planning, Vocal->Ins conversion, prefix/ABC checks, verify
and share all stay the original code.

    "$PY" yue2_cuda.py <instrumental.py args...>
    e.g. ... yue2_cuda.py run --style "..." --output work/x --offline
    Pick a free GPU with CUDA_VISIBLE_DEVICES (the default device is cuda:0).

YUE2_HOME points at the YuE checkout (default: $GENITOR_MUSIC_HOME/YuE,
GENITOR_MUSIC_HOME default ~/.local/share/genitor-music). install_linux.sh writes both.
"""
import os
import sys
from pathlib import Path

GENITOR_MUSIC_HOME = Path(os.environ.get("GENITOR_MUSIC_HOME", Path.home() / ".local/share/genitor-music"))
YUE2_HOME = Path(os.environ.get("YUE2_HOME", GENITOR_MUSIC_HOME / "YuE"))
SCRIPTS = YUE2_HOME / "skills/yue2-music/instrumental/scripts"
if not SCRIPTS.is_dir():
    raise SystemExit(f"yue2-music scripts not found under YUE2_HOME={YUE2_HOME}; run install_linux.sh")
sys.path.insert(0, str(SCRIPTS))

import instrumental  # noqa: E402
from common import read_json  # noqa: E402


def open_pipeline_cuda(args):
    import torch
    from yue2 import YuE2Pipeline
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA device is visible (check CUDA_VISIBLE_DEVICES / nvidia-smi)")
    device = torch.device(args.device)
    if device.type != "cuda":
        raise ValueError("yue2_cuda.py needs a CUDA device; use yue2_mac.py on Apple Silicon")
    if torch.cuda.get_device_capability(device)[0] < 8:
        raise RuntimeError("YuE2 needs a BF16-capable NVIDIA GPU (compute capability >= 8)")
    release = read_json(instrumental.ROOT / "assets/release.json")
    model_spec, vae_spec = release["models"]["YuE2-3B"], release["models"]["YuE2-Vae"]
    if args.models_root:
        model, vae = args.models_root / "YuE2-3B", args.models_root / "YuE2-Vae"
        if not model.is_dir() or not vae.is_dir():
            raise ValueError("models-root must contain YuE2-3B and YuE2-Vae directories")
    else:
        model, vae = model_spec["repo"], vae_spec["repo"]
    torch.set_num_threads(8)
    pipe = YuE2Pipeline.from_pretrained(model, vae=vae, device=args.device,
                                        revision=model_spec["revision"], vae_revision=vae_spec["revision"],
                                        local_files_only=args.offline, memory_budget_gib=24)
    try:
        from setup_runtime import check_model
        check_model(pipe.model_dir, model_spec)
        check_model(pipe.vae_dir, vae_spec)
        for name, role in (("YuE2-3B", "mot"), ("YuE2-Vae", "vae")):
            if pipe.weights[role]["files"]["model.safetensors"]["sha256"] != release["models"][name]["weights_sha256"]:
                raise ValueError(f"{name} weights differ from the frozen recipe")
    except Exception:
        pipe.close()
        raise
    return pipe


instrumental.open_pipeline = open_pipeline_cuda

if __name__ == "__main__":
    sys.argv = [str(SCRIPTS / "instrumental.py"), *sys.argv[1:]]
    raise SystemExit(instrumental.main())
