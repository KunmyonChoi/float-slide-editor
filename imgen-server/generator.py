"""Ideogram 4 (fp8) 기반 JSON 레이아웃 이미지 생성 — PyTorch/CUDA.

에디터에서 텍스트 박스 여러 개를 선택해 만든 JSON 캡션(bbox+text 쌍)을 받아 정밀한
레이아웃 이미지를 생성한다. 추론은 ideogram-4 패키지의 커스텀 Ideogram4Pipeline 사용
(generic diffusers 아님). magic-prompt는 끈다 — 캡션을 우리가 직접 만들기 때문(=API 키 불필요).

모델은 프로세스 최초 1회만 로드(로드만 ~3분) + 시작 시 워밍업으로 콜드 스타트 제거.
⚠️ 게이트·비상업 라이선스 모델 → HF 토큰 필요(HF_TOKEN env 또는 마운트된 HF 캐시).
⚠️ 추론 피크 VRAM ~32GB(fp8, 1024²) → 40GB급 이상 NVIDIA GPU 권장.

환경변수:
  IMGEN_WEIGHTS_REPO  기본 'ideogram-ai/ideogram-4-fp8'.
  IMGEN_DEVICE        기본 'cuda'(fp8는 사실상 CUDA 전용).
  IMGEN_WARM_PRESET   워밍업 더미 생성 프리셋. 기본 'V4_TURBO_12'. ''면 로드만(더미생성 생략).
"""
import io
import os
import json
import time
import threading

import torch
from PIL import ImageStat
from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig, PRESETS

BUILD_VERSION = "2026-06-30.1-ideogram4-fp8-safetyretry"
WEIGHTS_REPO = os.environ.get("IMGEN_WEIGHTS_REPO", "ideogram-ai/ideogram-4-fp8")
DEVICE = os.environ.get("IMGEN_DEVICE", "cuda")
WARM_PRESET = os.environ.get("IMGEN_WARM_PRESET", "V4_TURBO_12")
DEFAULT_PRESET = "V4_TURBO_12"
# 모델 내장 NSFW 안전필터는 회색 'Image blocked by safety filter' 카드를 반환(가중치 동작, 끌 수 없음).
# 오탐(특히 인물)이 잦고 시드마다 확률적 → 회색카드(낮은 색분산) 감지 시 시드를 바꿔 자동 재시도.
SAFETY_STD_THRESHOLD = 25.0   # 차단 카드는 색 stddev가 매우 낮음(정상 이미지는 보통 60+)
SAFETY_MAX_ATTEMPTS = int(os.environ.get("IMGEN_SAFETY_RETRIES", "3"))

_pipe = None
_lock = threading.Lock()       # 로드 1회 직렬화
_gen_lock = threading.Lock()   # 생성 직렬화 — FastAPI 동기 엔드포인트는 스레드풀 동시실행이라
                               # 동시 추론 시 단일 GPU OOM/충돌. 한 번에 한 작업만(28~127s 큐잉).


def get_device():
    return DEVICE


def is_ready():
    return _pipe is not None


def list_presets():
    return list(PRESETS.keys())


def ensure_loaded():
    """파이프라인 1회 로드(스레드 안전). 로드만 ~3분(fp8 양자 가중치)."""
    global _pipe
    if _pipe is not None:
        return
    with _lock:
        if _pipe is not None:
            return
        pipe = Ideogram4Pipeline.from_pretrained(
            config=Ideogram4PipelineConfig(weights_repo=WEIGHTS_REPO),
            device=DEVICE,
            dtype=torch.bfloat16,
        )
        _pipe = pipe


def _serialize_caption(caption) -> str:
    """캡션 dict → 모델이 학습된 compact JSON 문자열. 이미 문자열이면 그대로."""
    if isinstance(caption, str):
        return caption
    return json.dumps(caption, separators=(",", ":"), ensure_ascii=False)


def generate(caption, width=1024, height=1024, preset=DEFAULT_PRESET, seed=0):
    """JSON 캡션 → (PNG 바이트, 순수 추론 ms). preset은 PRESETS 키."""
    ensure_loaded()
    name = preset if preset in PRESETS else DEFAULT_PRESET
    p = PRESETS[name]
    prompt = _serialize_caption(caption)

    with _gen_lock:  # 단일 GPU — 동시 추론 방지(직렬화). 추가 요청은 대기.
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        img = None
        blocked = False
        # 안전필터 오탐(회색카드) 감지 시 시드 바꿔 재시도
        for attempt in range(SAFETY_MAX_ATTEMPTS):
            out = _pipe(
                prompt, height=int(height), width=int(width),
                num_steps=p.num_steps, guidance_schedule=p.guidance_schedule, mu=p.mu, std=p.std,
                seed=int(seed) + attempt, raise_on_caption_issues=False,
            )[0]
            blocked = _looks_blocked(out)
            img = out
            if not blocked:
                break
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        infer_ms = int((time.perf_counter() - t0) * 1000)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), infer_ms, blocked


def _looks_blocked(img):
    """모델 안전필터의 회색 'blocked' 카드 추정 — RGB 채널 평균 stddev가 임계 미만이면 차단."""
    try:
        st = ImageStat.Stat(img.convert("RGB"))
        return (sum(st.stddev) / 3.0) < SAFETY_STD_THRESHOLD
    except Exception:
        return False


def warmup():
    """시작 시 로드 + (옵션) 더미 생성으로 첫 요청 지연 제거."""
    ensure_loaded()
    if WARM_PRESET and WARM_PRESET in PRESETS:
        # 컬러풀한 더미(높은 색분산) — 안전필터 회색카드 오탐으로 불필요한 재시도 방지
        dummy = {
            "high_level_description": "warmup color scene",
            "compositional_deconstruction": {
                "background": "a vivid blue sky over a green field",
                "elements": [{"type": "obj", "bbox": [300, 350, 750, 650], "desc": "a bright red apple on grass"}],
            },
        }
        generate(dummy, 512, 512, preset=WARM_PRESET, seed=0)
