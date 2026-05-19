"""FastAPI server for high-quality PPTX export via python-pptx"""
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
import pptx as pptx_lib
from exporter import build_pptx

app = FastAPI()


@app.get("/api/health")
def health():
    return {"status": "ok", "python_pptx": pptx_lib.__version__}


@app.post("/api/export/pptx")
async def export_pptx(request: Request):
    try:
        data = await request.json()
        pages = data.get("pages", {})
        default_cs = data.get("defaultCanvasSize", {"w": 1280, "h": 720})
        fonts = data.get("fonts", [])
        pptx_bytes = build_pptx(pages, default_cs, fonts=fonts)
        return Response(
            content=pptx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": "attachment; filename=slide-export.pptx"},
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})
