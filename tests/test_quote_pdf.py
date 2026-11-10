"""Quote-card regression checks using fictitious data and actual A4 PDFs.

Run: python tests/test_quote_pdf.py
Requires Playwright, system Chromium and PyMuPDF. No model or customer data is used.
"""
from pathlib import Path
from tempfile import TemporaryDirectory

import fitz
from playwright.sync_api import expect, sync_playwright

from test_print_layout import apply, check_layout, check_pdf, compact
from test_workspace import KEY, await_saved, serve_app


SCOPE = (
    'QUOTE_SCOPE_BASE：文章制作常规服务为每月8篇。\n'
    'QUOTE_SCOPE_BONUS：活动加赠每月2篇。\n'
    'QUOTE_SCOPE_TOTAL：活动期间每月合计10篇，12个月合计120篇。\n'
    'QUOTE_SCOPE_OTHER：包含知识资料整理、发布台账及月度复盘，具体渠道按双方确认范围执行。'
)
FEE = (
    'QUOTE_FEE_TOTAL：年度总服务费人民币12000元。\n'
    'QUOTE_FEE_TAX：本测试报价含税，服务周期12个月。\n'
    'QUOTE_FEE_PAYMENT：分两期支付，额外拍摄及付费媒体费用另行确认。'
)


def quote_style(page, root):
    """Verify the same visual hierarchy survives both print paths."""
    styles = page.locator(root + ' .quote-summary').first.evaluate('''card => {
      const row=card.querySelector('.quote-fee');
      const price=row.querySelector('dd');
      const scope=card.querySelector('.quote-scope dd');
      return {
        background:getComputedStyle(card).backgroundColor,
        priceWeight:getComputedStyle(price).fontWeight,
        priceSize:parseFloat(getComputedStyle(price).fontSize),
        scopeSize:parseFloat(getComputedStyle(scope).fontSize),
        adjust:getComputedStyle(card).printColorAdjust,
      };
    }''')
    import re
    channels = [int(value) for value in re.findall(r'\d+', styles['background'])[:3]]
    assert len(channels) == 3 and max(channels) - min(channels) <= 2
    assert 180 <= channels[0] < 255, styles
    assert int(styles['priceWeight']) >= 600, styles
    assert styles['priceSize'] >= styles['scopeSize'], styles
    assert styles['adjust'] == 'exact', styles


def assert_once(text, scope=SCOPE, fee=FEE):
    result = compact(text)
    for line in (scope + '\n' + fee).splitlines():
        assert result.count(compact(line)) == 1, line


def assert_pdf_shading(path):
    # Verify an actual gray vector fill is present, even with browser background
    # printing disabled; color-adjust:exact should retain the quote's emphasis.
    with fitz.open(path) as pdf:
        drawings = pdf[-1].get_drawings()
        assert any(
            item.get('fill') is not None
            and len(item['fill']) >= 3
            and max(item['fill']) - min(item['fill']) < 0.02
            and 0.6 < item['fill'][0] < 0.99
            and item['rect'].width > 300
            and item['rect'].height > 30
            for item in drawings
        ), 'The quote emphasis disappeared from the PDF'


def assert_markers_stay_on_measured_sheets(path, layout, prefix='QUOTE_LONG_', count=55):
    # Native Chrome print fragmentation must not move a measured row onto the
    # next sheet above its masthead, even when every character remains in the PDF.
    with fitz.open(path) as pdf:
        for index in range(count):
            marker = f'{prefix}{index:03d}'
            expected = next(i for i, sheet in enumerate(layout) if marker in sheet['text'])
            actual = [(i, rect) for i, sheet in enumerate(pdf) for rect in sheet.search_for(marker)]
            assert len(actual) == 1 and actual[0][0] == expected, (marker, expected + 1, actual)
            assert actual[0][1].y0 >= 60, (marker, 'printed above the report content', actual)


def main():
    with serve_app() as url, sync_playwright() as p, TemporaryDirectory() as tmp:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                    args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':1280,'height':1000}, accept_downloads=True)
        page = context.new_page()
        errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        assert page.locator('#document #fee-row').get_attribute('class').split().count('hidden') == 1
        assert '双十一' not in page.locator('#document').text_content(), 'Activity details must never be injected by default'
        page.locator('#new-plan').click()
        page.locator('#new-name').fill('示例报价企业（虚构测试）')
        page.locator('#create-plan').click()
        page.locator('[name="business"]').fill('工业设备资料整理及选型信息服务。')
        page.locator('#step-service').click()
        expect(page.locator('textarea[name="fee"]')).to_have_count(1)
        page.locator('[name="duration"]').fill('12个月')
        page.locator('[name="scope"]').fill(SCOPE)
        page.locator('[name="fee"]').fill(FEE)
        await_saved(page)
        page.wait_for_function('''({key,scope,fee}) => {
          const store=JSON.parse(localStorage.getItem(key));
          const fields=store.plans.find(plan=>plan.id===store.activeId).data.fields;
          return fields.scope===scope && fields.fee===fee;
        }''', arg={'key':KEY,'scope':SCOPE,'fee':FEE})
        page.reload()
        page.locator('#step-service').click()
        expect(page.locator('[name="scope"]')).to_have_value(SCOPE)
        expect(page.locator('[name="fee"]')).to_have_value(FEE)
        assert page.locator('#document #p6 [data-bind="scope"]').text_content() == SCOPE
        assert page.locator('#document #p6 [data-bind="fee"]').text_content() == FEE

        root = Path(tmp)
        before = page.evaluate('JSON.stringify(collect())')
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print', 6)
        quote_style(page, '#prepared-print')
        output = root / 'quote-workspace.pdf'
        page.pdf(path=output, prefer_css_page_size=True, print_background=False)
        assert_once(check_pdf(output, 6, layout))
        assert_pdf_shading(output)
        assert page.evaluate('JSON.stringify(collect())') == before

        page.emulate_media(media='screen')
        with page.expect_download() as event:
            page.evaluate('downloadCustomer()')
        exported = root / 'quote-client.html'; event.value.save_as(exported)
        customer = context.new_page()
        customer_requests = []; customer.on('request', lambda req: customer_requests.append(req.url))
        customer.set_content(exported.read_text())
        customer.evaluate('window.dispatchEvent(new Event("beforeprint"))')
        customer.emulate_media(media='print')
        client_layout = check_layout(customer, '.report-print', 6)
        quote_style(customer, '.report-print')
        output = root / 'quote-client.pdf'
        customer.pdf(path=output, prefer_css_page_size=True, print_background=False)
        assert_once(check_pdf(output, 6, client_layout))
        assert_pdf_shading(output)
        assert not customer_requests

        # Empty fees must disappear without losing the service scope or retaining
        # previously entered activity/pricing content in either export path.
        page.emulate_media(media='screen')
        apply(page, {'client':'示例无报价企业','business':'通用资料整理服务。',
                     'scope':'SCOPE_WITHOUT_PRICE：本次整理企业资料并提交内容计划。','fee':'  \n  '})
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print', 6)
        assert not page.locator('#prepared-print .quote-fee').is_visible()
        output = root / 'quote-empty.pdf'
        page.pdf(path=output, prefer_css_page_size=True, print_background=True)
        empty_text = check_pdf(output, 6, layout)
        assert 'SCOPE_WITHOUT_PRICE' in empty_text
        assert 'QUOTE_FEE_' not in empty_text and 'QUOTE_SCOPE_' not in empty_text
        assert '服务报价' not in empty_text and '服务费用' not in empty_text
        page.emulate_media(media='screen')
        with page.expect_download() as event:
            page.evaluate('downloadCustomer()')
        empty_export = root / 'quote-empty.html'; event.value.save_as(empty_export)
        customer.set_content(empty_export.read_text())
        customer.emulate_media(media='print')
        assert not customer.locator('.report-print .quote-fee').is_visible()
        empty_layout = check_layout(customer, '.report-print', 6)
        output = root / 'quote-empty-client.pdf'
        customer.pdf(path=output, prefer_css_page_size=True, print_background=False)
        assert 'SCOPE_WITHOUT_PRICE' in check_pdf(output, 6, empty_layout)

        # A very long actual service list may continue, but each item must survive
        # once, with valid A4 footers and no edits to local data.
        long_scope = '\n'.join(f'QUOTE_LONG_{i:03d}：本项整理对应业务资料、核实内容并留存发布记录，数量及适用范围以双方确认的执行清单为准。'
                               for i in range(55))
        apply(page, {'client':'示例长清单企业','business':'资料整理服务。','scope':long_scope,'fee':FEE})
        before = page.evaluate('JSON.stringify(collect())')
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        layout = check_layout(page, '#prepared-print')
        assert len(layout) > 6 and any('续' in item['text'] for item in layout)
        output = root / 'quote-long.pdf'
        page.pdf(path=output, prefer_css_page_size=True, print_background=True)
        long_text = compact(check_pdf(output, len(layout), layout))
        for i in range(55):
            assert long_text.count(f'QUOTE_LONG_{i:03d}') == 1, i
        line_body = compact(long_scope.splitlines()[0].split('：', 1)[1])
        assert long_text.count(line_body) == 55, 'A service description was clipped after its marker'
        for line in FEE.splitlines():
            assert long_text.count(compact(line)) == 1, line
        assert_markers_stay_on_measured_sheets(output, layout)
        assert page.evaluate('JSON.stringify(collect())') == before

        page.emulate_media(media='screen')
        with page.expect_download() as event:
            page.evaluate('downloadCustomer()')
        long_export = root / 'quote-long.html'; event.value.save_as(long_export)
        customer.set_content(long_export.read_text())
        customer.evaluate('window.dispatchEvent(new Event("beforeprint"))')
        customer.emulate_media(media='print')
        long_client_layout = check_layout(customer, '.report-print', len(layout))
        output = root / 'quote-long-client.pdf'
        customer.pdf(path=output, prefer_css_page_size=True, print_background=False)
        long_client_text = compact(check_pdf(output, len(layout), long_client_layout))
        for i in range(55):
            assert long_client_text.count(f'QUOTE_LONG_{i:03d}') == 1, i
        assert long_client_text.count(line_body) == 55, 'An exported service description was clipped'
        for line in FEE.splitlines():
            assert long_client_text.count(compact(line)) == 1, line
        assert_markers_stay_on_measured_sheets(output, long_client_layout)

        long_fee_body = '本项费用包含双方确认的内容制作与执行记录，税务口径、付款节点及额外费用均应核实后确认。'
        long_fee = '\n'.join(f'QUOTE_FEE_LONG_{i:03d}：{long_fee_body}' for i in range(35))
        page.emulate_media(media='screen')
        apply(page, {'client':'示例长费用说明企业','business':'资料整理服务。',
                     'scope':'本次整理企业资料并提交内容计划。','fee':long_fee})
        page.evaluate('window.prepareReportPrint()')
        page.emulate_media(media='print')
        fee_layout = check_layout(page, '#prepared-print')
        output = root / 'quote-long-fee.pdf'
        page.pdf(path=output, prefer_css_page_size=True, print_background=False)
        long_fee_text = compact(check_pdf(output, len(fee_layout), fee_layout))
        assert long_fee_text.count(long_fee_body) == 35
        assert_markers_stay_on_measured_sheets(output, fee_layout, 'QUOTE_FEE_LONG_', 35)
        assert not errors, errors
        browser.close()
        print('PASS: multiline quote autosave/reload, six-page workspace/client PDFs, gray print emphasis, blank fee hidden, no default activity, long list continued without loss')


if __name__ == '__main__':
    main()
