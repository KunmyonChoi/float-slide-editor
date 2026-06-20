/**
 * ElementRegistry
 * 전체 HTML 문서를 파싱하고 편집 가능한 요소에 data-editor-id를 부여한다.
 * iframe srcdoc에 주입할 에디터 에이전트 스크립트도 함께 삽입한다.
 */

export const EDITABLE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'li', 'td', 'th', 'a', 'strong', 'em', 'label', 'figcaption', 'pre', 'code', 'blockquote', 'dt', 'dd'])
export const IMAGE_TAGS = new Set(['img'])
export const VIDEO_TAGS = new Set(['video'])
export const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'details', 'summary',
  // deck-stage 커스텀 슬롯(이미지 플레이스홀더). 미인식 시 통째로 누락되므로 컨테이너로 취급
  // → 비어 있으면 테두리/배경 도형으로, 배경이미지가 있으면 그대로 추출.
  'image-slot'])

export function classifyTag(tag) {
  if (IMAGE_TAGS.has(tag)) return 'image'
  if (VIDEO_TAGS.has(tag)) return 'video'
  if (EDITABLE_TAGS.has(tag)) return 'text'
  if (CONTAINER_TAGS.has(tag)) return 'container'
  return null
}

let _counter = 0
export const nextId = () => `fe-${++_counter}`
export function resetCounter() { _counter = 0 }

/**
 * History API 패치 — <head>에 주입되어 reveal.js 등의 initialize()보다 먼저 실행.
 * iframe srcdoc에서 history.replaceState/pushState SecurityError를 방지한다.
 */
const HISTORY_PATCH = `
(function () {
  if (window.__feHistoryPatched) return;
  window.__feHistoryPatched = true;
  try {
    var origReplace = history.replaceState.bind(history);
    history.replaceState = function () {
      try { return origReplace.apply(history, arguments); } catch (e) {}
    };
    var origPush = history.pushState.bind(history);
    history.pushState = function () {
      try { return origPush.apply(history, arguments); } catch (e) {}
    };
  } catch (e) {}
})();
`

/**
 * 에디터 에이전트 — iframe 내부에서 실행되는 스크립트.
 *
 * 모드 구분:
 *   'edit'    — [data-editor-id] 클릭 시 stopPropagation + fe:select (슬라이드 네비게이션 차단)
 *               빈 영역 클릭 시 fe:deselect만 알리고 슬라이드 핸들러는 그대로 진행
 *   'present' — 클릭 이벤트 일체 개입 없음. 슬라이드의 키보드/클릭/스와이프/postMessage 네비게이션 원본 동작
 */
const EDITOR_AGENT = `
(function () {
  if (window.__floatEditorAgentLoaded) return;
  window.__floatEditorAgentLoaded = true;

  var __feMode = 'edit';

  /* ── 하이라이트 스타일 ── */
  var s = document.createElement('style');
  s.id = '__fe-style';
  s.textContent = [
    '[data-editor-id]{cursor:pointer !important;}',
    '[data-editor-id]:hover{outline:2px solid rgba(99,102,241,0.5) !important;outline-offset:2px;}',
    '[data-editor-selected="true"]{outline:2px solid #6366f1 !important;outline-offset:3px;}'
  ].join('');
  document.head.appendChild(s);

  /**
   * 해당 요소가 슬라이드 자체 인터랙션(네비게이션 버튼 등)을 위한 요소인지 판단.
   * - <button>
   * - onclick 속성을 가진 요소
   * - href 가 있는 <a>  (슬라이드 내부 앵커 링크 포함)
   * - <input type="button|submit|reset">
   * 위 중 하나이면 편집 선택을 양보하고 슬라이드 핸들러에 위임한다.
   */
  function isSlideInteractive(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'button') return true;
    if (tag === 'input') {
      var t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') return true;
    }
    if (tag === 'a' && el.getAttribute('href')) return true;
    if (el.getAttribute('onclick')) return true;
    return false;
  }

  /* ── 클릭 인터셉터 (capture phase) ── */
  document.addEventListener('click', function (e) {
    /* 발표 모드: 개입 없이 슬라이드 핸들러에 위임 */
    if (__feMode !== 'edit') return;

    /* 리사이즈 핸들 클릭은 무시 (핸들 자체 mousedown이 처리) */
    if (e.target.closest('.__fe-resize-handle')) return;

    /* 삽입 플레이스홀더 클릭 처리 */
    var phEl = e.target.closest('.__fe-insert-ph');
    if (phEl) {
      e.stopPropagation();
      e.preventDefault();
      var rect = phEl.getBoundingClientRect();
      window.parent.postMessage({
        type: 'fe:insertAt',
        parentId: phEl.getAttribute('data-insert-parent') || null,
        index: parseInt(phEl.getAttribute('data-insert-index'), 10),
        axis: phEl.getAttribute('data-insert-axis') || 'flow',
        wrapTarget: phEl.getAttribute('data-wrap-target') || null,
        wrapSide: phEl.getAttribute('data-wrap-side') || null,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }, '*');
      return;
    }

    var el = e.target;
    while (el && el !== document.documentElement) {
      /*
       * 인터랙티브 요소(버튼, onclick 등)를 data-editor-id 보다 먼저 만나면
       * → 슬라이드 네비게이션 동작을 허용하고 선택만 해제
       */
      if (isSlideInteractive(el)) {
        window.parent.postMessage({ type: 'fe:deselect' }, '*');
        return; /* stopPropagation 없이 return → 슬라이드 핸들러 정상 동작 */
      }

      if (el.dataset && el.dataset.editorId) {
        /* 편집 가능 요소 클릭 → 슬라이드 네비게이션 차단 후 선택 알림 */
        e.stopPropagation();
        window.parent.postMessage({
          type: 'fe:select',
          id: el.dataset.editorId,
          tag: el.tagName.toLowerCase(),
          elemType: el.dataset.editorType || 'unknown',
        }, '*');
        return;
      }
      el = el.parentElement;
    }
    /* 빈 영역 클릭 → 선택 해제 알림 + 슬라이드 네비게이션 진행 */
    window.parent.postMessage({ type: 'fe:deselect' }, '*');
  }, true);

  /* ── Ctrl+V 이미지 붙여넣기 → 부모로 전달 ── */
  document.addEventListener('paste', function (e) {
    if (__feMode !== 'edit') return;
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') !== 0) continue;
      e.preventDefault();
      var file = items[i].getAsFile();
      if (!file) continue;
      var reader = new FileReader();
      reader.onload = function (ev) {
        window.parent.postMessage({
          type: 'fe:pasteImage',
          dataUrl: ev.target.result,
          fileName: file.name || 'pasted-image',
        }, '*');
      };
      reader.readAsDataURL(file);
      break;
    }
  });

  /* 슬라이드를 보이게 하되 display 타입을 강제하지 않는다.
     인라인 display를 제거해 덱 CSS(.slide.active 등)의 자연 display를 복원하고,
     그래도 none이면(JS로만 보이던 덱) block으로 폴백한다.
     (과거엔 display:flex를 강제해 block 레이아웃 슬라이드의 자식이 가로로
      찌부러지는 문제가 있었다 — 컬럼이 좁아져 텍스트가 비정상 줄바꿈됨) */
  function __feShowSlide(el) {
    el.style.display = '';
    try {
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    } catch (e) { el.style.display = 'block'; }
  }

  /* ── 페이지 변경 감시 ── */
  var __feIsReveal = false;

  /* 커스텀 덱 컴포넌트(deck-stage 등): goTo/next/prev + index/length API 노출.
     자체 내비게이션을 갖고 있으므로 DOM 조작 없이 그 API를 호출한다. */
  function __feDeckEl() {
    var d = document.querySelector('deck-stage');
    if (d && typeof d.goTo === 'function' && typeof d.length === 'number') return d;
    return null;
  }

  /* 폴백: reveal/.slide/deck-API가 모두 없을 때 최상위 반복 <section>을 슬라이드로 취급.
     (단일 컨테이너의 직속 section 우선, 없으면 body 직속) */
  function __feSectionSlides() {
    var host = document.querySelector('deck-stage');
    if (host) {
      var hs = host.querySelectorAll(':scope > section');
      if (hs.length >= 2) return hs;
    }
    var bs = document.body ? document.body.querySelectorAll(':scope > section') : [];
    return bs.length >= 2 ? bs : null;
  }

  /* 섹션 폴백 네비게이션: 한 번에 한 섹션만 표시 (덱 CSS의 자연 display 복원) */
  var __feSectionIdx = 0;
  function __feShowSection(secs, idx) {
    for (var i = 0; i < secs.length; i++) {
      if (i === idx) __feShowSlide(secs[i]);
      else secs[i].style.display = 'none';
    }
    __feSectionIdx = idx;
  }

  function __feDetectPage() {
    if (__feIsReveal) {
      var R = window.Reveal;
      var hSections = document.querySelectorAll('.reveal .slides > section');
      var totalH = hSections.length;
      var indices = R.getIndices();
      /* 현재 수평 섹션 내 수직 슬라이드 수 */
      var currentSection = hSections[indices.h];
      var vSlides = currentSection ? currentSection.querySelectorAll(':scope > section') : [];
      var totalV = vSlides.length; /* 0이면 수직 슬라이드 없음 */
      /* 수평 슬라이드별 수직 개수(전체) — 자식 section이 있으면 그 수, 없으면 1 */
      var vCounts = [];
      for (var __h = 0; __h < totalH; __h++) {
        var __kids = hSections[__h].querySelectorAll(':scope > section');
        vCounts.push(__kids.length > 0 ? __kids.length : 1);
      }
      /* 전체 방향별 이동 가능 여부 */
      window.parent.postMessage({
        type: 'fe:pageChange',
        page: indices.h || 0,
        total: totalH,
        /* reveal.js 확장 정보 */
        reveal: true,
        h: indices.h || 0,
        v: indices.v || 0,
        totalH: totalH,
        totalV: totalV,
        vCounts: vCounts,
        canLeft: indices.h > 0,
        canRight: indices.h < totalH - 1,
        canUp: (indices.v || 0) > 0,
        canDown: totalV > 0 && (indices.v || 0) < totalV - 1,
      }, '*');
      return;
    }
    /* 커스텀 덱 API(deck-stage 등) */
    var deck = __feDeckEl();
    if (deck) {
      window.parent.postMessage({
        type: 'fe:pageChange',
        page: deck.index || 0,
        total: deck.length || 1,
      }, '*');
      return;
    }
    /* 기본 .slide.active 패턴 */
    var slides = document.querySelectorAll('.slide');
    if (slides.length > 0) {
      var total = slides.length;
      var current = 0;
      for (var i = 0; i < slides.length; i++) {
        if (slides[i].classList.contains('active')) { current = i; break; }
      }
      window.parent.postMessage({ type: 'fe:pageChange', page: current, total: total }, '*');
      return;
    }
    /* 최상위 <section> 폴백 */
    var secs = __feSectionSlides();
    if (secs) {
      var cur = Math.min(__feSectionIdx, secs.length - 1);
      window.parent.postMessage({ type: 'fe:pageChange', page: cur < 0 ? 0 : cur, total: secs.length }, '*');
    }
  }

  /* reveal.js 바인딩 */
  function __feBindReveal() {
    __feIsReveal = true;
    window.Reveal.configure({ hash: false, history: false, transition: 'none', transitionSpeed: 'fast' });
    window.Reveal.on('slidechanged', function () { __feDetectPage(); });
    __feDetectPage();
  }

  /* 클래스 변경 감시 (기본 패턴용) */
  var __feMo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].attributeName === 'class') { __feDetectPage(); return; }
    }
  });

  /* reveal.js 감지 — 비동기 초기화 대응을 위한 폴링 */
  function __feInitPageDetection() {
    var hasRevealEl = document.querySelector('.reveal');
    if (hasRevealEl) {
      var poll = setInterval(function () {
        var hasObj = (typeof window.Reveal === 'object' || typeof window.Reveal === 'function') && !!window.Reveal;
        var hasIsReady = hasObj && typeof window.Reveal.isReady === 'function';
        var ready = hasIsReady && window.Reveal.isReady();
        if (ready) {
          clearInterval(poll);
          __feBindReveal();
        }
      }, 200);
      setTimeout(function () { clearInterval(poll); }, 30000);
      return;
    }
    /* deck-stage(커스텀 요소 업그레이드)·.slide·최상위 section — 비동기 로드 대응 폴링.
       deck-stage 태그가 있으면 그 API 업그레이드를 기다린다(아직 미업그레이드 상태에서
       그 자식 section을 폴백으로 오인해 display를 건드리지 않도록 우선 처리). */
    var tries = 0;
    var poll2 = setInterval(function () {
      tries++;
      var deckTag = document.querySelector('deck-stage');
      if (deckTag) {
        if (typeof deckTag.goTo === 'function' && (deckTag.length | 0) >= 1) {
          clearInterval(poll2);
          __feDetectPage();
        } else if (tries > 50) {
          clearInterval(poll2);
          __feDetectPage();
        }
        return;
      }
      var dotSlides = document.querySelectorAll('.slide');
      if (dotSlides.length > 0) {
        clearInterval(poll2);
        dotSlides.forEach(function (sl) {
          __feMo.observe(sl, { attributes: true, attributeFilter: ['class'] });
        });
        __feDetectPage();
        return;
      }
      var secs = __feSectionSlides();
      if (secs) {
        clearInterval(poll2);
        __feShowSection(secs, 0); /* 한 번에 한 섹션만 표시 */
        __feDetectPage();
        return;
      }
      if (tries > 50) { clearInterval(poll2); __feDetectPage(); } /* ~10s 후 포기 */
    }, 200);
  }
  __feInitPageDetection();

  /* deck-stage가 자체 네비게이션(키보드/클릭/goTo)으로 슬라이드를 바꾸면
     window로 {slideIndexChanged,deckTotal}을 브로드캐스트한다 → 부모에 페이지 변경 전달. */
  window.addEventListener('message', function (e) {
    if (e.data && typeof e.data.slideIndexChanged === 'number') {
      window.parent.postMessage({
        type: 'fe:pageChange',
        page: e.data.slideIndexChanged,
        total: e.data.deckTotal || 1,
      }, '*');
    }
  });

  /* ── 부모로부터 명령 수신 ── */
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (!e.data.type.startsWith('fe:')) return;

    /* 페이지 이동 명령 */
    if (e.data.type === 'fe:navigate') {
      if (__feIsReveal) {
        /* 방향 지정 네비게이션 (4방향) */
        if (e.data.direction) {
          if (e.data.direction === 'left') window.Reveal.left();
          else if (e.data.direction === 'right') window.Reveal.right();
          else if (e.data.direction === 'up') window.Reveal.up();
          else if (e.data.direction === 'down') window.Reveal.down();
        } else {
          var delta = e.data.delta;
          if (delta > 0) window.Reveal.next();
          else if (delta < 0) window.Reveal.prev();
          else if (e.data.page != null) window.Reveal.slide(e.data.page, e.data.v || 0);
        }
      } else if (__feDeckEl()) {
        /* 커스텀 덱 API(deck-stage 등): 자체 네비게이션 호출 (페이지 보고는 브로드캐스트가 처리) */
        var deck = __feDeckEl();
        if (e.data.direction === 'right') deck.next();
        else if (e.data.direction === 'left') deck.prev();
        else if (e.data.direction) { /* up/down 무시 (선형 덱) */ }
        else if (e.data.page != null) deck.goTo(e.data.page);
        else if ((e.data.delta || 0) > 0) deck.next();
        else if ((e.data.delta || 0) < 0) deck.prev();
      } else if (__feSectionSlides()) {
        /* 최상위 <section> 폴백: 한 번에 한 섹션 표시 */
        var secs = __feSectionSlides();
        var curS = Math.min(Math.max(__feSectionIdx, 0), secs.length - 1);
        var targetS;
        if (e.data.page != null) targetS = e.data.page;
        else if (e.data.direction === 'right') targetS = curS + 1;
        else if (e.data.direction === 'left') targetS = curS - 1;
        else if (e.data.direction) targetS = curS; /* up/down 무시 */
        else targetS = curS + (e.data.delta || 0);
        if (targetS < 0 || targetS >= secs.length || targetS === curS) return;
        __feShowSection(secs, targetS);
        __feDetectPage();
      } else {
        /* 기본 .slide 패턴: 직접 DOM 조작 */
        var slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;
        var curIdx = 0;
        for (var si = 0; si < slides.length; si++) {
          if (slides[si].classList.contains('active')) { curIdx = si; break; }
        }
        var targetIdx;
        if (e.data.page != null) {
          targetIdx = e.data.page;
        } else {
          targetIdx = curIdx + (e.data.delta || 0);
        }
        if (targetIdx < 0 || targetIdx >= slides.length || targetIdx === curIdx) return;
        slides[curIdx].classList.remove('active');
        slides[curIdx].style.display = 'none';
        slides[targetIdx].classList.add('active');
        __feShowSlide(slides[targetIdx]);
        __feDetectPage();
      }
      return;
    }

    /* 외부 goto 명령 (QualityDashboard 등) */
    if (e.data.type === 'goto') {
      var idx = e.data.index != null ? e.data.index : 0;
      if (__feIsReveal) {
        window.Reveal.slide(idx, 0);
      } else if (__feDeckEl()) {
        __feDeckEl().goTo(idx);
      } else if (__feSectionSlides()) {
        var gsecs = __feSectionSlides();
        if (idx >= 0 && idx < gsecs.length) { __feShowSection(gsecs, idx); __feDetectPage(); }
      } else {
        var slides = document.querySelectorAll('.slide');
        if (slides.length === 0) return;
        var curIdx = 0;
        for (var si = 0; si < slides.length; si++) {
          if (slides[si].classList.contains('active')) { curIdx = si; break; }
        }
        if (idx < 0 || idx >= slides.length || idx === curIdx) return;
        slides[curIdx].classList.remove('active');
        slides[curIdx].style.display = 'none';
        slides[idx].classList.add('active');
        __feShowSlide(slides[idx]);
        __feDetectPage();
      }
      return;
    }

    /* 모드 전환 */
    if (e.data.type === 'fe:setMode') {
      __feMode = e.data.mode;
      if (__feMode === 'present') {
        /* 발표 모드 진입 시 하이라이트 전부 제거 */
        document.querySelectorAll('[data-editor-selected]').forEach(function(el) {
          el.removeAttribute('data-editor-selected');
        });
        /* 편집용 커서 스타일 제거 */
        var st = document.getElementById('__fe-style');
        if (st) st.disabled = true;
      } else {
        var st = document.getElementById('__fe-style');
        if (st) st.disabled = false;
      }
      return;
    }

    /* 하이라이트 */
    if (e.data.type === 'fe:highlight') {
      var prev = document.querySelector('[data-editor-selected]');
      if (prev) prev.removeAttribute('data-editor-selected');
      if (e.data.id) {
        var target = document.querySelector('[data-editor-id="' + e.data.id + '"]');
        if (target) target.setAttribute('data-editor-selected', 'true');
      }
    }

    /* 텍스트 변경 */
    if (e.data.type === 'fe:setText') {
      var target = document.querySelector('[data-editor-id="' + e.data.id + '"]');
      if (target) target.textContent = e.data.value;
    }

    /* 스타일 변경 */
    if (e.data.type === 'fe:setStyle') {
      var target = document.querySelector('[data-editor-id="' + e.data.id + '"]');
      if (target) target.style[e.data.prop] = e.data.value;
    }

    /* 속성 변경 */
    if (e.data.type === 'fe:setAttribute') {
      var target = document.querySelector('[data-editor-id="' + e.data.id + '"]');
      if (target) target.setAttribute(e.data.attr, e.data.value);
    }
  });
})();
`

/**
 * HTML 전체 문서를 파싱해 data-editor-id를 부여하고
 * 에디터 에이전트 스크립트를 주입한 완성된 HTML을 반환한다.
 *
 * @param {string} fullHtml
 * @returns {{ html: string, elements: Map<string, ElementMeta> }}
 */
export function prepareHtmlForEditor(fullHtml) {
  resetCounter()
  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml, 'text/html')
  const elements = new Map()

  const walk = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = node.tagName.toLowerCase()
    if (node.id === '__fe-style' || node.id === '__fe-agent' || node.id === '__fe-history-patch') return

    const type = IMAGE_TAGS.has(tag)
      ? 'image'
      : VIDEO_TAGS.has(tag)
      ? 'video'
      : EDITABLE_TAGS.has(tag)
      ? 'text'
      : CONTAINER_TAGS.has(tag)
      ? 'container'
      : null

    if (type) {
      const id = nextId()
      node.setAttribute('data-editor-id', id)
      node.setAttribute('data-editor-type', type)
      elements.set(id, { id, tag, type })
    }

    for (const child of Array.from(node.childNodes)) walk(child)
  }

  walk(doc.body)

  // history API 패치: <head> 맨 앞에 주입 → reveal.js initialize()보다 먼저 실행
  const historyPatch = doc.createElement('script')
  historyPatch.id = '__fe-history-patch'
  historyPatch.textContent = HISTORY_PATCH
  if (doc.head.firstChild) {
    doc.head.insertBefore(historyPatch, doc.head.firstChild)
  } else {
    doc.head.appendChild(historyPatch)
  }

  // 에이전트 본체: <body> 끝에 주입 (DOM이 파싱된 후 실행)
  const agentScript = doc.createElement('script')
  agentScript.id = '__fe-agent'
  agentScript.textContent = EDITOR_AGENT
  doc.body.appendChild(agentScript)

  return {
    html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    elements,
  }
}

/**
 * iframe.contentDocument 기준으로 에디터 속성을 제거한 클린 HTML 반환
 * @param {Document} iframeDoc
 * @returns {string}
 */
export function exportCleanHtml(iframeDoc) {
  const clone = iframeDoc.documentElement.cloneNode(true)
  clone.querySelectorAll('[data-editor-id]').forEach((el) => {
    el.removeAttribute('data-editor-id')
    el.removeAttribute('data-editor-type')
    el.removeAttribute('data-editor-selected')
  })
  const agent = clone.querySelector('#__fe-agent')
  if (agent) agent.remove()
  const histPatch = clone.querySelector('#__fe-history-patch')
  if (histPatch) histPatch.remove()
  const style = clone.querySelector('#__fe-style')
  if (style) style.remove()
  // 삽입 플레이스홀더 스타일 및 요소 제거
  const phStyle = clone.querySelector('#__fe-insert-ph-style')
  if (phStyle) phStyle.remove()
  clone.querySelectorAll('.__fe-insert-ph').forEach(el => el.remove())
  // flex 리사이즈 핸들 스타일 및 요소 제거
  const fhStyle = clone.querySelector('#__fe-flex-handle-style')
  if (fhStyle) fhStyle.remove()
  clone.querySelectorAll('.__fe-flex-handle').forEach(el => el.remove())
  // 리사이즈 핸들 스타일 및 요소 제거
  const rhStyle = clone.querySelector('#__fe-resize-handle-style')
  if (rhStyle) rhStyle.remove()
  clone.querySelectorAll('.__fe-resize-handle').forEach(el => el.remove())
  return '<!DOCTYPE html>\n' + clone.outerHTML
}
