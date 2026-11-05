'use strict';
(() => {
  const ENDPOINT_KEY = 'yizhantui.geo.assistant.endpoint.v1';
  const $ = id => document.getElementById(id);
  const PROVIDERS = {deepseek:'DeepSeek',gemini:'Gemini'};
  const FIELDS = [
    ['clientName','客户 / 品牌名称','客户资料 → 企业与业务',''],
    ['business','主推业务 / 产品','客户资料 → 推广什么','核实业务实体、产品范围和相关依据。'],
    ['targetAudience','目标客户','客户资料 → 影响谁','核实客群、采购角色及适用区域，避免混入无关受众。'],
    ['region','服务区域','客户资料 → 补充服务区域',''],
    ['concern','优先关注的问题','客户资料 → 解决什么问题',''],
    ['evidence','核心依据与优势','客户资料 → 凭什么选择','请核实资质、工艺、文献、案例和人物履历；资料缺失不代表事实成立。'],
    ['actions','希望承接的行动','客户资料 → 怎样承接','确认咨询、体验、询价或演示等入口实际可用。'],
    ['goal','本次服务希望推动的方向','客户资料 → 补充问题清单与调整标准目标','核实目标表述，避免将预期方向写成销量、排名或效果承诺。'],
    ['questions','拟观察的客户提问','客户资料 → 补充问题清单与调整标准目标','五个问题分别覆盖背景、品牌、产品对比、供应链及售后；B2B 服务可对应采购与交付场景。'],
    ['exceptions','行业或业务例外事项','服务安排 → 启动与配合 → 例外事项','核实行业术语、适用范围、公开授权及需要客户审核的表述。']
  ];
  const INPUTS = {companyInfo:$('company-info'),promotionDirection:$('promotion-direction'),constraints:$('generation-constraints')};
  const UI_LIMITS = {companyInfo:6000,promotionDirection:2000,constraints:1000};
  const state = {connection:null,busy:false,controller:null,operation:null,result:null,resultSignature:'',resultProvider:'',resultModel:'',resultAt:null,edited:false,failureRetained:false};
  const cards = new Map();

  function notify(text) {$('generation-status').textContent=text;}
  function error(text) {$('assistant-error').textContent=text;$('assistant-error').hidden=false;}
  function clearError() {$('assistant-error').hidden=true;$('assistant-error').textContent='';}
  function signature() {return JSON.stringify({provider:$('assistant-provider').value,...readInputs()});}
  function readInputs() {return Object.fromEntries(Object.entries(INPUTS).map(([key,input])=>[key,input.value.trim()]));}
  function timestamp(value) {return value.toLocaleString('zh-CN',{hour12:false});}
  function validateEndpoint(value) {
    let url;
    try {url=new URL(value.trim());}catch(e){throw new Error('请填写有效的生成服务地址。');}
    const local=url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname);
    if(url.protocol!=='https:'&&!local)throw new Error('生成服务需使用 HTTPS；本地开发仅支持 localhost 或 127.0.0.1。');
    if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不能包含账号、密码、查询参数或片段。');
    return url.href.replace(/\/+$/,'');
  }
  function serverMessage(code,status) {
    const messages={
      UNAUTHORIZED:'访问口令不正确或已失效，请重新连接生成服务。',
      FORBIDDEN_ORIGIN:'生成服务尚未允许当前工作台地址，请检查服务端的访问来源设置。',
      INVALID_INPUT:'资料格式或长度不符合要求，请检查填写内容。',
      INVALID_REQUEST:'资料格式不符合要求，请检查填写内容。',
      INVALID_JSON:'生成服务收到的资料格式不正确，请重试。',
      BODY_TOO_LARGE:'资料内容过长，请精简后重试。',
      PAYLOAD_TOO_LARGE:'资料内容过长，请精简后重试。',
      PROVIDER_NOT_CONFIGURED:'该模型尚未在生成服务中配置，请选择可用模型或联系服务管理员。',
      PROVIDER_UNAVAILABLE:'所选模型服务暂时不可用，请稍后重试。',
      UPSTREAM_TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      UPSTREAM_AUTH:'模型服务鉴权失败，请由管理员检查服务端 API 配置。',
      UPSTREAM_QUOTA:'模型服务额度不足或请求过于频繁，请稍后重试或检查额度。',
      RATE_LIMITED:'请求过于频繁，请稍后重试。',
      INVALID_MODEL_OUTPUT:'模型未返回完整有效的内容，请补充资料后重试。',
      INVALID_OUTPUT:'模型未返回完整有效的内容，请补充资料后重试。',
      SERVICE_NOT_CONFIGURED:'生成服务尚未完成配置，请联系服务管理员。',
      MODEL_AUTH:'模型服务鉴权失败，请由管理员检查服务端密钥与权限配置。',
      MODEL_LIMIT:'模型额度或请求频次受限，请稍后重试或联系管理员检查额度。',
      MODEL_UNAVAILABLE:'所选模型暂时不可用，请稍后重试。',
      MODEL_REQUEST:'模型调用未成功，请由管理员检查模型名称及服务权限。',
      MODEL_OUTPUT:'模型返回了无效内容，请补充资料后重试。',
      INVALID_MODEL_RESULT:'模型结果未通过完整性检查，请补充资料后重试。',
      MODEL_TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      INPUT_TOO_LARGE:'资料内容过长，请精简后重试。',
      MISSING_INPUT:'请填写企业基础资料和本次推广方向。',
      ORIGIN_NOT_ALLOWED:'生成服务尚未允许当前工作台地址，请由管理员检查访问来源配置。',
      MODEL_CONFIGURATION:'服务端模型配置无效，请联系管理员检查。',
      INVALID_PROVIDER:'请选择已配置的 DeepSeek 或 Gemini 模型。',
      CONTENT_TYPE:'提交资料格式不正确，请刷新后重试。'
    };
    if(messages[code])return messages[code];
    if(status===401||status===403)return '连接未获授权，请检查访问口令及服务端的访问来源设置。';
    if(status===413)return '资料内容过长，请精简后重试。';
    if(status===429)return '请求过于频繁或模型额度受限，请稍后重试。';
    if(status===504)return '模型生成超时，请稍后重试。';
    return '生成服务返回异常，请稍后重试或检查服务配置。';
  }
  async function requestJSON(endpoint,path,token,{method='GET',body,signal}={}) {
    const headers={Authorization:'Bearer '+token};
    if(body!==undefined)headers['Content-Type']='application/json';
    let response;
    try {response=await fetch(endpoint+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});}catch(e){if(e.name==='AbortError')throw e;throw new Error('无法连接生成服务，请检查地址、网络以及服务端是否允许当前工作台访问。');}
    let data;
    try {data=await response.json();}catch(e){throw new Error('生成服务没有返回有效数据，请检查连接地址后重试。');}
    if(!response.ok) {
      const failure=new Error(serverMessage(data?.error?.code,response.status));failure.status=response.status;throw failure;
    }
    return data;
  }
  function setBusy(busy,operation=null) {
    state.busy=busy;state.operation=busy?operation:null;
    for(const input of Object.values(INPUTS))input.disabled=busy;
    $('assistant-provider').disabled=busy;
    for(const id of ['service-url','service-passcode','connect-service','disconnect-service','generate-content'])$(id).disabled=busy;
    for(const {input,copy} of cards.values()){input.disabled=busy;copy.disabled=busy;}
    $('clear-results').disabled=busy;
    $('cancel-generation').hidden=!busy;$('cancel-generation').textContent=operation==='connect'?'取消连接检查':'取消生成';
    $('generate-content').textContent=busy&&operation==='generate'?'正在生成…':'生成内容建议';
    $('connect-service').textContent=busy&&operation==='connect'?'正在检查…':'连接并检查';
    if(!busy && state.connection && !state.connection.providers.some(p=>p.configured))$('generate-content').disabled=true;
  }
  function resetConnection({clearPasscode=false,message='尚未连接生成服务'}={}) {
    state.connection=null;
    if(clearPasscode)$('service-passcode').value='';
    $('connection-status').textContent=message;
    $('connection-description').textContent='连接服务后可选择 DeepSeek 或 Gemini。模型 API 密钥由服务端保管。';
    $('disconnect-service').hidden=true;
    for(const option of $('assistant-provider').options){option.disabled=false;option.textContent=PROVIDERS[option.value];}
    $('model-description').textContent='连接后显示可用模型。';
    $('generate-content').disabled=state.busy;
  }
  function updateModelDescription() {
    const selected=state.connection?.providers.find(p=>p.id===$('assistant-provider').value);
    $('model-description').textContent=selected?(selected.configured?'模型：'+selected.model:'该模型尚未配置。'):'连接后显示可用模型。';
    updateResultState();
  }
  function parseConfig(data) {
    if(!data||!Array.isArray(data.providers))throw new Error('生成服务的配置格式不正确，请检查服务部署。');
    const providers=Object.keys(PROVIDERS).map(id=>{
      const item=data.providers.find(p=>p?.id===id);
      return {id,label:PROVIDERS[id],configured:item?.configured===true,model:typeof item?.model==='string'?item.model.slice(0,100):'未指定'};
    });
    return {providers,limits:data.limits&&typeof data.limits==='object'?data.limits:{}};
  }
  async function connect(event) {
    event.preventDefault();if(state.busy)return;clearError();
    let endpoint;
    try {endpoint=validateEndpoint($('service-url').value);}catch(e){error(e.message);$('service-settings').open=true;$('service-url').focus();return;}
    const token=$('service-passcode').value.trim();
    if(!token){error('请填写生成服务的访问口令。');$('service-settings').open=true;$('service-passcode').focus();return;}
    state.controller=new AbortController();setBusy(true,'connect');$('settings-status').textContent='正在检查服务与可用模型…';
    try {
      const config=parseConfig(await requestJSON(endpoint,'/config',token,{signal:state.controller.signal}));
      state.connection={endpoint,token,...config};$('service-url').value=endpoint;
      try {localStorage.setItem(ENDPOINT_KEY,endpoint);}catch(e){}
      for(const option of $('assistant-provider').options) {
        const provider=config.providers.find(p=>p.id===option.value);option.disabled=!provider.configured;
        option.textContent=provider.label+(provider.configured?'':' · 未配置');
      }
      const current=config.providers.find(p=>p.id===$('assistant-provider').value);
      if(!current?.configured)$('assistant-provider').value=config.providers.find(p=>p.configured)?.id||'deepseek';
      for(const [key,input] of Object.entries(INPUTS)) {
        const limit=Number(config.limits[key]);input.maxLength=Number.isInteger(limit)&&limit>0?Math.min(UI_LIMITS[key],limit):UI_LIMITS[key];
      }
      updateCounts();updateModelDescription();
      const enabled=config.providers.filter(p=>p.configured).map(p=>p.label);
      $('connection-status').textContent=enabled.length?'生成服务已连接':'服务已连接，尚未配置模型';
      $('connection-description').textContent=enabled.length?'可用模型：'+enabled.join('、')+'。访问口令只保留在本页面。':'请由管理员在服务端配置 DeepSeek 或 Gemini 的 API 密钥。';
      $('settings-status').textContent=enabled.length?'连接成功，可以开始生成。':'需要完成服务端模型配置。';
      $('disconnect-service').hidden=false;$('service-settings').open=!enabled.length;
      notify(enabled.length?'已连接。填写资料后，点击“生成内容建议”。':'服务中尚无可用模型，请先完成服务端配置。');
    }catch(e) {
      resetConnection();$('settings-status').textContent=e.name==='AbortError'?'已取消连接检查。':'连接未成功。';
      if(e.name!=='AbortError')error(e.message);$('service-settings').open=true;
    }finally {state.controller=null;setBusy(false);}
  }
  function hasPlaceholder(text) {
    return /【[^】]+】|\$\{[^}]+\}|\{\{[^}]+\}\}|\[(?:客户|企业|品牌|产品|品类|地区|区域|名称|请填|待填)[^\]]*\]|[（(](?:客户名称|企业名称|品牌名称|产品名称|请填写|待填写|请替换)[^）)]*[）)]|(?:请替换|产品名称待填)/u.test(text);
  }
  function validateResult(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('模型结果不是完整的方案参数，请重试。');
    const expected=FIELDS.map(([key])=>key);const actual=Object.keys(value);
    if(actual.length!==expected.length||expected.some(key=>!actual.includes(key)))throw new Error('模型结果缺少字段或包含异常字段，请重试。');
    const result={};
    for(const key of expected) {
      if(key==='questions') {
        if(!Array.isArray(value.questions)||value.questions.length!==5||value.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>600||!/[？?]$/u.test(q.trim()))||new Set(value.questions.map(q=>q.trim().replace(/\s+/g,''))).size!==5)throw new Error('模型没有返回5个完整且不同的问题，请补充资料后重试。');
        result.questions=value.questions.map(q=>q.trim());
      }else {
        if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>6000||/^(?:N\/A|null|undefined|待填|待填写|请填写)$/i.test(value[key].trim()))throw new Error('模型结果中有未完成的内容，请补充资料后重试。');
        result[key]=value[key].trim();
      }
    }
    if(Object.values(result).flat().some(hasPlaceholder))throw new Error('模型结果包含未代入的占位内容，请补充资料后重试。');
    return result;
  }
  function setResultMetadata() {
    if(!state.result)return;
    $('result-client').textContent=state.result.clientName;
    $('result-origin').textContent=PROVIDERS[state.resultProvider]+' · '+state.resultModel+' · '+timestamp(state.resultAt);
    updateResultState();
  }
  function updateResultState() {
    if(!state.result)return;
    const stale=state.failureRetained||signature()!==state.resultSignature;
    $('result-metadata').classList.toggle('is-stale',stale);
    $('result-state').textContent=state.failureRetained?'本次生成未完成，下方保留上次成功结果；复制前请核对客户与资料。':stale?'资料或模型已改变，下方仍是上次生成结果，请核对后重新生成。':state.edited?'已手动调整建议内容，请检查后逐项复制。':'这是内容建议，尚未填入或保存到方案。请核实后逐项复制。';
  }
  function renderResults(result,provider,model,capturedSignature) {
    state.result=result;state.resultProvider=provider;state.resultModel=model;state.resultSignature=capturedSignature;state.resultAt=new Date();state.edited=false;state.failureRetained=false;
    cards.clear();$('result-cards').replaceChildren();
    FIELDS.forEach(([key,label,destination,note],index)=>{
      const card=document.createElement('section');card.className='result-card';card.dataset.field=key;
      const heading=document.createElement('div');heading.className='card-heading';
      const info=document.createElement('div');const title=document.createElement('h3');title.textContent=String(index+1).padStart(2,'0')+' · '+label;
      const hint=document.createElement('p');hint.textContent='粘贴到：'+destination;info.append(title,hint);
      const copy=document.createElement('button');copy.type='button';copy.className='copy-button';copy.dataset.copyField=key;copy.textContent='复制';copy.setAttribute('aria-label','复制'+label);
      heading.append(info,copy);
      const input=document.createElement('textarea');input.id='suggestion-'+key;input.dataset.resultField=key;input.setAttribute('aria-label',label+'生成建议');input.rows=key==='questions'?7:['business','evidence','exceptions','goal'].includes(key)?4:3;
      input.className=key==='questions'?'question-result':['business','evidence','exceptions','goal'].includes(key)?'long-result':'';
      input.value=key==='questions'?result.questions.join('\n'):result[key];
      const status=document.createElement('p');status.className='copy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      card.append(heading,input);
      const noteNode=document.createElement('p');noteNode.className='card-note';noteNode.textContent=note;
      if(note)card.append(noteNode);
      if(key==='questions') {
        const count=document.createElement('p');count.id='question-result-count';count.className='card-note';
        const update=()=>{const n=input.value.split('\n').map(x=>x.trim()).filter(Boolean).length;count.textContent=n===5?'当前5个问题，复制时按每行一个输出。':'当前'+n+'个问题；建议核对并保留5个不同的具体提问。';};
        input.addEventListener('input',update);card.append(count);update();
      }
      card.append(status);
      input.addEventListener('input',()=>{state.edited=true;status.textContent='';updateResultState();});
      copy.onclick=async()=>{
        const text=input.value.trim();if(!text){status.textContent='这一项尚无内容。';return;}
        try {
          if(!navigator.clipboard?.writeText)throw new Error('unavailable');
          await navigator.clipboard.writeText(text);status.textContent='已复制，请检查后粘贴到对应字段。';
        }catch(e){input.focus();input.select();status.textContent='已选中文字，请使用系统复制快捷键复制。';}
      };
      cards.set(key,{input,copy,status});$('result-cards').append(card);
    });
    $('results-empty').hidden=true;$('result-metadata').hidden=false;$('clear-results').hidden=false;setResultMetadata();
  }
  async function generate(event) {
    event.preventDefault();if(state.busy)return;clearError();
    for(const [key,input] of Object.entries(INPUTS)) {
      input.setCustomValidity('');
      if(key!=='constraints'&&!input.value.trim())input.setCustomValidity(key==='companyInfo'?'请先填写企业基础资料。':'请填写本次推广方向。');
      if(input.value.length>input.maxLength)input.setCustomValidity('资料超过允许长度，请适当精简。');
      if(!input.reportValidity())return;
    }
    if(!state.connection){error('请先连接生成服务，访问口令与模型 API 密钥是不同的配置。');$('service-settings').open=true;$('service-url').focus();return;}
    const provider=$('assistant-provider').value;
    if(!state.connection.providers.some(p=>p.id===provider&&p.configured)){error('所选模型尚未配置，请选择可用模型。');return;}
    const values=readInputs();const requestSignature=signature();const connection=state.connection;
    state.failureRetained=false;state.controller=new AbortController();setBusy(true,'generate');notify('正在使用 '+PROVIDERS[provider]+' 生成内容建议，请稍候。');
    if(state.result){$('result-metadata').classList.add('is-stale');$('result-state').textContent='正在生成新建议，下方暂时保留上次结果。';}
    try {
      const data=await requestJSON(connection.endpoint,'/generate',connection.token,{method:'POST',body:{provider,...values},signal:state.controller.signal});
      const result=validateResult(data?.result);
      if(data.provider!==provider||typeof data.model!=='string')throw new Error('生成服务返回的模型信息不匹配，请重试。');
      renderResults(result,provider,data.model.slice(0,100),requestSignature);notify('已生成10项建议。请逐项检查、修改，再复制到工作台。');
    }catch(e) {
      state.failureRetained=Boolean(state.result);updateResultState();
      if(e.name==='AbortError')notify('已取消生成。'+(state.result?'上次成功结果仍保留。':''));
      else {error(e.message);notify('本次生成未完成。'+(state.result?'上次成功结果仍保留，请注意核对客户。':''));}
      if(e.status===401||e.status===403){resetConnection({message:'连接授权需要重新确认'});$('service-settings').open=true;}
    }finally {state.controller=null;setBusy(false);}
  }
  function updateCounts() {
    for(const [key,id] of [['companyInfo','company-count'],['promotionDirection','direction-count'],['constraints','constraints-count']]) {
      const input=INPUTS[key];$(id).textContent=input.value.length+' / '+input.maxLength;
    }
  }
  $('connection-form').addEventListener('submit',connect);
  $('generation-form').addEventListener('submit',generate);
  $('open-settings').onclick=()=>{$('service-settings').open=!$('service-settings').open;if($('service-settings').open)$('service-url').focus();};
  $('disconnect-service').onclick=()=>{if(state.busy)return;resetConnection({clearPasscode:true});$('settings-status').textContent='已断开，访问口令已清除。';notify('请重新连接服务后生成。');};
  for(const id of ['service-url','service-passcode'])$(id).addEventListener('input',()=>{if(state.connection)resetConnection({message:'连接信息已修改，请重新检查'});});
  for(const input of Object.values(INPUTS))input.addEventListener('input',()=>{input.setCustomValidity('');updateCounts();updateResultState();});
  $('assistant-provider').addEventListener('change',updateModelDescription);
  $('cancel-generation').onclick=()=>{state.controller?.abort();};
  $('clear-results').onclick=()=>{if(state.busy)return;state.result=null;state.resultSignature='';state.failureRetained=false;state.edited=false;cards.clear();$('result-cards').replaceChildren();$('results-empty').hidden=false;$('result-metadata').hidden=true;$('clear-results').hidden=true;notify('结果已清空，可重新生成。');};
  try {const stored=localStorage.getItem(ENDPOINT_KEY);if(stored)$('service-url').value=validateEndpoint(stored);}catch(e){}
  $('service-settings').open=!$('service-url').value;
  updateCounts();
})();
