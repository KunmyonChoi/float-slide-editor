"""FastAPI server for high-quality PPTX export via python-pptx"""
import os
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import pptx as pptx_lib
from exporter import build_pptx
from public_adapter import is_public_deck, public_deck_to_internal

# 빌드 버전 — 실행 중인 컨테이너가 최신인지 확인용(헬스/ UI에 노출). 변경 시 갱신.
BUILD_VERSION = '2026-06-19.3-video-mp4'

app = FastAPI()

# CORS — 공개 프론트(Netlify 등)가 로컬 컨테이너를 직접 호출하므로 허용 필요.
# ALLOWED_ORIGINS 환경변수(쉼표구분)로 제한 가능, 기본은 모두 허용(* — 로컬 전용 서버).
_origins_env = os.environ.get('ALLOWED_ORIGINS', '*').strip()
_allow_origins = ['*'] if _origins_env == '*' else [o.strip() for o in _origins_env.split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.middleware('http')
async def allow_private_network(request: Request, call_next):
    """Chrome Private Network Access: 공개 사이트 → localhost 프리플라이트가
    `Access-Control-Request-Private-Network`를 보내면 허용 헤더로 응답해야 한다."""
    response = await call_next(request)
    if request.headers.get('access-control-request-private-network') == 'true':
        response.headers['Access-Control-Allow-Private-Network'] = 'true'
    return response


@app.get("/api/health")
def health():
    return {"status": "ok", "python_pptx": pptx_lib.__version__, "build": BUILD_VERSION}


@app.post("/api/export/pptx")
async def export_pptx(request: Request):
    try:
        data = await request.json()
        embed_fonts = data.get("embedFonts", True)
        editor_version = data.get("editorVersion", "")
        # 입력 형태 라우팅: 공개 SlideDeck(envelope {deck} 또는 raw) vs legacy internal payload
        if is_public_deck(data):
            deck = data["deck"] if isinstance(data.get("deck"), dict) else data
            pages, default_cs, fonts = public_deck_to_internal(deck)
        else:
            pages = data.get("pages", {})
            default_cs = data.get("defaultCanvasSize", {"w": 1280, "h": 720})
            fonts = data.get("fonts", [])
        pptx_bytes = build_pptx(pages, default_cs, fonts=fonts, embed_fonts=embed_fonts,
                                editor_version=editor_version, converter_version=BUILD_VERSION)
        return Response(
            content=pptx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": "attachment; filename=slide-export.pptx"},
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
