/**
 * ElementRegistry
 * 전체 HTML 문서를 파싱하고 편집 가능한 요소에 data-editor-id를 부여한다.
 * iframe srcdoc에 주입할 에디터 에이전트 스크립트도 함께 삽입한다.
 */

export const EDITABLE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'li', 'td', 'th', 'a', 'strong', 'em', 'label', 'figcaption'])
export const IMAGE_TAGS = new Set(['img'])
export const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'table', 'thead', 'tbody', 'tfoot', 'tr'])

export function classifyTag(tag) {
  if (IMAGE_TAGS.has(tag)) return 'image'
  if (EDITABLE_TAGS.has(tag)) return 'text'
  if (CONTAINER_TAGS.has(tag)) return 'container'
  return null
}

let _counter = 0
export const nextId = () => `fe-${++_counter}`
export function resetCounter() { _counter = 0 }

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

  /* ── 페이지 변경 감시 (MutationObserver) ── */
  function __feDetectPage() {
    var slides = document.querySelectorAll('.slide');
    if (slides.length === 0) return;
    var total = slides.length;
    var current = 0;
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains('active')) { current = i; break; }
    }
    window.parent.postMessage({
      type: 'fe:pageChange',
      page: current,
      total: total,
    }, '*');
  }

  /* 클래스 변경 감시 — .slide 요소의 active 클래스 토글을 감지 */
  var __feMo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].attributeName === 'class') { __feDetectPage(); return; }
    }
  });
  document.querySelectorAll('.slide').forEach(function (sl) {
    __feMo.observe(sl, { attributes: true, attributeFilter: ['class'] });
  });
  /* 초기 페이지 보고 */
  setTimeout(__feDetectPage, 100);

  /* ── 부모로부터 명령 수신 ── */
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (!e.data.type.startsWith('fe:')) return;

    /* 페이지 이동 명령 */
    if (e.data.type === 'fe:navigate') {
      if (typeof window.nav === 'function') {
        window.nav(e.data.delta);
      } else if (typeof window.show === 'function') {
        window.show(e.data.page);
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
    if (node.id === '__fe-style' || node.id === '__fe-agent') return

    const type = IMAGE_TAGS.has(tag)
      ? 'image'
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
