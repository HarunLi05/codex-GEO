"""Run with the app served at http://127.0.0.1:8765 (python -m http.server 8765)."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8765/'
with sync_playwright() as p, TemporaryDirectory() as tmp:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    assert page.locator('#new-template option').count() == 1
    assert page.locator('script[id^="template-"]').count() == 0
    network_after_load = []
    page.on('request', lambda request: network_after_load.append(request.url))
    assert page.locator('.plan-card').count() == 1
    assert page.locator('[data-edit="intro"]').count() == 0
    page.locator('[name="client"]').fill('测试企业 <品牌> & 服务')
    page.locator('[name="business"]').fill('自动保存的业务资料')
    page.locator('#edit-copy').click()
    page.locator('[data-edit="goals"]').fill('测试正文：<script>不会执行</script>')
    page.wait_for_timeout(900)
    assert '已保存' in page.locator('#persist-status').inner_text()
    assert network_after_load == [], network_after_load
    page.reload()
    assert page.locator('[name="client"]').input_value() == '测试企业 <品牌> & 服务'
    assert page.locator('[name="business"]').input_value() == '自动保存的业务资料'
    assert page.locator('[data-edit="goals"]').inner_text() == '测试正文：<script>不会执行</script>'
    network_after_load.clear()
    page.locator('#save').click()
    page.locator('[name="business"]').fill('第二版业务资料')
    page.wait_for_timeout(900)
    page.locator('#save').click()
    page.locator('#show-history').click()
    rows = page.locator('.version-item')
    assert rows.count() >= 3
    rows.nth(1).get_by_role('button', name='查看').click()
    assert '自动保存的业务资料' in page.locator('#version-summary').inner_text()
    page.locator('#restore-version').click()
    assert page.locator('[name="business"]').input_value() == '自动保存的业务资料'
    page.locator('#new-plan').click()
    page.locator('#new-name').fill('第二家测试企业')
    page.locator('#new-template').select_option('generic')
    page.locator('#create-plan').click()
    assert '主推' in page.locator('[name="business"]').input_value()
    assert page.locator('[data-edit="intro"]').count() == 0
    page.locator('#copy-plan').click()
    assert page.locator('.plan-card').count() == 3
    assert '副本' in page.locator('[name="client"]').input_value()
    page.get_by_role('button', name='测试企业 <品牌> & 服务', exact=False).click()
    assert page.locator('[name="business"]').input_value() == '自动保存的业务资料'
    with page.expect_download() as dl:
        page.locator('#export').click()
    customer_path = Path(tmp) / 'customer.html'
    dl.value.save_as(customer_path)
    customer = context.new_page()
    customer.set_content(customer_path.read_text())
    assert customer.locator('[data-app-ui]').count() == 0
    assert customer.locator('script').count() == 0
    assert customer.locator('.toolbar').count() == 0
    assert '测试企业 <品牌> & 服务' in customer.inner_text('body')
    assert '内部审核提示' not in customer.inner_text('body')
    with page.expect_download() as dl:
        page.locator('#backup-plans').click()
    backup = Path(tmp) / 'backup.json'
    dl.value.save_as(backup)
    page.locator('#import-plans').set_input_files(backup)
    page.wait_for_timeout(400)
    assert page.locator('.plan-card').count() == 6
    # Import merges; it never replaces existing customers.
    assert page.locator('[name="business"]').input_value() == '自动保存的业务资料'
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.set_viewport_size({'width':1280,'height':900})
    assert network_after_load == [], network_after_load
    page.emulate_media(media='print')
    assert not page.locator('.app-shell').is_visible()
    assert not page.locator('.toolbar').is_visible()
    page.emulate_media(media='screen')
    other = context.new_page(); other.goto(URL)
    other.locator('[name="business"]').fill('另一个标签的资料')
    other.wait_for_timeout(900)
    assert '另一个标签页' in page.locator('#storage-error').inner_text()
    page.locator('[name="business"]').fill('冲突标签的资料不得覆盖')
    page.wait_for_timeout(900)
    assert other.locator('[name="business"]').input_value() == '另一个标签的资料'
    other.reload()
    assert other.locator('[name="business"]').input_value() == '另一个标签的资料'
    # A blocked browser database must report failure, without claiming a successful save.
    blocked = browser.new_context()
    blocked.add_init_script("Object.defineProperty(Storage.prototype, 'setItem', {value() {throw new Error('blocked')}})")
    blocked_page = blocked.new_page(); blocked_page.goto(URL)
    blocked_page.locator('[name="client"]').fill('无法持久化的方案')
    blocked_page.wait_for_timeout(900)
    assert '保存失败' in blocked_page.locator('#storage-error').inner_text()
    assert '尚未保存' in blocked_page.locator('#persist-status').inner_text()
    assert not errors, errors
    print('PASS: autosave, reload, version restore, isolated plans, generic template, no report upload, copy, customer export, backup/import, mobile, print, multi-tab conflict, storage failure')
    browser.close()
