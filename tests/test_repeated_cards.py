"""Verify repeated report cards across editing, legacy backups, and both A4 exports.

Run: python tests/test_repeated_cards.py
"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from test_json_import import open_import, saved_plan
from test_print_layout import check_layout, check_pdf, compact
from test_workspace import await_saved, open_copy_section, serve_app


OVERRIDES = ('p2_focus', 'p5_focus', 'p5_actions')
CONCERN = ('LEGACY_FOCUS_1 选型条件', 'LEGACY_FOCUS_2 首次安装')
ACTIONS = ('LEGACY_ACTION_1 预约产品咨询', 'LEGACY_ACTION_2 提交安装需求')
CUSTOM_SCHEDULE = ('CUSTOM_SCHEDULE_1 首月核对尺寸', 'CUSTOM_SCHEDULE_2 提交安装方案')
CUSTOM_FEEDBACK = ('CUSTOM_FEEDBACK_1 记录到货咨询', 'CUSTOM_FEEDBACK_2 核对安装反馈')
CUSTOM_ACTION = ('CUSTOM_ACTION_1 跟进初次预约',)


def import_legacy_backup(page):
    # This v1 backup predates the three override keys in current data and history.
    stamp = '2026-10-01T00:00:00.000Z'
    data = {
        'fields': {
            'client': '虚构安装设备测试',
            'business': '提供安装设备资料，说明尺寸与适配条件。',
            'concern': '\n'.join(CONCERN),
            'actions': '\n'.join(ACTIONS),
        },
        'copy': {'access': '原有的反馈说明应继续保存。'},
    }
    backup = {'schema': 1, 'revision': 'old-revision', 'activeId': 'old-plan', 'plans': [{
        'id': 'old-plan', 'name': '虚构安装设备测试', 'updatedAt': stamp, 'data': data,
        'versions': [{'id': 'old-version', 'at': stamp, 'label': '旧历史版本', 'data': data}],
    }]}
    page.locator('.backup-menu summary').click()
    page.locator('#import-plans').set_input_files({
        'name': 'legacy-backup.json',
        'mimeType': 'application/json',
        'buffer': json.dumps(backup, ensure_ascii=False).encode('utf-8'),
    })
    page.locator('.plan-card').filter(has_text='虚构安装设备测试').click()
    plan = saved_plan(page)
    assert all(key not in plan['data']['copy'] for key in OVERRIDES)
    old = next(version for version in plan['versions'] if version['id'] == 'old-version')
    assert old['data'] == data


def preview_page(page, section):
    page.locator('#step-preview').click()
    page.locator('[data-page="' + section + '"]').click()


def rendered_card(page, section, source, visible_lines):
    card = page.locator(f'#document #{section} [data-focus="{source}"]')
    block = card.locator('xpath=ancestor::*[@data-focus-block][1]')
    if visible_lines:
        expect(block).to_be_visible()
        expect(card.locator('.focus-chip')).to_have_text(list(visible_lines))
    else:
        expect(block).to_be_hidden()
        expect(card.locator('.focus-chip')).to_have_count(0)


def open_override_editor(page, key):
    page.locator('#step-service').click()
    page.locator('#service-tab-schedule' if key == 'p2_focus' else '#service-tab-content').click()
    open_copy_section(page, key)


def edit_override(page, key, value):
    open_override_editor(page, key)
    page.locator('#copy-' + key).fill('\n'.join(value))
    await_saved(page)


def check_fallback_and_editing(page):
    preview_page(page, 'p2')
    rendered_card(page, 'p2', 'concern', CONCERN)
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', CONCERN)
    rendered_card(page, 'p5', 'actions', ACTIONS)

    open_override_editor(page, 'p2_focus')
    expect(page.locator('#reuse-p2_focus')).to_be_checked()
    edit_override(page, 'p2_focus', CUSTOM_SCHEDULE)
    expect(page.locator('#reuse-p2_focus')).not_to_be_checked()
    edit_override(page, 'p5_focus', CUSTOM_FEEDBACK)
    edit_override(page, 'p5_actions', CUSTOM_ACTION)
    preview_page(page, 'p2')
    rendered_card(page, 'p2', 'concern', CUSTOM_SCHEDULE)
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', CUSTOM_FEEDBACK)
    rendered_card(page, 'p5', 'actions', CUSTOM_ACTION)

    # Clearing explicitly suppresses each card while the original texts stay available.
    edit_override(page, 'p2_focus', ())
    edit_override(page, 'p5_focus', ())
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', ())
    rendered_card(page, 'p5', 'actions', CUSTOM_ACTION)
    expect(page.locator('#p5-focus-cards')).to_be_visible()
    edit_override(page, 'p5_actions', ())
    await_saved(page)
    page.reload()
    preview_page(page, 'p2')
    rendered_card(page, 'p2', 'concern', ())
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', ())
    rendered_card(page, 'p5', 'actions', ())
    expect(page.locator('#p5-focus-cards')).to_be_hidden()
    assert page.locator('#p5-focus-cards').evaluate('(row) => row.getBoundingClientRect().height') == 0
    assert all(saved_plan(page)['data']['copy'][key] == '' for key in OVERRIDES)

    # Reusing the shared value removes only this override key and tracks later shared changes.
    open_override_editor(page, 'p5_focus')
    page.locator('#reuse-p5_focus').check()
    await_saved(page)
    assert 'p5_focus' not in saved_plan(page)['data']['copy']
    page.locator('#step-details').click()
    updated_concern = ('UPDATED_FOCUS_1 核对上门时段',)
    page.locator('[name="concern"]').fill('\n'.join(updated_concern))
    await_saved(page)
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', updated_concern)
    rendered_card(page, 'p5', 'actions', ())
    preview_page(page, 'p2')
    rendered_card(page, 'p2', 'concern', ())
    preview_page(page, 'p1')
    expect(page.locator('#p1 [data-focus="concern"] .focus-chip')).to_have_text(list(updated_concern))
    expect(page.locator('#p1 [data-focus="actions"] .focus-chip')).to_have_text(list(ACTIONS))
    preview_page(page, 'p4')
    rendered_card(page, 'p4', 'actions', ACTIONS)


def import_overrides(page):
    payload = {'copy': {
        'p2_focus': '\n'.join(CUSTOM_SCHEDULE),
        'p5_focus': '\n'.join(CUSTOM_FEEDBACK),
        'p5_actions': '',
    }}
    before = saved_plan(page)['data']
    open_import(page)
    page.locator('#json-import-text').fill(json.dumps(payload, ensure_ascii=False))
    page.locator('#json-import-apply').click()
    expect(page.locator('#json-import-dialog')).to_be_hidden()
    after = saved_plan(page)
    assert after['data']['fields'] == before['fields']
    assert after['versions'][0]['data'] == before
    assert all(after['data']['copy'][key] == value for key, value in payload['copy'].items())
    page.reload()
    preview_page(page, 'p2')
    rendered_card(page, 'p2', 'concern', CUSTOM_SCHEDULE)
    preview_page(page, 'p5')
    rendered_card(page, 'p5', 'concern', CUSTOM_FEEDBACK)
    rendered_card(page, 'p5', 'actions', ())


def check_pdf_copy(page, selector, output):
    page.emulate_media(media='print')
    layout = check_layout(page, selector, 6)
    page.pdf(path=output, prefer_css_page_size=True, print_background=False)
    text = compact(check_pdf(output, 6, layout))
    for line in (*CUSTOM_SCHEDULE, *CUSTOM_FEEDBACK, *ACTIONS, 'UPDATED_FOCUS_1'):
        expected_count = 2 if line in ACTIONS else 1
        assert text.count(compact(line)) == expected_count, line
    for absent in (*CONCERN, *CUSTOM_ACTION, '拟跟进的客户行动'):
        assert compact(absent) not in text, absent


def check_exports(page, directory):
    before = saved_plan(page)
    page.evaluate('window.prepareReportPrint()')
    check_pdf_copy(page, '#prepared-print', directory / 'workbench.pdf')
    page.emulate_media(media='screen')
    with page.expect_download() as event:
        page.locator('#export').click()
    path = directory / 'customer.html'
    event.value.save_as(path)
    customer = page.context.new_page()
    try:
        customer.set_content(path.read_text(encoding='utf-8'))
        expect(customer.locator('#copy-p2_focus')).to_have_count(0)
        customer.evaluate('window.dispatchEvent(new Event("beforeprint"))')
        check_pdf_copy(customer, '.report-print', directory / 'customer.pdf')
    finally:
        customer.close()
    assert saved_plan(page) == before


def main():
    with serve_app() as url, sync_playwright() as p, TemporaryDirectory() as tmp:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1360, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        import_legacy_backup(page)
        check_fallback_and_editing(page)
        import_overrides(page)
        check_exports(page, Path(tmp))
        assert not errors, errors
        browser.close()
    print('PASS: legacy repeated cards, page-specific overrides, hide and reuse, JSON, and both A4 exports')


if __name__ == '__main__':
    main()
