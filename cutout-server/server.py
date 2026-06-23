"""FastAPI server — BiRefNet 피사체(전경) 분리. pptx-server의 CORS/PNA 패턴 미러.

엔드포인트:
  GET  /api/health         상태·디바이스·빌드
  POST /api/segment        multipart 'image' → 전경 알파 PNG
"""
import os
import traceback

from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

import segmenter

app = FastAPI()

# CORS — 공개 프론트(Netlify 등)가 로컬 컨테이너를 직접 호출. 기본 전체 허용(로컬 전용 서버).
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "build": segmenter.BUILD_VERSION,
        "device": segmenter.get_device(),
        "model": segmenter.MODEL_ID,
    }


@app.post("/api/segment")
async def segment(image: UploadFile = File(...)):
    try:
        data = await image.read()
        if not data:
            return JSONResponse(status_code=400, content={"error": "빈 이미지입니다."})
        png = segmenter.segment_to_png(data)
        return Response(
            content=png,
            media_type="image/png",
            headers={"Content-Disposition": "inline; filename=cutout.png"},
        )
    except Exception as e:  # noqa: BLE001 — 모든 추론 오류를 JSON으로 변환
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
