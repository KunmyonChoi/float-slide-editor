"""BiRefNet(MIT) 기반 전경(피사체) 분리 — PyTorch, GPU 우선.

브라우저(WebGPU 셰이더 버퍼 한도 / WASM 메모리)에서 막혔던 BiRefNet을 서버에서 실행한다.
네이티브 PyTorch라 해상도/버퍼 제약이 없고, GPU에서 즉시·최고품질로 동작.
모델은 프로세스 최초 1회만 로드(이후 재사용).
"""
import io
import threading

import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

BUILD_VERSION = "2026-06-23.1-birefnet"
MODEL_ID = "ZhengPeng7/BiRefNet"  # MIT 라이선스

_INPUT_SIZE = 1024  # BiRefNet 표준 입력 해상도
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD = [0.229, 0.224, 0.225]

_transform = transforms.Compose([
    transforms.Resize((_INPUT_SIZE, _INPUT_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(_IMAGENET_MEAN, _IMAGENET_STD),
])

_model = None
_device = None
_use_half = False
_lock = threading.Lock()


def get_device():
    """현재(또는 예정) 실행 디바이스."""
    if _device is not None:
        return _device
    return "cuda" if torch.cuda.is_available() else "cpu"


def ensure_loaded():
    """모델 1회 로드(스레드 안전). GPU면 half로 메모리·속도 최적화."""
    global _model, _device, _use_half
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model = AutoModelForImageSegmentation.from_pretrained(MODEL_ID, trust_remote_code=True)
        model.eval().to(dev)
        use_half = dev == "cuda"
        if use_half:
            model.half()
        torch.set_float32_matmul_precision("high")
        _model, _device, _use_half = model, dev, use_half


def segment_to_png(image_bytes: bytes) -> bytes:
    """입력 이미지 바이트 → 전경만 남긴 알파 PNG 바이트."""
    ensure_loaded()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    x = _transform(image).unsqueeze(0).to(_device)
    if _use_half:
        x = x.half()
    with torch.no_grad():
        preds = _model(x)[-1].sigmoid().float().cpu()

    # 마스크(1×H×W, 0~1) → 원본 크기 8bit 그레이스케일 → 알파 채널
    mask_arr = (preds[0].squeeze(0).numpy() * 255).astype(np.uint8)
    mask = Image.fromarray(mask_arr, mode="L").resize(image.size)
    out = image.copy()
    out.putalpha(mask)

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()
