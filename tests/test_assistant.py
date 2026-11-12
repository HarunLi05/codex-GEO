"""Full-plan browser tests use a fake Worker and no model keys.

Run: python tests/test_assistant.py
"""
from copy import deepcopy
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright
from test_workspace import KEY as REPORT_KEY, serve_app

SERVICE = 'https://geo-assistant.invalid'
TOKEN = 'test-only-service-passcode-not-a-real-secret'
ENDPOINT_KEY = 'yizhantui.geo.assistant.endpoint.v1'
REPORT_SENTINEL = '{"private-test-report":"must remain untouched"}'
INPUTS = {
    'companyInfo': '测试衡远设备，生产包装设备，服务华东企业客户。已提供设备参数表。',
    'promotionDirection': '推广自动封箱机，帮助采购人员核实适配条件并预约技术咨询。',
    'constraints': '不编造认证和产能，不保证询盘或成交。',
}
FACTS = {
    'provider': '测试服务团队', 'date': '2026-11-12', 'durationMonths': '13',
    'platforms': '测试平台甲、测试平台乙', 'scope': '整理已提供的业务资料并开展内容、发布与复测工作。',
    'fee': '', 'resources': '测试资源记录，具体计量口径需核实。', 'resourceType': 'execution_quota',
}
FACT_IDS = {
    'provider': 'provider', 'date': 'date', 'durationMonths': 'duration-months',
    'platforms': 'platforms', 'scope': 'scope', 'fee': 'fee', 'resources': 'resources',
    'resourceType': 'resource-type',
}
SECTIONS = ('profile', 'service', 'schedule', 'operations')
# Independent field lists catch a missing UI field instead of silently shrinking coverage.
FIELD_LABELS = {
    'profile': {
        'fields.client': '客户 / 品牌名称', 'fields.business': '主推业务 / 产品',
        'fields.audience': '目标客户', 'fields.region': '补充服务区域',
        'fields.concern': '优先关注的问题', 'fields.evidence': '核心依据与优势',
        'fields.actions': '希望承接的行动', 'fields.questions': '拟观察的客户提问',
        'copy.goals': '本次服务希望推动的方向',
    },
    'service': {
        'fields.provider': '服务方', 'fields.date': '方案日期', 'fields.duration': '服务周期',
        'fields.platforms': '拟关注 AI 平台', 'fields.keywords': '关键词 / 问题范围',
        'fields.scope': '服务项目与数量', 'fields.fee': '服务费用', 'fields.start': '服务启动安排',
        'fields.cadence': '反馈与复测节奏', 'fields.review': '内容核对安排',
        'fields.exceptions': '行业或业务例外事项',
    },
    'schedule': {
        **{'copy.' + prefix + str(week): '第' + str(week) + '周 · ' + label
           for week in range(1, 5)
           for prefix, label in [('w', '我们主要做什么'), ('d', '客户能看到什么'), ('c', '客户需要配合什么')]},
        'copy.timing': '首月排期说明',
        **{'copy.annual_stage' + str(stage) + '_' + suffix: '阶段' + str(stage) + ' · ' + label
           for stage in range(1, 6) for suffix, label in [('work', '阶段工作重点'), ('output', '阶段交付')]},
        'copy.monthly_plan': '月度执行计划', 'copy.monthly_content': '内容与发布台账',
        'copy.monthly_monitor': '监测与问题记录', 'copy.monthly_review': '月度复盘与下月安排',
        'copy.w5': '持续运营工作', 'copy.d5': '持续运营交付', 'copy.w6': '期满总结与建议',
        'copy.annual_note': '全期排期与范围说明',
    },
    'operations': {
        **{'copy.' + key: label for key, label in [
            ('a1', '企业知识整理'), ('a2', '关键词与平台定位'), ('a3', '内容制作与核对'),
            ('a4', '公开信息与信源建设'), ('a5', '内容发布与留档'), ('a6', '复测与信息更新'),
            ('optional', '可选专项与范围说明'), ('access', '客户怎样查看进展'),
            ('metric1', '问题范围与可比性'), ('metric2', '监测记录与比例口径'),
            ('metric3', '监测结果的适用限制'), ('boundary', '服务范围与效果说明'),
            ('end', '期满交付与后续建议'), ('next', '下一步安排')]},
    },
}
assert [len(FIELD_LABELS[section]) for section in SECTIONS] == [9, 11, 31, 14]


def result_for(section, name='测试衡远设备', facts=None):
    facts = FACTS if facts is None else facts
    result = {'fields': {}, 'copy': {}}
    for path, label in FIELD_LABELS[section].items():
        part, key = path.split('.')
        result[part][key] = name + '的' + label + '：依据已确认设备资料安排工作并保留记录。'
    if section == 'profile':
        result['fields']['client'] = name
        result['fields']['questions'] = '\n'.join([
            name + '主要提供哪些包装设备？',
            '采购方如何核实' + name + '的设备参数资料？',
            name + '的自动封箱机与半自动封箱机应如何按箱型选型？',
            '向' + name + '采购封箱机前应确认哪些交付条件？',
            name + '的封箱机安装与售后支持应如何咨询？',
        ])
    if section == 'service':
        result['fields'].update({
            'provider': facts['provider'], 'date': facts['date'],
            'duration': facts['durationMonths'] + '个月，自双方确认的服务启动日起算',
            'platforms': facts['platforms'], 'fee': facts['fee'],
            'scope': '实际服务范围：\n' + facts['scope'] + '\n数量与资源配置：\n' + facts['resources'] +
                     '\n以下为服务执行使用的系统资源额度，不等同于同量确认稿件、确认成片或发布交付。',
        })
    return result


def value_at(result, path):
    part, key = path.split('.')
    return result[part][key]


class MockWorker:
    def __init__(self):
        self.requests, self.pending = [], []
        self.available = {'deepseek': True, 'gemini': True}
        self.plan_version, self.mode = 2, 'success'
        self.modes, self.overrides = {}, {}
        self.name = '测试衡远设备'
        self.failure = (429, 'MODEL_LIMIT')

    @property
    def generations(self):
        return [request['body'] for request in self.requests if request['path'] == '/generate']

    def response(self, body, result=None):
        provider, section = body['provider'], body['section']
        selected = self.overrides.get(section, result_for(section, self.name, body['serviceFacts']))
        return {'result': deepcopy(selected if result is None else result),
                'version': 2, 'section': section, 'provider': provider,
                'model': 'deepseek-chat' if provider == 'deepseek' else 'gemini-flash-latest'}

    def fulfill(self, route, payload, status=200):
        route.fulfill(status=status, content_type='application/json',
                      headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(payload, ensure_ascii=False))

    def handle(self, route):
        request = route.request
        assert request.url.startswith(SERVICE + '/'), 'Unexpected external request: ' + request.url
        path = urlparse(request.url).path
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                          'Access-Control-Allow-Headers': 'Authorization, Content-Type'})
            return
        body = request.post_data_json if request.method == 'POST' else None
        self.requests.append({'path': path, 'method': request.method,
                              'authorization': request.headers.get('authorization'), 'body': body})
        assert request.headers.get('authorization') == 'Bearer ' + TOKEN
        if path == '/config':
            assert request.method == 'GET'
            config = {'providers': [
                {'id': provider, 'label': provider, 'configured': configured,
                 'model': 'deepseek-chat' if provider == 'deepseek' else 'gemini-flash-latest'}
                for provider, configured in self.available.items()],
                'limits': {'companyInfo': 12000, 'promotionDirection': 4000, 'constraints': 2000}}
            if self.plan_version is not None:
                config['planVersion'] = self.plan_version
            self.fulfill(route, config)
            return
        assert path == '/generate' and request.method == 'POST'
        assert set(body) == {'version', 'section', 'provider', 'companyInfo',
                            'promotionDirection', 'constraints', 'serviceFacts'}
        assert body['version'] == 2 and body['section'] in SECTIONS
        assert set(body['serviceFacts']) == set(FACTS)
        mode = self.modes.get(body['section'], self.mode)
        if mode == 'hold':
            self.pending.append((route, deepcopy(body)))
        elif mode == 'network':
            route.abort('failed')
        elif mode == 'error':
            status, code = self.failure
            self.fulfill(route, {'error': {'code': code, 'message': '<script>untrusted model detail</script>'}}, status)
        elif mode == 'invalid_json':
            route.fulfill(status=200, content_type='text/plain', body='not valid json')
        elif mode == 'provider_mismatch':
            response = self.response(body)
            response['provider'] = 'gemini' if body['provider'] == 'deepseek' else 'deepseek'
            self.fulfill(route, response)
        else:
            self.fulfill(route, self.response(body))


def storage_snapshot(page):
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


def create_page(browser, url):
    context = browser.new_context(viewport={'width': 1360, 'height': 1000}, accept_downloads=True)
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
    page.test_errors = []
    page.on('pageerror', lambda error: page.test_errors.append(str(error)))
    page.goto(url + 'assistant.html')
    return context, page, worker


def open_settings(page):
    if page.locator('#service-settings').get_attribute('open') is None:
        page.locator('#open-settings').click()


def connect(page, success=True):
    open_settings(page)
    page.locator('#service-url').fill(SERVICE + '/')
    page.locator('#service-passcode').fill(TOKEN)
    page.locator('#connect-service').click()
    if success:
        expect(page.locator('#connection-status')).to_contain_text('已连接')
    expect(page.locator('#connect-service')).to_be_enabled()


def fill_inputs(page):
    page.locator('#company-info').fill(INPUTS['companyInfo'])
    page.locator('#promotion-direction').fill(INPUTS['promotionDirection'])
    optional = page.locator('#generation-constraints').locator('xpath=ancestor::details[1]')
    if optional.get_attribute('open') is None:
        optional.locator('summary').click()
    page.locator('#generation-constraints').fill(INPUTS['constraints'])
    fact_details = page.locator('#fact-provider').locator('xpath=ancestor::details[1]')
    if fact_details.count() and fact_details.get_attribute('open') is None:
        fact_details.locator('summary').click()
    for key, suffix in FACT_IDS.items():
        control = page.locator('#fact-' + suffix)
        if key == 'resourceType':
            control.select_option(FACTS[key])
        else:
            control.fill(FACTS[key])


def select_section(page, section):
    page.locator('[data-section-tab="' + section + '"]').click()


def generate(page, section=None):
    if section:
        select_section(page, section)
    page.locator('#generate-' + section if section else '#generate-content').click()


def await_pending(page, worker):
    for _ in range(100):
        if worker.pending:
            return worker.pending.pop(0)
        page.wait_for_timeout(20)
    raise AssertionError('Expected a queued generation request')


def expect_section(page, section, result, copy_every_field=False):
    select_section(page, section)
    panel = page.locator('#result-section-' + section)
    expect(panel.locator('[data-result-field]')).to_have_count(len(FIELD_LABELS[section]))
    for path, label in FIELD_LABELS[section].items():
        control = panel.locator('[data-result-field="' + path + '"]')
        expect(control).to_have_value(value_at(result, path))
        assert label in control.get_attribute('aria-label'), path + ' has no Chinese field label'
        card = control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " result-card ")][1]')
        assert '粘贴到' in card.inner_text() and '→' in card.inner_text(), path + ' has no destination hint'
        copy = panel.locator('[data-copy-field="' + path + '"]')
        expect(copy).to_be_visible()
        if copy_every_field and value_at(result, path):
            copy.click()
            assert page.evaluate('window.__copied.at(-1)') == value_at(result, path)


def expect_error(page, fragment):
    expect(page.locator('#assistant-error')).to_be_visible()
    expect(page.locator('#assistant-error')).to_contain_text(fragment)
    assert '<script>' not in page.locator('#assistant-error').inner_html()
    expect(page.locator('#generate-content')).to_be_enabled()


def check_full_plan(browser, url):
    context, page, worker = create_page(browser, url)
    expect(page.locator('#assistant-provider')).to_have_value('deepseek')
    expect(page.locator('#service-passcode')).to_have_value('')
    expect(page.locator('#company-info')).to_have_value('')
    assert worker.requests == [], 'Opening the assistant must not contact a model service'
    assert_private_storage(page, connected=False)
    fill_inputs(page)
    assert worker.requests == [], 'Typing source material must not upload it'
    generate(page)
    expect_error(page, '请先连接')
    assert worker.requests == []
    for endpoint in ('http://example.invalid', SERVICE + '?token=not-a-key',
                     'https://account:password@geo-assistant.invalid'):
        page.locator('#service-url').fill(endpoint)
        page.locator('#service-passcode').fill(TOKEN)
        page.locator('#connect-service').click()
        expect(page.locator('#assistant-error')).to_be_visible()
        assert worker.requests == [], 'Invalid service URLs must be rejected before any request'
    connect(page)
    assert worker.requests == [{'path': '/config', 'method': 'GET',
                                'authorization': 'Bearer ' + TOKEN, 'body': None}]
    assert_private_storage(page)
    assert not page.locator('#assistant-provider option[value="gemini"]').evaluate('(option) => option.disabled')
    expect(page.locator('#sending-notice')).to_contain_text('会发送给你选择的 AI')
    assert not page.get_by_role('button', name='应用').count()

    # Inspect every in-flight step rather than only the final rendered content.
    worker.mode = 'hold'
    generate(page)
    completed = 0
    for index, section in enumerate(SECTIONS):
        route, body = await_pending(page, worker)
        assert body['section'] == section
        assert len(worker.generations) == index + 1, 'Full-plan requests must be sequential'
        assert body == {'version': 2, 'section': section, 'provider': 'deepseek',
                        **INPUTS, 'serviceFacts': FACTS}
        expect(page.locator('#cancel-generation')).to_be_visible()
        expect(page.locator('#generate-content')).to_be_disabled()
        expect(page.locator('#fact-duration-months')).to_be_disabled()
        expect(page.locator('[data-result-field]')).to_have_count(completed)
        worker.fulfill(route, worker.response(body))
        completed += len(FIELD_LABELS[section])
        expect(page.locator('[data-result-field]')).to_have_count(completed)
    expect(page.locator('#generate-content')).to_be_enabled()
    expect(page.locator('#generation-status')).to_contain_text(re.compile(r'4\s*/\s*4'))
    assert len(worker.generations) == 4
    for section in SECTIONS:
        expect_section(page, section, result_for(section), copy_every_field=True)
    select_section(page, 'service')
    expect(page.locator('[data-result-field="fields.fee"]')).to_have_value('')
    assert page.locator('[data-result-field="fields.duration"]').input_value().startswith('13个月')
    scope = page.locator('[data-result-field="fields.scope"]').input_value()
    assert '系统资源额度' in scope and '不等同于' in scope

    select_section(page, 'profile')
    edited_goal = '人工核对后的设备推广方向\n只使用已经确认的业务资料。'
    goal = page.locator('[data-result-field="copy.goals"]')
    goal.fill(edited_goal)
    page.locator('[data-copy-field="copy.goals"]').click()
    assert page.evaluate('window.__copied.at(-1)') == edited_goal
    page.locator('#config-export > summary').click()
    page.locator('#copy-config').click()
    copied_config = json.loads(page.evaluate('window.__copied.at(-1)'))
    assert set(copied_config) == {'fields', 'copy'}
    assert sum(len(part) for part in copied_config.values()) == 65
    assert copied_config['copy']['goals'] == edited_goal and copied_config['fields']['fee'] == ''
    with TemporaryDirectory() as tmp:
        with page.expect_download() as pending_download:
            page.locator('#download-config').click()
        downloaded = Path(tmp) / 'test-plan.json'
        pending_download.value.save_as(downloaded)
        assert json.loads(downloaded.read_text()) == copied_config
    page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true,value:undefined})")
    page.locator('[data-copy-field="copy.goals"]').click()
    assert goal.evaluate('(input) => input.selectionEnd - input.selectionStart') == len(edited_goal)
    page.locator('#copy-config').click()
    config_output = page.locator('#config-output')
    assert config_output.evaluate('(input) => input.selectionEnd - input.selectionStart') == len(config_output.input_value())
    assert_private_storage(page)

    # Changing inputs invalidates all groups; one retry must replace only that group.
    page.locator('#company-info').fill(INPUTS['companyInfo'] + ' 补充：面向新采购项目。')
    for section in SECTIONS:
        expect(page.locator('[data-section-state="' + section + '"]')).to_contain_text(re.compile('已变|过期|上次'))
    page.locator('#assistant-provider').select_option('gemini')
    worker.mode = 'success'
    worker.name = '测试新资料客户'
    previous_count = len(worker.generations)
    generate(page, 'profile')
    expect(page.locator('#generate-profile')).to_be_enabled()
    assert len(worker.generations) == previous_count + 1
    assert worker.generations[-1]['section'] == 'profile' and worker.generations[-1]['provider'] == 'gemini'
    expect_section(page, 'profile', result_for('profile', worker.name))
    expect(page.locator('[data-section-origin="profile"]')).to_contain_text('Gemini')
    for section in SECTIONS[1:]:
        expect(page.locator('[data-section-state="' + section + '"]')).to_contain_text(re.compile('已变|过期|上次'))
        expect_section(page, section, result_for(section))
    expect(page.locator('#config-status')).to_contain_text(re.compile('过期|上次|旧资料|资料已变|不一致'))
    current_config = json.loads(config_output.input_value())
    assert current_config == result_for('profile', worker.name), 'Stale groups must be excluded from the current JSON'
    # Service configuration changes invalidate results just like changing customer material.
    page.locator('#fact-scope').fill(FACTS['scope'] + ' 补充测试限制。')
    expect(page.locator('[data-section-state="profile"]')).to_contain_text(re.compile('已变|过期|上次'))
    expect(page.locator('#copy-config')).to_be_disabled()
    expect(config_output).to_have_value('')
    page.locator('#fact-scope').fill(FACTS['scope'])
    expect(page.locator('#copy-config')).to_be_enabled()

    page.set_viewport_size({'width': 390, 'height': 844})
    for section in SECTIONS:
        select_section(page, section)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile full plan overflows: ' + section
    assert_private_storage(page)
    count_before_reload = len(worker.requests)
    page.reload()
    expect(page.locator('#service-url')).to_have_value(SERVICE)
    expect(page.locator('#service-passcode')).to_have_value('')
    for field in ('company-info', 'promotion-direction', 'generation-constraints', 'fact-scope', 'fact-fee', 'fact-resources'):
        expect(page.locator('#' + field)).to_have_value('')
    expect(page.locator('[data-result-field]')).to_have_count(0)
    expect(page.locator('#connection-status')).to_contain_text('尚未连接')
    assert len(worker.requests) == count_before_reload, 'Reload must not reconnect or upload saved client materials'
    assert_private_storage(page)
    assert page.test_errors == [], page.test_errors
    context.close()


def check_partial_failure(browser, url):
    context, page, worker = create_page(browser, url)
    fill_inputs(page)
    connect(page)
    worker.modes['service'] = 'error'
    generate(page)
    expect_error(page, '额度')
    assert [body['section'] for body in worker.generations] == list(SECTIONS)
    expect(page.locator('[data-result-field]')).to_have_count(54)
    expect_section(page, 'profile', result_for('profile'))
    expect(page.locator('#config-status')).to_contain_text(re.compile(r'未完成|不完整|3\s*/\s*4'))
    assert not re.search(r'4\s*/\s*4', page.locator('#generation-status').inner_text())
    assert not page.locator('[data-result-field="fields.keywords"]').count()
    worker.modes.clear()
    generate(page, 'service')
    expect(page.locator('[data-result-field]')).to_have_count(65)
    assert worker.generations[-1]['section'] == 'service' and len(worker.generations) == 5
    expect_section(page, 'profile', result_for('profile'))
    expect_section(page, 'schedule', result_for('schedule'))
    expect_section(page, 'operations', result_for('operations'))
    expect(page.locator('#generate-content')).to_be_enabled()
    assert_private_storage(page)
    assert page.test_errors == [], page.test_errors
    context.close()


def check_failures_and_cancel(browser, url):
    context, page, worker = create_page(browser, url)
    fill_inputs(page)
    connect(page)
    dangerous = '<img src=x onerror="window.__xss=true"> 测试设备说明'
    worker.overrides['profile'] = result_for('profile')
    worker.overrides['profile']['fields']['business'] = dangerous
    generate(page, 'profile')
    expect_section(page, 'profile', worker.overrides['profile'])
    assert not page.locator('#result-section-profile img').count()
    assert page.evaluate('window.__xss === undefined')
    for status, code, fragment in [(401, 'UNAUTHORIZED', '口令'), (429, 'MODEL_LIMIT', '额度'),
                                   (502, 'MODEL_AUTH', '鉴权'), (504, 'MODEL_TIMEOUT', '超时'),
                                   (503, 'PROVIDER_NOT_CONFIGURED', '配置')]:
        worker.mode = 'error'
        worker.failure = (status, code)
        generate(page, 'profile')
        expect_error(page, fragment)
        expect(page.locator('[data-result-field="fields.business"]')).to_have_value(dangerous)
        expect(page.locator('[data-section-state="profile"]')).to_contain_text(re.compile('上次|保留'))
        if status == 401:
            connect(page)
    for mode, fragment in [('network', '无法连接'), ('invalid_json', '有效数据'),
                           ('provider_mismatch', '模型信息不匹配')]:
        worker.mode = mode
        generate(page, 'profile')
        expect_error(page, fragment)
        expect(page.locator('[data-result-field="fields.business"]')).to_have_value(dangerous)
    invalid = []
    bad = result_for('profile'); bad['fields']['questions'] = '\n'.join(bad['fields']['questions'].splitlines()[:4]); invalid.append(bad)
    bad = result_for('profile'); lines = bad['fields']['questions'].splitlines(); lines[4] = lines[0].replace('设备', '设 备'); bad['fields']['questions'] = '\n'.join(lines); invalid.append(bad)
    bad = result_for('profile'); bad['fields']['questions'] += '\n额外的第六个问题？'; invalid.append(bad)
    bad = result_for('profile'); del bad['copy']['goals']; invalid.append(bad)
    bad = result_for('profile'); bad['fields']['unexpected'] = '异常字段'; invalid.append(bad)
    bad = result_for('profile'); bad['fields']['business'] = '请替换【客户名称】后输出。'; invalid.append(bad)
    worker.mode = 'success'
    for bad in invalid:
        worker.overrides['profile'] = bad
        generate(page, 'profile')
        expect(page.locator('#assistant-error')).to_be_visible()
        expect(page.locator('#generate-profile')).to_be_enabled()
        expect(page.locator('[data-result-field="fields.business"]')).to_have_value(dangerous)
    worker.overrides.clear()

    worker.mode = 'hold'
    generate(page, 'service')
    old_route, old_body = await_pending(page, worker)
    for selector in ('#company-info', '#assistant-provider', '#fact-fee', '#generate-content',
                     '#generate-profile', '#connect-service', '[data-copy-field="fields.business"]'):
        expect(page.locator(selector)).to_be_disabled()
    page.locator('#cancel-generation').click()
    expect(page.locator('#generation-status')).to_contain_text('已取消')
    expect(page.locator('#generate-content')).to_be_enabled()
    worker.mode = 'success'
    worker.name = '测试取消后新客户'
    generate(page, 'service')
    expect_section(page, 'service', result_for('service', worker.name))
    try:
        worker.fulfill(old_route, worker.response(old_body, result_for('service', '测试被取消旧客户')))
    except PlaywrightError:
        pass  # Chromium may have discarded the aborted request already.
    page.wait_for_timeout(100)
    expect(page.locator('[data-result-field="fields.keywords"]')).to_have_value(result_for('service', worker.name)['fields']['keywords'])
    assert_private_storage(page)
    assert page.test_errors == [], page.test_errors
    context.close()


def check_configuration(browser, url):
    context, page, worker = create_page(browser, url)
    fill_inputs(page)
    for old_version in (None, 1):
        worker.plan_version = old_version
        connect(page, success=False)
        expect(page.locator('#assistant-error')).to_contain_text(re.compile('升级|更新'))
        assert worker.generations == [], 'An old API must not receive full-plan requests'
    worker.plan_version = 2
    worker.available = {'deepseek': False, 'gemini': True}
    connect(page)
    expect(page.locator('#assistant-provider')).to_have_value('gemini')
    assert page.locator('#assistant-provider option[value="deepseek"]').evaluate('(option) => option.disabled')
    worker.available = {'deepseek': False, 'gemini': False}
    connect(page)
    expect(page.locator('#generate-content')).to_be_disabled()
    for section in SECTIONS:
        expect(page.locator('#generate-' + section)).to_be_disabled()
    expect(page.locator('#connection-description')).to_contain_text('配置')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile empty/configuration UI overflows'
    assert_private_storage(page)
    assert page.test_errors == [], page.test_errors
    context.close()


def main():
    with serve_app() as url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        editor = browser.new_page(viewport={'width': 390, 'height': 844})
        editor.goto(url)
        entry = editor.get_by_role('link', name='AI 内容助手')
        expect(entry).to_have_attribute('href', 'assistant.html')
        expect(entry).to_have_attribute('target', '_blank')
        assert 'noopener' in entry.get_attribute('rel')
        assert editor.locator('script[src^="assets/assistant."]').count() == 0
        assert editor.evaluate('document.documentElement.scrollWidth <= innerWidth')
        editor.close()
        check_full_plan(browser, url)
        check_partial_failure(browser, url)
        check_failures_and_cancel(browser, url)
        check_configuration(browser, url)
        browser.close()
    print('PASS: full-plan assistant: 65 fields, four ordered sections, manual review/export, '
          'service facts, retries/cancellation, providers, privacy and mobile layout')


if __name__ == '__main__':
    main()
