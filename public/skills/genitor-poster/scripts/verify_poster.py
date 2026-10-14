#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_poster.py — 인쇄물(전시 포스터·배너·패널) 검사.

genitor-slides의 verify_deck.py에서 레이아웃 검사를 그대로 가져다 쓰고
(FLEX·WRAP·OVERFLOW·OUTSIDE·PAD — 인쇄물에도 똑같이 필요하다),
화면용 검사(ANIM·ANIM-REF·NOTES·LOOP·MEDIA·NAV·SAFE)는 걸러낸 뒤
인쇄에만 있는 검사 넷을 얹는다.

  BLEED   재단 여백 밖에 놓인 글자 — 잘려 나간다
  DIST    보는 거리 기준 최소 글자 크기 미달 — 안 읽힌다
  LINE    2 mm 아래 선·획 — 멀리서 사라진다
  ROT     (경고) 회전 요소의 저장 좌표가 캔버스 밖 — 인쇄는 정상, 편집기에서만 불편
  INK     (경고) CMYK에서 탁해지는 색 — 형광에 가까운 순색
  INERT   data-anim·fe-notes 등 인쇄물에서 아무 효과 없는 속성

여백에 일부러 두는 것(세로 레일·재단 표시·인쇄 지시)에는 data-print-mark를 달면
BLEED·DIST·LINE에서 빠진다. 장식과 본문은 자동으로 가를 수 없다.

왜 복사하지 않고 불러 쓰나: 형식 계약(추출이 망가지는 패턴)은 한 벌이어야 한다.
두 벌로 두면 반드시 갈라진다.

사용:
  python3 verify_poster.py poster.html --mm 750x1250
  python3 verify_poster.py poster.html --mm 750x1250 --dist 2.0 --shots out/
"""
import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.normpath(os.path.join(HERE, "..", "..", "genitor-slides", "scripts", "verify_deck.py"))

# 인쇄물에서 의미 없는 검사 — 결과에서 걸러낸다
SCREEN_ONLY = ("ANIM", "ANIM-REF", "NOTES", "LOOP", "MEDIA", "NAV", "SAFE")

# 인쇄물에서 아무 효과 없는 속성
INERT_ATTRS = ("data-anim", "data-anim-loop", "data-advance", "data-max-play",
               "data-bgm", "data-transition", "data-viz")

MM_IN = 25.4
BLEED_MM = 3        # 인쇄소 기본 재단 여유
SAFE_MM = 50        # 글자를 두지 않을 가장자리 폭(대형 출력 기준)
LINE_MM_PER_M = 1.3  # 선 굵기 하한 = 보는 거리(m) × 이 값. 1.5 m에서 약 2 mm
GLYPH = 0.7         # font-size 대비 실제 글자높이 비율


def load_deck():
    spec = importlib.util.spec_from_file_location("verify_deck", DECK)
    if spec is None or not os.path.exists(DECK):
        sys.exit(f"verify_deck.py를 찾을 수 없다: {DECK}\n"
                 "genitor-slides 스킬과 나란히 설치돼 있어야 한다.")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "run_checks"):
        sys.exit("verify_deck.py에 run_checks()가 없다 — 구버전이다. genitor-slides를 갱신할 것.")
    return mod


# 인쇄 전용 검사. 같은 페이지에서 한 번 더 평가한다.
PRINT_JS = r"""
([cw, ch, ppmm, safePx, minLinePx, minFontPx, bleedPx]) => {
  const out = [];
  const slides = [...document.querySelectorAll('.slide')];
  slides.forEach((slide, si) => {
    const prev = slide.className;
    slide.classList.add('active');
    const sb = slide.getBoundingClientRect();
    for (const el of slide.querySelectorAll('*')) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      const x = Math.round(b.left - sb.left), y = Math.round(b.top - sb.top);
      const w = Math.round(b.width), h = Math.round(b.height);
      if (!w && !h) continue;
      const at = `S${si + 1} @${x},${y}`;
      // 여백에 일부러 두는 것(세로 레일·재단 표시·인쇄 지시)은 작성자가 표시한다.
      // 자동으로는 장식과 본문을 가를 수 없다.
      const isDeco = el.hasAttribute('data-print-mark');
      const own = [...el.childNodes]
        .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      const label = (own || el.textContent || '').trim().slice(0, 26) || '(도형)';

      // ── ROT: 회전 요소는 화면엔 들어와도 선언 박스가 캔버스 밖일 수 있다
      if (cs.transform && cs.transform !== 'none' && /matrix/.test(cs.transform)) {
        const ow = el.offsetWidth, oh = el.offsetHeight;
        const ol = el.offsetLeft, ot = el.offsetTop;
        if (ol < 0 || ot < 0 || ol + ow > cw || ot + oh > ch) {
          // 렌더는 정상이다 — Genitor 추출기가 회전 후 bbox 중심에서 역산하므로
          // transform-origin을 바꿔도 저장 좌표는 같다. 편집기에서 핸들이 밖으로 나갈 뿐.
          out.push(`WARN ${at} ROT 회전 요소의 저장 좌표가 캔버스 밖 ` +
                   `(${ol},${ot} ${ow}x${oh}) — 인쇄는 정상, 편집기에서 핸들이 밖으로 나간다 :: ${label}`);
        }
      }

      if (own) {
        const fs = parseFloat(cs.fontSize) || 0;
        // ── DIST: 보는 거리에서 읽히지 않는 글자
        if (fs && fs < minFontPx && !isDeco) {
          out.push(`${at} DIST 글자가 작다 (${Math.round(fs)}px = ` +
                   `글자높이 ${(fs * 0.7 / ppmm).toFixed(1)}mm · 최소 ${Math.round(minFontPx)}px) :: ${label}`);
        }
        // ── BLEED: 재단 여백 안쪽(안전 영역) 밖에 놓인 글자
        if (!isDeco && (x < safePx || y < safePx || x + w > cw - safePx || y + h > ch - safePx)) {
          out.push(`${at} BLEED 글자가 안전 영역(가장자리 ${Math.round(safePx / ppmm)}mm) 밖 ` +
                   `${w}x${h} :: ${label}`);
        }
      }

      // ── INK: CMYK에서 탁해지는 색. 밝고 채도가 높은 순색이 위험하다.
      //    제대로 하려면 ICC 프로파일이 필요하지만 브라우저에선 현실적이지 않다 —
      //    실제로 문제를 일으키는 색의 성질만 본다.
      if (!isDeco && (w * h) > safePx * safePx * 0.25) {
        for (const c of [cs.backgroundColor, own ? cs.color : null]) {
          const m = c && c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/);
          if (!m) continue;
          if (m[4] !== undefined && parseFloat(m[4]) < 0.5) continue;
          const r = +m[1], g = +m[2], bl = +m[3];
          const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
          const v = mx / 255, sat = mx === 0 ? 0 : (mx - mn) / mx;
          if (v > 0.72 && sat > 0.62) {
            const hue = mx === r ? '빨강·주황' : mx === g ? '초록' : '파랑·사이안';
            out.push(`WARN ${at} INK 밝고 채도 높은 ${hue} (${c}) — CMYK에서 탁해진다 :: ${label}`);
            break;
          }
        }
      }

      if (!own) {
        // ── LINE: 선·획으로 쓰인 가는 도형
        const bg = cs.backgroundColor;
        const painted = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        const thin = (w > 0 && w < minLinePx && h > minLinePx * 3) ||
                     (h > 0 && h < minLinePx && w > minLinePx * 3);
        // 안전 영역 밖에 있는 가는 도형은 재단 표시로 본다 — 원래 가늘게 긋는 것이다
        const isMark = x < safePx || y < safePx || x + w > cw - safePx || y + h > ch - safePx;
        if (painted && thin && !isMark && !isDeco) {
          const t = Math.min(w, h);
          out.push(`WARN ${at} LINE 선이 가늘다 (${t}px = ${(t / ppmm).toFixed(1)}mm · ` +
                   `권장 ${Math.round(minLinePx)}px = ${(minLinePx / ppmm).toFixed(1)}mm)`);
        }
      }
    }
    slide.className = prev;
  });
  return out;
};
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--mm", required=True, metavar="WxH",
                    help="인쇄 크기 (mm). 예: 750x1250")
    ap.add_argument("--size", metavar="WxH",
                    help="캔버스 px. 생략하면 HTML의 <body> 크기를 쓴다")
    ap.add_argument("--dist", type=float, default=1.5, metavar="M",
                    help="본문을 읽는 거리(m). 기본 1.5")
    ap.add_argument("--safe", type=float, default=SAFE_MM, metavar="MM",
                    help=f"글자를 두지 않을 가장자리 폭(mm). 기본 {SAFE_MM}")
    ap.add_argument("--shots", metavar="DIR")
    ap.add_argument("--wait", type=int, default=2500)
    args = ap.parse_args()

    wmm, hmm = (float(v) for v in args.mm.lower().split("x"))

    if args.size:
        cw, ch = (int(v) for v in args.size.lower().split("x"))
    else:
        import re
        src = open(os.path.abspath(args.html), encoding="utf-8").read(8000)
        m = re.search(r"body\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px", src, re.S)
        if not m:
            sys.exit("캔버스 크기를 찾지 못했다 — --size 2250x3750 처럼 직접 줄 것")
        cw, ch = int(m.group(1)), int(m.group(2))

    ppmm = cw / wmm
    ratio_px, ratio_mm = cw / ch, wmm / hmm
    deck = load_deck()

    # 거리에서 역산한 최소 글자 크기: 글자높이 ≥ 거리/250, font = 높이/0.7
    min_glyph_mm = args.dist * 1000 / 250
    min_font_px = min_glyph_mm / GLYPH * ppmm
    safe_px = args.safe * ppmm
    min_line_mm = args.dist * LINE_MM_PER_M
    min_line_px = min_line_mm * ppmm
    bleed_px = BLEED_MM * ppmm

    print(f"인쇄 {wmm:g}×{hmm:g}mm · 캔버스 {cw}×{ch}px · {ppmm:.2f}px/mm")
    for dpi_scale in (1, 2, 3):
        dpi = (cw * dpi_scale) / (wmm / MM_IN)
        mark = "  ← 권장" if 140 <= dpi <= 170 else ""
        print(f"  scale {dpi_scale} 내보내기 → {cw*dpi_scale}×{ch*dpi_scale}px = {dpi:.0f} dpi{mark}")
    print(f"본문 기준 거리 {args.dist:g}m → 최소 글자 {min_font_px:.0f}px "
          f"(글자높이 {min_glyph_mm:.1f}mm) · 최소 선 {min_line_px:.0f}px ({min_line_mm:.1f}mm)")
    print(f"재단 여백 {BLEED_MM}mm = {bleed_px:.0f}px · 안전 영역 {args.safe:g}mm = {safe_px:.0f}px")

    if abs(ratio_px - ratio_mm) > 0.005:
        print(f"\n문제: 캔버스 비율({ratio_px:.4f})이 인쇄 비율({ratio_mm:.4f})과 다르다 — "
              "그대로 내보내면 늘어나거나 잘린다.")

    res = deck.run_checks(args.html, cw, ch, wait=args.wait, shots_dir=args.shots,
                          extra_js=PRINT_JS,
                          extra_args=[cw, ch, ppmm, safe_px, min_line_px, min_font_px, bleed_px])

    layout = [p for p in res["problems"]
              if not any(f" {k} " in f" {p} " for k in SCREEN_ONLY)]
    raw = res.get("extra") or []
    printing = [p for p in raw if not p.startswith("WARN ")]
    warns = [p[5:] for p in raw if p.startswith("WARN ")] + list(res.get("warnings", []))

    src = open(os.path.abspath(args.html), encoding="utf-8").read()
    inert = [a for a in INERT_ATTRS if f'{a}="' in src]
    if "fe-notes" in src:
        inert.append("fe-notes")

    if args.shots:
        print(f"\nPNG {len(res['shots'])}장: {args.shots}")

    if inert:
        print(f"\nINERT — 인쇄물에서 아무 효과 없는 속성 {len(inert)}종:")
        print("  " + ", ".join(inert))
        print("  화면용 스킬(genitor-slides)의 모션·노트 규약이 그대로 따라온 것이다.")
        print("  남겨도 인쇄에는 해가 없지만, 포스터라면 애초에 달 필요가 없다.")

    if warns:
        print(f"\n경고 {len(warns)}건 (의도한 것이면 넘어가도 된다):\n")
        for line in warns:
            print("  " + line)

    bad = layout + printing
    if not bad:
        print("\nOK — 레이아웃·인쇄 규격 문제 없음.")
        return 0
    print(f"\n문제 {len(bad)}건:\n")
    for line in bad:
        print("  " + line)
    print("\n※ BLEED는 재단에서 잘린다 — 글자는 가장자리에서 충분히 떨어뜨릴 것.")
    print("※ DIST는 보는 거리의 문제다 — 글자를 키우거나 그 글을 뺄 것.")
    print("※ LINE·ROT는 경고다 — 의도한 것이면 넘어가도 된다.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
