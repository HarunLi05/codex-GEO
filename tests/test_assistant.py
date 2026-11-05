"""Browser checks with a mocked Worker; no model account or API key is used.

Run: python tests/test_assistant.py
"""
from copy import deepcopy
import json
from urllib.parse import urlparse

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright

from test_workspace import KEY as REPORT_KEY, serve_app


SERVICE = 'https://assistant-test.workers.dev'
TOKEN = 'test-only-service-passcode-not-a-real-secret'
ENDPOINT_KEY = 'yizhantui.geo.assistant.endpoint.v1'
REPORT_SENTINEL = '{"private-test-report":"must remain untouched"}'
FIELDS = ('clientName', 'business', 'targetAudience', 'region', 'concern',
          'evidence', 'actions', 'goal', 'questions', 'exceptions')
INPUTS = {
    'companyInfo': '测试衡远设备，生产包装设备，服务华东企业客户。已提供设备参数表。',
    'promotionDirection': '推广自动封箱机，帮助采购人员核实适配条件并预约技术咨询。',
    'constraints': '不编造认证和产能，不保证询盘或成交。',
}


def result_for(name='测试衡远设备'):
    return {
        'clientName': name,
        'business': name + '生产包装设备，重点推广自动封箱机并完善设备参数说明。',
        'targetAudience': '华东制造企业的包装生产与设备采购负责人。',
        'region': '华东地区。',
        'concern': '帮助采购人员核实封箱机适用箱型及选型条件。',
        'evidence': '以客户提供的设备参数表为依据，认证与产能资料尚未提供，需核实。',
        'actions': '通过企业现有渠道预约技术咨询。',
        'goal': '完善设备选型资料，支持客户了解产品并提出真实采购需求。',
        'questions': [
            name + '主要提供哪些包装设备？',
            '采购方如何核实' + name + '的设备参数资料？',
            name + '的自动封箱机与半自动封箱机应如何按箱型选型？',
            '向' + name + '采购封箱机前应确认哪些交付条件？',
            name + '的封箱机安装与售后支持应如何咨询？',
        ],
        'exceptions': '参数、适用箱型与交付条件须由客户核实，未经确认不公开认证或产能表述。',
    }


class MockWorker:
    def __init__(self):
        self.requests = []
        self.pending = []
        self.available = {'deepseek': True, 'gemini': True}
        self.mode = 'success'
        self.result = result_for()
        self.failure = (429, 'MODEL_LIMIT')

    def response(self, provider, result=None):
        return {'result': deepcopy(self.result if result is None else result),
                'provider': provider,
                'model': 'deepseek-chat' if provider == 'deepseek' else 'gemini-flash-latest'}

    def fulfill(self, route, payload, status=200):
        route.fulfill(status=status, content_type='application/json',
                      headers={'Access-Control-Allow-Origin': '*'},
                      body=json.dumps(payload, ensure_ascii=False))

    def handle(self, route):
        request = route.request
        assert request.url.startswith(SERVICE + '/'), 'Unexpected external request: ' + request.url
        path = urlparse(request.url).path
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            })
            return
        body = request.post_data_json if request.method == 'POST' else None
        self.requests.append({'path': path, 'method': request.method,
                              'authorization': request.headers.get('authorization'), 'body': body})
        assert request.headers.get('authorization') == 'Bearer ' + TOKEN
        if path == '/config':
            assert request.method == 'GET'
            self.fulfill(route, {'providers': [
                {'id': provider, 'label': provider, 'configured': configured,
                 'model': 'deepseek-chat' if provider == 'deepseek' else 'gemini-flash-latest'}
                for provider, configured in self.available.items()
            ], 'limits': {'companyInfo': 12000, 'promotionDirection': 4000, 'constraints': 2000}})
            return
        assert path == '/generate' and request.method == 'POST'
        assert set(body) == {'provider', 'companyInfo', 'promotionDirection', 'constraints'}
        if self.mode == 'hold':
            self.pending.append((route, body['provider']))
        elif self.mode == 'network':
            route.abort('failed')
        elif self.mode == 'error':
            status, code = self.failure
            self.fulfill(route, {'error': {'code': code, 'message': '<script>untrusted upstream detail</script>'}}, status)
        elif self.mode == 'invalid_json':
            route.fulfill(status=200, content_type='text/plain', body='not valid json')
        elif self.mode == 'provider_mismatch':
            other = 'gemini' if body['provider'] == 'deepseek' else 'deepseek'
            self.fulfill(route, self.response(other))
        else:
            self.fulfill(route, self.response(body['provider']))


def storage_snapshot(page):
    # Object.entries avoids calling the report-key accessor audited below.
    return page.evaluate('({local: Object.fromEntries(Object.entries(localStorage)), '
                         'session: Object.fromEntries(Object.entries(sessionStorage)), '
                         'reportAccesses: window.__reportAccesses})')


def assert_private_storage(page, connected=True):
    snapshot = storage_snapshot(page)
    expected = {REPORT_KEY: REPORT_SENTINEL}
    if connected:
        expected[ENDPOINT_KEY] = SERVICE
    assert snapshot['local'] == expected, snapshot
    assert snapshot['session'] == {}, snapshot
    assert snapshot['reportAccesses'] == [], 'Assistant accessed the existing report library'


def open_settings(page):
    if page.locator('#service-settings').get_attribute('open') is None:
        page.locator('#open-settings').click()


def connect(page):
    open_settings(page)
    page.locator('#service-url').fill(SERVICE + '/')
    page.locator('#service-passcode').fill(TOKEN)
    page.locator('#connect-service').click()
    expect(page.locator('#connection-status')).to_contain_text('已连接')
    expect(page.locator('#connect-service')).to_be_enabled()


def fill_inputs(page):
    page.locator('#company-info').fill(INPUTS['companyInfo'])
    page.locator('#promotion-direction').fill(INPUTS['promotionDirection'])
    page.locator('.optional-input > summary').click()
    page.locator('#generation-constraints').fill(INPUTS['constraints'])


def generate(page):
    page.locator('#generate-content').click()


def expect_result(page, result):
    expect(page.locator('[data-result-field]')).to_have_count(10)
    for field in FIELDS:
        expected = '\n'.join(result[field]) if field == 'questions' else result[field]
        expect(page.locator('[data-result-field="' + field + '"]')).to_have_value(expected)
        expect(page.locator('[data-copy-field="' + field + '"]')).to_be_visible()
    expect(page.locator('#generate-content')).to_be_enabled()


def expect_retained_error(page, fragment, old_business):
    expect(page.locator('#assistant-error')).to_be_visible()
    expect(page.locator('#assistant-error')).to_contain_text(fragment)
    expect(page.locator('#result-state')).to_contain_text('保留上次成功结果')
    expect(page.locator('#suggestion-business')).to_have_value(old_business)
    assert '<script>' not in page.locator('#assistant-error').inner_html()
    expect(page.locator('#generate-content')).to_be_enabled()


def main():
    with serve_app() as url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                             args=['--no-sandbox'])
        editor = browser.new_page()
        editor.goto(url)
        entry = editor.get_by_role('link', name='AI 内容助手')
        expect(entry).to_have_attribute('href', 'assistant.html')
        expect(entry).to_have_attribute('target', '_blank')
        assert 'noopener' in entry.get_attribute('rel')
        assert editor.locator('script[src^="assets/assistant."]').count() == 0
        editor.close()

        context = browser.new_context(viewport={'width': 1360, 'height': 1000})
        context.add_init_script('''(() => {
            const reportKey = %s;
            Storage.prototype.setItem.call(localStorage, reportKey, %s);
            window.__reportAccesses = [];
            for (const method of ['getItem', 'setItem', 'removeItem', 'clear']) {
                const original = Storage.prototype[method];
                Storage.prototype[method] = function (...args) {
                    if (this === localStorage && (method === 'clear' || args[0] === reportKey))
                        window.__reportAccesses.push(method);
                    return Reflect.apply(original, this, args);
                };
            }
            window.__copied = [];
            Object.defineProperty(navigator, 'clipboard', {configurable: true,
                value: {writeText: async text => window.__copied.push(text)}});
        })();''' % (json.dumps(REPORT_KEY), json.dumps(REPORT_SENTINEL)))
        worker = MockWorker()
        context.route('https://**/*', worker.handle)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url + 'assistant.html')
        expect(page.locator('#assistant-provider')).to_have_value('deepseek')
        expect(page.locator('#service-passcode')).to_have_value('')
        expect(page.locator('#company-info')).to_have_value('')
        assert worker.requests == [], 'Opening the assistant must not contact a model service'
        assert_private_storage(page, connected=False)
        fill_inputs(page)
        assert worker.requests == [], 'Typing source material must not upload it'
        generate(page)
        expect(page.locator('#assistant-error')).to_contain_text('请先连接')
        assert worker.requests == []
        for invalid_endpoint in ('http://example.com', SERVICE + '?token=not-a-key',
                                 'https://account:password@assistant-test.workers.dev'):
            page.locator('#service-url').fill(invalid_endpoint)
            page.locator('#service-passcode').fill(TOKEN)
            page.locator('#connect-service').click()
            expect(page.locator('#assistant-error')).to_be_visible()
            assert worker.requests == [], 'Invalid service URLs must be rejected before any request'

        # Only an explicit connection checks config; raw client inputs are not in that request.
        connect(page)
        assert worker.requests == [{'path': '/config', 'method': 'GET',
                                    'authorization': 'Bearer ' + TOKEN, 'body': None}]
        assert_private_storage(page)
        assert not page.locator('#assistant-provider option[value="gemini"]').evaluate('(option) => option.disabled')
        expect(page.locator('#sending-notice')).to_contain_text('资料会发送给你选择的 AI')
        assert not page.get_by_role('button', name='应用').count()

        # Full DeepSeek result, per-field copying, editable text, and safe untrusted rendering.
        malicious = '<img src=x onerror="window.__xss=true"> 包装设备资料'
        worker.result['business'] = malicious
        generate(page)
        expect_result(page, worker.result)
        expect(page.locator('#result-origin')).to_contain_text('DeepSeek · deepseek-chat')
        assert worker.requests[-1]['body'] == {'provider': 'deepseek', **INPUTS}
        assert page.locator('#result-cards img').count() == 0
        assert page.evaluate('window.__xss === undefined')
        for field in FIELDS:
            page.locator('[data-copy-field="' + field + '"]').click()
            expected = '\n'.join(worker.result[field]) if field == 'questions' else worker.result[field]
            assert page.evaluate('window.__copied.at(-1)') == expected
        edited_goal = '人工核对后的推广方向\n只使用已确认的业务资料。'
        page.locator('#suggestion-goal').fill(edited_goal)
        page.locator('[data-copy-field="goal"]').click()
        assert page.evaluate('window.__copied.at(-1)') == edited_goal
        expect(page.locator('#result-state')).to_contain_text('已手动调整')
        page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true,value:undefined})")
        page.locator('[data-copy-field="goal"]').click()
        expect(page.locator('[data-field="goal"] .copy-status')).to_contain_text('已选中文字')
        assert page.locator('#suggestion-goal').evaluate('(input) => input.selectionEnd - input.selectionStart') == len(edited_goal)
        assert_private_storage(page)

        # Changing models marks old results explicitly; Gemini is sent as a separate provider.
        page.locator('#assistant-provider').select_option('gemini')
        expect(page.locator('#result-state')).to_contain_text('模型已改变')
        worker.result = result_for('测试云序软件')
        generate(page)
        expect_result(page, worker.result)
        expect(page.locator('#result-origin')).to_contain_text('Gemini · gemini-flash-latest')
        assert worker.requests[-1]['body']['provider'] == 'gemini'
        old_business = worker.result['business']

        # Auth, quota, transport and malformed responses retain a clearly marked successful result.
        for status, code, fragment in [(401, 'UNAUTHORIZED', '口令'), (429, 'MODEL_LIMIT', '额度'),
                                       (502, 'MODEL_AUTH', '鉴权'), (504, 'MODEL_TIMEOUT', '超时')]:
            worker.mode = 'error'
            worker.failure = (status, code)
            generate(page)
            expect_retained_error(page, fragment, old_business)
            if status == 401:
                connect(page)
        for mode, fragment in [('network', '无法连接'), ('invalid_json', '有效数据'),
                               ('provider_mismatch', '模型信息不匹配')]:
            worker.mode = mode
            generate(page)
            expect_retained_error(page, fragment, old_business)

        # Frontend still rejects an incomplete or unsafe result from a misconfigured backend.
        invalid_results = []
        bad = result_for(); bad['questions'] = bad['questions'][:4]
        invalid_results.append((bad, '5个'))
        bad = result_for(); bad['questions'][4] = bad['questions'][0]
        invalid_results.append((bad, '5个'))
        bad = result_for(); bad['questions'][4] = bad['questions'][0].replace('设备', '设 备')
        invalid_results.append((bad, '5个'))
        bad = result_for(); bad['questions'][4] = '这是一句未形成问题的陈述。'
        invalid_results.append((bad, '5个'))
        bad = result_for(); del bad['business']
        invalid_results.append((bad, '字段'))
        bad = result_for(); bad['extra'] = 'unexpected'
        invalid_results.append((bad, '字段'))
        bad = result_for(); bad['business'] = '请替换【客户名称】后输出。'
        invalid_results.append((bad, '占位'))
        worker.mode = 'success'
        for bad, fragment in invalid_results:
            worker.result = bad
            generate(page)
            expect_retained_error(page, fragment, old_business)

        # A canceled request cannot overwrite a later success, and busy operations guard all edits.
        worker.mode = 'hold'
        generate(page)
        expect(page.locator('#cancel-generation')).to_be_visible()
        for selector in ['#company-info', '#promotion-direction', '#assistant-provider',
                         '#generate-content', '#connect-service', '#suggestion-business',
                         '[data-copy-field="business"]', '#clear-results']:
            expect(page.locator(selector)).to_be_disabled()
        assert len(worker.pending) == 1
        page.locator('#cancel-generation').click()
        expect(page.locator('#generation-status')).to_contain_text('已取消')
        expect(page.locator('#generate-content')).to_be_enabled()
        expect(page.locator('#suggestion-business')).to_have_value(old_business)
        worker.mode = 'success'
        worker.result = result_for('测试新资料客户')
        generate(page)
        expect_result(page, worker.result)
        pending_route, pending_provider = worker.pending.pop()
        try:
            worker.fulfill(pending_route, worker.response(pending_provider, result_for('测试已取消旧客户')))
        except PlaywrightError:
            pass  # Chromium may already have disposed the canceled network request.
        page.wait_for_timeout(100)
        expect(page.locator('#result-client')).to_have_text('测试新资料客户')
        assert_private_storage(page)

        # Unconfigured providers cannot be requested; no configured providers disables generation.
        worker.available = {'deepseek': True, 'gemini': False}
        connect(page)
        expect(page.locator('#assistant-provider')).to_have_value('deepseek')
        assert page.locator('#assistant-provider option[value="gemini"]').evaluate('(option) => option.disabled')
        worker.available = {'deepseek': False, 'gemini': False}
        connect(page)
        expect(page.locator('#generate-content')).to_be_disabled()
        expect(page.locator('#connection-description')).to_contain_text('配置')

        # Narrow layout remains usable even with generated cards and connection errors.
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile assistant overflows'
        assert_private_storage(page)
        page.locator('#clear-results').click()
        expect(page.locator('[data-result-field]')).to_have_count(0)
        expect(page.locator('#results-empty')).to_be_visible()
        requests_before_reload = len(worker.requests)
        page.reload()
        expect(page.locator('#service-url')).to_have_value(SERVICE)
        expect(page.locator('#service-passcode')).to_have_value('')
        expect(page.locator('#company-info')).to_have_value('')
        expect(page.locator('#promotion-direction')).to_have_value('')
        expect(page.locator('#generation-constraints')).to_have_value('')
        expect(page.locator('[data-result-field]')).to_have_count(0)
        expect(page.locator('#connection-status')).to_contain_text('尚未连接')
        assert len(worker.requests) == requests_before_reload, 'Reload must not reconnect using a saved credential'
        assert_private_storage(page)
        assert errors == [], errors
        context.close()
        browser.close()
    print('PASS: assistant browser workflow, dual providers, manual review/copy, privacy, errors, cancellation and mobile layout')


if __name__ == '__main__':
    main()
