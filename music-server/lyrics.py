"""가사 정리와 가사 줄 타이밍 — 노래를 만든 악보(ABC)의 보컬 프레이즈로 줄마다 시작·끝 시각을 낸다.

YuE2는 가사와 음표의 정렬(어느 음절이 어느 음표인지)을 내주지 않는다. 대신 노래는 자기가 쓴 악보를
조건으로 렌더링되므로(템포·마디가 악보와 거의 같다), 악보의 보컬 음표를 구간별로 나눠 가사 줄에 맞춘다.
  1) 악보 구간(% verse 등)과 가사 구간([Verse] 등)을 순서·이름으로 짝짓는다.
  2) 한 구간의 보컬 음표를 가장 긴 쉼 (줄 수 − 1)곳에서 잘라 줄 수만큼의 프레이즈로 나눈다.
  3) 가사 구간이 없는 악보 구간(보통 intro)의 보컬 음표는 다음 구간의 못갖춘마디로 붙인다.
결과는 악보 시간(초) 기준이다. 실제 오디오와의 작은 어긋남은 앱에서 오프셋으로 보정한다.
"""
from __future__ import annotations

import re

SECTION_ALIASES = {
    "pre chorus": "pre-chorus", "prechorus": "pre-chorus", "pre-chorus": "pre-chorus",
    "hook": "chorus", "refrain": "chorus", "post chorus": "chorus", "post-chorus": "chorus",
    "instrumental": "interlude", "break": "interlude", "solo": "interlude",
}
_TAG = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def _norm_label(raw: str) -> str:
    s = re.sub(r"[\d#.:]+", " ", raw.lower()).strip()
    s = re.sub(r"\s+", " ", s)
    return SECTION_ALIASES.get(s, s.replace(" ", "-"))


def clean_lyrics(text: str) -> str:
    """ChatGPT 등이 붙이는 군더더기를 걷어낸다 — 부르면 안 되는 글자가 가사로 들어가지 않게.
    - 첫 태그 앞의 줄(제목 등)은 버린다. 태그가 하나도 없으면 전부 가사로 본다.
    - 마크다운 강조(**, __, *, #, >)와 줄 끝 공백을 지운다.
    - 태그 번호를 뗀다: [Verse 1] → [Verse], [Pre Chorus] → [Pre-Chorus].
    """
    lines = [l.rstrip() for l in (text or "").replace("\r\n", "\n").split("\n")]
    if any(_TAG.match(l) for l in lines):
        lines = lines[next(i for i, l in enumerate(lines) if _TAG.match(l)):]
    out = []
    for line in lines:
        m = _TAG.match(line)
        if m:
            label = _norm_label(m.group(1))
            out.append("[" + "-".join(w.capitalize() for w in label.split("-")) + "]")
            continue
        line = re.sub(r"(\*\*|__|\*|`)", "", line)
        line = re.sub(r"^\s*(#+|>)\s*", "", line).strip()
        out.append(line)
    text = "\n".join(out).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def lyric_sections(text: str):
    """정리된 가사 → [(label, [줄...])]. 빈 줄은 버린다."""
    sections = []
    for line in text.split("\n"):
        m = _TAG.match(line)
        if m:
            sections.append([_norm_label(m.group(1)), []])
        elif line.strip():
            if not sections:
                sections.append(["verse", []])
            sections[-1][1].append(line.strip())
    return [(label, lines) for label, lines in sections if lines]


def syllables(line: str) -> int:
    """대략의 음절 수 — 한글은 글자 수, 라틴 문자는 단어별 모음 덩어리 수."""
    n = len(re.findall(r"[\uac00-\ud7a3]", line))
    for word in re.findall(r"[A-Za-z']+", line):
        n += max(1, len(re.findall(r"[aeiouy]+", word.lower())))
    return max(1, n + len(re.findall(r"[\u3040-\u30ff\u4e00-\u9fff]", line)))


def _split_phrases(notes, weights, balance=2.0):
    """연속 음표를 len(weights)개 프레이즈로 자른다. notes=[(onset, pitch, dur)] (4분음표 단위)
    자른 자리의 쉼(박)이 길수록, 각 프레이즈의 음표 수가 줄 음절 비율에 가까울수록 좋다.
      score = Σ 자른 곳의 쉼 − balance × Σ |음표 수 − 기대 음표 수| / 기대 음표 수
    쉼이 뚜렷하면(verse의 1마디 쉼) 쉼을 따르고, 쉼이 다 짧으면(반 박) 음절 비율로 나눈다."""
    count, m = len(weights), len(notes)
    if count <= 1 or m <= 1:
        return [notes]
    if m < count:
        return []
    gap = [notes[i + 1][0] - (notes[i][0] + notes[i][2]) for i in range(m - 1)]
    total_w = float(sum(weights))
    expect = [m * w / total_w for w in weights]
    NEG = float("-inf")
    # best[k][j]: 앞 j개 음표를 k개 프레이즈로 나눴을 때 최고점, back: 직전 자르기 위치
    best = [[NEG] * (m + 1) for _ in range(count + 1)]
    back = [[0] * (m + 1) for _ in range(count + 1)]
    best[0][0] = 0.0
    for k in range(1, count + 1):
        for j in range(k, m - (count - k) + 1):
            for i in range(k - 1, j):
                if best[k - 1][i] == NEG:
                    continue
                size = j - i
                v = best[k - 1][i] - balance * abs(size - expect[k - 1]) / expect[k - 1]
                if j < m:
                    v += float(gap[j - 1])
                if v > best[k][j]:
                    best[k][j], back[k][j] = v, i
    cuts, j = [], m
    for k in range(count, 0, -1):
        i = back[k][j]
        cuts.append((i, j))
        j = i
    return [notes[i:j] for i, j in reversed(cuts)]


def lyric_timing(abc: str, lyrics: str):
    """→ [{"start", "end", "text", "section"}] (초, 악보 기준). 맞출 수 없으면 빈 목록."""
    from abc_tools import parse_abc
    from instrumentalize import section_starts

    score = parse_abc(abc)
    spq = 60.0 / score.bpm  # seconds per quarter
    vocal = sorted(score.voices["Vocal"].notes)
    if not vocal:
        return []
    starts = sorted(section_starts(abc, score).items())  # [(bar_start_quarters, label)]
    total = score.voices["Vocal"].time
    blocks = []  # [label, notes, end_quarters]
    for i, (t0, label) in enumerate(starts):
        t1 = starts[i + 1][0] if i + 1 < len(starts) else total
        notes = [n for n in vocal if t0 <= n[0] < t1]
        if notes:
            blocks.append([label, notes, t1])

    # 구간 끝의 못갖춘마디 — 2박 이상 쉰 뒤 마지막 마디 안에서 시작해 구간 끝까지 이어지는 음 —
    # 는 다음 구간 첫 줄의 시작이다. 그대로 두면 '가장 긴 쉼'이 엉뚱한 곳에 잡힌다.
    meter = score.voices["Vocal"].meter
    bar = meter[0] * 4 / meter[1]
    for i in range(len(blocks) - 1):
        notes, end = blocks[i][1], blocks[i][2]
        k = len(notes)
        while k > 1 and notes[k - 1][0] >= end - bar:
            k -= 1
        tail = notes[k:]
        gap = tail[0][0] - (notes[k - 1][0] + notes[k - 1][2]) if tail else 0
        if tail and gap >= 2 and tail[-1][0] + tail[-1][2] >= end - 0.5:
            blocks[i][1] = notes[:k]
            blocks[i + 1][1] = tail + blocks[i + 1][1]

    sections = lyric_sections(lyrics)
    if not sections:
        return []

    # 가사 구간에 짝이 없는 악보 구간(intro 등)의 보컬은 다음 구간의 못갖춘마디로 붙인다.
    lyric_labels = {label for label, _ in sections}
    merged = []
    carry = []
    for label, notes, _ in blocks:
        if label not in lyric_labels and label in ("intro", "interlude"):
            carry += notes
            continue
        merged.append([label, carry + notes])
        carry = []
    if carry and merged:
        merged[-1][1] += carry

    # 악보 구간 ↔ 가사 구간 짝짓기: 순서대로, 이름이 같으면 우선. 악보가 후렴을 반복하면 같은 가사를 다시 쓴다.
    lines_out = []
    li = 0
    last_by_label = {}
    for label, notes in merged:
        match = None
        for j in range(li, len(sections)):
            if sections[j][0] == label:
                match, li = sections[j], j + 1
                break
        if match is None and label in last_by_label:
            match = last_by_label[label]          # 반복 구간(후렴 다시)
        if match is None and li < len(sections):
            match, li = sections[li], li + 1      # 이름이 달라도 순서대로
        if match is None:
            continue
        last_by_label[label] = match
        phrases = _split_phrases(notes, [syllables(t) for t in match[1]])
        if len(phrases) < len(match[1]):          # 음표가 줄보다 적으면 구간 시간을 고르게 나눈다
            a, b = notes[0][0], notes[-1][0] + notes[-1][2]
            step = (b - a) / len(match[1])
            phrases = [[(a + k * step, 0, step)] for k in range(len(match[1]))]
        for text, ph in zip(match[1], phrases):
            lines_out.append({"start": float(ph[0][0] * spq), "end": float((ph[-1][0] + ph[-1][2]) * spq),
                              "text": text, "section": match[0]})

    lines_out.sort(key=lambda x: x["start"])
    for a, b in zip(lines_out, lines_out[1:]):
        a["end"] = max(a["end"], min(b["start"], a["end"] + 2.0))  # 다음 줄 전까지 조금 더 머문다
    return [{**l, "start": round(l["start"], 3), "end": round(l["end"], 3)} for l in lines_out]
