"""Check service-cycle labels and actual exported PDFs with fictitious data."""
from pathlib import Path
from tempfile import TemporaryDirectory
import fitz
from playwright.sync_api import sync_playwright, expect
from test_workspace import serve_app
from test_print_layout import check_layout, check_pdf, compact


def main():
    with serve_app() as url,sync_playwright() as p,TemporaryDirectory() as tmp:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context(accept_downloads=True)
        page=context.new_page();page.goto(url)
        paths=page.evaluate('''() => [...document.querySelectorAll('#fields [name]')].map(el=>'fields.'+el.name).concat([...document.querySelectorAll('[data-copy]')].map(el=>'copy.'+el.dataset.copy)).sort()''')
        assert paths==page.evaluate('GEOPlanSchema.allFields.map(f=>f.path).sort()'), 'Assistant and editor fields drifted'
        page.locator('[name=business]').fill('虚构周期测试设备服务')
        page.locator('#step-service').click()
        original=page.evaluate('JSON.stringify(collect().copy)')
        page.locator('[name=duration]').fill('13个月，自服务启动日起算')
        page.locator('#service-tab-annual').click()
        expect(page.locator('.copy-section[data-period-stage="5"] .copy-section-title')).to_have_text('第10—13个月')
        assert page.locator('#document [data-period-lead]').text_content().startswith('本次服务期为13个月')
        assert page.evaluate('JSON.stringify(collect().copy)')==original, 'Period labels must not rewrite saved body text'
        page.evaluate('prepareReportPrint()');page.emulate_media(media='print')
        layout=check_layout(page,'#prepared-print',6)
        pdf=Path(tmp)/'period-13.pdf';page.pdf(path=pdf,prefer_css_page_size=True,print_background=True)
        text=compact(check_pdf(pdf,6,layout));assert '第10—13个月' in text and '本次服务期为13个月' in text
        assert '以12个月服务为讨论示例' not in text
        page.emulate_media(media='screen')
        with page.expect_download() as event:page.evaluate('downloadCustomer()')
        file=Path(tmp)/'period-client.html';event.value.save_as(file)
        customer=context.new_page();customer.set_content(file.read_text())
        customer.emulate_media(media='print')
        client_layout=check_layout(customer,'.report-print',6)
        pdf=Path(tmp)/'period-13-client.pdf';customer.pdf(path=pdf,prefer_css_page_size=True)
        assert '第10—13个月' in compact(check_pdf(pdf,6,client_layout))
        page.locator('#service-tab-config').click()
        page.locator('[name=duration]').fill('3个月')
        assert page.locator('#document tr[data-period-stage="3"]').get_attribute('hidden') is not None
        page.evaluate('prepareReportPrint()');page.emulate_media(media='print')
        layout=check_layout(page,'#prepared-print',6)
        pdf=Path(tmp)/'period-3.pdf';page.pdf(path=pdf,prefer_css_page_size=True)
        text=compact(check_pdf(pdf,6,layout));assert '本次服务期为3个月' in text and '第2—3个月' in text
        assert '第4—6个月' not in text and '第10—12个月' not in text
        page.emulate_media(media='screen')
        page.locator('[name=duration]').fill('待双方确认')
        assert '待双方确认' in page.locator('#document [data-period-lead]').text_content()
        assert '本次服务期为12个月' not in page.locator('#document [data-period-lead]').text_content()
        page.locator('[name=duration]').fill('12个月＋赠送1个月')
        assert '13个月' in page.locator('#document [data-period-lead]').text_content()
        browser.close()
    print('PASS: all 65 field names aligned; 13-month editor/workspace/client PDFs; 3-month rows hidden; unknown cycle explicit; saved body unchanged')

if __name__=='__main__':main()
