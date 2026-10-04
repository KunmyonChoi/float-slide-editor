"""YuE2 음악 생성 엔진 — 작업 큐 하나, GPU 작업은 한 번에 하나.

연주곡(instrumental)은 원본 yue2-music 스킬의 기본 흐름을 그대로 따른다:
  YuE2가 악보(ABC)를 쓴다 → Vocal 음표를 Ins로 옮긴다(instrumentalize.convert_score)
  → 구간 태그만 남긴 가사로 그 악보를 렌더링한다.
노래(song)는 style + 가사로 cot="full" 생성.

원본 스킬 스크립트(YuE/skills/yue2-music/instrumental/scripts)는 설치된 YuE 소스에서 import한다.
"""
from __future__ import annotations

import gc
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from pathlib import Path

BUILD_VERSION = "music-0.1.0"
HOME = Path(os.environ.get("GENITOR_MUSIC_HOME", Path.home() / "Library/Application Support/genitor-music"))
YUE = Path(os.environ.get("YUE2_HOME", HOME / "YuE"))
OUTPUTS = HOME / "outputs"
KEEP_JOBS = 20
SEMANTIC_TOKENS_PER_SECOND = 25  # YuE2 codec: 47.1s 오디오 = 1178 토큰(실측)

sys.path.insert(0, str(YUE / "skills/yue2-music/instrumental/scripts"))

# 연주곡 플래너에 주는 구간 태그 — 곡 길이는 이 구조로 대략 정해진다(초 단위 보장 없음).
PLANNING_SECTIONS = {
    "short": ["Intro", "Chorus", "Outro"],
    "medium": ["Intro", "Verse", "Chorus", "Outro"],
    "long": ["Intro", "Verse", "Chorus", "Verse", "Chorus", "Outro"],
}
NO_VOCAL_TERMS = ("no vocals", "no singing", "no choir", "no spoken words")
# YuE2 플래너는 구간 태그를 그대로 따르지 않는다('짧게'에 226초 악보를 쓴 적이 있다). 악보 길이 상한(초)을
# 넘으면 fit_length()가 앞에서부터 잘라 맞춘다. 길수록 MPS 메모리·시간이 커지므로 상한은 필수.
MAX_SECONDS = {"short": 75, "medium": 120, "long": 200}


def _groups(text: str):
    """ABC를 머리말과 [구간 라벨, [그룹 줄 목록...]] 목록으로 나눈다. 그룹 = 'V: Vocal'부터 다음 그룹 전까지."""
    lines = text.rstrip("\n").split("\n")
    first = next(i for i, l in enumerate(lines) if l.startswith("% "))
    header, sections = lines[:first], []
    for line in lines[first:]:
        if line.startswith("% "):
            sections.append([line[2:], []])
        elif line.startswith("V: Vocal") or not sections[-1][1]:
            sections[-1][1].append([line])
        else:
            sections[-1][1][-1].append(line)
    return header, sections


def _render(header, sections) -> str:
    out = list(header)
    for label, groups in sections:
        out.append(f"% {label}")
        for g in groups:
            out.extend(g)
    return "\n".join(out) + "\n"


def fit_length(text: str, max_seconds: float):
    """악보가 max_seconds를 넘으면 그룹 단위로 앞부분만 남기고 마지막 구간(보통 outro)을 붙인다.
    붙임줄로 끝나는 그룹 뒤에서는 자르지 않는다. 결과가 검증을 통과하지 못하면 원본을 돌려준다.
    → (abc, {"seconds_before", "seconds_after", "trimmed"})"""
    from abc_tools import parse_abc, report
    from instrumental import validate_score

    seconds = lambda t: float(report(parse_abc(t))["nominal_duration_seconds"])
    before = seconds(text)
    info = {"seconds_before": round(before, 1), "seconds_after": round(before, 1), "trimmed": False}
    if before <= max_seconds:
        return text, info
    try:
        header, sections = _groups(text)
        tempo = float(next(l for l in header if l.startswith("Q:")).split("=")[1])
        meter = [next(l for l in header if l.startswith("M:"))[2:].strip()]

        def dur(_label, g):
            """그룹 길이(초) = 마디 수 × 마디당 4분음표 수 × 60/템포. 그룹 단독 파싱은 붙임줄 때문에 실패한다."""
            for line in g:
                if line.startswith("M:"):
                    meter[0] = line[2:].strip()
            num, den = (int(x) for x in meter[0].split("/"))
            music = next(l for l in g[1:] if not l.startswith(("V:", "M:", "K:")))
            bars = 0
            for bar in (b for b in music.split("|") if b.strip()):
                m = re.fullmatch(r"Z(\d?)", bar.strip())
                bars += int(m.group(1) or 1) if m else 1
            return bars * num * 4 / den * 60 / tempo

        tail_label, tail_groups = sections[-1]
        tail = sum(dur(tail_label, g) for g in tail_groups)
        kept, total, best = [], 0.0, None
        for label, groups in sections[:-1]:
            for g in groups:
                d = dur(label, g)
                if total + d + tail > max_seconds:
                    break
                total += d
                if kept and kept[-1][0] == label:
                    kept[-1][1].append(g)
                else:
                    kept.append([label, [g]])
                if not g[-1].rstrip("|").endswith("-"):  # 붙임줄이 열린 채로 끝나지 않는 지점만 자를 수 있다
                    best = [[lb, list(gs)] for lb, gs in kept]
            else:
                continue
            break
        if not best:
            return text, info
        if best[-1][0] == tail_label:  # 같은 라벨이 연달아 오면 안 된다
            best[-1][1].extend(tail_groups)
        else:
            best.append([tail_label, tail_groups])
        out = _render(header, best)
        validate_score(out)
        info.update(seconds_after=round(seconds(out), 1), trimmed=True)
        return out, info
    except Exception:
        traceback.print_exc()
        return text, info


def instrumental_style(style: str) -> str:
    """yue2-music instrumental prepare()와 같은 규칙으로 연주곡 스타일을 정규화한다."""
    s = (style or "").strip().rstrip(".,") or "Expressive instrumental music"
    if not re.match(r"^instrumental\b", s, re.I):
        s = "Instrumental, " + s
    for term in NO_VOCAL_TERMS:
        if term not in s.lower():
            s += ", " + term
    return s + "."


def song_lyrics(text: str) -> str:
    """제목·마크다운·태그 번호를 정리하고(lyrics.clean_lyrics), 구간 태그가 없으면 한 덩어리 [Verse]로 감싼다."""
    from lyrics import clean_lyrics
    t = clean_lyrics(text)
    if not t:
        raise ValueError("가사가 비어 있습니다.")
    return t if re.search(r"^\[[A-Za-z -]+\]\s*$", t, re.M) else f"[Verse]\n{t}"


def device_name() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


_READY = None


def readiness() -> dict:
    """설치·모델 준비 상태. 모델을 메모리에 올리지 않는다. 준비되면 결과를 캐시한다."""
    global _READY
    if _READY:
        return _READY
    info = {"yue": YUE.is_dir(), "models": False, "torch": None, "error": None}
    try:
        import torch
        info["torch"] = torch.__version__
        import yue2  # noqa: F401
        import instrumentalize  # noqa: F401
        from huggingface_hub import snapshot_download
        for repo in ("m-a-p/YuE2-3B", "m-a-p/YuE2-Vae"):
            snapshot_download(repo, local_files_only=True)
        info["models"] = True
    except Exception as e:  # 설치 전/중
        info["error"] = f"{type(e).__name__}: {e}"
    if info["models"]:
        _READY = info
    return info


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, params: dict):
        self.id = uuid.uuid4().hex[:12]
        self.params = params
        self.status = "queued"  # queued | running | done | failed | cancelled
        self.stage = "대기 중"
        self.progress = 0
        self.error = None
        self.result = None
        self.cancel = threading.Event()
        self.created = time.time()
        self.dir = OUTPUTS / self.id

    def public(self) -> dict:
        return {"id": self.id, "status": self.status, "stage": self.stage, "progress": self.progress,
                "error": self.error, "result": self.result, "mode": self.params.get("mode")}


class Engine:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.queue: deque[Job] = deque()
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.current: Job | None = None
        self.verified = False  # 가중치 해시 검증은 프로세스당 한 번
        self._load_finished()
        threading.Thread(target=self._worker, daemon=True).start()

    def _load_finished(self):
        """재시작 전에 끝난 작업을 되살린다 — 브라우저가 새로고침 후 결과를 이어 받을 수 있게."""
        for meta in sorted(OUTPUTS.glob("*/job.json")):
            try:
                d = json.loads(meta.read_text(encoding="utf-8"))
                job = Job(d.get("params") or {})
                job.id, job.status, job.stage, job.progress = d["id"], "done", "완료", 100
                job.result, job.created, job.dir = d.get("result"), d.get("created", 0), meta.parent
                if (job.dir / "audio.mp3").is_file():
                    self.jobs[job.id] = job
            except Exception:
                continue

    # ── API ──────────────────────────────────────────────────────
    def submit(self, params: dict) -> Job:
        mode = params.get("mode", "instrumental")
        if mode not in ("instrumental", "song"):
            raise ValueError("mode는 instrumental 또는 song")
        if mode == "instrumental" and params.get("length", "medium") not in PLANNING_SECTIONS:
            raise ValueError("length는 short/medium/long")
        if not (params.get("style") or "").strip():
            raise ValueError("음악 설명(style)이 비어 있습니다.")
        if mode == "song":
            song_lyrics(params.get("lyrics", ""))
        job = Job(params)
        with self.lock:
            self.jobs[job.id] = job
            self.queue.append(job)
            self._prune()
        self.wake.set()
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def recent(self, mode=None, limit=20):
        """최근 작업(새 것부터) — 앱이 기존 오디오와 가사를 다시 연결할 때 고른다."""
        jobs = [j for j in self.jobs.values() if mode is None or j.params.get("mode") == mode]
        return sorted(jobs, key=lambda j: j.created, reverse=True)[:limit]

    def lyrics_timing(self, job_id: str):
        """노래 작업의 가사 줄 타이밍. 결과에 없으면(이전 버전 작업) 저장된 악보와 가사로 계산한다."""
        job = self.jobs.get(job_id)
        if not job or job.status != "done" or job.params.get("mode") != "song":
            return None
        if job.result and job.result.get("lyrics_timing"):
            return job.result["lyrics_timing"]
        score = job.dir / "score.abc"
        if not score.is_file():
            return None
        from lyrics import lyric_timing
        return lyric_timing(score.read_text(encoding="utf-8"), song_lyrics(job.params.get("lyrics", "")))

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or job.status not in ("queued", "running"):
            return False
        job.cancel.set()
        with self.lock:
            if job in self.queue:
                self.queue.remove(job)
                job.status, job.stage = "cancelled", "취소됨"
        return True

    def busy(self) -> dict:
        return {"running": self.current.id if self.current else None, "queued": len(self.queue)}

    # ── 내부 ────────────────────────────────────────────────────
    def _prune(self):
        done = [j for j in self.jobs.values() if j.status in ("done", "failed", "cancelled")]
        for j in sorted(done, key=lambda j: j.created)[:-KEEP_JOBS] if len(done) > KEEP_JOBS else []:
            self.jobs.pop(j.id, None)
            shutil.rmtree(j.dir, ignore_errors=True)

    def _worker(self):
        while True:
            self.wake.wait()
            with self.lock:
                job = self.queue.popleft() if self.queue else None
                if not self.queue:
                    self.wake.clear()
            if job is None:
                continue
            self.current = job
            job.status = "running"
            try:
                self._run(job)
                job.status, job.stage, job.progress = "done", "완료", 100
                (job.dir / "job.json").write_text(json.dumps(
                    {"id": job.id, "params": job.params, "result": job.result, "created": job.created},
                    ensure_ascii=False), encoding="utf-8")
            except Cancelled:
                job.status, job.stage = "cancelled", "취소됨"
            except Exception as e:
                traceback.print_exc()
                job.status, job.error = "failed", f"{type(e).__name__}: {e}"
            finally:
                self.current = None

    def _set(self, job, stage, progress=None):
        job.stage = stage
        if progress is not None:
            job.progress = max(job.progress, min(99, int(progress)))
        if job.cancel.is_set():
            raise Cancelled()

    def _run(self, job: Job):
        import numpy as np
        import soundfile as sf
        from yue2 import YuE2Pipeline

        p = job.params
        seed = int(p.get("seed") or 831001)
        job.dir.mkdir(parents=True, exist_ok=True)
        cancelled = job.cancel.is_set

        self._set(job, "모델 불러오는 중…", 2)
        pipe = YuE2Pipeline.from_pretrained("m-a-p/YuE2-3B", vae="m-a-p/YuE2-Vae", device=device_name(),
                                            local_files_only=True, progress=False,
                                            verify_hashes=not self.verified,
                                            memory_budget_gib=float(os.environ.get("MUSIC_BUDGET_GIB", 16)))
        self.verified = True
        try:
            if p.get("mode") == "song":
                style = p["style"].strip()
                request = dict(id="song", style=style, lyrics=song_lyrics(p.get("lyrics", "")), cot="full", seed=seed)
                expected = None
            else:
                from abc_tools import parse_abc, report
                from instrumental import lyric_tags, validate_score
                from instrumentalize import convert_score
                style = instrumental_style(p["style"])
                tags = PLANNING_SECTIONS[p.get("length", "medium")]
                planning = dict(id="plan", style=style, lyrics="\n\n".join(f"[{t}]" for t in tags) + "\n", cot="full", seed=seed)
                self._set(job, "악보 작곡 중… (YuE2)", 5)
                abc_count = [0]

                def on_abc(*_):
                    abc_count[0] += 1
                    if abc_count[0] % 20 == 0:  # 악보는 보통 1~2천 토큰
                        self._set(job, "악보 작곡 중… (YuE2)", 5 + 13 * min(1.0, abc_count[0] / 1500))

                plan = pipe.plan(**planning, cancelled=cancelled, on_token=on_abc)
                if plan.truncated or not plan.abc:
                    raise RuntimeError("YuE2가 악보를 끝까지 쓰지 못했습니다. 다시 시도하세요.")
                (job.dir / "original.abc").write_text(plan.abc, encoding="utf-8")
                converted, _ = convert_score(plan.abc, overlap="vocal", keep_chords=True)
                converted, fit = fit_length(converted, MAX_SECONDS[p.get("length", "medium")])
                job.fit = fit
                score = validate_score(converted)
                (job.dir / "score.abc").write_text(converted, encoding="utf-8")
                request = dict(id="instrumental", style=style, lyrics=lyric_tags(converted), abc=converted,
                               cot="full" if score.voices["Vocal"].chords else "melody", seed=seed)
                expected = report(parse_abc(converted)).get("nominal_duration_seconds")

            total = max(1.0, (expected or 60) * SEMANTIC_TOKENS_PER_SECOND)
            count, sem = [0], [0]

            def on_token(phase, _token):
                if phase == "abc":  # 노래 모드: 같은 호출 안에서 악보부터 쓴다
                    count[0] += 1
                    if count[0] % 20 == 0:
                        self._set(job, "악보 작곡 중… (YuE2)", 5 + 13 * min(1.0, count[0] / 1500))
                    return
                sem[0] += 1
                if sem[0] % 10 == 0:
                    self._set(job, "음악 생성 중…", 20 + 60 * min(1.0, sem[0] / total))

            # pipe(**request)와 같은 순서를 공개 단계 API로 나눠 단계별 진행을 보여 준다
            # (합성·디코딩은 토큰 콜백이 없어 한 번에 부르면 몇 분씩 진행률이 멈춘다).
            self._set(job, "음악 생성 중…", 20)
            plan = pipe.plan(**request, cancelled=cancelled, on_token=on_token)
            semantic = pipe.generate_semantic(plan, cancelled=cancelled, on_token=on_token)
            self._set(job, "소리 합성 중… (수 분)", 82)
            latents = pipe.synthesize(semantic, cancelled=cancelled)
            self._set(job, "오디오 디코딩 중…", 94)
            audio = np.asarray(pipe.decode(latents))
            self._set(job, "오디오 저장 중…", 98)
            sf.write(job.dir / "audio.flac", audio, 48000, subtype="PCM_24")
            sf.write(job.dir / "audio.mp3", audio, 48000, format="MP3")
            if plan.abc and not (job.dir / "score.abc").is_file():
                (job.dir / "score.abc").write_text(plan.abc, encoding="utf-8")
            truncated = bool(plan.truncated or semantic.truncated)
            timing = None
            if p.get("mode") == "song" and plan.abc:
                try:
                    from lyrics import lyric_timing
                    timing = lyric_timing(plan.abc, request["lyrics"])
                except Exception:
                    traceback.print_exc()
            job.result = {"seconds": round(len(audio) / 48000, 2), "style": style, "seed": seed,
                          "score": (job.dir / "score.abc").is_file(), "truncated": truncated,
                          "fit": getattr(job, "fit", None), "lyrics_timing": timing}
        except InterruptedError as e:
            raise Cancelled() from e
        finally:
            pipe.close()
            del pipe
            gc.collect()
            try:
                import torch
                if torch.backends.mps.is_available():
                    torch.mps.empty_cache()
            except Exception:
                pass
