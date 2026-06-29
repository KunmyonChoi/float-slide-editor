"""FastAPI server — Ideogram 4 JSON 레이아웃 이미지 생성. cutout-server의 CORS/PNA 패턴 미러.

엔드포인트:
  GET  /api/health     상태·디바이스·모델·준비여부·프리셋 목록·빌드
  POST /api/generate   JSON {caption, width, height, preset, seed} → PNG (+ X-Inference-Ms 헤더)
"""
import os
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import generator


@asynccontextmanager
async def lifespan(app):
    # 시작 시 모델 로드 + 워밍업 → 첫 사용자 요청의 콜드 스타트(다운로드·로드~3분·커널 컴파일) 제거.
    try:
        print("[imgen] 모델 로드/워밍업 시작... (fp8 로드만 ~3분)", flush=True)
        generator.warmup()
        print(f"[imgen] 준비 완료 (device={generator.get_device()}, model={generator.WEIGHTS_REPO})", flush=True)
    except Exception:
        traceback.print_exc()
    yield


app = FastAPI(lifespan=lifespan)

# CORS — 공개 프론트(Netlify 등)가 로컬 컨테이너를 직접 호출. 기본 전체 허용(로컬 전용 서버).
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Inference-Ms"],
)


@app.middleware("http")
async def allow_private_network(request: Request, call_next):
    """Chrome Private Network Access: 공개 사이트 → localhost 프리플라이트 허용."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "build": generator.BUILD_VERSION,
        "device": generator.get_device(),
        "model": generator.WEIGHTS_REPO,
        "presets": generator.list_presets(),
        "ready": generator.is_ready(),
    }


class GenerateRequest(BaseModel):
    caption: dict            # Ideogram 4 JSON 캡션(compositional_deconstruction 등)
    width: int = 1024
    height: int = 1024
    preset: str = generator.DEFAULT_PRESET
    seed: int = 0


@app.post("/api/generate")
def generate(req: GenerateRequest):
    try:
        if not req.caption:
            return JSONResponse(status_code=400, content={"error": "빈 캡션입니다."})
        png, infer_ms = generator.generate(
            req.caption, width=req.width, height=req.height, preset=req.preset, seed=req.seed,
        )
        return Response(
            content=png,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=ideogram.png",
                "X-Inference-Ms": str(infer_ms),
            },
        )
    except Exception as e:  # noqa: BLE001 — 모든 추론 오류를 JSON으로 변환
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
