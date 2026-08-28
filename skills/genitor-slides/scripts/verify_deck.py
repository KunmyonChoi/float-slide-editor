#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genitor 슬라이드 HTML 검증기.

실제 브라우저로 렌더해서 레이아웃이 깨지는 네 가지 패턴을 잡는다.

  FLEX+children  자식 요소를 가진 flex 컨테이너.
                 <strong>/<span>/<br>이 개별 flex item이 되어 가로로 늘어서고
                 <br>은 줄바꿈이 되지 않는다. 여러 줄 카드는 도형 + 절대 위치
                 텍스트 블록으로 분리할 것.
  WRAP           선언한 <br> 수보다 실제 렌더된 줄이 많은 요소(의도치 않은 줄바꿈).
  OVERFLOW       내용 높이가 지정 height를 넘는 요소.
  OUTSIDE        캔버스 밖으로 나간 요소.

사용법:
  python3 verify_deck.py deck.html
  python3 verify_deck.py deck.html --shots out/     # 슬라이드 PNG + 컨택트시트
  python3 verify_deck.py deck.html --size 1280x720  # 캔버스가 1920x1080이 아닐 때

준비(최초 1회):
  pip install playwright --break-system-packages && playwright install chromium
  # 컨택트시트를 원하면: pip install pillow --break-system-packages
"""
import argparse
import os
import sys

CHECK_JS = """
(canvas) => {
  const [CW, CH] = canvas;
  const problems = [];
  const slides = document.querySelectorAll('.slide');
  slides.forEach((slide, si) => {
    const prevDisplay = slide.style.display;
    slide.style.display = 'block';
    for (const el of slide.children) {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const label = text ? text.slice(0, 36) : '(도형)';
      const at = `S${si + 1} @${Math.round(box.left)},${Math.round(box.top)}`;

      if (cs.display.includes('flex') && el.children.length > 0) {
        const kids = [...el.children]
          .map(k => `${k.tagName}(${Math.round(k.getBoundingClientRect().width)}px)`)
          .join(' + ');
        problems.push(`${at} FLEX+children -> ${kids} :: ${label}`);
      }

      if (text) {
        const declared = (el.innerHTML.match(/<br/gi) || []).length + 1;
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const rendered = Math.round(el.scrollHeight / lh);
        if (rendered > declared) {
          problems.push(
            `${at} WRAP ${declared}줄 선언 -> ${rendered}줄 렌더 ` +
            `(width=${Math.round(box.width)}px, font=${cs.fontSize}) :: ${label}`
          );
        }
      }

      if (el.scrollHeight > Math.round(box.height) + 1) {
        problems.push(
          `${at} OVERFLOW height=${Math.round(box.height)} 필요=${el.scrollHeight} :: ${label}`
        );
      }

      if (box.left < -0.5 || box.top < -0.5 ||
          box.right > CW + 0.5 || box.bottom > CH + 0.5) {
        problems.push(
          `${at} OUTSIDE ${Math.round(box.width)}x${Math.round(box.height)} ` +
          `(캔버스 ${CW}x${CH}) :: ${label}`
        );
      }
    }
    slide.style.display = prevDisplay;
  });
  return { problems, slideCount: slides.length };
}
"""


def contact_sheet(paths, out_path, cw, ch, cols=3, scale=0.42):
    try:
        from PIL import Image
    except ImportError:
        print("(pillow 미설치 — 컨택트시트는 건너뜀)")
        return
    tw, th = int(cw * scale), int(ch * scale)
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols + 8 * (cols - 1), th * rows + 8 * (rows - 1)), "white")
    for i, p in enumerate(paths):
        sheet.paste(Image.open(p).resize((tw, th)), ((i % cols) * (tw + 8), (i // cols) * (th + 8)))
    sheet.save(out_path)
    print(f"컨택트시트: {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--shots", metavar="DIR", help="슬라이드별 PNG와 컨택트시트를 저장할 디렉터리")
    ap.add_argument("--size", default="1920x1080", help="캔버스 크기 (기본 1920x1080)")
    ap.add_argument("--wait", type=int, default=2500, help="웹폰트 로딩 대기 ms")
    args = ap.parse_args()

    cw, ch = (int(v) for v in args.size.lower().split("x"))
    path = os.path.abspath(args.html)
    if not os.path.exists(path):
        sys.exit(f"파일 없음: {path}")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("playwright 미설치: pip install playwright --break-system-packages "
                 "&& playwright install chromium")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": cw, "height": ch})
        page.goto("file://" + path)
        page.wait_for_timeout(args.wait)

        result = page.evaluate(CHECK_JS, [cw, ch])
        problems, count = result["problems"], result["slideCount"]

        if args.shots:
            os.makedirs(args.shots, exist_ok=True)
            shots = []
            for i in range(count):
                page.evaluate(
                    "i => document.querySelectorAll('.slide')"
                    ".forEach((s, j) => s.classList.toggle('active', i === j))", i)
                page.wait_for_timeout(200)
                out = os.path.join(args.shots, f"slide{i + 1:02d}.png")
                page.screenshot(path=out)
                shots.append(out)
            print(f"슬라이드 PNG {len(shots)}장: {args.shots}")
            contact_sheet(shots, os.path.join(args.shots, "contact-sheet.png"), cw, ch)

        browser.close()

    print(f"\n슬라이드 {count}장 검사 완료.")
    if not problems:
        print("OK — 레이아웃 문제 없음.")
        return 0
    print(f"문제 {len(problems)}건:\n")
    for line in problems:
        print("  " + line)
    print("\n※ FLEX+children이 보이면 그 카드를 '도형 + 절대 위치 텍스트 블록'으로 분리할 것.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
