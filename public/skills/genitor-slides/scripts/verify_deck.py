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

발표자 노트(.fe-notes)와 모션(data-anim) 규약도 함께 본다. 이쪽은 렌더에 드러나지 않고
Genitor로 가져가야 어긋난 게 보이므로 특히 중요하다.

  ANIM           알 수 없는 효과/트리거/방향, 중복된 data-anim-name.
  ANIM-REF       with/after가 가리킬 이름이 없거나 같은 슬라이드에 그 이름이 없음.
  NOTES          .fe-notes에 type="text/plain"이 없거나, 한 슬라이드에 둘 이상.
  (경고)         노트 없는 슬라이드, click 단계 과다, 중첩된 data-anim 등.

슬라이드별 "노트 문단 수 / click 단계 수"도 요약해 준다 — 둘이 맞물리는지 눈으로 확인할 것.

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
  const EFFECTS = ['fadeIn', 'slideIn', 'scaleIn', 'pop', 'fadeOut', 'slideOut', 'scaleOut'];
  const DIRS = ['left', 'right', 'up', 'down'];
  const TRIGGERS = ['click', 'auto', 'with', 'after'];
  const TRANSITIONS = ['fade', 'slide', 'zoom'];
  const problems = [];
  const warnings = [];
  const summary = [];
  const slides = document.querySelectorAll('.slide');
  slides.forEach((slide, si) => {
    const prevDisplay = slide.style.display;
    slide.style.display = 'block';
    const S = `S${si + 1}`;

    // ── 레이아웃 ──
    for (const el of slide.children) {
      if (el.tagName === 'SCRIPT' || el.classList.contains('fe-notes')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const box = el.getBoundingClientRect();
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const label = text ? text.slice(0, 36) : '(도형)';
      const at = `${S} @${Math.round(box.left)},${Math.round(box.top)}`;

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

    // ── 발표자 노트 ──
    const noteEls = slide.querySelectorAll('.fe-notes');
    let paragraphs = 0;
    if (noteEls.length === 0) {
      warnings.push(`${S} NOTES 없음 — 이 장에서 발표자가 할 말이 비어 있다`);
    } else {
      if (noteEls.length > 1) {
        problems.push(`${S} NOTES ${noteEls.length}개 — 첫 번째만 읽힌다. 하나로 합칠 것`);
      }
      const n = noteEls[0];
      if (n.tagName === 'SCRIPT' && !/^\\s*text\\/plain\\s*$/i.test(n.getAttribute('type') || '')) {
        problems.push(`${S} NOTES type="text/plain" 누락 — 브라우저가 원고를 JS로 실행하려 한다`);
      }
      const body = (n.textContent || '').trim();
      if (!body) {
        warnings.push(`${S} NOTES 비어 있음`);
      }
      paragraphs = body ? body.split(/\\n\\s*\\n/).filter(t => t.trim()).length : 0;
    }

    // ── 모션 ──
    const hosts = [...slide.querySelectorAll('[data-anim]')];
    const names = new Map();
    for (const h of hosts) {
      const nm = (h.getAttribute('data-anim-name') || '').trim();
      if (!nm) continue;
      if (names.has(nm)) problems.push(`${S} ANIM data-anim-name="${nm}" 중복 — 첫 번째만 참조된다`);
      else names.set(nm, h);
    }
    let clicks = 0, autos = 0;
    for (const h of hosts) {
      const desc = (h.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24) || '(도형)';
      const at = `${S} :: ${desc}`;
      const eff = (h.getAttribute('data-anim') || '').trim();
      if (!EFFECTS.includes(eff)) {
        problems.push(`${at} ANIM 알 수 없는 효과 "${eff}" — 무시되어 모션이 사라진다`);
        continue;
      }
      const trig = (h.getAttribute('data-anim-trigger') || 'click').trim();
      if (!TRIGGERS.includes(trig)) {
        problems.push(`${at} ANIM 알 수 없는 트리거 "${trig}" (click로 폴백)`);
      }
      const dir = (h.getAttribute('data-anim-dir') || '').trim();
      if (dir && !DIRS.includes(dir)) {
        problems.push(`${at} ANIM 알 수 없는 방향 "${dir}"`);
      } else if (dir && !['slideIn', 'slideOut'].includes(eff)) {
        warnings.push(`${at} ANIM data-anim-dir는 slideIn/slideOut에만 쓰인다 (무시됨)`);
      }
      if (trig === 'with' || trig === 'after') {
        const ref = (h.getAttribute('data-anim-ref') || '').trim();
        if (!ref) {
          problems.push(`${at} ANIM-REF "${trig}"인데 data-anim-ref가 없다 — 별도 클릭 단계로 떨어진다`);
        } else if (!names.has(ref)) {
          problems.push(`${at} ANIM-REF "${ref}" 이름을 이 슬라이드에서 못 찾음 — 별도 클릭 단계로 떨어진다`);
        } else if (names.get(ref) === h) {
          problems.push(`${at} ANIM-REF 자기 자신을 참조한다`);
        }
      }
      if (h.parentElement && h.parentElement.closest('[data-anim]')) {
        warnings.push(`${at} ANIM 중첩 선언 — 안쪽 선언이 이긴다(바깥은 요소로 잡히지 않을 수 있음)`);
      }
      if (h.parentElement !== slide) {
        warnings.push(`${at} ANIM .slide 직계 자식이 아님 — 한 덩어리로 묶여 움직인다`);
      }
      if (trig === 'auto') autos++;
      else if (trig === 'click' || !TRIGGERS.includes(trig)) clicks++;
    }
    if (clicks > 4) {
      warnings.push(`${S} click 단계 ${clicks}개 — 한 장에 1~4개가 적당하다. 슬라이드를 쪼갤 것`);
    }

    const tr = (slide.getAttribute('data-transition') || '').trim();
    if (tr && !TRANSITIONS.includes(tr)) {
      problems.push(`${S} ANIM 알 수 없는 전환 "${tr}" — 무시된다`);
    }

    summary.push({ slide: si + 1, paragraphs, clicks, autos, notes: noteEls.length > 0 });
    slide.style.display = prevDisplay;
  });
  return { problems, warnings, summary, slideCount: slides.length };
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
        warnings, summary = result.get("warnings", []), result.get("summary", [])

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

    if summary:
        print("\n슬라이드별 노트/단계 (노트 문단 수 ↔ click 단계 수가 맞물려야 한다):")
        for row in summary:
            notes = "{}문단".format(row["paragraphs"]) if row["notes"] else "노트 없음"
            auto = " (auto {}개)".format(row["autos"]) if row["autos"] else ""
            print("  S{}: {} / click {}단계{}".format(row["slide"], notes, row["clicks"], auto))

    if warnings:
        print(f"\n경고 {len(warnings)}건 (의도한 것이면 넘어가도 된다):\n")
        for line in warnings:
            print("  " + line)

    if not problems:
        print("\nOK — 레이아웃·노트·모션 문제 없음.")
        return 0
    print(f"\n문제 {len(problems)}건:\n")
    for line in problems:
        print("  " + line)
    print("\n※ FLEX+children이 보이면 그 카드를 '도형 + 절대 위치 텍스트 블록'으로 분리할 것.")
    print("※ ANIM-REF는 조용히 어긋난다 — data-anim-name과 data-anim-ref 철자를 맞출 것.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
