"""Remembered connection browser tests. All endpoints and passcodes are fictional.

Run: python tests/test_remember_connection.py
"""
import json
import re
from urllib.parse import urlparse

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright

from test_assistant import (ENDPOINT_KEY, REPORT_KEY, REPORT_SENTINEL, SERVICE, TOKEN,
                            MockWorker, create_page, fill_inputs, generate,
                            open_settings, storage_snapshot)
from test_workspace import serve_app


CONNECTION_KEY = 'yizhantui.geo.assistant.connection.v1'
SECOND_SERVICE = 'https://second-geo-assistant.invalid'
SECOND_TOKEN = 'another-test-only-passcode-not-a-real-secret'
NEW_HOST_TOKEN = 'new-host-test-passcode-not-a-real-secret'


class ConnectionWorker(MockWorker):
    def __init__(self):
        super().__init__()
        self.config_mode = 'success'
        self.config_pending = []
        self.expected_tokens = {SERVICE: TOKEN, SECOND_SERVICE: NEW_HOST_TOKEN}

    @property
    def checks(self):
        return [request for request in self.requests if request['path'] == '/config']

    def config(self):
        return {'planVersion': 2, 'providers': [
            {'id': provider, 'label': provider, 'configured': configured,
             'model': 'deepseek-chat' if provider == 'deepseek' else 'gemini-flash-latest'}
            for provider, configured in self.available.items()
        ], 'limits': {'companyInfo': 12000, 'promotionDirection': 4000, 'constraints': 2000}}

    def handle(self, route):
        request = route.request
        parsed = urlparse(request.url)
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                          'Access-Control-Allow-Headers': 'Authorization, Content-Type'})
            return
        if parsed.path != '/config':
            return super().handle(route)
        origin = parsed.scheme + '://' + parsed.netloc
        self.requests.append({'path': '/config', 'url': request.url, 'method': request.method,
                              'authorization': request.headers.get('authorization'), 'body': None})
        assert request.method == 'GET'
        assert origin in self.expected_tokens, 'A saved passcode was sent to an unexpected host'
        assert request.headers.get('authorization') == 'Bearer ' + self.expected_tokens[origin]
        if self.config_mode == 'hold':
            self.config_pending.append(route)
        elif self.config_mode == 'network':
            route.abort('failed')
        elif self.config_mode == 'unauthorized':
            self.fulfill(route, {'error': {'code': 'UNAUTHORIZED', 'message': 'fictional access failure'}}, 401)
        else:
            self.fulfill(route, self.config())


def create_connection_page(browser, url):
    context, page, _ = create_page(browser, url)
    context.unroute('https://**/*')
    worker = ConnectionWorker()
    context.route('https://**/*', worker.handle)
    return context, page, worker


def saved_pair(endpoint=SERVICE, token=TOKEN):
    return {'version': 1, 'endpoint': endpoint, 'token': token}


def assert_storage(page, endpoint=SERVICE, pair=None):
    snapshot = storage_snapshot(page)
    expected = {REPORT_KEY: REPORT_SENTINEL}
    if endpoint is not None:
        expected[ENDPOINT_KEY] = endpoint
    if pair is not None:
        assert CONNECTION_KEY in snapshot['local'], snapshot
        assert json.loads(snapshot['local'][CONNECTION_KEY]) == pair, snapshot
        expected[CONNECTION_KEY] = snapshot['local'][CONNECTION_KEY]
    assert snapshot['local'] == expected, snapshot
    assert snapshot['session'] == {}, snapshot
    assert snapshot['reportAccesses'] == [], 'Remembering a connection must never read or alter report storage'


def seed_pair(page, pair, endpoint=SERVICE, raw=False):
    page.evaluate('([key, pair, endpointKey, endpoint]) => {'
                  ' localStorage.setItem(key, pair); localStorage.setItem(endpointKey, endpoint); }',
                  [CONNECTION_KEY, pair if raw else json.dumps(pair), ENDPOINT_KEY, endpoint])


def begin_connection(page, endpoint=SERVICE, token=TOKEN, remember=None):
    open_settings(page)
    page.locator('#service-url').fill(endpoint)
    page.locator('#service-passcode').fill(token)
    if remember is not None:
        page.locator('#remember-connection').set_checked(remember)
    page.locator('#connect-service').click()


def expect_connected(page):
    expect(page.locator('#connection-status')).to_contain_text('已连接')
    expect(page.locator('#connect-service')).to_be_enabled()


def await_config(page, worker):
    for _ in range(100):
        if worker.config_pending:
            return worker.config_pending.pop(0)
        page.wait_for_timeout(20)
    raise AssertionError('Expected a held configuration request')


def assert_no_page_errors(page):
    assert page.test_errors == [], page.test_errors


def check_explicit_opt_in_and_reload(browser, url):
    context, page, worker = create_connection_page(browser, url)
    expect(page.locator('#remember-connection')).not_to_be_checked()
    assert worker.checks == [] and worker.generations == []
    assert_storage(page, endpoint=None)
    worker.config_mode = 'hold'
    begin_connection(page, remember=True)
    held = await_config(page, worker)
    assert_storage(page, endpoint=None)  # Merely checking the box is not a verified connection.
    worker.fulfill(held, worker.config())
    expect_connected(page)
    assert_storage(page, pair=saved_pair())
    assert len(worker.checks) == 1 and worker.generations == []

    # A remembered refresh checks only configuration and must not restore business material.
    fill_inputs(page)
    generate(page, 'profile')
    expect(page.locator('[data-result-field]')).to_have_count(9)
    assert_storage(page, pair=saved_pair())
    worker.config_mode = 'success'
    previous_checks, previous_generations = len(worker.checks), len(worker.generations)
    page.reload()
    expect_connected(page)
    expect(page.locator('#remember-connection')).to_be_checked()
    assert len(worker.checks) == previous_checks + 1
    assert len(worker.generations) == previous_generations
    for selector in ('#company-info', '#promotion-direction', '#generation-constraints',
                     '#fact-duration-months', '#fact-platforms', '#fact-scope', '#fact-fee', '#fact-resources'):
        expect(page.locator(selector)).to_have_value('')
    expect(page.locator('[data-result-field]')).to_have_count(0)
    assert_storage(page, pair=saved_pair())

    # Unchecking forgets the credential immediately while keeping this verified session usable.
    open_settings(page)
    page.locator('#remember-connection').uncheck()
    assert_storage(page)
    expect_connected(page)
    fill_inputs(page)
    generate(page, 'profile')
    expect(page.locator('[data-result-field]')).to_have_count(9)
    checks_before_reload = len(worker.checks)
    page.reload()
    expect(page.locator('#connection-status')).to_contain_text('尚未连接')
    expect(page.locator('#service-passcode')).to_have_value('')
    expect(page.locator('#remember-connection')).not_to_be_checked()
    assert len(worker.checks) == checks_before_reload
    assert_storage(page)
    assert_no_page_errors(page)
    context.close()


def check_remember_after_connection_and_disconnect(browser, url):
    context, page, worker = create_connection_page(browser, url)
    begin_connection(page, remember=False)
    expect_connected(page)
    assert_storage(page)
    open_settings(page)
    page.locator('#remember-connection').check()
    assert_storage(page, pair=saved_pair())
    assert len(worker.checks) == 1, 'Remembering an already verified connection need not send a second check'
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Remembered connection controls overflow on mobile'
    page.locator('#disconnect-service').click()
    expect(page.locator('#service-passcode')).to_have_value('')
    expect(page.locator('#remember-connection')).not_to_be_checked()
    expect(page.locator('#service-url')).to_have_value(SERVICE)
    assert_storage(page)
    count = len(worker.checks)
    page.reload()
    expect(page.locator('#connection-status')).to_contain_text('尚未连接')
    assert len(worker.checks) == count
    assert_no_page_errors(page)
    context.close()


def check_authorization_and_network_failure(browser, url):
    context, page, worker = create_connection_page(browser, url)
    seed_pair(page, saved_pair())
    worker.config_mode = 'unauthorized'
    page.reload()
    expect(page.locator('#assistant-error')).to_contain_text('口令')
    expect(page.locator('#service-passcode')).to_have_value('')
    expect(page.locator('#service-url')).to_have_value(SERVICE)
    expect(page.locator('#remember-connection')).not_to_be_checked()
    assert len(worker.checks) == 1 and worker.generations == []
    assert_storage(page)
    page.wait_for_timeout(150)
    assert len(worker.checks) == 1, 'An unauthorized stored credential must not be retried in a loop'
    worker.config_mode = 'success'
    begin_connection(page, remember=True)
    expect_connected(page)
    assert_storage(page, pair=saved_pair())

    worker.config_mode = 'network'
    before = len(worker.checks)
    page.reload()
    expect(page.locator('#assistant-error')).to_contain_text('无法连接')
    expect(page.locator('#connect-service')).to_be_enabled()
    assert len(worker.checks) == before + 1
    expect(page.locator('#remember-connection')).to_be_checked()
    assert_storage(page, pair=saved_pair())
    page.wait_for_timeout(150)
    assert len(worker.checks) == before + 1, 'Network failure must await a deliberate retry'
    worker.config_mode = 'success'
    open_settings(page)
    page.locator('#connect-service').click()
    expect_connected(page)
    assert len(worker.checks) == before + 2
    assert_storage(page, pair=saved_pair())
    assert_no_page_errors(page)
    context.close()


def check_changed_connection_cannot_reuse_old_secret(browser, url):
    context, page, worker = create_connection_page(browser, url)
    begin_connection(page, remember=True)
    expect_connected(page)
    open_settings(page)
    page.locator('#service-passcode').fill(SECOND_TOKEN)
    assert_storage(page)
    worker.expected_tokens[SERVICE] = SECOND_TOKEN
    page.locator('#connect-service').click()
    expect_connected(page)
    assert_storage(page, pair=saved_pair(token=SECOND_TOKEN))

    open_settings(page)
    previous_checks = len(worker.checks)
    page.locator('#service-url').fill(SECOND_SERVICE)
    expect(page.locator('#service-passcode')).to_have_value('')
    assert_storage(page)
    page.locator('#connect-service').click()
    expect(page.locator('#assistant-error')).to_contain_text('口令')
    assert len(worker.checks) == previous_checks
    # Only a freshly supplied credential may be sent to the new host.
    page.locator('#service-passcode').fill(NEW_HOST_TOKEN)
    page.locator('#connect-service').click()
    expect_connected(page)
    assert worker.checks[-1]['url'] == SECOND_SERVICE + '/config'
    assert_storage(page, endpoint=SECOND_SERVICE, pair=saved_pair(SECOND_SERVICE, NEW_HOST_TOKEN))
    assert_no_page_errors(page)
    context.close()


def check_forget_during_automatic_connection(browser, url):
    context, page, worker = create_connection_page(browser, url)
    seed_pair(page, saved_pair())
    worker.config_mode = 'hold'
    page.reload()
    held = await_config(page, worker)
    open_settings(page)
    expect(page.locator('#forget-connection')).to_be_enabled()
    page.locator('#forget-connection').click()
    expect(page.locator('#service-url')).to_have_value('')
    expect(page.locator('#service-passcode')).to_have_value('')
    expect(page.locator('#remember-connection')).not_to_be_checked()
    expect(page.locator('#connect-service')).to_be_enabled()
    assert_storage(page, endpoint=None)
    try:
        worker.fulfill(held, worker.config())
    except PlaywrightError:
        pass  # The browser may already have discarded the canceled request.
    page.wait_for_timeout(100)
    assert_storage(page, endpoint=None)
    expect(page.locator('#service-url')).to_have_value('')
    assert '已连接' not in page.locator('#connection-status').inner_text()
    count = len(worker.checks)
    worker.config_mode = 'success'
    page.reload()
    assert len(worker.checks) == count
    assert_storage(page, endpoint=None)
    assert_no_page_errors(page)
    context.close()


def check_invalid_saved_pairs(browser, url):
    invalid = [
        ('not-json', True), (None, False), ([], False), ('wrong-type', False),
        ({**saved_pair(), 'version': 2}, False), ({**saved_pair(), 'version': '1'}, False),
        ({**saved_pair(), 'endpoint': None}, False), ({**saved_pair(), 'token': None}, False),
        ({**saved_pair(), 'token': 42}, False), ({**saved_pair(), 'token': {}}, False),
        ({**saved_pair(), 'token': ''}, False),
        ({**saved_pair(), 'token': 'short'}, False),
        ({**saved_pair(), 'token': 't' * 4097}, False),
        ({**saved_pair(), 'token': TOKEN + '\nextra'}, False),
        ({**saved_pair(), 'endpoint': 'http://insecure.invalid'}, False),
        ({**saved_pair(), 'endpoint': 'https://account:password@geo-assistant.invalid'}, False),
        ({**saved_pair(), 'endpoint': SERVICE + '?token=bad'}, False),
        ({**saved_pair(), 'endpoint': SERVICE + '#bad'}, False),
    ]
    context, page, worker = create_connection_page(browser, url)
    for pair, raw in invalid:
        seed_pair(page, pair, raw=raw)
        previous_checks = len(worker.checks)
        page.reload()
        expect(page.locator('#service-passcode')).to_have_value('')
        expect(page.locator('#remember-connection')).not_to_be_checked()
        assert len(worker.checks) == previous_checks, 'Malformed saved data triggered a request: ' + repr(pair)
        assert worker.generations == []
        assert_storage(page)
    seed_pair(page, saved_pair(), endpoint=SECOND_SERVICE)
    previous_checks = len(worker.checks)
    page.reload()
    expect(page.locator('#service-passcode')).to_have_value('')
    assert len(worker.checks) == previous_checks, 'A mismatched stored endpoint must not receive a remembered secret'
    assert_storage(page, endpoint=SECOND_SERVICE)
    assert_no_page_errors(page)
    context.close()


def check_storage_failure(browser, url):
    context, page, worker = create_connection_page(browser, url)
    page.evaluate('key => {const original = Storage.prototype.setItem; '
                  'Storage.prototype.setItem = function(name, value) {'
                  'if(this === localStorage && name === key) throw new DOMException("test failure", "QuotaExceededError");'
                  'return Reflect.apply(original, this, [name, value]); };}', CONNECTION_KEY)
    begin_connection(page, remember=True)
    expect_connected(page)
    assert_storage(page)
    expect(page.locator('#remember-connection')).not_to_be_checked()
    notices = '\n'.join(page.locator('#remember-status, #settings-status, #assistant-error').all_text_contents())
    assert re.search('无法(?:在.*)?保存|保存失败|未能保存|不能保存|未保存|记住失败', notices), notices
    assert not re.search('已保存|已记住', notices), notices
    # The connection is still usable, and a refresh cannot silently restore the failed save.
    fill_inputs(page)
    generate(page, 'profile')
    expect(page.locator('[data-result-field]')).to_have_count(9)
    before = len(worker.checks)
    page.reload()
    expect(page.locator('#connection-status')).to_contain_text('尚未连接')
    assert len(worker.checks) == before
    assert_storage(page)
    assert_no_page_errors(page)
    context.close()


def main():
    with serve_app() as url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        check_explicit_opt_in_and_reload(browser, url)
        check_remember_after_connection_and_disconnect(browser, url)
        check_authorization_and_network_failure(browser, url)
        check_changed_connection_cannot_reuse_old_secret(browser, url)
        check_forget_during_automatic_connection(browser, url)
        check_invalid_saved_pairs(browser, url)
        check_storage_failure(browser, url)
        browser.close()
    print('PASS: remembered connection opt-in, reload/config-only, authentication and network failures, '
          'credential changes, forgetting/cancellation, corrupt storage and report privacy')


if __name__ == '__main__':
    main()
