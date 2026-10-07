---
name: genitor-music
description: >-
  Generate background music (instrumental BGM) and songs for Genitor decks and
  motion graphics with the open YuE2 model, running locally on an Apple Silicon
  Mac's GPU (MPS) or a Linux machine's NVIDIA GPU (CUDA). Use when the user wants music for slides, a presentation,
  a promo or motion graphic — "배경음악 만들어줘", "BGM 생성", "슬라이드에 깔 음악",
  "이 가사로 노래 만들어", "모션그래픽 음악", "비트에 맞출 음악" — including a
  designed score whose tempo, sections, drop and final hit line up with planned
  animation. Pairs with genitor-slides (the deck); beat analysis for syncing visuals
  is a separate, later step (music-sync), not part of generation. Runs in Claude Code on macOS arm64 or
  Linux + NVIDIA (BF16 GPU); elsewhere it prepares the prompt/score and hands generation to Genitor's
  built-in "음악 생성".
---

# genitor-music

Make music with **YuE2** (open weights, `m-a-p/YuE2-3B`). It runs locally on the user's Apple Silicon Mac or Linux NVIDIA machine and the result drops into a Genitor deck as an audio element. YuE2 takes three inputs: an English **style** line, **lyrics** with section tags, and an optional **ABC score**. The score fixes tempo, bars, chords and section order. Style text can only *request* drums, timbre and silences.

`SKILL_DIR` = the directory of this file.

## 0. Where this can run

| Environment | What to do |
|---|---|
| Claude Code on macOS **arm64** (M1 or later) | Everything below, **macOS** rows |
| Claude Code on **Linux + NVIDIA GPU** (BF16: compute capability ≥ 8, e.g. RTX 30/40, A6000, A100) | Everything below, **Linux** rows |
| Claude Desktop / claude.ai / Windows / Linux without an NVIDIA GPU | YuE2 cannot run here: CPU is far too slow. Write the style line (and the score, if one is wanted) and tell the user how to generate it in Genitor: select a text box → **✨ AI ▾ → 음악 생성…** with the Genitor music server running on their Mac. |

Check with `uname -sm` (`Darwin arm64` → macOS; `Linux x86_64` → Linux) and, on Linux,
`nvidia-smi --query-gpu=index,name,compute_cap,memory.used --format=csv`.

## 1. Install

### Linux (once per machine)
```bash
sh "$SKILL_DIR/scripts/install_linux.sh" --check                # exit 0 = ready
sh "$SKILL_DIR/scripts/install_linux.sh" --yue /path/to/YuE     # reuse an existing YuE checkout + its .venv
```
If the user already has a YuE source checkout (e.g. a clone of `multimodal-art-projection/YuE` with a
`.venv` where `pip install .` was run), point `--yue` at it: nothing is downloaded except model weights
missing from the Hugging Face cache. Look for one before installing (`ls */YuE/.venv`, the user's source
folders). Without `--yue`, the script fetches the pinned YuE commit into `~/.local/share/genitor-music/YuE`
and installs a Python 3.12 venv with uv (about 15 GB with weights, tens of minutes) — **ask before
running that**. Either way it writes `~/.local/share/genitor-music/env.sh` (`GENITOR_MUSIC_HOME` changes the
folder):
```bash
. "${GENITOR_MUSIC_HOME:-$HOME/.local/share/genitor-music}/env.sh"   # sets YUE2_HOME, GENITOR_MUSIC_PY
PY="$GENITOR_MUSIC_PY"
RUNNER="$SKILL_DIR/scripts/yue2_cuda.py"
YUE2_CLI="$(dirname "$PY")/yue2"
DEVICE=cuda
```
`yue2_cuda.py` runs the upstream yue2-music instrumental workflow unchanged; it only replaces the loader
so that the checkout's own yue2-infer version is accepted (upstream pins 0.1.5) while keeping the CUDA/BF16
checks and the frozen weight checks (revision files and SHA-256).

### macOS (once per Mac)

```bash
sh "$SKILL_DIR/scripts/install_mac.sh" --check   # exit 0 = ready
```
If it is not ready, **ask before installing**. The install downloads about 11 GB (torch, 7.8 GB of YuE2 weights, and 1.3 GB of lyric-alignment models) and takes tens of minutes. Then run:
```bash
sh "$SKILL_DIR/scripts/install_mac.sh"            # add --claude-skill to also link the upstream yue2-music skill
```
It installs to `~/Library/Application Support/genitor-music` (`$HOME_DIR` below). That folder holds the YuE2 source pinned to a verified commit, a Python 3.12 venv, and torch ≥ 2.13. Never downgrade torch: torch ≤ 2.12 silently corrupts BF16 causal attention on MPS. Weights go to the shared Hugging Face cache. The script is idempotent, so re-running it resumes an interrupted download.

```bash
HOME_DIR="$HOME/Library/Application Support/genitor-music"
YUE2_HOME="$HOME_DIR/YuE"
PY="$HOME_DIR/.venv/bin/python"
RUNNER="$SKILL_DIR/scripts/yue2_mac.py"
YUE2_CLI="$HOME_DIR/.venv/bin/yue2"
DEVICE=mps
```

## 2. One GPU job at a time

**Linux:** one YuE2 run per GPU. Pick a GPU with little memory in use from `nvidia-smi` and prefix each
command with `CUDA_VISIBLE_DEVICES=<index>`; runs on different GPUs can go in parallel. A run needs about
24 GB of GPU memory.

**macOS:** the Genitor music server (`launch.command`, port 8326) may already be generating. Two YuE2 runs at once can exhaust 16 GB of unified memory. Check before every run:
```bash
curl -s localhost:8326/api/health   # "running": null and "queued": 0 → free
```
If the server is up, you may submit to it instead of running the CLI. It queues jobs safely:
```bash
curl -s -X POST localhost:8326/api/jobs -H 'content-type: application/json' \
  -d '{"mode":"instrumental","style":"...","length":"short|medium|long"}'      # ≤75/120/200 s; or {"mode":"song","style":"...","lyrics":"..."}
curl -s localhost:8326/api/jobs/<id>                  # status / stage / progress
curl -s -o bgm.mp3 "localhost:8326/api/jobs/<id>/audio?format=mp3"   # or flac
```

## 3. Write the inputs

**Style**: one line of English tags covering genre, mood, main instruments, drums, `<N> BPM`, and optionally the key. Translate a Korean request into English tags. YuE2 follows English tags best.
- Instrumental: start with `Instrumental,` and end with `no vocals, no singing, no choir, no spoken words` (the wrapper adds these if missing).
- Song: name the lyric language and the vocal character, e.g. `Korean, warm female vocal, acoustic pop, 88 BPM`.

**Lyrics** (songs): section tags on their own lines (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`), followed by the words. Instrumentals carry only the tags; the tooling writes them.

**Score** (optional, instrumental): write it only when timing must be controlled, e.g. animation that cuts on a drop. Otherwise YuE2 composes the score itself, which is the default. See §4.

## 4. Generate

### Instrumental BGM, composed by YuE2 (default)
```bash
"$PY" "$RUNNER" run --style "Instrumental, ..." --output WORK/bgm --offline
```
**Check the length first.** YuE2's planner does not follow section tags reliably. A request meant to be short once produced a 226 s score. Add `--prepare-only`, read `nominal_seconds` from the output, and only then generate with `"$PY" "$RUNNER" generate --prepared WORK/bgm/prepared --output WORK/bgm/generation --offline`. If the score is too long, re-plan with another `--seed` or shorten the score at a group boundary before generating (the Genitor music server does this automatically: short ≤ 75 s, medium ≤ 120 s, long ≤ 200 s, keeping the ending section).

This runs the upstream yue2-music workflow unchanged: YuE2 plans an ABC score, the Vocal notes move to Ins, and the score is rendered. The wrapper swaps only the CUDA-only loader for MPS and still checks the weight hashes. Output goes to `WORK/bgm/generation/native/audio.flac`, with a summary in `generation/summary.json` and a player plus mp3 in `listen/` (made with `"$PY" "$RUNNER" share WORK/bgm/generation --output WORK/bgm/listen`). Output folders must be new.

### Designed score for motion graphics
Only when the user wants sync points. Start from `assets/make_motion_bgm_events.py`: A minor, 120 BPM, 24 bars (about 48 s). The structure is intro stabs → build with a one-beat rest → drop at bar 9 → stop-time break → chorus → final hit at bar 23. At 120 BPM a beat is 0.5 s, which divides evenly into 30/60 fps frames. Edit the notes and sections, run it to write `events.json`, then:
```bash
"$PY" "$RUNNER" run --composer agent --events WORK/events.json --style-file "$SKILL_DIR/assets/motion-bgm-style.txt" --output WORK/mg --offline
```
Events format: `[onset, duration, MIDI]` in quarter notes, plus chords and section labels. See `$YUE2_HOME/skills/yue2-music/instrumental/references/event-schema.md`. Ins is monophonic, so no stacked notes.

### Song with lyrics
```bash
cat > WORK/req.json <<'EOF'
{"id":"song","style":"Korean, warm female vocal, acoustic pop, 88 BPM","lyrics":"[Verse]\n...\n\n[Chorus]\n...","cot":"full","seed":831001}
EOF
"$YUE2_CLI" generate --device "$DEVICE" --offline --request WORK/req.json --output WORK/song
```
Do not use `examples/generate.py`, which hardcodes CUDA.

Run long jobs in the background and wait for completion. On an M1 (16 GB), a 47 s instrumental took about 8 minutes (about 10× real time) and peaked at about 8 GB of GPU memory; warn before anything longer than about 3 minutes of audio there, because MPS memory grows with length. On Linux an RTX A6000 rendered a 46 s instrumental in about 34 s (plus about 15 s to plan), and 2–3 minute songs in about 1.5–2 minutes. To get another take, change `seed` in `prepared/request.json` and run `"$PY" "$RUNNER" generate --prepared WORK/x/prepared --output WORK/x/gen-2 --offline`.

## 5. Check before reporting

- Report the actual audio length, the wall time, the `truncated` flags, and where the score came from (YuE2, agent or user).
- Generation ends here. Do **not** run beat analysis (music-sync) as part of generating. That belongs to the later step of syncing visuals to the track, and runs only when the user asks for it. When it does run, use the measured grid: generated audio usually starts about 0.4 s in, so not bar × 2 s.
- Say plainly what the score did not control. A stop-time break often comes back as a softer breakdown, not true silence. Re-seed rather than claim it.
- File checks are not listening. Never describe how it sounds.

## 6. Put it in the Genitor deck

Genitor's HTML import turns each visible `<audio controls src="audio/x.mp3">` into an audio visualizer element at the player's position and size (autoplays while presenting; bar color follows the player background). Keep the mp3 at a path relative to the HTML: when the user opens the HTML, Genitor asks for its folder and loads the files from it (dropping the HTML together with the mp3 files also works). A hidden `<audio>` without controls is not imported. Add `data-advance="end"` to the `<audio>` when the slide should advance only after the song finishes (auto-advance and exhibition loop wait for it even if the narration ends first), `data-max-play="90"` to cap playback with a 2 s fade-out, or `data-bgm="3"` / `data-bgm="end"` to keep it playing across the next slides as background music (ducked under narration). See genitor-slides for the slide-level `data-advance` rule. Without an HTML deck, give the user the mp3 (or flac) and tell them to drag it onto the slide canvas. It becomes an audio visualizer element that autoplays and loops while presenting. Alternatively, in Genitor, select a text box with the music description → **✨ AI ▾ → 음악 생성…** to generate and insert it directly. For a song generated from a lyrics text box this way, that text box is linked to the audio: while presenting, the lyrics scroll inside the box with the current line centered and highlighted (line timing comes from aligning the lyrics to the separated vocals; the server does this right after generation). An existing song can be linked by selecting its audio element → **✨ AI ▾ → 가사 싱크 연결…** (and unlinked there with 가사 싱크 해제). For a deck made with genitor-slides, name the slide the music belongs to and give the score's designed bar times (bar N ≈ 2 s × (N−1) at 120 BPM, plus the start offset), so the user can align `data-anim` delays to the drop.

## Licenses

YuE2 code and these scripts are Apache-2.0. The model weights are **CC BY-NC 4.0 plus an additional creator permission**. Individuals and creators may use and monetize the outputs. Companies using the model commercially need a license from the YuE2 authors. Mention this when the user's use looks commercial.
