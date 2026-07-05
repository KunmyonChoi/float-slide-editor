"""FastAPI server — RVM 비디오 전경 매팅 → 알파 WebM. cutout-server의 CORS/PNA 패턴 미러.

엔드포인트:
  GET  /api/health        상태·디바이스·모델·준비여부·빌드
  POST /api/matte         multipart 'video' → 알파 WebM(VP9 yuva420p) (+ X-Inference-Ms)
"""
import os
import tempfile
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

import matter


@asynccontextmanager
async def lifespan(app):
    try:
        print("[matte] 모델 로드/워밍업 시작...", flush=True)
        matter.warmup()
        print(f"[matte] 준비 완료 (device={matter.get_device()}, model={matter.MODEL_VARIANT})", flush=True)
    except Exception:
        traceback.print_exc()
    yield


app = FastAPI(lifespan=lifespan)

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
        "build": matter.BUILD_VERSION,
        "device": matter.get_device(),
        "model": matter.MODEL_VARIANT,
        "ready": matter.is_ready(),
    }


@app.post("/api/matte")
async def matte(video: UploadFile = File(...)):
    tmp_in = tmp_out = None
    try:
        data = await video.read()
        if not data:
            return JSONResponse(status_code=400, content={"error": "빈 영상입니다."})
        suffix = os.path.splitext(video.filename or "")[1] or ".mp4"
        fd, tmp_in = tempfile.mkstemp(suffix=suffix); os.close(fd)
        fd, tmp_out = tempfile.mkstemp(suffix=".webm"); os.close(fd)
        with open(tmp_in, "wb") as f:
            f.write(data)
        infer_ms = matter.matte_to_webm(tmp_in, tmp_out)
        with open(tmp_out, "rb") as f:
            webm = f.read()
        return Response(
            content=webm,
            media_type="video/webm",
            headers={
                "Content-Disposition": "inline; filename=matte.webm",
                "X-Inference-Ms": str(infer_ms),
            },
        )
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        for p in (tmp_in, tmp_out):
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass
