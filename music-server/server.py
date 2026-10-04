"""FastAPI server — YuE2 음악 생성(연주곡·노래). cutout-server의 CORS/PNA 패턴 미러.

생성은 Apple M1 기준 수 분이 걸리므로 작업(job) 방식이다. 큐는 하나, 한 번에 한 곡.

엔드포인트:
  GET  /api/health               상태·디바이스·설치/모델 준비·진행 중 작업
  POST /api/jobs                 JSON {mode, style, lyrics?, length?, seed?} → {id, ...}
  GET  /api/jobs/{id}            진행 상태 {status, stage, progress, error, result}
  GET  /api/jobs/{id}/audio      결과 오디오 (?format=mp3|flac, 기본 mp3)
  GET  /api/jobs/{id}/score      생성에 쓴 ABC 악보(text/plain)
  GET  /api/jobs/{id}/lyrics     노래 가사 줄 타이밍 {lines, offset, source} — 없으면 보컬 정렬(수십 초)
  GET  /api/jobs?mode=song       최근 작업 목록
  POST /api/jobs/{id}/cancel     취소
"""
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

import engine

app = FastAPI()
ENGINE = engine.Engine()

_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_allow_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def allow_private_network(request: Request, call_next):
    """Chrome Private Network Access: 공개 사이트 → localhost 프리플라이트 허용."""
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/api/health")
def health():
    ready = engine.readiness()
    return {
        "status": "ok",
        "build": engine.BUILD_VERSION,
        "device": engine.device_name(),
        "model": "m-a-p/YuE2-3B",
        "ready": ready["models"],
        "torch": ready["torch"],
        "detail": ready["error"],
        **ENGINE.busy(),
    }


@app.post("/api/jobs")
async def create_job(request: Request):
    try:
        body = await request.json()
        job = ENGINE.submit({k: body.get(k) for k in ("mode", "style", "lyrics", "length", "seed") if body.get(k) is not None})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return job.public()


def _job_or_404(job_id):
    job = ENGINE.get(job_id)
    return job, (None if job else JSONResponse({"error": "작업을 찾을 수 없습니다."}, status_code=404))


@app.get("/api/jobs")
def list_jobs(mode: str | None = None):
    """최근 작업 목록(새 것부터). 노래는 가사 첫 줄을 미리보기로 준다."""
    out = []
    for job in ENGINE.recent(mode):
        first = next((l for l in (job.params.get("lyrics") or "").splitlines() if l.strip() and not l.strip().startswith(("[", "**", "#"))), "")
        out.append({**job.public(), "created": job.created, "preview": first[:40]})
    return {"jobs": out}


@app.get("/api/jobs/{job_id}/lyrics")
def job_lyrics(job_id: str):
    """노래의 가사 줄 타이밍 {lines: [{start, end, text, section, source}], offset, source}.
    source="vocal"이면 소리에 맞춘 오디오 시각(offset 0). 아직이면 이 요청에서 정렬한다(곡당 수십 초)."""
    job, missing = _job_or_404(job_id)
    if missing:
        return missing
    timing = ENGINE.lyrics_timing(job_id)
    if not timing or not timing["lines"]:
        return JSONResponse({"error": "가사 타이밍을 만들 수 없습니다(노래가 아니거나 악보가 없음)."}, status_code=404)
    return timing


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job, missing = _job_or_404(job_id)
    return missing or job.public()


@app.get("/api/jobs/{job_id}/audio")
def job_audio(job_id: str, format: str = "mp3"):
    job, missing = _job_or_404(job_id)
    if missing:
        return missing
    if format not in ("mp3", "flac") or job.status != "done":
        return JSONResponse({"error": "완료된 작업의 mp3/flac만 받을 수 있습니다."}, status_code=400)
    return FileResponse(job.dir / f"audio.{format}", media_type="audio/mpeg" if format == "mp3" else "audio/flac",
                        filename=f"genitor-music-{job.id}.{format}")


@app.get("/api/jobs/{job_id}/score")
def job_score(job_id: str):
    job, missing = _job_or_404(job_id)
    if missing:
        return missing
    path = job.dir / "score.abc"
    if not path.is_file():
        return JSONResponse({"error": "악보가 없습니다."}, status_code=404)
    return PlainTextResponse(path.read_text(encoding="utf-8"))


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    job, missing = _job_or_404(job_id)
    return missing or {"cancelled": ENGINE.cancel(job_id), **job.public()}


@app.on_event("startup")
def warm_readiness():
    # torch·yue2 첫 import는 수 초 걸린다 — 브라우저 헬스체크(2초 제한)보다 먼저 끝내 둔다.
    engine.readiness()
