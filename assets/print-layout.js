/* A4 layout is measured on clones; customer data never leaves this document. */
(function createGEOPrint(global) {
  'use strict';

  const MIN_SCALE = 0.9;
  const FIT_EPSILON = 0.5;
  const INTERNAL_KEY = 'data-print-source-key';
  const ATOMIC = '.stage,.work-row,.fact,tr,li,.business-focus,.scope,.sample,.box,.cols,.project-header,.month-header,.annual-handover';
  const CONTEXT = '.section,.stage,.work-row,.fact,.business-focus,.scope,.box,.sample';

  function build(sourceReport) {
    if (!sourceReport || !sourceReport.querySelectorAll) throw new Error('找不到用于打印的方案内容。');
    // Template contents belong to an inert document; measure in the live one.
    const document = global.document;
    const sourcePages = Array.from(sourceReport.children).filter(node => node.classList.contains('page'));
    if (!sourcePages.length) throw new Error('方案中没有可打印的页面。');
    const root = document.createElement('main');
    root.className = 'document report-print';
    root.dataset.generatedPrint = 'true';
    root.dataset.printMeasuring = 'true';
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {position: 'fixed', left: '-100000px', top: '0', width: '210mm', maxWidth: 'none', visibility: 'hidden'});
    document.body.appendChild(root);
    const sheets = [];

    function createSheet(sourcePage, continuation) {
      const page = sourcePage.cloneNode(false);
      page.hidden = false;
      page.style.removeProperty('display');
      page.dataset.originPage = sourcePage.id || `page-${sourcePages.indexOf(sourcePage) + 1}`;
      page.id = continuation ? `${page.dataset.originPage}-continuation-${continuation}` : page.dataset.originPage;
      page.dataset.printDensity = 'normal';
      const masthead = Array.from(sourcePage.children).find(node => node.classList.contains('masthead'));
      const footer = Array.from(sourcePage.children).find(node => node.classList.contains('footer'));
      if (masthead) page.appendChild(masthead.cloneNode(true));
      const body = document.createElement('div');
      body.className = 'print-page-body';
      const content = document.createElement('div');
      content.className = 'print-page-content';
      body.appendChild(content);
      page.appendChild(body);
      if (footer) page.appendChild(footer.cloneNode(true));
      root.appendChild(page);
      return {page, body, content, masthead: page.querySelector(':scope > .masthead'), footer: page.querySelector(':scope > .footer')};
    }

    function measure(sheet, density, scale) {
      sheet.page.dataset.printDensity = density;
      sheet.content.style.setProperty('--print-scale', String(scale));
      sheet.content.style.width = `${100 / scale}%`;
      sheet.content.style.transform = `scale(${scale})`;
      sheet.content.style.transformOrigin = 'top left';
      const pageRect = sheet.page.getBoundingClientRect();
      const top = sheet.masthead ? sheet.masthead.getBoundingClientRect().bottom - pageRect.top + 18 : 38;
      const bottom = sheet.footer ? sheet.footer.getBoundingClientRect().top - pageRect.top - 10 : pageRect.height - 40;
      sheet.body.style.top = `${Math.ceil(top)}px`;
      sheet.body.style.bottom = `${Math.ceil(pageRect.height - bottom)}px`;
      const available = sheet.body.getBoundingClientRect().height;
      const contentRect = sheet.content.getBoundingClientRect();
      // scrollHeight catches overflow from long text; descendant bounds catch grids
      // and margins whose transformed visual extent exceeds the normal flow box.
      let extent = Math.max(sheet.content.scrollHeight * scale, contentRect.height);
      for (const node of sheet.content.querySelectorAll('*')) {
        const rect = node.getBoundingClientRect();
        if (rect.width || rect.height) extent = Math.max(extent, rect.bottom - contentRect.top);
      }
      return available > 0 && extent <= available + FIT_EPSILON;
    }

    function fit(sheet) {
      if (measure(sheet, 'normal', 1)) return true;
      if (measure(sheet, 'compact', 1)) return true;
      if (!measure(sheet, 'compact', MIN_SCALE)) return false;
      let low = MIN_SCALE;
      let high = 1;
      for (let pass = 0; pass < 10; pass += 1) {
        const middle = (low + high) / 2;
        if (measure(sheet, 'compact', middle)) low = middle;
        else high = middle;
      }
      // Round down, so a floating point difference cannot create an extra page.
      measure(sheet, 'compact', Math.floor(low * 10000) / 10000);
      return true;
    }

    function paginate(sourcePage) {
      const original = document.createElement('div');
      for (const node of sourcePage.childNodes) {
        if (node.nodeType === 1 && (node.classList.contains('masthead') || node.classList.contains('footer'))) continue;
        original.appendChild(node.cloneNode(true));
      }
      const keyed = new Map();
      let key = 0;
      for (const node of original.querySelectorAll(`table,${CONTEXT},ol,ul`)) {
        node.setAttribute(INTERNAL_KEY, String(++key));
        keyed.set(String(key), node);
        if (node.tagName === 'TABLE') {
          for (const row of node.rows) Array.from(row.cells).forEach((cell, index) => { cell.dataset.printColumn = String(index); });
        }
        if (node.matches('ol,ul')) Array.from(node.children).forEach((child, index) => { child.dataset.printListIndex = String(index + 1); });
      }
      let sheet = createSheet(sourcePage, 0);
      sheet.content.appendChild(original.cloneNode(true));
      // Do not retain the temporary wrapper: its margin/layout must not change
      // the measured report compared with a fragment used for continuation pages.
      sheet.content.replaceChildren(...sheet.content.firstChild.childNodes);
      if (fit(sheet)) {
        sheets.push(sheet);
        return;
      }
      sheet.page.remove();

      const startOf = {node: original, offset: 0};
      const endOf = {node: original, offset: original.childNodes.length};
      const coarse = [];
      function after(node) {
        return {node: node.parentNode, offset: Array.prototype.indexOf.call(node.parentNode.childNodes, node) + 1};
      }
      function collect(node) {
        if (node.nodeType !== 1) return;
        if (node.hidden || node.matches('[data-focus-block][hidden],[data-optional-field][hidden]')) return;
        const heading = node.matches('h1,h2,h3,h4,.eyebrow,.section-title,thead,colgroup');
        if (heading) return;
        if (node.matches(ATOMIC) || !node.children.length || node.matches('p')) {
          coarse.push(after(node));
          return;
        }
        for (const child of node.children) collect(child);
        coarse.push(after(node));
      }
      for (const node of original.children) collect(node);
      coarse.push(endOf);

      function compare(a, b) {
        const first = document.createRange();
        first.setStart(a.node, a.offset);
        first.collapse(true);
        const second = document.createRange();
        second.setStart(b.node, b.offset);
        second.collapse(true);
        return first.compareBoundaryPoints(0, second);
      }
      // Ancestor boundaries can be equivalent to a preceding child boundary.
      // Sorting them also gives a stable order when a container is empty/hidden.
      coarse.sort(compare);
      const boundaries = coarse.filter((point, index) => !index || compare(point, coarse[index - 1]) !== 0);

      function fragmentBetween(start, end) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        let fragment = range.cloneContents();
        // cloneContents omits its common ancestor. When both endpoints are in
        // one paragraph it returns bare text; rebuild that ancestor chain so a
        // continuation retains its paragraph, grid, table and font styling.
        let ancestor = range.commonAncestorContainer;
        if (ancestor.nodeType !== 1) ancestor = ancestor.parentElement;
        while (ancestor && ancestor !== original) {
          const shell = ancestor.cloneNode(false);
          shell.appendChild(fragment);
          fragment = document.createDocumentFragment();
          fragment.appendChild(shell);
          ancestor = ancestor.parentElement;
        }
        // Empty indentation at a container's final boundary must not acquire a
        // repeated heading, otherwise it could create a blank continuation.
        if (fragment.textContent.trim() || fragment.querySelector('img,svg,canvas')) repairContext(fragment);
        return fragment;
      }

      function repairContext(fragment) {
        // Range preserves ancestor markup. Restore only labels omitted at a
        // continuation boundary, so grids keep their columns and tables retain
        // their headings. This repeats context, never substitutes report text.
        for (const clone of fragment.querySelectorAll(`[${INTERNAL_KEY}]`)) {
          const source = keyed.get(clone.getAttribute(INTERNAL_KEY));
          if (!source) continue;
          if (clone.tagName === 'TABLE') {
            if (source.tHead && !clone.tHead) clone.insertBefore(source.tHead.cloneNode(true), clone.tBodies[0] || null);
            for (const row of clone.rows) {
              if (row.parentElement.tagName === 'THEAD') continue;
              const cells = Array.from(row.cells);
              const first = cells[0];
              if (!first) continue;
              const before = Number(first.dataset.printColumn || 0);
              for (let index = 0; index < before; index += 1) row.insertBefore(document.createElement('td'), first);
            }
          }
          const firstChild = source.firstElementChild;
          let selector = '';
          if (source.matches('.section') && firstChild && firstChild.matches('.section-title')) selector = '.section-title';
          else if (source.matches('.stage')) selector = '.week';
          else if (source.matches('.work-row')) selector = '.num';
          else if (source.matches('.fact')) selector = 'dt';
          else if (source.matches('.business-focus,.scope')) selector = 'strong';
          else if (source.matches('.box')) selector = 'h3';
          else if (source.matches('.sample')) selector = '.sample-head';
          if (selector && firstChild && firstChild.matches(selector) && !Array.from(clone.children).some(child => child.matches(selector))) {
            clone.insertBefore(firstChild.cloneNode(true), clone.firstChild);
          }
          if (source.matches('.stage,.work-row')) {
            const sourceDetail = source.children[1];
            const cloneDetail = clone.children[1];
            const heading = sourceDetail && sourceDetail.querySelector(':scope > h3');
            if (heading && cloneDetail && !cloneDetail.querySelector(':scope > h3')) cloneDetail.insertBefore(heading.cloneNode(true), cloneDetail.firstChild);
          }
          if (source.matches('ol,ul')) {
            const first = clone.querySelector(':scope > li[data-print-list-index]');
            if (first) {
              const index = Number(first.dataset.printListIndex);
              if (clone.tagName === 'OL') clone.start = index;
              if (clone.classList.contains('questions')) clone.style.counterReset = `q ${index - 1}`;
            }
          }
        }
      }

      function put(start, end) {
        const fragment = fragmentBetween(start, end);
        sheet.content.replaceChildren(fragment);
        if (continuation && (sheet.content.textContent.trim() || sheet.content.querySelector('img,svg,canvas'))) {
          const heading = document.createElement('div');
          heading.className = 'continuation-heading';
          const label = sheet.masthead && sheet.masthead.lastElementChild;
          heading.textContent = `${label ? label.textContent : '服务方案'}（续）`;
          sheet.content.insertBefore(heading, sheet.content.firstChild);
        }
      }
      function fitsAtMinimum(start, end) {
        put(start, end);
        return measure(sheet, 'compact', MIN_SCALE);
      }
      function textBoundaries(start, end) {
        const points = [];
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const walker = document.createTreeWalker(original, 4);
        const segmenter = global.Intl && global.Intl.Segmenter ? new global.Intl.Segmenter('zh', {granularity: 'grapheme'}) : null;
        let node;
        while ((node = walker.nextNode())) {
          if (!node.data || !range.intersectsNode(node)) continue;
          const textStart = node === start.node ? start.offset : 0;
          const textEnd = node === end.node ? end.offset : node.length;
          let offset = textStart;
          const text = node.data.slice(textStart, textEnd);
          const pieces = segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);
          for (const piece of pieces) {
            offset += piece.length;
            const point = {node, offset};
            if (compare(point, start) > 0 && compare(point, end) < 0) points.push(point);
          }
        }
        return points;
      }
      function findLastFit(points, start) {
        let low = 0;
        let high = points.length - 1;
        let best = -1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (fitsAtMinimum(start, points[middle])) { best = middle; low = middle + 1; }
          else high = middle - 1;
        }
        return best;
      }

      let start = startOf;
      let continuation = 0;
      while (compare(start, endOf) < 0) {
        sheet = createSheet(sourcePage, continuation);
        const remaining = boundaries.filter(point => compare(point, start) > 0);
        const lastFit = findLastFit(remaining, start);
        let end;
        if (lastFit >= 0) end = remaining[lastFit];
        else {
          // A single row/paragraph exceeds a whole sheet. Split its text at a
          // measured grapheme boundary, preserving inline markup via Range.
          const limit = remaining[0] || endOf;
          const points = textBoundaries(start, limit);
          const index = findLastFit(points, start);
          if (index < 0) {
            sheet.page.remove();
            throw new Error('某项内容或页脚大于整张 A4 可用空间，请缩短该项标题或客户名称后重试。');
          }
          end = points[index];
          // Prefer the end of a word/sentence when close to the measured edge.
          // Chinese text has no spaces, so punctuation is also a safe boundary.
          const minimum = Math.max(0, index - 40);
          for (let candidate = index; candidate >= minimum; candidate -= 1) {
            const point = points[candidate];
            if (/[\s，。；、！？,.!?;:：]/u.test(point.node.data.charAt(point.offset - 1))) { end = point; break; }
          }
        }
        put(start, end);
        if (!fit(sheet)) {
          sheet.page.remove();
          throw new Error('打印布局计算未能完成，请重新打开打印预览。');
        }
        // A final structural boundary can contain only the original indentation.
        if (sheet.content.textContent.trim() || sheet.content.querySelector('img,svg,canvas')) {
          sheets.push(sheet);
          continuation += 1;
        } else sheet.page.remove();
        start = end;
      }
    }

    try {
      sourcePages.forEach(paginate);
      const total = sheets.length;
      sheets.forEach((sheet, index) => {
        const number = sheet.footer && sheet.footer.children[1];
        if (number) number.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
        sheet.page.dataset.printSheet = String(index + 1);
        // IDs inside the source report belong to the editor. Keep only the
        // sheet's logical ID; cloned fields must never shadow those editor IDs.
        for (const node of sheet.page.querySelectorAll('[id]')) {
          node.dataset.originId = node.id;
          node.id = `${node.id}-print-${index + 1}`;
        }
        for (const node of sheet.page.querySelectorAll('[contenteditable]')) node.removeAttribute('contenteditable');
        for (const node of sheet.page.querySelectorAll(`[${INTERNAL_KEY}]`)) node.removeAttribute(INTERNAL_KEY);
        const scale = Number(sheet.content.style.getPropertyValue('--print-scale')) || 1;
        if (!measure(sheet, sheet.page.dataset.printDensity, scale) && !fit(sheet)) {
          throw new Error('页码更新后可用空间不足，请缩短客户名称后重新导出。');
        }
      });
      root.dataset.printPages = String(total);
      return root;
    } finally {
      root.remove();
      root.removeAttribute('aria-hidden');
      delete root.dataset.printMeasuring;
      root.removeAttribute('style');
    }
  }

  function installStandalone(options) {
    const settings = options || {};
    if (global.__geoStandalonePrintInstalled) return;
    const document = global.document;
    const sourceElement = document.querySelector(settings.sourceSelector || '#report-source,[data-report-source],#document');
    if (!sourceElement) return;
    const source = sourceElement.tagName === 'TEMPLATE' ? sourceElement.content.firstElementChild : sourceElement;
    if (!source) return;
    global.__geoStandalonePrintInstalled = true;
    const targetId = settings.targetId || 'standalone-print';
    function prepare() {
      const output = build(source);
      output.id = targetId;
      const previous = document.getElementById(targetId);
      if (previous) previous.replaceWith(output);
      else sourceElement.insertAdjacentElement('afterend', output);
      if (sourceElement.tagName !== 'TEMPLATE') sourceElement.hidden = true;
      return output;
    }
    global.addEventListener('beforeprint', prepare);
    prepare();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(prepare);
  }

  global.GEOPrint = {
    build,
    installStandalone,
    getStandaloneSource() { return `(${createGEOPrint.toString()})(window);\nwindow.GEOPrint.installStandalone();`; }
  };
})(window);
