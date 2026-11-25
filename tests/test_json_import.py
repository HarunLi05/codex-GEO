"""Exercise the assistant-to-workbench JSON import without calling a model.

Run: python tests/test_json_import.py
"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from test_assistant import connect, create_page, fill_inputs, generate, select_section
from test_workspace import KEY, await_saved, menu_action, open_copy_section, serve_app


def assistant_exports(browser, url, directory):
    context, page, worker = create_page(browser, url)
    fill_inputs(page)
    connect(page)
    generate(page, 'profile')
    config = page.locator('#config-export')
    config.locator('summary').click()
    expect(page.locator('#config-status')).to_contain_text('1 / 4')
    edited_goal = '审核后的测试目标：让采购人员了解包装设备的真实适配条件。'
    page.locator('[data-result-field="copy.goals"]').fill(edited_goal)
    page.locator('#copy-config').click()
    partial = page.evaluate('window.__copied.at(-1)')
    assert json.loads(partial)['copy']['goals'] == edited_goal

    generate(page)
    expect(page.locator('#config-status')).to_contain_text('4 / 4')
    select_section(page, 'schedule')
    page.locator('[data-result-field="copy.w1"]').fill('工作安排以实际沟通为准。')
    with page.expect_download() as event:
        page.locator('#download-config').click()
    full = Path(directory) / event.value.suggested_filename
    event.value.save_as(full)
    complete = json.loads(full.read_text(encoding='utf-8'))
    assert len(complete['fields']) == 19 and len(complete['copy']) == 46
    assert len(worker.generations) == 5
    assert not page.test_errors, page.test_errors
    context.close()
    return partial, full, complete


def saved_library(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)


def saved_plan(page):
    library = saved_library(page)
    return next(plan for plan in library['plans'] if plan['id'] == library['activeId'])


def open_import(page):
    page.locator('#open-json-import').click()
    expect(page.locator('#json-import-dialog')).to_be_visible()


def check_rejected_inputs(page):
    before = saved_library(page)
    open_import(page)
    source = page.locator('#json-import-text')
    error = page.locator('#json-import-error')
    for bad in ('{', '[{"fields":{"client":"无效根类型"}}]',
                '{"fields":{"client":17}}', '{"fields":{"notAPlanField":"无效字段"}}',
                '{"fields":{"date":"2026-02-30"}}'):
        source.fill(bad)
        apply = page.locator('#json-import-apply')
        if apply.is_enabled():
            apply.click()
        expect(error).to_be_visible()
        assert error.inner_text().strip()
        assert saved_library(page) == before, 'A rejected JSON changed the saved library'
    source.fill('{"fields":{"client":"已取消，不应写入"}}')
    page.locator('#close-json-import').click()
    expect(page.locator('#json-import-dialog')).to_be_hidden()
    assert saved_library(page) == before


def check_current_plan(page, partial_json):
    page.locator('[name="client"]').fill('导入前测试客户')
    page.locator('[name="business"]').fill('原有业务')
    page.locator('[name="audience"]').fill('导入前原有受众')
    page.locator('#step-service').click()
    page.locator('[name="fee"]').fill('原有报价：6000元')
    page.locator('#service-tab-schedule').click()
    open_copy_section(page, 'w1')
    page.locator('#copy-w1').fill('原有首周排期')
    page.locator('#step-details').click()
    await_saved(page)
    before = saved_plan(page)

    open_import(page)
    expect(page.locator('#json-import-target')).to_contain_text('导入前测试客户')
    page.locator('#json-import-text').fill(partial_json)
    expect(page.locator('#json-import-apply')).to_be_enabled()
    # Keep the last edit inside its debounce window when applying the import.
    page.evaluate('''() => {
        const business = document.querySelector('[name="business"]');
        business.value = '还未自动保存的原有业务';
        business.dispatchEvent(new Event('input', {bubbles: true}));
        document.querySelector('#json-import-apply').click();
    }''')
    expect(page.locator('#json-import-dialog')).to_be_hidden()
    await_saved(page)
    partial = json.loads(partial_json)
    after = saved_plan(page)
    assert after['id'] == before['id']
    assert len(saved_library(page)['plans']) == 1
    previous_data = before['data']
    previous_data['fields']['business'] = '还未自动保存的原有业务'
    assert after['data']['fields'] == {**previous_data['fields'], **partial['fields']}
    assert after['data']['copy'] == {**previous_data['copy'], **partial['copy']}
    backups = [version for version in after['versions'] if version['label'] == '导入前留存']
    assert len(backups) == 1 and backups[0]['data'] == previous_data

    page.reload()
    expect(page.locator('[name="client"]')).to_have_value(partial['fields']['client'])
    expect(page.locator('#copy-goals')).to_have_value(partial['copy']['goals'])
    expect(page.locator('[name="fee"]')).to_have_value('原有报价：6000元')
    expect(page.locator('#copy-w1')).to_have_value('原有首周排期')
    menu_action(page, '#show-history')
    history = page.locator('.version-item').filter(has_text='导入前留存')
    expect(history).to_have_count(1)
    history.get_by_role('button', name='查看').click()
    expect(page.locator('#version-summary')).to_contain_text('还未自动保存的原有业务')
    page.locator('#restore-version').click()
    expect(page.locator('[name="client"]')).to_have_value('导入前测试客户')
    expect(page.locator('[name="business"]')).to_have_value('还未自动保存的原有业务')
    assert saved_plan(page)['data'] == previous_data


def check_create_from_file(page, full_path, complete):
    before = saved_plan(page)
    open_import(page)
    page.locator('#json-import-file').set_input_files(full_path)
    source = page.locator('#json-import-text')
    expect(source).to_have_value(full_path.read_text(encoding='utf-8'))
    expect(page.locator('#json-import-create')).to_be_enabled()
    page.locator('#json-import-create').click()
    expect(page.locator('#json-import-dialog')).to_be_hidden()
    await_saved(page)
    library = saved_library(page)
    assert len(library['plans']) == 2
    old = next(plan for plan in library['plans'] if plan['id'] == before['id'])
    assert old['name'] == before['name'] and old['data'] == before['data']
    new = saved_plan(page)
    assert new['id'] != before['id']
    assert new['name'] == complete['fields']['client']
    assert new['versions'][0]['data'] == new['data']

    # The editor and the browser's saved copy must agree after a fresh load.
    page.reload()
    for field, value in complete['fields'].items():
        expect(page.locator('[name="' + field + '"]')).to_have_value(value)
    for field, value in complete['copy'].items():
        expect(page.locator('#copy-' + field)).to_have_value(value)


def check_empty_value_and_storage_failure(page):
    old = saved_plan(page)
    open_import(page)
    page.locator('#json-import-text').fill('{"fields":{"client":"","business":"<b>保持纯文本</b>"}}')
    page.locator('#json-import-apply').click()
    await_saved(page)
    expect(page.locator('[name="client"]')).to_have_value('')
    expect(page.locator('[name="business"]')).to_have_value('<b>保持纯文本</b>')
    expect(page.locator('[data-bind="business"]').first).to_have_text('<b>保持纯文本</b>')
    assert saved_plan(page)['data']['fields']['provider'] == old['data']['fields']['provider']

    current = saved_library(page)
    page.evaluate('''() => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (value.includes('测试故意阻止本次导入写入')) throw new Error('blocked');
            return write.call(this, key, value);
        };
    }''')
    open_import(page)
    page.locator('#json-import-text').fill('{"fields":{"business":"测试故意阻止本次导入写入"}}')
    page.locator('#json-import-apply').click()
    expect(page.locator('#json-import-dialog')).to_be_visible()
    expect(page.locator('#json-import-error')).to_be_visible()
    assert saved_library(page) == current
    page.locator('#close-json-import').click()
    expect(page.locator('[name="business"]')).to_have_value('<b>保持纯文本</b>')

    open_import(page)
    page.locator('#json-import-text').fill('{"fields":{"business":"重试成功的业务资料"}}')
    page.locator('#json-import-apply').click()
    expect(page.locator('#json-import-dialog')).to_be_hidden()
    await_saved(page)
    recovered = saved_plan(page)
    assert recovered['data']['fields']['business'] == '重试成功的业务资料'
    assert recovered['versions'][0]['data']['fields']['business'] == '<b>保持纯文本</b>'


def main():
    with serve_app() as url, sync_playwright() as playwright, TemporaryDirectory() as directory:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        partial, full_path, complete = assistant_exports(browser, url, directory)
        page = browser.new_page(viewport={'width': 1360, 'height': 1000})
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        page.on('request', lambda request: requests.append(request.url))
        check_rejected_inputs(page)
        check_current_plan(page, partial)
        check_create_from_file(page, full_path, complete)
        check_empty_value_and_storage_failure(page)
        assert all(request.startswith(url) for request in requests), requests

        page.set_viewport_size({'width': 390, 'height': 844})
        open_import(page)
        assert page.locator('#json-import-dialog').evaluate(
            '(dialog) => dialog.getBoundingClientRect().right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth'
        ), 'Import dialog overflows the mobile viewport'
        page.keyboard.press('Escape')
        expect(page.locator('#json-import-dialog')).to_be_hidden()
        expect(page.locator('#open-json-import')).to_be_focused()
        assert not errors, errors
        browser.close()
    print('PASS: assistant JSON paste/upload, 65 fields, partial merge and restore, empty values, invalid input, storage rollback, and mobile dialog')


if __name__ == '__main__':
    main()
