"""가사 줄 타이밍을 실제 노래 소리에 맞춘다 — 보컬 분리(Demucs) + 강제 정렬(MMS, torchaudio).

악보 기반 타이밍(lyrics.lyric_timing)은 YuE2가 악보를 마디 단위로 따르지 않으면 어긋난다. 실측한 102초 곡은
YuE2가 인트로에서 1마디를 빼고 불러 모든 줄이 약 2초 늦었고, 줄 나누기 추정이 틀린 곳은 4초까지 어긋났다.
가사는 이미 알고 있으므로 받아쓰기 대신 강제 정렬로 각 단어가 불린 구간을 찾는다.
  1) Demucs(htdemucs)로 반주를 걷어 낸 보컬을 얻는다.
  2) 가사를 uroman으로 로마자로 바꿔(MMS 정렬 모델의 문자 집합) 줄 사이에 '*'(무엇이든 흡수)를 끼운다.
  3) CTC 강제 정렬 → 단어 구간 → 줄의 첫 단어 시작·마지막 단어 끝.
신뢰도(문자 평균 확률)가 낮은 줄은 악보 기반 값에 '정렬이 확실한 줄들의 차이 중앙값'을 더해 대신 쓴다.
결과 시각은 오디오 기준(초)이라 앱의 보정값은 0이다.

라이선스: Demucs MIT. MMS 정렬 모델은 CC BY-NC 4.0(비상업) — YuE2 가중치와 같은 조건.
"""
from __future__ import annotations

import re
import statistics
import subprocess
import sys
from pathlib import Path

MIN_LINE_SCORE = 0.3   # 실측 0.61~0.84. 이보다 낮으면 그 줄은 정렬을 믿지 않는다.
LANG_HINTS = (("kor", r"[가-힣]"), ("jpn", r"[぀-ヿ]"), ("zho", r"[一-鿿]"))


def available() -> bool:
    try:
        import demucs  # noqa: F401
        import uroman  # noqa: F401
        from torchaudio.pipelines import MMS_FA  # noqa: F401
        return True
    except Exception:
        return False


def separate_vocals(audio: Path, workdir: Path, device: str) -> Path:
    """Demucs로 보컬만 분리 → vocals.wav 경로."""
    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / "htdemucs" / audio.stem / "vocals.wav"
    if out.is_file():
        return out
    subprocess.run([sys.executable, "-m", "demucs", "--two-stems", "vocals", "-n", "htdemucs",
                    "-d", device, "-o", str(workdir), str(audio)], check=True, capture_output=True)
    return out


def _lang(text: str):
    for code, pattern in LANG_HINTS:
        if re.search(pattern, text):
            return code
    return None


def force_align(vocals: Path, lines: list[str]):
    """보컬 + 가사 줄 → [(start, end, score) | None] (줄마다, 초)."""
    import soundfile as sf
    import torch
    import torchaudio
    import uroman
    from torchaudio.pipelines import MMS_FA

    wav, sr = sf.read(str(vocals), dtype="float32", always_2d=True)
    wav = torchaudio.functional.resample(torch.from_numpy(wav.mean(1)).unsqueeze(0), sr, MMS_FA.sample_rate)
    vocab = set(MMS_FA.get_dict(star=None))
    roman = uroman.Uroman()

    words, owner = [], []
    for i, line in enumerate(lines):
        rom = roman.romanize_string(line, lcode=_lang(line)).lower()
        for w in re.findall(r"[a-z']+", rom):
            w = "".join(c for c in w if c in vocab)
            if w:
                words.append(w)
                owner.append(i)
    if not words:
        return [None] * len(lines)
    transcript, wmap = [], []
    for k, w in enumerate(words):
        if k and owner[k] != owner[k - 1]:
            transcript.append("*")   # 간주·숨소리·반주 잔향을 노래로 늘이지 않게
            wmap.append(None)
        transcript.append(w)
        wmap.append(k)

    model = MMS_FA.get_model(with_star=True).eval()
    with torch.inference_mode():
        emission, _ = model(wav)
    spans = MMS_FA.get_aligner()(emission[0], MMS_FA.get_tokenizer()(transcript))
    ratio = wav.size(1) / emission.size(1) / MMS_FA.sample_rate
    acc = {}
    for span, k in zip(spans, wmap):
        if k is None:
            continue
        s, e = span[0].start * ratio, span[-1].end * ratio
        n = sum(len(t) for t in span)
        d = acc.setdefault(owner[k], [s, e, 0.0, 0])
        d[0], d[1] = min(d[0], s), max(d[1], e)
        d[2] += sum(t.score * len(t) for t in span)
        d[3] += n
    return [(acc[i][0], acc[i][1], acc[i][2] / acc[i][3]) if i in acc else None for i in range(len(lines))]


def merge(score_lines: list[dict], aligned: list) -> list[dict]:
    """정렬 결과와 악보 기반 타이밍을 합친다(순수 함수). 신뢰도 낮은 줄은 악보 값 + 차이 중앙값."""
    good = [(a[0] - s["start"]) for s, a in zip(score_lines, aligned) if a and a[2] >= MIN_LINE_SCORE]
    shift = statistics.median(good) if good else 0.0
    out = []
    for s, a in zip(score_lines, aligned):
        if a and a[2] >= MIN_LINE_SCORE:
            out.append({**s, "start": round(a[0], 3), "end": round(a[1], 3), "score": round(a[2], 3), "source": "vocal"})
        else:
            out.append({**s, "start": round(s["start"] + shift, 3), "end": round(s["end"] + shift, 3),
                        "score": round(a[2], 3) if a else None, "source": "score"})
    # 줄 순서가 뒤집히면(정렬 실패가 섞인 경우) 앞 줄 끝 이후로 민다
    for prev, cur in zip(out, out[1:]):
        if cur["start"] < prev["start"]:
            cur["start"] = prev["end"]
    for prev, cur in zip(out, out[1:]):
        prev["end"] = max(prev["end"], min(cur["start"], prev["end"] + 2.0))  # 다음 줄 전까지 조금 머문다
    return out


def align_lyrics(audio: Path, score_lines: list[dict], workdir: Path, device: str = "cpu") -> list[dict]:
    """노래 오디오 + 악보 기반 줄 타이밍 → 소리에 맞춘 줄 타이밍(오디오 기준 초)."""
    vocals = separate_vocals(audio, workdir, device)
    return merge(score_lines, force_align(vocals, [l["text"] for l in score_lines]))
