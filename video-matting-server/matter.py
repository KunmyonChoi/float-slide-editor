"""RVM(Robust Video Matting, GPL/CC — 연구·개인용) 기반 비디오 전경 매팅.

셀프 아바타 배경 제거 B2: 프레임별 알파(pha)+전경(fgr)을 recurrent state로 이어 만들어
시간적 일관성(깜빡임 억제)을 확보한다. 결과는 투명 RGBA 프레임 → 알파 WebM(VP9 yuva420p).
브라우저 B1(MediaPipe 실시간)의 고품질·베이크 버전.

device: MATTE_DEVICE(기본 'cuda'; 학습 중 GPU 보호가 필요하면 'cpu' 또는 CUDA_VISIBLE_DEVICES="").
디코드/인코드는 ffmpeg(libvpx-vp9, yuva420p 알파) 파이프.
"""
import os
import time
import json
import threading
import subprocess

import numpy as np
import torch

BUILD_VERSION = "2026-07-05.1-rvm"
MODEL_VARIANT = os.environ.get("MATTE_MODEL", "mobilenetv3")  # mobilenetv3 | resnet50
DEVICE_ENV = os.environ.get("MATTE_DEVICE", "cuda")
DOWNSAMPLE = float(os.environ.get("MATTE_DOWNSAMPLE", "0.25"))  # RVM HD 권장 0.25
_BITRATE = os.environ.get("MATTE_BITRATE", "3M")

_model = None
_device = None
_lock = threading.Lock()


def get_device():
    return _device or "?"


def is_ready():
    return _model is not None


def _resolve_device():
    if DEVICE_ENV == "cpu":
        return "cpu"
    if DEVICE_ENV.startswith("cuda") and torch.cuda.is_available():
        return DEVICE_ENV
    return "cpu"


def load():
    global _model, _device
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        dev = _resolve_device()
        # torch.hub: PeterL1n/RobustVideoMatting 의 mobilenetv3/resnet50 사전학습 모델
        m = torch.hub.load("PeterL1n/RobustVideoMatting", MODEL_VARIANT, trust_repo=True)
        m = m.eval().to(dev)
        _device = dev
        _model = m


def warmup():
    load()
    with torch.no_grad():
        dummy = torch.zeros(1, 3, 256, 256, device=_device)
        rec = [None] * 4
        _model(dummy, *rec, DOWNSAMPLE)


def _probe(path):
    """W,H,fps 추출(ffprobe)."""
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "json", path,
    ])
    s = json.loads(out)["streams"][0]
    w, h = int(s["width"]), int(s["height"])
    num, den = (s.get("r_frame_rate") or "30/1").split("/")
    fps = (float(num) / float(den)) if float(den) else 30.0
    return w, h, round(fps, 3)


def matte_to_webm(in_path, out_path):
    """입력 영상 → RVM 매팅 → 알파 WebM(VP9 yuva420p). 순수 추론 ms 반환."""
    load()
    w, h, fps = _probe(in_path)

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", in_path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", _BITRATE, "-an", out_path],
        stdin=subprocess.PIPE,
    )

    frame_bytes = w * h * 3
    rec = [None] * 4
    t0 = time.time()
    try:
        with torch.no_grad():
            while True:
                buf = dec.stdout.read(frame_bytes)
                if not buf or len(buf) < frame_bytes:
                    break
                arr = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
                src = torch.from_numpy(arr.copy()).to(_device).permute(2, 0, 1).unsqueeze(0).float().div_(255.0)
                fgr, pha, *rec = _model(src, *rec, DOWNSAMPLE)
                fgr = fgr.clamp(0, 1)
                pha = pha.clamp(0, 1)
                rgba = torch.cat([fgr, pha], dim=1)[0]           # [4,H,W]
                out = rgba.mul(255).round().byte().permute(1, 2, 0).contiguous().cpu().numpy()  # HxWx4
                enc.stdin.write(out.tobytes())
    finally:
        try: dec.stdout.close()
        except Exception: pass
        try: enc.stdin.close()
        except Exception: pass
        dec.wait()
        enc.wait()
    return int((time.time() - t0) * 1000)
