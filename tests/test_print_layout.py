"""Validate actual A4 PDFs, including long filled reports and explicit continuations.

Run: python tests/test_print_layout.py
Requires Playwright, system Chromium, and PyMuPDF (fitz). Only synthetic fixtures are used.
"""
from pathlib import Path
import re
from tempfile import TemporaryDirectory

import fitz
from playwright.sync_api import sync_playwright

from print_fixtures import BASELINE, ALL_PRESETS, REALISTIC_LONG, REALISTIC_EXTENDED, OVERSIZED_PARAGRAPH
from test_workspace import serve_app


LAYOUT = r'''(selector) => [...document.querySelectorAll(selector+' > .page')].map((page,i) => {
  const rect=page.getBoundingClientRect();
  const footer=page.querySelector('.footer');
  const footerRect=footer.getBoundingClientRect();
  const walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT);
  const lines=[];
  while(walker.nextNode()) {
    const node=walker.currentNode;
    if(!node.textContent.trim() || node.parentElement.closest('.footer'))continue;
    const range=document.createRange();range.selectNodeContents(node);
    for(const line of range.getClientRects())if(line.width>0 && line.height>0)lines.push(line);
  }
  const transforms=[];
  for(const el of [page,...page.querySelectorAll('*')]) {
    const style=getComputedStyle(el);
    const matrix=style.transform;
    if(matrix && matrix!=='none') {
      const m=new DOMMatrixReadOnly(matrix);
      transforms.push(Math.sqrt(m.a*m.a+m.b*m.b));
    }
    const zoom=Number.parseFloat(style.zoom);
    if(Number.isFinite(zoom) && zoom>0 && zoom!==1)transforms.push(zoom);
  }
  return {
    index:i+1,width:rect.width,height:rect.height,
    footerGap:footerRect.top-Math.max(...lines.map(line=>line.bottom)),
    footerBottom:footerRect.bottom-rect.top,
    maxContentRight:Math.max(...lines.map(line=>line.right))-rect.left,
    minContentLeft:Math.min(...lines.map(line=>line.left))-rect.left,
    minScale:Math.min(1,...transforms),
    number:footer.querySelector('span:nth-child(2)').textContent.trim(),
    text:page.textContent,
  };
})'''


def compact(text):
    return re.sub(r'\s+', '', text)


def check_layout(page, selector, expected_count=None):
    layout = page.evaluate(LAYOUT, selector)
    if expected_count is not None:
        assert len(layout) == expected_count, (expected_count, layout)
    assert layout, 'No prepared physical report pages'
    total = len(layout)
    for item in layout:
        assert abs(item['width'] - 210 * 96 / 25.4) <= 2, item
        assert 295.5 * 96 / 25.4 <= item['height'] <= 297 * 96 / 25.4 + 2, item
        assert item['footerGap'] >= 3, item
        assert item['footerBottom'] <= item['height'] - 8, item
        assert item['minContentLeft'] >= 15, item
        assert item['maxContentRight'] <= item['width'] - 15, item
        assert item['minScale'] >= 0.879, item
        assert [int(n) for n in re.findall(r'\d+', item['number'])][-2:] == [item['index'], total], item
    return layout


def check_pdf(path, expected_count, layout):
    with fitz.open(path) as pdf:
        assert len(pdf) == expected_count, (path.name, len(pdf), expected_count)
        texts = []
        for index, physical in enumerate(pdf):
            assert abs(physical.rect.width - 595.276) < 1.5
            assert abs(physical.rect.height - 841.89) < 1.5
            text = physical.get_text()
            assert len(compact(text)) > 70, (path.name, index + 1, text)
            assert compact(layout[index]['number']) in compact(text), (path.name, index + 1, text[-200:])
            # Text must remain within the physical sheet rather than being clipped off-page.
            for block in physical.get_text('blocks'):
                assert block[0] >= 0 and block[1] >= 0, (path.name, index + 1, block)
                assert block[2] <= physical.rect.width + 1 and block[3] <= physical.rect.height + 1, (path.name, index + 1, block)
            texts.append(text)
        return '\n'.join(texts)


def apply(page, fields, copy=None):
    page.evaluate('(data)=>applyReport(data)', {'fields': fields, 'copy': copy or {}})


def main():
    with serve_app() as url, sync_playwright() as p, TemporaryDirectory() as tmp:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        root = Path(tmp)
        summary = []
        for name, fields, width in [
            ('baseline', BASELINE, 1280),
            ('all_presets', ALL_PRESETS, 1280),
            ('realistic_b2b', REALISTIC_LONG, 1280),
            ('extended_b2b', REALISTIC_EXTENDED, 1280),
            ('mobile_b2b', REALISTIC_LONG, 390),
        ]:
            context = browser.new_context(viewport={'width': width, 'height': 900}, accept_downloads=True)
            page = context.new_page()
            errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url)
            apply(page, fields)
            before_html = page.locator('#document').inner_html()
            before_state = page.evaluate('JSON.stringify(collect())')
            requests = []; page.on('request', lambda req: requests.append(req.url))
            page.evaluate('window.prepareReportPrint()')
            first_text = page.locator('#prepared-print').text_content()
            page.evaluate('window.prepareReportPrint()')
            assert page.locator('#prepared-print').count() == 1
            assert page.locator('#prepared-print').text_content() == first_text
            assert page.locator('#document').inner_html() == before_html
            assert page.evaluate('JSON.stringify(collect())') == before_state
            page.emulate_media(media='print')
            assert not page.locator('#document').is_visible()
            layout = check_layout(page, '#prepared-print', 6)
            output = root / (name + '.pdf')
            page.pdf(path=output, prefer_css_page_size=True, print_background=True)
            text = check_pdf(output, 6, layout)
            assert '年度' in text and '每月' in text
            for source in ['第2—3个月', '第4—6个月', '第7—9个月', '第10—12个月']:
                assert compact(source) in compact(text), (name, source)
            assert page.locator('#document').inner_html() == before_html
            assert page.evaluate('JSON.stringify(collect())') == before_state
            assert not requests, requests
            assert not errors, errors
            summary.append(f'{name}=6 pages')

            if name == 'realistic_b2b':
                page.emulate_media(media='screen')
                with page.expect_download() as event:
                    page.evaluate('downloadCustomer()')
                exported = root / 'standalone.html'; event.value.save_as(exported)
                customer = context.new_page()
                customer_requests = []; customer.on('request', lambda req: customer_requests.append(req.url))
                customer.set_content(exported.read_text())
                assert customer.locator('script[src],link[rel="stylesheet"]').count() == 0
                assert customer.locator('[data-app-ui],#plan-list,#fields').count() == 0
                assert customer.locator('script').count() == 1
                utility = customer.locator('script').text_content()
                for forbidden in ['localStorage','sessionStorage','indexedDB','fetch(','XMLHttpRequest','WebSocket','sendBeacon']:
                    assert forbidden not in utility, forbidden
                source = customer.locator('#report-source').inner_html()
                customer.evaluate('window.dispatchEvent(new Event("beforeprint"))')
                customer.evaluate('window.dispatchEvent(new Event("beforeprint"))')
                assert customer.locator('#report-source').inner_html() == source
                customer.emulate_media(media='print')
                exported_layout = check_layout(customer, '.report-print', 6)
                output = root / 'standalone.pdf'
                customer.pdf(path=output, prefer_css_page_size=True, print_background=True)
                exported_text = check_pdf(output, 6, exported_layout)
                assert compact(fields['business']) in compact(exported_text)
                assert not customer_requests, customer_requests
                summary.append('standalone=6 pages, no external requests/storage')
            context.close()

        # Prefix normalization also applies to untouched legacy reports, without repeated labels.
        context = browser.new_context(viewport={'width':1280,'height':900})
        page = context.new_page(); page.goto(url)
        legacy = {'w1':'工作旧版首周工作', 'd1':'交付旧版首周交付',
                  'w5':'工作旧版持续运营', 'd5':'交付旧版持续交付', 'w6':'工作与交付旧版期满总结'}
        apply(page, BASELINE, legacy)
        expected = ['工作：旧版首周工作','交付：旧版首周交付','工作：旧版持续运营',
                    '交付：旧版持续交付','工作与交付：旧版期满总结']
        for _ in range(2):
            page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print', 6)
        output = root / 'legacy-prefixes.pdf'; page.pdf(path=output, prefer_css_page_size=True, print_background=True)
        text = compact(check_pdf(output, 6, layout))
        for label in expected:
            assert compact(label) in text, label
        assert '工作：工作：' not in text and '交付：交付：' not in text
        summary.append('legacy prefixes normalized once in actual PDF')
        context.close()

        # Historical contact values may contain review prose; that text must never
        # populate the fixed service-contact line or leak into a client export.
        context = browser.new_context(viewport={'width':1280,'height':900}, accept_downloads=True)
        page = context.new_page(); page.goto(url)
        review = 'REVIEW_ONLY_MARKER：由客户核对真实业务资料，统一反馈并确认发布版本。'
        legacy_contact = review + ' LEGACY_CONTACT_MUST_NOT_EXPORT'
        apply(page, {**BASELINE, 'review': review, 'contact': legacy_contact})
        fixed_contact = '服务对接：启动时确认服务对接人与联系方式。'
        assert page.locator('#document #p6 [data-static-contact]').text_content() == fixed_contact
        assert page.locator('#document #p6 [data-bind="review"]').text_content() == review
        assert page.locator('[name="contact"]').count() == 0
        assert page.evaluate('collect().fields.contact') == legacy_contact, 'Legacy data must remain available in local records'
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print', 6)
        output = root / 'fixed-service-contact.pdf'; page.pdf(path=output, prefer_css_page_size=True, print_background=True)
        pdf_text = compact(check_pdf(output, 6, layout))
        assert pdf_text.count('REVIEW_ONLY_MARKER') == 1
        assert compact(fixed_contact) in pdf_text
        assert 'LEGACY_CONTACT_MUST_NOT_EXPORT' not in pdf_text
        page.emulate_media(media='screen')
        with page.expect_download() as event:
            page.evaluate('downloadCustomer()')
        exported = root / 'fixed-service-contact.html'; event.value.save_as(exported)
        customer = context.new_page(); customer.set_content(exported.read_text())
        assert customer.locator('.report-print [data-static-contact]').text_content() == fixed_contact
        assert 'LEGACY_CONTACT_MUST_NOT_EXPORT' not in exported.read_text()
        assert customer.locator('.report-print').inner_text().count('REVIEW_ONLY_MARKER') == 1
        customer.emulate_media(media='print')
        exported_layout = check_layout(customer, '.report-print', 6)
        output = root / 'fixed-service-contact-standalone.pdf'
        customer.pdf(path=output, prefer_css_page_size=True, print_background=True)
        pdf_text = compact(check_pdf(output, 6, exported_layout))
        assert pdf_text.count('REVIEW_ONLY_MARKER') == 1
        assert compact(fixed_contact) in pdf_text
        assert 'LEGACY_CONTACT_MUST_NOT_EXPORT' not in pdf_text
        summary.append('fixed service contact independent of legacy review/contact values')
        context.close()

        # One genuinely oversized paragraph must continue, never disappear or shrink below the readable limit.
        context = browser.new_context(viewport={'width':1280,'height':900})
        page = context.new_page(); page.goto(url)
        apply(page, BASELINE, {'a3': OVERSIZED_PARAGRAPH})
        source = page.locator('#document').inner_html()
        state = page.evaluate('JSON.stringify(collect())')
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print')
        assert len(layout) > 6, 'A genuinely overlong paragraph should use explicit continuation sheets'
        assert any('续' in item['text'] for item in layout), 'Continuation pages need a visible continuation label'
        fragments = page.locator('#prepared-print [data-edit="a3"]').all_text_contents()
        assert compact(''.join(fragments)) == compact(OVERSIZED_PARAGRAPH), 'Continuation fragments must preserve every character'
        output = root / 'oversized.pdf'; page.pdf(path=output, prefer_css_page_size=True, print_background=True)
        text = compact(check_pdf(output, len(layout), layout))
        for i in range(110):
            for suffix in ('START', 'END'):
                marker = f'RETAIN_{i:03d}_{suffix}'
                assert marker in text, marker + ' was lost while continuing a long paragraph'
        assert page.locator('#document').inner_html() == source
        assert page.evaluate('JSON.stringify(collect())') == state
        summary.append(f'oversized={len(layout)} explicit sheets, all 220 sentinels retained')
        context.close(); browser.close()
        print('PASS: ' + '; '.join(summary))


if __name__ == '__main__':
    main()
