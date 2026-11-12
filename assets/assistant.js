'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const schema=globalThis.GEOPlanSchema;
  if(!schema){$('assistant-error').textContent='方案字段配置未能加载，请刷新页面后重试。';$('assistant-error').hidden=false;return;}
  const ENDPOINT_KEY='yizhantui.geo.assistant.endpoint.v1';
  const CONNECTION_KEY='yizhantui.geo.assistant.connection.v1';
  const PROVIDERS={deepseek:'DeepSeek',gemini:'Gemini'};
  const INPUTS={companyInfo:$('company-info'),promotionDirection:$('promotion-direction'),constraints:$('generation-constraints')};
  const UI_LIMITS={companyInfo:6000,promotionDirection:2000,constraints:1000};
  const FACTS={provider:$('fact-provider'),date:$('fact-date'),durationMonths:$('fact-duration-months'),platforms:$('fact-platforms'),scope:$('fact-scope'),fee:$('fact-fee'),resources:$('fact-resources'),resourceType:$('fact-resource-type')};
  const FACT_LIMITS={provider:120,platforms:1000,scope:6000,fee:2000,resources:4000};
  const state={connection:null,remembered:null,credentialEndpoint:'',busy:false,task:null,active:'profile',records:new Map(),cards:new Map(),progress:new Map()};
  const ui=new Map();
  const text=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
  const notify=value=>{$('generation-status').textContent=value;};
  const showError=value=>{$('assistant-error').textContent=value;$('assistant-error').hidden=false;};
  const clearError=()=>{$('assistant-error').hidden=true;$('assistant-error').textContent='';};
  const readInputs=()=>Object.fromEntries(Object.entries(INPUTS).map(([key,input])=>[key,input.value.trim()]));
  const readFacts=()=>Object.fromEntries(Object.entries(FACTS).map(([key,input])=>[key,input.value.trim()]));
  const sourceSignature=snapshot=>JSON.stringify(snapshot);
  const snapshot=()=>({provider:$('assistant-provider').value,...readInputs(),serviceFacts:readFacts(),endpoint:state.connection?.endpoint||''});
  const currentSignature=()=>sourceSignature(snapshot());
  const valueAt=(result,path)=>{const [part,key]=path.split('.');return result[part][key];};
  const putAt=(result,path,value)=>{const [part,key]=path.split('.');result[part][key]=value;};
  const isCurrent=task=>state.task===task&&!task.cancelled;
  const countCurrent=()=>Array.from(state.records.values()).filter(record=>record.signature===currentSignature()).length;
  function today(){const date=new Date();return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
  $('fact-date').value=today();

  function validateEndpoint(value){
    let url;try{url=new URL(value.trim());}catch(e){throw new Error('请填写有效的生成服务地址。');}
    const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
    if(url.protocol!=='https:'&&!local)throw new Error('生成服务需使用 HTTPS；本地开发仅支持 localhost 或 127.0.0.1。');
    if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不能包含账号、密码、查询参数或片段。');
    return url.href.replace(/\/+$/,'');
  }
  function removeRemembered(){
    state.remembered=null;
    try{localStorage.removeItem(CONNECTION_KEY);return true;}
    catch(e){$('remember-status').textContent='本页已断开记忆，但浏览器未允许删除保存的连接；请检查站点存储权限。';return false;}
  }
  function rememberVerifiedConnection(){
    if(!$('remember-connection').checked||!state.connection)return false;
    const saved={version:1,endpoint:state.connection.endpoint,token:state.connection.token};
    try{localStorage.setItem(ENDPOINT_KEY,saved.endpoint);localStorage.setItem(CONNECTION_KEY,JSON.stringify(saved));state.remembered=saved;$('remember-status').textContent='已在此浏览器记住连接，下次打开会自动检查连接。';return true;}
    catch(e){state.remembered=null;$('remember-connection').checked=false;try{localStorage.removeItem(CONNECTION_KEY);}catch(ignore){}$('remember-status').textContent='已连接，但浏览器无法保存访问口令；下次仍需填写。';return false;}
  }
  function expireRememberedConnection(){
    const removed=removeRemembered();$('remember-connection').checked=false;$('service-passcode').value='';state.credentialEndpoint='';
    if(removed)$('remember-status').textContent='已记住的访问口令不正确或已失效，请重新填写并连接。';
  }
  function restoreRememberedConnection(){
    let endpointInvalid=false;
    try{const endpoint=localStorage.getItem(ENDPOINT_KEY);if(endpoint){try{$('service-url').value=validateEndpoint(endpoint);}catch(e){endpointInvalid=true;}}}
    catch(e){$('remember-status').textContent='浏览器存储不可用，当前连接只会保留在本页面。';return false;}
    let raw;
    try{raw=localStorage.getItem(CONNECTION_KEY);}catch(e){return false;}
    if(!raw)return false;
    try{
      if(raw.length>16000)throw new Error('invalid saved connection');
      const saved=JSON.parse(raw);
      if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).sort().join(',')!=='endpoint,token,version'||saved.version!==1||typeof saved.endpoint!=='string'||typeof saved.token!=='string'||saved.token.trim().length<16||saved.token.length>4096||/[\r\n]/u.test(saved.token))throw new Error('invalid saved connection');
      const endpoint=validateEndpoint(saved.endpoint);
      if(endpointInvalid||($('service-url').value&&$('service-url').value!==endpoint))throw new Error('saved endpoint mismatch');
      state.remembered={version:1,endpoint,token:saved.token.trim()};state.credentialEndpoint=endpoint;
      $('service-url').value=endpoint;$('service-passcode').value=state.remembered.token;$('remember-connection').checked=true;
      $('remember-status').textContent='正在使用此浏览器记住的连接检查服务…';return true;
    }catch(e){if(removeRemembered())$('remember-status').textContent='保存的连接信息不可用，请重新填写并连接。';return false;}
  }
  function serverMessage(code,status){
    const messages={
      UNAUTHORIZED:'访问口令不正确或已失效，请重新连接生成服务。',
      FORBIDDEN_ORIGIN:'生成服务尚未允许当前工作台地址，请检查服务端的访问来源设置。',
      ORIGIN_NOT_ALLOWED:'生成服务尚未允许当前工作台地址，请由管理员检查访问来源配置。',
      INVALID_INPUT:'资料格式或长度不符合要求，请检查客户资料与服务配置。',
      INVALID_REQUEST:'资料格式不符合要求，请检查填写内容。',
      INVALID_JSON:'生成服务收到的资料格式不正确，请重试。',
      BODY_TOO_LARGE:'资料内容过长，请精简后重试。',
      INPUT_TOO_LARGE:'资料内容过长，请精简后重试。',
      PAYLOAD_TOO_LARGE:'资料内容过长，请精简后重试。',
      MISSING_INPUT:'请填写企业基础资料和本次推广方向。',
      INVALID_PROVIDER:'请选择已配置的 DeepSeek 或 Gemini 模型。',
      INVALID_SECTION:'生成区域不受支持，请刷新页面并检查 Worker 版本。',
      INVALID_VERSION:'生成服务版本不兼容，请先更新 Worker 到支持全方案生成的版本。',
      UNSUPPORTED_VERSION:'生成服务版本不兼容，请先更新 Worker 到支持全方案生成的版本。',
      INVALID_SERVICE_FACTS:'服务配置格式不正确，请检查日期、周期与数量口径。',
      PROVIDER_NOT_CONFIGURED:'该模型尚未在生成服务中配置，请选择可用模型或联系服务管理员。',
      MODEL_AUTH:'模型服务鉴权失败，请由管理员检查服务端密钥与权限配置。',
      UPSTREAM_AUTH:'模型服务鉴权失败，请由管理员检查服务端 API 配置。',
      MODEL_LIMIT:'模型额度或请求频次受限，请稍后重试或联系管理员检查额度。',
      UPSTREAM_QUOTA:'模型服务额度不足或请求过于频繁，请稍后重试或检查额度。',
      RATE_LIMITED:'请求过于频繁，请稍后重试。',
      MODEL_UNAVAILABLE:'所选模型暂时不可用，请稍后重试。',
      PROVIDER_UNAVAILABLE:'所选模型服务暂时不可用，请稍后重试。',
      MODEL_REQUEST:'模型调用未成功，请由管理员检查模型名称及服务权限。',
      MODEL_OUTPUT:'模型返回了无效内容，请补充资料后仅重试当前区域。',
      INVALID_MODEL_RESULT:'模型结果未通过完整性检查，请补充资料后仅重试当前区域。',
      INVALID_MODEL_OUTPUT:'模型未返回完整有效的内容，请补充资料后重试。',
      INVALID_OUTPUT:'模型未返回完整有效的内容，请补充资料后重试。',
      MODEL_TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      UPSTREAM_TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      TIMEOUT:'模型生成超时，请稍后重试或适当精简资料。',
      MODEL_CONFIGURATION:'服务端模型配置无效，请联系管理员检查。',
      SERVICE_NOT_CONFIGURED:'生成服务尚未完成配置，请联系服务管理员。',
      CONTENT_TYPE:'提交资料格式不正确，请刷新后重试。'
    };
    if(messages[code])return messages[code];
    if(status===401||status===403)return '连接未获授权，请检查访问口令及服务端的访问来源设置。';
    if(status===413)return '资料内容过长，请精简后重试。';
    if(status===429)return '请求过于频繁或模型额度受限，请稍后重试。';
    if(status===504)return '模型生成超时，请稍后重试。';
    return '生成服务返回异常，请稍后重试或检查服务配置。';
  }
  async function requestJSON(endpoint,path,token,{method='GET',body,signal}={}){
    const headers={Authorization:'Bearer '+token};if(body!==undefined)headers['Content-Type']='application/json';
    let response;
    try{response=await fetch(endpoint+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});}catch(e){if(e.name==='AbortError')throw e;throw new Error('无法连接生成服务，请检查地址、网络以及服务端是否允许当前工作台访问。');}
    let data;try{data=await response.json();}catch(e){throw new Error('生成服务没有返回有效数据，请检查连接地址后重试。');}
    if(!response.ok){const failure=new Error(serverMessage(data?.error?.code,response.status));failure.status=response.status;failure.code=data?.error?.code;throw failure;}
    return data;
  }
  function parseConfig(data){
    if(data?.planVersion!==2)throw new Error('当前生成服务仍是旧版，不能生成完整方案。请先更新 Cloudflare Worker 到支持全方案生成的版本，再重新连接。');
    if(!Array.isArray(data.providers))throw new Error('生成服务的配置格式不正确，请检查服务部署。');
    const providers=Object.keys(PROVIDERS).map(id=>{const item=data.providers.find(p=>p?.id===id);return{id,label:PROVIDERS[id],configured:item?.configured===true,model:typeof item?.model==='string'?item.model.slice(0,100):'未指定'};});
    return{providers,limits:data.limits&&typeof data.limits==='object'?data.limits:{}};
  }
  function updateControls(){
    const unavailable=state.connection&&!state.connection.providers.some(p=>p.configured);
    for(const input of [...Object.values(INPUTS),...Object.values(FACTS)])input.disabled=state.busy;
    for(const id of ['assistant-provider','service-url','service-passcode','connect-service','disconnect-service','clear-results','remember-connection'])$(id).disabled=state.busy;
    $('generate-content').disabled=state.busy||Boolean(unavailable);
    for(const sectionUI of ui.values())sectionUI.generate.disabled=state.busy||Boolean(unavailable);
    for(const {input,copy} of state.cards.values()){input.disabled=state.busy;copy.disabled=state.busy;}
    $('cancel-generation').hidden=!state.busy;
    $('cancel-generation').textContent=state.task?.type==='connect'?'取消连接检查':'取消生成';
    $('generate-content').textContent=state.busy&&state.task?.type==='generate'?'正在生成…':'生成整份方案';
    $('connect-service').textContent=state.busy&&state.task?.type==='connect'?'正在检查…':'连接并检查';
    const canExport=countCurrent()>0&&!state.busy;$('copy-config').disabled=!canExport;$('download-config').disabled=!canExport;
  }
  function beginTask(type){const task={type,controller:new AbortController(),cancelled:false,currentSection:null};state.task=task;state.busy=true;updateControls();return task;}
  function finishTask(task){if(state.task!==task)return;state.task=null;state.busy=false;updateAll();}
  function resetConnection({clearPasscode=false,message='尚未连接生成服务'}={}){
    state.connection=null;if(clearPasscode)$('service-passcode').value='';
    $('connection-status').textContent=message;$('connection-description').textContent='连接服务后可选择 DeepSeek 或 Gemini。模型 API 密钥由服务端保管。';$('disconnect-service').hidden=true;
    for(const option of $('assistant-provider').options){option.disabled=false;option.textContent=PROVIDERS[option.value];}
    $('model-description').textContent='连接后显示可用模型。';updateAll();
  }
  function updateModelDescription(){
    const selected=state.connection?.providers.find(p=>p.id===$('assistant-provider').value);
    $('model-description').textContent=selected?(selected.configured?'模型：'+selected.model:'该模型尚未配置。'):'连接后显示可用模型。';updateAll();
  }
  async function connect(event,{automatic=false}={}){
    event?.preventDefault();if(state.busy)return;clearError();
    let endpoint;try{endpoint=validateEndpoint($('service-url').value);}catch(e){showError(e.message);$('service-settings').open=true;$('service-url').focus();return;}
    const token=$('service-passcode').value.trim();if(!token){showError('请填写生成服务的访问口令。');$('service-settings').open=true;$('service-passcode').focus();return;}
    state.credentialEndpoint=endpoint;
    const task=beginTask('connect');$('settings-status').textContent=automatic?'正在自动连接已记住的服务…':'正在检查服务版本与可用模型…';
    try{
      const config=parseConfig(await requestJSON(endpoint,'/config',token,{signal:task.controller.signal}));if(!isCurrent(task))return;
      state.connection={endpoint,token,...config};$('service-url').value=endpoint;try{localStorage.setItem(ENDPOINT_KEY,endpoint);}catch(e){}
      if($('remember-connection').checked)rememberVerifiedConnection();else if(state.remembered)removeRemembered();
      for(const option of $('assistant-provider').options){const provider=config.providers.find(p=>p.id===option.value);option.disabled=!provider.configured;option.textContent=provider.label+(provider.configured?'':' · 未配置');}
      const current=config.providers.find(p=>p.id===$('assistant-provider').value);if(!current?.configured)$('assistant-provider').value=config.providers.find(p=>p.configured)?.id||'deepseek';
      for(const [key,input] of Object.entries(INPUTS)){const limit=Number(config.limits[key]);input.maxLength=Number.isInteger(limit)&&limit>0?Math.min(UI_LIMITS[key],limit):UI_LIMITS[key];}
      for(const [key,limit] of Object.entries(FACT_LIMITS)){const configured=Number(config.limits.serviceFacts?.[key]);FACTS[key].maxLength=Number.isInteger(configured)&&configured>0?Math.min(limit,configured):limit;}
      const enabled=config.providers.filter(p=>p.configured).map(p=>p.label);$('connection-status').textContent=enabled.length?'全方案生成服务已连接':'服务已连接，尚未配置模型';
      $('connection-description').textContent=enabled.length?'可用模型：'+enabled.join('、')+'。支持四区全方案生成；'+(state.remembered?'此浏览器已记住连接。':'访问口令只保留在本页面。'):'请由管理员在服务端配置 DeepSeek 或 Gemini 的 API 密钥。';
      $('settings-status').textContent=enabled.length?'连接成功，可以开始生成。':'需要完成服务端模型配置。';$('disconnect-service').hidden=false;$('service-settings').open=!enabled.length;
      updateModelDescription();notify(enabled.length?'已连接。填写资料与服务配置后，可生成整份方案或仅生成一个区域。':'服务中尚无可用模型，请先完成服务端配置。');
    }catch(e){if(!isCurrent(task))return;if(e.status===401)expireRememberedConnection();resetConnection();$('settings-status').textContent=automatic?'自动连接未成功，可在此重新连接。':'连接未成功。';if(e.name!=='AbortError')showError(e.message);$('service-settings').open=true;}
    finally{finishTask(task);}
  }
  function activateSection(id,focus=false){
    if(!schema.getSection(id))return;state.active=id;
    for(const [sectionId,sectionUI] of ui){const active=sectionId===id;sectionUI.tab.setAttribute('aria-selected',String(active));sectionUI.tab.tabIndex=active?0:-1;sectionUI.panel.hidden=!active;}
    if(focus)ui.get(id).tab.focus();
  }
  function buildSections(){
    for(const [index,section] of schema.sections.entries()){
      const tab=text('button','result-tab');tab.type='button';tab.id='tab-'+section.id;tab.dataset.sectionTab=section.id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','result-section-'+section.id);
      tab.append(text('span','tab-label',String(index+1).padStart(2,'0')+' '+section.label),text('span','tab-status','未生成'));tab.onclick=()=>activateSection(section.id);
      tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let next=event.key==='Home'?0:event.key==='End'?schema.sections.length-1:(index+(event.key==='ArrowRight'?1:-1)+schema.sections.length)%schema.sections.length;activateSection(schema.sections[next].id,true);};
      const panel=text('div','section-results');panel.id='result-section-'+section.id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
      const heading=text('div','section-result-heading');const headingText=text('div');headingText.append(text('h3','',section.label),text('p','',section.fields.length+' 项内容，逐项核对后复制到对应位置。'));
      const generate=text('button','section-generate','仅生成本区');generate.type='button';generate.id='generate-'+section.id;generate.dataset.generateSection=section.id;generate.onclick=()=>generateSections([section.id]);heading.append(headingText,generate);
      const meta=text('div','section-metadata');meta.dataset.sectionMetadata=section.id;meta.hidden=true;const client=text('strong');client.dataset.sectionClient=section.id;const origin=text('p');origin.dataset.sectionOrigin=section.id;const status=text('p');status.dataset.sectionState=section.id;status.setAttribute('role','status');status.setAttribute('aria-live','polite');meta.append(client,origin,status);
      const empty=text('div','results-empty');empty.append(text('h4','','本区尚未生成'),text('p','','可以生成整份方案，也可以点击“仅生成本区”。生成后会显示可编辑、可逐项复制的内容。'));
      const cards=text('div','result-cards');cards.dataset.sectionCards=section.id;panel.append(heading,meta,empty,cards);$('result-tabs').append(tab);$('result-sections').append(panel);
      const progress=text('li');progress.dataset.progressSection=section.id;progress.append(text('span','',section.label),text('strong','','未生成'));$('generation-progress').append(progress);
      ui.set(section.id,{tab,panel,generate,meta,client,origin,status,empty,cards,progress});state.progress.set(section.id,'未生成');
    }
    activateSection('profile');
  }
  function fieldLabel(field,record){
    const match=field.path.match(/^copy\.annual_stage([1-5])_(work|output)$/);if(!match)return field.label;
    const stages=schema.periodStages(record?.facts.durationMonths??FACTS.durationMonths.value);const stage=stages.stages[Number(match[1])-1];
    return '阶段'+match[1]+' · '+(stages.known?stage.label:'参考'+stage.label)+' · '+(match[2]==='work'?'工作重点':'阶段交付');
  }
  async function copyValue(value,input,status){
    if(!value.trim()){status.textContent='这一项尚无内容，请核对后补充。';return;}
    try{if(!navigator.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(value);status.textContent='已复制，请检查后粘贴到对应字段。';}
    catch(e){input.focus();input.select();status.textContent='已选中文字，请使用系统复制快捷键复制。';}
  }
  function renderSection(id,result,source,data){
    const old=state.records.get(id);if(old)for(const field of schema.getSection(id).fields)state.cards.delete(field.path);
    const client=id==='profile'?result.fields.client:state.records.get('profile')?.signature===source.signature?state.records.get('profile').client:source.client;
    const record={result,signature:source.signature,provider:source.provider,model:data.model.slice(0,100),requestId:typeof data.requestId==='string'?data.requestId.slice(0,100):'',at:new Date(),facts:source.serviceFacts,client,edited:false,outcome:'success'};
    state.records.set(id,record);const sectionUI=ui.get(id);sectionUI.cards.replaceChildren();
    schema.getSection(id).fields.forEach((field,index)=>{
      const card=text('section','result-card');card.dataset.field=field.path;
      const heading=text('div','card-heading');const info=text('div');const title=text('h4','',String(index+1).padStart(2,'0')+' · '+fieldLabel(field,record));const hint=text('p','','粘贴到：'+field.destination);info.append(title,hint);
      const copy=text('button','copy-button','复制');copy.type='button';copy.dataset.copyField=field.path;copy.setAttribute('aria-label','复制'+field.label);heading.append(info,copy);
      const input=text('textarea');input.id='suggestion-'+field.path.replace('.','-');input.dataset.resultField=field.path;input.setAttribute('aria-label',field.label+'生成建议');input.rows=field.path==='fields.questions'?7:3;input.value=valueAt(result,field.path);if(field.path==='fields.questions')input.className='question-result';
      const status=text('p','copy-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');card.append(heading);
      if(schema.lockedPaths.includes(field.path))card.append(text('p','config-source','来自服务配置 · 可人工核对修改后复制'));
      card.append(input);if(field.note)card.append(text('p','card-note',field.note));
      if(field.path==='fields.questions'){
        const counter=text('p','card-note');counter.id='question-result-count';const update=()=>{const n=input.value.split('\n').map(line=>line.trim()).filter(Boolean).length;counter.textContent=n===5?'当前5个问题，复制时每行一个。':'当前'+n+'个问题，请核对并保留5个不同的具体提问。';};input.addEventListener('input',update);card.append(counter);update();
      }
      card.append(status);copy.onclick=()=>copyValue(input.value,input,status);
      input.addEventListener('input',()=>{putAt(record.result,field.path,input.value);record.edited=true;status.textContent='';$('config-copy-status').textContent='';updateAll();});
      state.cards.set(field.path,{input,copy,status,title});sectionUI.cards.append(card);
    });
    sectionUI.empty.hidden=true;updateAll();
  }
  function updateSection(id){
    const sectionUI=ui.get(id),record=state.records.get(id),progress=state.progress.get(id);sectionUI.progress.lastChild.textContent=record&&record.signature!==currentSignature()&&progress==='已完成'?'资料已变':progress;
    let short='未生成';
    if(record){
      const stale=record.signature!==currentSignature();sectionUI.meta.hidden=false;sectionUI.client.textContent='客户：'+record.client;
      sectionUI.origin.textContent=PROVIDERS[record.provider]+' · '+record.model+' · '+record.at.toLocaleString('zh-CN',{hour12:false})+(record.requestId?' · 请求编号 '+record.requestId:'');
      sectionUI.meta.classList.toggle('is-stale',stale||record.outcome!=='success');
      if(progress==='生成中'){short='生成中';sectionUI.status.textContent='本区正在重新生成，下方暂时保留上次成功结果。';}
      else if(stale){short='资料已变';sectionUI.status.textContent='资料或模型已改变：下方是上次结果，来源见上方；不会合入当前资料的 JSON 配置。可仅生成本区更新。';}
      else if(record.outcome==='failed'||record.outcome==='cancelled'){short='上次结果';sectionUI.status.textContent=(record.outcome==='cancelled'?'本次生成已取消':'本次生成未完成')+'，保留上次成功结果与手动修改。可点击“仅生成本区”重试。';}
      else{short=record.edited?'已修改':'已完成';sectionUI.status.textContent=record.edited?'已手动修改，复制和导出会使用当前编辑内容。':'本区已生成。尚未填入或保存到方案，请逐项核对。';}
    }else{
      sectionUI.meta.hidden=false;sectionUI.client.textContent='本区尚未生成';sectionUI.origin.textContent='';sectionUI.meta.classList.toggle('is-stale',['失败','已取消'].includes(progress));
      sectionUI.status.textContent=progress==='生成中'?'正在生成本区内容，请稍候。':progress==='失败'?'本区生成未完成，其他区域的成功结果仍保留。请仅生成本区重试。':progress==='已取消'?'本区生成已取消，尚无结果。可以仅生成本区重试。':progress==='等待生成'?'已加入本次生成顺序，等待前一区完成。':'可先生成本区，也可生成整份方案。';
      if(['生成中','失败','已取消'].includes(progress))short=progress;
    }
    sectionUI.tab.lastChild.textContent=short;
  }
  function collectConfig(){
    const result={fields:{},copy:{}};const included=[];const signature=currentSignature();
    for(const section of schema.sections){const record=state.records.get(section.id);if(!record||record.signature!==signature)continue;included.push(section.id);for(const field of section.fields){const card=state.cards.get(field.path);putAt(result,field.path,card?card.input.value:valueAt(record.result,field.path));}}
    return{result,included,missing:schema.sections.filter(section=>!included.includes(section.id))};
  }
  function updateExport(){
    const {result,included,missing}=collectConfig();const stale=Array.from(state.records.values()).filter(record=>record.signature!==currentSignature()).length;
    $('result-summary').textContent='当前资料已生成 '+included.length+' / 4 区';
    $('result-overview-state').textContent=stale?'另有 '+stale+' 区旧资料结果，仅供查看或单项复制。':included.length===4?'四区内容齐备，仍需逐项核实事实与服务约定。':'按区域核对，可只重试尚未完成的区域。';
    $('clear-results').hidden=state.records.size===0;
    $('config-output').value=included.length?JSON.stringify(result,null,2):'';
    $('config-status').textContent=included.length===4?'完整配置：4 / 4 区，采用各字段当前编辑内容；不会自动应用到工作台。':included.length?'不完整配置：仅含当前资料的 '+included.length+' / 4 区；缺少'+missing.map(section=>section.label).join('、')+'。'+(stale?'旧资料分区已排除。':''):'尚无与当前资料一致的生成结果。'+(stale?'旧资料结果不会合入配置，请重新生成所需区域。':'配置不会自动应用到工作台。');
    updateControls();
  }
  function updateCounts(){for(const [key,id] of [['companyInfo','company-count'],['promotionDirection','direction-count'],['constraints','constraints-count']])$(id).textContent=INPUTS[key].value.length+' / '+INPUTS[key].maxLength;}
  function updateAll(){updateCounts();for(const section of schema.sections)updateSection(section.id);updateExport();}
  function validInputs(){
    for(const [key,input] of Object.entries(INPUTS)){
      input.setCustomValidity('');if(key!=='constraints'&&!input.value.trim())input.setCustomValidity(key==='companyInfo'?'请先填写企业基础资料。':'请填写本次推广方向。');
      if(input.value.length>input.maxLength)input.setCustomValidity('资料超过允许长度，请适当精简。');if(!input.reportValidity())return false;
    }
    for(const input of Object.values(FACTS)){input.setCustomValidity('');if(input.maxLength>0&&input.value.length>input.maxLength)input.setCustomValidity('内容超过允许长度，请适当精简。');if(!input.reportValidity()){$('service-facts').open=true;input.focus();return false;}}
    const months=FACTS.durationMonths.value;if(months&&(!/^\d+$/.test(months)||Number(months)<1||Number(months)>120)){FACTS.durationMonths.setCustomValidity('服务周期请填写1到120之间的整数月份，未知可留空。');$('service-facts').open=true;FACTS.durationMonths.reportValidity();return false;}
    if(!state.connection){showError('请先连接支持全方案生成的服务。访问口令与模型 API 密钥是不同的配置。');$('service-settings').open=true;$('service-url').focus();return false;}
    if(!state.connection.providers.some(p=>p.id===$('assistant-provider').value&&p.configured)){showError('所选模型尚未配置，请选择可用模型。');return false;}
    return true;
  }
  function validatedResponse(data,id,source){
    if((data?.version!==undefined&&data.version!==2)||(data?.section!==undefined&&data.section!==id))throw new Error('生成服务返回的区域或版本不匹配，请更新 Worker 后重试。');
    if(data?.provider!==source.provider||typeof data?.model!=='string'||!data.model.trim())throw new Error('生成服务返回的模型信息不匹配，请重试。');
    if(!schema.validateSection(data?.result,id))throw new Error('本区结果未通过字段完整性检查，请仅重试本区；其余成功结果不会被覆盖。');
    const result={fields:{...data.result.fields},copy:{...data.result.copy}};
    if(id==='service')Object.assign(result.fields,schema.canonicalFields(source.serviceFacts));
    if(!schema.validateSection(result,id))throw new Error('本区服务配置未通过检查，请核实输入后重试。');return result;
  }
  async function generateSections(ids){
    if(state.busy)return;clearError();if(!validInputs())return;
    const captured=snapshot();const source={...captured,signature:sourceSignature(captured),client:captured.companyInfo.split('\n').find(line=>line.trim())?.slice(0,100)||'本次企业资料'};const connection=state.connection;
    const task=beginTask('generate');for(const id of ids)state.progress.set(id,'等待生成');updateAll();let completed=0,failed=0;
    for(const [index,id] of ids.entries()){
      if(!isCurrent(task))return;task.currentSection=id;state.progress.set(id,'生成中');activateSection(id);updateAll();notify('正在生成 '+(index+1)+' / '+ids.length+' 区：'+schema.getSection(id).label+'。已完成 '+completed+' / '+ids.length+' 区。');
      try{
        const body={version:2,section:id,provider:source.provider,companyInfo:source.companyInfo,promotionDirection:source.promotionDirection,constraints:source.constraints,serviceFacts:{...source.serviceFacts}};
        const data=await requestJSON(connection.endpoint,'/generate',connection.token,{method:'POST',body,signal:task.controller.signal});if(!isCurrent(task))return;
        const result=validatedResponse(data,id,source);renderSection(id,result,source,data);state.progress.set(id,'已完成');completed++;
      }catch(e){
        if(!isCurrent(task))return;failed++;state.progress.set(id,'失败');const record=state.records.get(id);if(record)record.outcome='failed';
        showError(schema.getSection(id).label+'：'+e.message);
        if(e.status===401||e.status===403){if(e.status===401)expireRememberedConnection();resetConnection({message:'连接授权需要重新确认'});$('service-settings').open=true;for(const next of ids.slice(index+1))state.progress.set(next,'未生成');break;}
      }
      updateAll();
    }
    if(!isCurrent(task))return;
    const current=countCurrent();notify(failed?'本次成功 '+completed+' / '+ids.length+' 区，未完成区域可点击“仅生成本区”重试；已成功结果保留。当前资料已生成 '+current+' / 4 区。':ids.length===4?'整份方案已生成，本次完成 4 / 4 区。请按区域逐项核对，再复制或导出配置。':'本区生成完成。当前资料已生成 '+current+' / 4 区，请核对后复制。');finishTask(task);
  }
  function cancelTask(){
    const task=state.task;if(!task)return;task.cancelled=true;task.controller.abort();state.task=null;state.busy=false;
    if(task.type==='connect'){$('settings-status').textContent='已取消连接检查。';notify('已取消连接检查，可以重新连接。');}
    else{
      for(const [id,progress] of state.progress)if(progress==='生成中'||progress==='等待生成'){state.progress.set(id,'已取消');if(progress==='生成中'&&state.records.has(id))state.records.get(id).outcome='cancelled';}
      notify('已取消生成；已经完成的分区与上次结果仍保留。当前资料已生成 '+countCurrent()+' / 4 区，可以仅生成所需区域。');
    }
    updateAll();
  }
  $('connection-form').addEventListener('submit',connect);$('generation-form').addEventListener('submit',event=>{event.preventDefault();generateSections(schema.sections.map(section=>section.id));});
  $('open-settings').onclick=()=>{$('service-settings').open=!$('service-settings').open;if($('service-settings').open)$('service-url').focus();};
  $('disconnect-service').onclick=()=>{if(state.busy)return;const removed=removeRemembered();$('remember-connection').checked=false;state.credentialEndpoint='';resetConnection({clearPasscode:true});$('settings-status').textContent='已断开连接。';if(removed)$('remember-status').textContent='已忘记访问口令，服务地址仍保留；下次需重新填写口令。';notify('请重新连接服务后生成。');};
  $('remember-connection').addEventListener('change',()=>{
    if($('remember-connection').checked){if(state.connection)rememberVerifiedConnection();else $('remember-status').textContent='连接成功后，会在此浏览器记住服务地址和访问口令。';}
    else if(removeRemembered())$('remember-status').textContent='已关闭记住连接；本次连接仍可使用，刷新后需重新填写口令。';
    if(state.connection)$('connection-description').textContent='支持四区全方案生成；'+(state.remembered?'此浏览器已记住连接。':'访问口令只保留在本页面。');
  });
  $('forget-connection').onclick=()=>{
    if(state.task)cancelTask();const removed=removeRemembered();let endpointRemoved=true;
    try{localStorage.removeItem(ENDPOINT_KEY);}catch(e){endpointRemoved=false;}
    $('remember-connection').checked=false;$('service-url').value='';state.credentialEndpoint='';resetConnection({clearPasscode:true});$('service-settings').open=true;
    $('settings-status').textContent='本页已断开连接。';
    $('remember-status').textContent=removed&&endpointRemoved?'已清除本浏览器保存的服务地址和访问口令。':'本页已断开，但浏览器未允许完整删除保存信息；请检查站点存储权限。';
    notify('请填写服务地址和口令后重新连接。');
  };
  $('service-url').addEventListener('input',()=>{
    let endpoint='';try{endpoint=validateEndpoint($('service-url').value);}catch(e){}
    if(state.credentialEndpoint&&endpoint!==state.credentialEndpoint){$('service-passcode').value='';state.credentialEndpoint='';}
    if(state.remembered&&endpoint!==state.remembered.endpoint){if(removeRemembered())$('remember-status').textContent='服务地址已修改，旧口令记忆已清除；请为新地址填写口令。';}
    if(state.connection)resetConnection({message:'连接信息已修改，请重新检查'});
  });
  $('service-passcode').addEventListener('input',()=>{
    if(state.remembered){if(removeRemembered())$('remember-status').textContent='口令已修改，重新连接成功后再保存。';}
    try{state.credentialEndpoint=validateEndpoint($('service-url').value);}catch(e){state.credentialEndpoint='';}
    if(state.connection)resetConnection({message:'连接信息已修改，请重新检查'});
  });
  for(const input of [...Object.values(INPUTS),...Object.values(FACTS)])input.addEventListener('input',()=>{input.setCustomValidity('');$('config-copy-status').textContent='';updateAll();});
  $('assistant-provider').addEventListener('change',updateModelDescription);$('cancel-generation').onclick=cancelTask;
  $('clear-results').onclick=()=>{if(state.busy)return;state.records.clear();state.cards.clear();for(const section of schema.sections){ui.get(section.id).cards.replaceChildren();ui.get(section.id).empty.hidden=false;state.progress.set(section.id,'未生成');}$('config-copy-status').textContent='';notify('生成结果已清空，可重新生成。');updateAll();};
  $('copy-config').onclick=()=>{updateExport();if(!countCurrent())return;copyValue($('config-output').value,$('config-output'),$('config-copy-status'));};
  $('download-config').onclick=()=>{updateExport();const {included}=collectConfig();if(!included.length)return;const blob=new Blob([$('config-output').value],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='GEO方案配置_'+(included.length===4?'完整':'不完整')+'_'+today()+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('config-copy-status').textContent=included.length===4?'已导出完整配置，请核对后使用。':'已导出不完整配置；缺少的区域见上方说明。';};
  const autoConnect=restoreRememberedConnection();
  $('service-settings').open=!$('service-url').value;buildSections();updateAll();
  if(autoConnect)connect(null,{automatic:true});
})();
