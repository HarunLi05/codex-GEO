"""Exercise the complete browser workflow. Run: python tests/test_workspace.py."""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = 'yizhantui.geo.workspace.v1'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def serve_app():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def menu_action(page, selector):
    menu = page.locator('#plan-menu')
    if menu.get_attribute('open') is None:
        menu.locator('summary').click()
    page.locator(selector).click()


def await_saved(page):
    expect(page.locator('#persist-status')).to_contain_text('已保存')


def open_copy_section(page, key):
    section = page.locator('#copy-' + key).locator('xpath=ancestor::details[1]')
    if section.get_attribute('open') is None:
        section.locator('summary').click()


def assert_no_horizontal_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile UI overflows horizontally'


def main():
    with serve_app() as url, sync_playwright() as p, TemporaryDirectory() as tmp:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1360, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        expect(page.locator('.plan-card')).to_have_count(1)
        expect(page.locator('#view-details')).to_be_visible()
        expect(page.locator('#view-service')).to_be_hidden()
        expect(page.locator('#view-preview')).to_be_hidden()
        expect(page.locator('#document')).to_be_hidden()
        assert page.locator('script[id^="template-"]').count() == 0
        assert page.locator('[data-edit="intro"]').count() == 0
        baseline = page.evaluate('collect()')
        network_after_load = []
        page.on('request', lambda request: network_after_load.append(request.url))

        # No business facts or optional examples are selected for a new customer.
        expect(page.locator('[name="business"]')).to_have_value('')
        expect(page.locator('[name="evidence"]')).to_have_value('')
        expect(page.locator('[name="actions"]')).to_have_value('')
        expect(page.locator('[name="region"]')).to_be_hidden()
        assert page.locator('[data-preset-field][aria-pressed="true"]').count() == 0
        page.locator('[data-go-view="service"]').click()
        expect(page.locator('#view-details')).to_be_visible()
        assert not page.locator('[name="business"]').evaluate('(input) => input.validity.valid')
        attempted_downloads = []
        page.on('download', lambda download: attempted_downloads.append(download.suggested_filename))
        page.evaluate('downloadCustomer()')
        assert not attempted_downloads, 'An empty business description must not generate a client report'

        page.locator('[name="client"]').fill('测试企业 <品牌> & 服务')
        page.locator('[name="business"]').fill('自动保存的业务资料')
        page.locator('[name="audience"]').fill('采购机械设备的制造企业与项目负责人')
        # Chips add/remove exact newline entries while preserving free text and substrings.
        custom_evidence = '测试资料：机械设备安装案例，内容需核实。'
        evidence = page.locator('[name="evidence"]')
        evidence.fill(custom_evidence)
        chip = page.locator('[data-preset-field="evidence"]').first
        preset = chip.get_attribute('data-preset-value')
        assert preset
        chip.click()
        expect(chip).to_have_attribute('aria-pressed', 'true')
        assert evidence.input_value().split('\n').count(preset) == 1
        assert custom_evidence in evidence.input_value()
        chip.click()
        expect(chip).to_have_attribute('aria-pressed', 'false')
        expect(evidence).to_have_value(custom_evidence)
        evidence.fill(custom_evidence + '\n' + preset)
        expect(chip).to_have_attribute('aria-pressed', 'true')
        chip.click()
        expect(evidence).to_have_value(custom_evidence)
        evidence.fill(custom_evidence + '（' + preset + '待确认）')
        expect(chip).to_have_attribute('aria-pressed', 'false')
        chip.click()
        assert evidence.input_value().split('\n').count(preset) == 1
        evidence.fill(custom_evidence)
        page.locator('[name="actions"]').fill('联系技术顾问，核实设备适配条件')
        page.locator('[name="concern"]').fill('让采购人员了解设备用途与适配条件')
        page.locator('.advanced-options > summary').click()
        page.locator('#copy-goals').fill('测试正文：<script>不会执行</script>\n第二行服务目标')
        # Navigate while the save debounce is still pending; changing views must not lose edits.
        page.locator('#step-service').click()
        expect(page.locator('#view-service')).to_be_visible()
        expect(page.locator('#view-details')).to_be_hidden()
        page.locator('[name="scope"]').fill('本次服务范围：首月诊断与内容计划。')
        page.locator('[data-optional-input="exceptions"] > summary').click()
        page.locator('[name="exceptions"]').fill('不展示未经客户确认的参数或价格')
        page.locator('#service-tab-schedule').click()
        expect(page.locator('#service-config')).to_be_hidden()
        expect(page.locator('#service-schedule')).to_be_visible()
        page.locator('#copy-w1').fill('首周核对产品资料并记录初始回答。')
        page.locator('#copy-d1').fill('资料清单与初始诊断。')
        page.locator('#service-tab-annual').click()
        expect(page.locator('#service-annual')).to_be_visible()
        open_copy_section(page, 'annual_stage2_work')
        page.locator('#copy-annual_stage2_work').fill('复核重点设备问题，补齐应用与选型资料。')
        page.locator('#copy-annual_stage2_output').fill('设备问题对照、补充资料和季度工作复盘。')
        open_copy_section(page, 'monthly_review')
        page.locator('#copy-monthly_review').fill('汇总本月可核实的咨询反馈，安排下月内容与复测。')
        page.locator('#step-preview').click()
        expect(page.locator('#document')).to_be_visible()
        expect(page.locator('#p1')).to_be_visible()
        expect(page.locator('#p2')).to_be_hidden()
        assert page.locator('#document .page:visible').count() == 1
        page.locator('[data-page="p2"]').click()
        expect(page.locator('#p2')).to_be_visible()
        expect(page.locator('[data-edit="w1"]')).to_have_text('工作：首周核对产品资料并记录初始回答。')
        expect(page.locator('[data-edit="d1"]')).to_have_text('交付：资料清单与初始诊断。')
        page.locator('#edit-preview-page').click()
        expect(page.locator('#view-service')).to_be_visible()
        expect(page.locator('#service-schedule')).to_be_visible()
        expect(page.locator('#copy-w1')).to_have_value('首周核对产品资料并记录初始回答。')
        await_saved(page)
        assert not network_after_load, network_after_load

        page.reload()
        expect(page.locator('[name="client"]')).to_have_value('测试企业 <品牌> & 服务')
        expect(page.locator('[name="business"]')).to_have_value('自动保存的业务资料')
        expect(page.locator('#copy-goals')).to_have_value('测试正文：<script>不会执行</script>\n第二行服务目标')
        page.locator('#step-service').click()
        page.locator('#service-tab-schedule').click()
        expect(page.locator('#copy-w1')).to_have_value('首周核对产品资料并记录初始回答。')
        page.locator('#service-tab-annual').click()
        open_copy_section(page, 'annual_stage2_work')
        expect(page.locator('#copy-annual_stage2_work')).to_have_value('复核重点设备问题，补齐应用与选型资料。')
        open_copy_section(page, 'monthly_review')
        expect(page.locator('#copy-monthly_review')).to_have_value('汇总本月可核实的咨询反馈，安排下月内容与复测。')
        page.locator('#step-details').click()
        expect(page.locator('[name="evidence"]')).to_have_value(custom_evidence)
        expect(page.locator('[name="actions"]')).to_have_value('联系技术顾问，核实设备适配条件')
        network_after_load.clear()

        # Version restore recovers both business data and structured paragraph edits.
        menu_action(page, '#save')
        page.locator('[name="business"]').fill('第二版业务资料')
        await_saved(page)
        menu_action(page, '#save')
        menu_action(page, '#show-history')
        rows = page.locator('.version-item')
        assert rows.count() >= 3
        rows.nth(1).get_by_role('button', name='查看').click()
        expect(page.locator('#version-summary')).to_contain_text('自动保存的业务资料')
        page.locator('#restore-version').click()
        expect(page.locator('[name="business"]')).to_have_value('自动保存的业务资料')
        expect(page.locator('#copy-goals')).to_have_value('测试正文：<script>不会执行</script>\n第二行服务目标')

        page.locator('#new-plan').click()
        page.locator('#new-name').fill('第二家测试企业')
        page.locator('#create-plan').click()
        expect(page.locator('#view-details')).to_be_visible()
        expect(page.locator('[name="business"]')).to_have_value('')
        expect(page.locator('[name="evidence"]')).to_have_value('')
        expect(page.locator('[name="actions"]')).to_have_value('')
        page.locator('[name="business"]').fill('面向企业采购的软件服务，提供工单管理与流程配置。')
        page.locator('[name="audience"]').fill('有内部流程协同需求的企业团队')
        menu_action(page, '#copy-plan')
        expect(page.locator('.plan-card')).to_have_count(3)
        assert '副本' in page.locator('[name="client"]').input_value()
        page.locator('.plan-card').filter(has_text='测试企业 <品牌> & 服务').click()
        expect(page.locator('[name="business"]')).to_have_value('自动保存的业务资料')

        # Preview hides other pages; client HTML must retain every annual and monthly section.
        page.locator('#step-preview').click()
        page.locator('[data-page="p3"]').click()
        assert page.locator('#document .page:visible').count() == 1
        with page.expect_download() as download:
            page.locator('#export').click()
        customer_path = Path(tmp) / 'customer.html'
        download.value.save_as(customer_path)
        customer = context.new_page()
        customer.set_content(customer_path.read_text())
        assert customer.locator('#document .page:visible').count() == 6
        assert customer.locator('script').count() == 0
        assert customer.locator('[data-app-ui]').count() == 0
        assert customer.locator('link[rel="stylesheet"]').count() == 0
        assert '测试企业 <品牌> & 服务' in customer.inner_text('body')
        assert '工作：首周核对产品资料并记录初始回答。' in customer.inner_text('body')
        assert customer.locator('#p1 .box .detail').inner_text() == '测试正文：<script>不会执行</script>\n第二行服务目标'
        assert '第二家测试企业' not in customer.inner_text('body')
        assert '内部审核提示' not in customer.inner_text('body')
        assert customer.locator('#plan-list').count() == 0
        assert '复核重点设备问题，补齐应用与选型资料。' in customer.locator('#p3').inner_text()
        assert '设备问题对照、补充资料和季度工作复盘。' in customer.locator('#p3').inner_text()
        assert '汇总本月可核实的咨询反馈，安排下月内容与复测。' in customer.locator('#p3').inner_text()
        for expected_heading in ['第2—3个月', '第4—6个月', '第7—9个月', '第10—12个月', '月度执行计划', '内容及发布台账', '监测与问题记录']:
            assert expected_heading in customer.locator('#p3').inner_text()
        assert custom_evidence in customer.locator('#p4').inner_text()
        assert '联系技术顾问，核实设备适配条件' in customer.locator('#p5').inner_text()
        assert '不展示未经客户确认的参数或价格' in customer.locator('#p6').inner_text()
        assert '<script>' not in customer.locator('#p4').inner_html()

        # Print from both preview and an editing step must reveal all six report pages.
        for editing in (False, True):
            if editing:
                page.locator('#step-details').click()
                expect(page.locator('#document')).to_be_hidden()
            page.emulate_media(media='print')
            assert page.locator('#document .page:visible').count() == 6
            assert not page.locator('.workbench').is_visible()
            assert not page.locator('.app-sidebar').is_visible()
            page.emulate_media(media='screen')
        expect(page.locator('#document')).to_be_hidden()

        # Backup/import is a secondary action, and import must merge instead of replace.
        page.locator('.backup-menu > summary').click()
        with page.expect_download() as download:
            page.locator('#backup-plans').click()
        backup = Path(tmp) / 'backup.json'
        download.value.save_as(backup)
        exported_data = json.loads(backup.read_text())
        first = next(plan for plan in exported_data['plans'] if plan['name'] == '测试企业 <品牌> & 服务')
        assert first['data']['fields']['evidence'] == custom_evidence
        assert first['data']['fields']['actions'] == '联系技术顾问，核实设备适配条件'
        assert first['data']['copy']['annual_stage2_work'] == '复核重点设备问题，补齐应用与选型资料。'
        page.locator('#import-plans').set_input_files(backup)
        expect(page.locator('.plan-card')).to_have_count(6)
        expect(page.locator('[name="business"]')).to_have_value('自动保存的业务资料')
        assert not network_after_load, network_after_load

        # A browser report saved with the original schema must load with all text intact.
        legacy_context = browser.new_context()
        old_fields = {key: value for key, value in baseline['fields'].items() if key not in ('evidence', 'actions', 'exceptions')}
        old_copy = {key: value for key, value in baseline['copy'].items() if not key.startswith(('annual_', 'monthly_'))}
        fixture = {
            'schema': 1, 'revision': 'legacy-revision', 'activeId': 'legacy-plan',
            'plans': [{
                'id': 'legacy-plan', 'name': '旧版测试客户', 'updatedAt': '2026-10-27T00:00:00.000Z',
                'data': {'fields': {**old_fields, 'client': '旧版测试客户', 'business': '旧版本机报告资料'},
                         'copy': {**old_copy, 'w1': '工作旧版自定义工作', 'goals': '旧版服务目标', 'w5': '工作：旧版每月自定义服务', 'd5': '交付：旧版每月交付'}},
                'versions': [{'id': 'legacy-version', 'at': '2026-10-27T00:00:00.000Z', 'label': '旧版手动保存',
                              'data': {'fields': old_fields, 'copy': old_copy}}]
            }]
        }
        legacy_context.add_init_script('localStorage.setItem(' + json.dumps(KEY) + ', ' + json.dumps(json.dumps(fixture, ensure_ascii=False)) + ');')
        legacy = legacy_context.new_page(); legacy.goto(url)
        expect(legacy.locator('[name="client"]')).to_have_value('旧版测试客户')
        expect(legacy.locator('[name="business"]')).to_have_value('旧版本机报告资料')
        expect(legacy.locator('#copy-goals')).to_have_value('旧版服务目标')
        expect(legacy.locator('[name="evidence"]')).to_have_value('')
        expect(legacy.locator('[name="actions"]')).to_have_value('')
        assert legacy.locator('[data-preset-field][aria-pressed="true"]').count() == 0
        stored = legacy.evaluate('JSON.parse(localStorage.getItem(' + json.dumps(KEY) + '))')
        assert stored['plans'][0]['data']['copy']['w1'] == '工作旧版自定义工作'
        assert any(version['id'] == 'legacy-version' for version in stored['plans'][0]['versions'])
        legacy.locator('#step-service').click()
        legacy.locator('#service-tab-schedule').click()
        expect(legacy.locator('#copy-w1')).to_have_value('旧版自定义工作')
        legacy.locator('#step-preview').click()
        legacy.locator('[data-page="p2"]').click()
        expect(legacy.locator('[data-edit="w1"]')).to_have_text('工作旧版自定义工作')
        legacy.locator('[data-page="p3"]').click()
        expect(legacy.locator('[data-edit="w5"]')).to_have_text('工作：旧版每月自定义服务')
        expect(legacy.locator('[data-edit="d5"]')).to_have_text('交付：旧版每月交付')
        legacy.locator('[data-page="p4"]').click()
        for focus_field in ('evidence', 'actions'):
            expect(legacy.locator('#p4 [data-focus="' + focus_field + '"]')).to_be_hidden()

        # On mobile, the library becomes an overlay; choosing a customer closes it.
        page.set_viewport_size({'width': 390, 'height': 844})
        assert_no_horizontal_overflow(page)
        expect(page.locator('#toggle-library')).to_be_visible()
        page.locator('#toggle-library').click()
        expect(page.locator('body')).to_have_class('view-details library-open')
        expect(page.locator('#plan-sidebar')).to_be_visible()
        page.locator('.plan-card[aria-current="true"]').click()
        assert 'library-open' not in page.locator('body').get_attribute('class')
        page.locator('#toggle-library').click()
        page.locator('.plan-card').filter(has=page.get_by_text('第二家测试企业', exact=True)).click()
        assert 'library-open' not in page.locator('body').get_attribute('class')
        expect(page.locator('[name="client"]')).to_have_value('第二家测试企业')
        page.locator('#step-preview').click()
        assert_no_horizontal_overflow(page)
        assert page.locator('#document .page:visible').count() == 1
        page.locator('#step-details').click()
        page.set_viewport_size({'width':1360,'height':1000})

        # Simultaneous tabs must not silently overwrite one another.
        other = context.new_page(); other.goto(url)
        other.locator('[name="business"]').fill('另一个标签的资料')
        await_saved(other)
        expect(page.locator('#storage-error')).to_contain_text('另一个标签页')
        page.locator('[name="business"]').fill('冲突标签的资料不得覆盖')
        page.wait_for_timeout(800)
        other.reload()
        expect(other.locator('[name="business"]')).to_have_value('另一个标签的资料')

        # A storage failure must remain visible and never claim a successful save.
        blocked = browser.new_context()
        blocked.add_init_script("Object.defineProperty(Storage.prototype, 'setItem', {value() {throw new Error('blocked')}})")
        blocked_page = blocked.new_page(); blocked_page.goto(url)
        blocked_page.locator('[name="client"]').fill('无法持久化的方案')
        expect(blocked_page.locator('#storage-error')).to_contain_text('保存失败')
        expect(blocked_page.locator('#persist-status')).to_contain_text('尚未保存')
        assert not errors, errors
        print('PASS: five business groups, required business validation, exact preset toggles, annual/monthly editing, three-step workflow, autosave/versions, independent plans, old-schema reports, six-page export/print, backup/import, no uploads, mobile library, multi-tab and storage protection')
        browser.close()


if __name__ == '__main__':
    main()
