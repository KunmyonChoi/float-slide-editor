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
  PAD            상자(배경·테두리) 위에 얹힌 글자가 상자를 넘거나 여백이 좁은 것.
                 카드와 글자는 절대 위치 형제라 서로를 모른다 — 위 검사들은 전부 통과하면서
                 글자가 상자를 뚫고 나갈 수 있다(선언 산수가 어긋난 채 나온 실제 사례).

발표자 노트(.fe-notes)와 모션(data-anim) 규약도 함께 본다. 이쪽은 렌더에 드러나지 않고
Genitor로 가져가야 어긋난 게 보이므로 특히 중요하다.

  ANIM           알 수 없는 효과/트리거/방향, 중복된 data-anim-name, 한 순간에 몰린 등장,
                 너무 길게 끄는 단계, 재생시간을 한 번도 안 준 덱.
  ANIM-REF       with/after가 가리킬 이름이 없거나 같은 슬라이드에 그 이름이 없음,
                 뒤에 선언된 앵커를 가리키는 참조.
  NOTES          .fe-notes에 type="text/plain"이 없거나, 한 슬라이드에 둘 이상.
  (경고)         노트 없는 슬라이드, click 단계 과다, 중첩된 data-anim 등.

슬라이드별 "노트 문단 수 / click 단계 수"도 요약해 준다 — 둘이 맞물리는지 눈으로 확인할 것.
click 단계는 속성을 세지 않고 Genitor의 계산(computeSteps)을 그대로 따라 한다. 참조가 어긋나면
with/after도 각자 클릭 단계가 되므로, 속성만 세면 "4단계"인 장이 실제로는 44단계가 될 수 있다.

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
  const BURST_LIMIT = 12;    // 한 순간에 같이 뜨는 요소 수 상한
  const SPAN_LIMIT = 4000;   // 한 클릭 단계가 끌어도 되는 시간(ms)
  const problems = [];
  let deckUsesDuration = false;
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

    // ── 상자 안 텍스트의 여백 (PAD) ──
    // 이 배치 모델에서 카드와 그 위의 글자는 부모-자식이 아니라 절대 위치 형제다. 서로를 모르므로
    // 위의 네 검사(FLEX/WRAP/OVERFLOW/OUTSIDE)는 전부 통과하면서 글자가 상자를 뚫고 나갈 수 있다.
    // 실제 덱에서 카드 본문이 선언 산수만으로 상자 바닥을 4~14px 넘긴 채 나왔다.
    {
      const kids = [...slide.children].filter(el => el.tagName !== 'SCRIPT' && !el.classList.contains('fe-notes'));
      const boxed = [];
      for (const el of kids) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const bg = cs.backgroundColor;
        const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        const hasBorder = cs.borderWidth && !cs.borderWidth.split(' ').every(v => v === '0px');
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        // 배경/테두리가 있고 자기 글자는 없는 것 = 담는 상자. 전면 배경은 제외(모든 글자의 부모가 된다).
        const isBox = (hasBg || hasBorder) && !text && !(r.width >= CW * 0.9 && r.height >= CH * 0.9);
        boxed.push({ el, r, isBox, text });
      }
      const boxes = boxed.filter(b => b.isBox);
      for (const t of boxed) {
        if (t.isBox || !t.text) continue;
        // 가장 작은(가장 가까운) 상자 하나에만 책임을 묻는다 — 겹친 상자마다 중복 보고하지 않도록.
        const holder = boxes
          .filter(b => t.r.left >= b.r.left - 2 && t.r.right <= b.r.right + 2
            && t.r.bottom > b.r.top && t.r.top < b.r.bottom)
          .sort((p, q) => p.r.width * p.r.height - q.r.width * q.r.height)[0];
        if (!holder) continue;
        const gap = {
          위: Math.round(t.r.top - holder.r.top), 아래: Math.round(holder.r.bottom - t.r.bottom),
          왼: Math.round(t.r.left - holder.r.left), 오른: Math.round(holder.r.right - t.r.right),
        };
        const worst = Math.min(...Object.values(gap));
        // 여백 기준은 상자 높이에 비례 — 56px짜리 행과 160px 카드를 같은 잣대로 잴 수 없다.
        const need = Math.max(10, Math.min(20, Math.round(holder.r.height * 0.10)));
        if (worst >= need) continue;
        const where = `${S} @${Math.round(t.r.left)},${Math.round(t.r.top)}`;
        const desc = t.text.slice(0, 26);
        const sides = Object.entries(gap).filter(([, v]) => v < need).map(([k, v]) => `${k} ${v}px`).join(' · ');
        if (worst < 0) {
          problems.push(`${where} PAD 글자가 상자를 넘어간다 (${sides}) :: ${desc}`);
        } else {
          warnings.push(`${where} PAD 상자 안쪽 여백이 좁다 (${sides} · ${need}px 이상 권장) :: ${desc}`);
        }
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
    // 속성 파싱 — 여기서는 검사만 하고, 단계 계산은 아래에서 Genitor와 같은 방식으로 한다.
    const specs = [];
    for (const h of hosts) {
      const desc = (h.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24) || '(도형)';
      const at = `${S} :: ${desc}`;
      const eff = (h.getAttribute('data-anim') || '').trim();
      if (!EFFECTS.includes(eff)) {
        problems.push(`${at} ANIM 알 수 없는 효과 "${eff}" — 무시되어 모션이 사라진다`);
        continue;
      }
      let trig = (h.getAttribute('data-anim-trigger') || 'click').trim();
      if (!TRIGGERS.includes(trig)) {
        problems.push(`${at} ANIM 알 수 없는 트리거 "${trig}" (click로 폴백)`);
        trig = 'click';
      }
      const dir = (h.getAttribute('data-anim-dir') || '').trim();
      if (dir && !DIRS.includes(dir)) {
        problems.push(`${at} ANIM 알 수 없는 방향 "${dir}"`);
      } else if (dir && !['slideIn', 'slideOut'].includes(eff)) {
        warnings.push(`${at} ANIM data-anim-dir는 slideIn/slideOut에만 쓰인다 (무시됨)`);
      }
      let ref = null;
      if (trig === 'with' || trig === 'after') {
        ref = (h.getAttribute('data-anim-ref') || '').trim();
        if (!ref) {
          problems.push(`${at} ANIM-REF "${trig}"인데 data-anim-ref가 없다 — 별도 클릭 단계로 떨어진다`);
          ref = null;
        } else if (!names.has(ref)) {
          problems.push(`${at} ANIM-REF "${ref}" 이름을 이 슬라이드에서 못 찾음 — 별도 클릭 단계로 떨어진다`);
          ref = null;
        } else if (names.get(ref) === h) {
          problems.push(`${at} ANIM-REF 자기 자신을 참조한다`);
          ref = null;
        }
      }
      if (h.parentElement && h.parentElement.closest('[data-anim]')) {
        warnings.push(`${at} ANIM 중첩 선언 — 안쪽 선언이 이긴다(바깥은 요소로 잡히지 않을 수 있음)`);
      }
      if (h.parentElement !== slide) {
        warnings.push(`${at} ANIM .slide 직계 자식이 아님 — 한 덩어리로 묶여 움직인다`);
      }
      const dur = Number(h.getAttribute('data-anim-duration')) || 500;
      const delay = Number(h.getAttribute('data-anim-delay')) || 0;
      if (dur < 50 || dur > 10000) {
        warnings.push(`${at} ANIM 재생시간 ${dur}ms — 50~10000 범위를 벗어나면 잘린다`);
      }
      specs.push({ h, at, eff, trig, ref, dur, delay, node: h, desc });
      if (h.getAttribute('data-anim-duration')) deckUsesDuration = true;
    }

    // ── 단계 계산 (Genitor의 computeSteps와 같은 규칙) ──
    // 속성에 적힌 click 개수를 세면 안 된다 — 참조가 어긋나면 with/after도 각자 클릭 단계가 되고,
    // auto에 매달린 체인은 반대로 클릭을 아예 요구하지 않는다. 실제로 재생될 모양으로 센다.
    const idxOfName = new Map();
    specs.forEach((sp, i) => { const nm = (sp.h.getAttribute('data-anim-name') || '').trim(); if (nm && !idxOfName.has(nm)) idxOfName.set(nm, i); });
    const refIdx = specs.map(sp => (sp.ref != null && idxOfName.has(sp.ref) ? idxOfName.get(sp.ref) : -1));
    const rootOf = new Array(specs.length).fill(-1);
    const findRoot = (i, seen) => {
      if (rootOf[i] >= 0) return rootOf[i];
      const chained = specs[i].trig === 'with' || specs[i].trig === 'after';
      const r = chained ? refIdx[i] : -1;
      if (r < 0 || r === i || seen.has(r)) return (rootOf[i] = i);
      seen.add(i);
      return (rootOf[i] = findRoot(r, seen));
    };
    specs.forEach((_, i) => findRoot(i, new Set([i])));

    const start = new Array(specs.length).fill(null);
    const stepIdx = new Array(specs.length).fill(null);
    let clicks = 0, autos = 0;
    specs.forEach((sp, i) => {
      if (rootOf[i] !== i) return;
      start[i] = sp.delay;
      if (sp.trig === 'auto') { autos++; stepIdx[i] = 'auto'; }
      else stepIdx[i] = clicks++;
    });
    const startOf = (i) => {
      if (start[i] != null) return start[i];
      const r = refIdx[i];
      const base = startOf(r);
      start[i] = specs[i].trig === 'after' ? base + specs[r].dur + specs[i].delay : base + specs[i].delay;
      stepIdx[i] = stepIdx[r];
      return start[i];
    };
    specs.forEach((_, i) => startOf(i));

    // 전방 참조 — Genitor는 이제 순서와 무관하게 해소하지만, 앵커가 뒤에 있으면 읽는 사람이 흐름을
    // 거꾸로 따라가야 한다. 옛 버전에서는 이 모양이 통째로 클릭 단계로 흩어졌다.
    let forward = 0;
    specs.forEach((sp, i) => { if (refIdx[i] > i) forward++; });
    if (forward) {
      warnings.push(`${S} ANIM-REF 뒤에 선언된 앵커를 가리키는 참조 ${forward}개 — 앵커를 먼저 선언할 것`);
    }

    // 한 단계에 몇 개가 '같은 순간'에 뜨는지 / 그 단계가 얼마나 오래 끄는지
    const groups = new Map();
    specs.forEach((sp, i) => {
      const k = String(stepIdx[i]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    let maxBurst = 0, maxSpan = 0;
    for (const [k, list] of groups) {
      const byStart = new Map();
      let span = 0;
      for (const i of list) {
        byStart.set(start[i], (byStart.get(start[i]) || 0) + 1);
        span = Math.max(span, start[i] + specs[i].dur);
      }
      const burst = Math.max(...byStart.values());
      maxBurst = Math.max(maxBurst, burst);
      maxSpan = Math.max(maxSpan, span);
      if (burst > BURST_LIMIT) {
        warnings.push(`${S} ANIM 한 순간에 ${burst}개가 동시에 등장(단계 ${k}) — ${BURST_LIMIT}개를 넘으면 화면이 번쩍인다. `
          + `행/열 단위로 묶고 data-anim-delay로 60~120ms씩 어긋내거나 재생시간을 줄일 것`);
      }
      if (span > SPAN_LIMIT) {
        warnings.push(`${S} ANIM 단계 ${k}이 ${Math.round(span)}ms 동안 이어진다 — after 체인이 길면 발표자가 기다린다. `
          + `재생시간을 줄이거나 with+delay로 겹칠 것`);
      }
    }
    if (clicks > 4) {
      warnings.push(`${S} click 단계 ${clicks}개 — 한 장에 1~4개가 적당하다. 슬라이드를 쪼갤 것`);
    }

    const tr = (slide.getAttribute('data-transition') || '').trim();
    if (tr && !TRANSITIONS.includes(tr)) {
      problems.push(`${S} ANIM 알 수 없는 전환 "${tr}" — 무시된다`);
    }

    summary.push({ slide: si + 1, paragraphs, clicks, autos, notes: noteEls.length > 0,
                   anims: specs.length, burst: maxBurst, span: Math.round(maxSpan) });
    slide.style.display = prevDisplay;
  });
  if (!deckUsesDuration && summary.some(r => r.anims > 0)) {
    warnings.push('ANIM 덱 전체가 재생시간 기본값(500ms)만 쓴다 — 제목 500~600 / 카드 350~450 / '
      + '반복 행 120~180처럼 역할에 따라 달리 주면 리듬이 생긴다');
  }
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
        print("  ※ click 단계는 속성 개수가 아니라 Genitor가 실제로 만드는 단계 수다.")
        for row in summary:
            notes = "{}문단".format(row["paragraphs"]) if row["notes"] else "노트 없음"
            auto = " auto {}".format(row["autos"]) if row["autos"] else ""
            motion = ""
            if row.get("anims"):
                motion = "  [요소 {} · 최대 동시 {} · 최장 단계 {}ms]".format(
                    row["anims"], row["burst"], row["span"])
            print("  S{}: {} / click {}단계{}{}".format(
                row["slide"], notes, row["clicks"], auto, motion))

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
    print("※ PAD는 좌표 산수 문제다 — 글자 블록의 top+height가 상자 바닥에서 여백만큼 남는지 확인할 것.")
    print("※ ANIM-REF는 조용히 어긋난다 — data-anim-name과 data-anim-ref 철자를 맞출 것.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
