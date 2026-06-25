"""BiRefNet(MIT) 기반 전경(피사체) 분리 — PyTorch, GPU 우선.

브라우저(WebGPU 셰이더 버퍼 한도 / WASM 메모리)에서 막혔던 BiRefNet을 서버에서 실행한다.
모델은 프로세스 최초 1회만 로드(이후 재사용) + 시작 시 워밍업으로 콜드 스타트 제거.

환경변수:
  CUTOUT_MODEL       기본 'ZhengPeng7/BiRefNet'. 'ZhengPeng7/BiRefNet_lite'면 더 빠름(품질 약간↓).
  CUTOUT_INPUT_SIZE  기본 1024. 낮추면(예 768/512) 더 빠름(경계 디테일↓).
"""
import io
import os
import time
import threading

# MPS(Apple GPU)에서 미지원 연산은 CPU로 자동 폴백 — torch import 전에 설정해야 적용됨
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

BUILD_VERSION = "2026-06-26.1-birefnet-dtype-at-load"
MODEL_ID = os.environ.get("CUTOUT_MODEL", "ZhengPeng7/BiRefNet")  # MIT
INPUT_SIZE = int(os.environ.get("CUTOUT_INPUT_SIZE", "1024"))

_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD = [0.229, 0.224, 0.225]
_transform = transforms.Compose([
    transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(_IMAGENET_MEAN, _IMAGENET_STD),
])

_model = None
_device = None
_use_half = False
_lock = threading.Lock()


def _pick_device():
    """cuda(NVIDIA) > mps(Apple Silicon 네이티브) > cpu 순. ⚠️ Docker on macOS는 GPU 불가 → cpu."""
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def get_device():
    if _device is not None:
        return _device
    return _pick_device()


def is_ready():
    return _model is not None


def ensure_loaded():
    """모델 1회 로드(스레드 안전). CUDA면 half + cudnn 오토튜닝으로 가속(mps/cpu는 fp32).

    from_pretrained 호출 시 torch_dtype을 지정해 로드 시점에 dtype을 확정한다.
    post-hoc model.half()/float() 변환은 BiRefNet 일부 레이어(bias 등)를 누락하는 경우가
    있어 "input type (float) and bias type (c10::Half)" 에러를 유발한다.
    """
    global _model, _device, _use_half
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        dev = _pick_device()
        if dev == "cuda":
            torch.backends.cudnn.benchmark = True  # 고정 입력크기(1024)에서 conv 오토튜닝
        use_half = dev == "cuda"
        dtype = torch.float16 if use_half else torch.float32
        model = AutoModelForImageSegmentation.from_pretrained(
            MODEL_ID, trust_remote_code=True, torch_dtype=dtype
        )
        model.eval().to(dev)
        torch.set_float32_matmul_precision("high")
        _model, _device, _use_half = model, dev, use_half


def _infer_mask(image: Image.Image) -> Image.Image:
    """RGB 이미지 → 원본 크기 알파 마스크(L)."""
    x = _transform(image).unsqueeze(0).to(_device)
    if _use_half:
        x = x.half()
    with torch.inference_mode():
        preds = _model(x)[-1].sigmoid().float().cpu()
    mask_arr = (preds[0].squeeze(0).numpy() * 255).astype(np.uint8)
    return Image.fromarray(mask_arr, mode="L").resize(image.size)


def segment_to_png(image_bytes: bytes):
    """입력 이미지 바이트 → (전경 알파 PNG 바이트, 순수 추론 ms)."""
    ensure_loaded()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    t0 = time.perf_counter()
    mask = _infer_mask(image)
    if _device == "cuda":
        torch.cuda.synchronize()  # 비동기 커널 완료까지 포함해 정확히 측정
    infer_ms = int((time.perf_counter() - t0) * 1000)
    out = image.copy()
    out.putalpha(mask)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue(), infer_ms


def warmup():
    """시작 시 더미 추론으로 CUDA 커널/cudnn 오토튜닝을 미리 끝내 첫 요청 지연 제거."""
    ensure_loaded()
    dummy = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (128, 128, 128))
    _infer_mask(dummy)
    if _device == "cuda":
        torch.cuda.synchronize()
