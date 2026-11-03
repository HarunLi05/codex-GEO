'use strict';
const defaults={client:'',provider:'壹站推',date:'',duration:'待双方确认',business:'',audience:'',region:'',concern:'',platforms:'启动阶段根据客户使用场景确认目标 AI 平台',questions:'',start:'从双方确认的服务启动日计算；具体日期及启动条件另行确认。',keywords:'关键词及问题范围：首周拟定，第2周共同确认。',scope:'基础工作：企业资料与知识库整理、关键词与问题规划、内容制作、约定发布、监测与服务反馈。\n文章、视频、发布数量及渠道：待双方确认服务清单。\n专项工作是否包含：另行列明。',fee:'',review:'由贵司核对内容涉及的业务事实、价格、参数及品牌表达，汇总反馈后沟通修改，确认版本再发布。具体核对时限与修改安排在启动时确认。',cadence:'拟每周反馈一次服务进展，按月安排内容与发布工作，结合阶段监测开展复盘。具体反馈、复测及复盘频次，须在启动前共同确认。',evidence:'',actions:'',exceptions:'',contact:'启动时确认服务对接人与联系方式'};
const legacyCustomerDefaults = {"client": ["客户企业 / 品牌名称", "未命名客户方案"], "business": ["启动阶段确认本次主推的产品或服务"], "audience": ["启动阶段明确目标客户及主要需求"], "region": ["按贵司实际服务范围确认"], "concern": ["确认企业信息是否完整、相关问题中如何呈现，以及优先建设哪些内容。"], "questions": ["寻找这类产品或服务时，有哪些企业值得了解？\n选择服务商时应关注哪些条件？\n贵司的产品、服务流程和适用场景是什么？"]};
const customerPlaceholders = {
  client:'请输入客户企业或品牌名称',
  business:'填写本次主推的产品或服务',
  audience:'填写目标客户、采购角色及重点区域',
  region:'填写需要补充的服务区域（选填）',
  concern:'填写客户希望解决的问题，或选择下方预设词',
  evidence:'填写已有资料、真实优势或选择下方资料方向',
  actions:'填写希望客户采取的行动，或选择下方预设词',
  questions:'每行填写一个客户真实会问的问题（选填）'
};
function normalizeCustomerFields(fields) {
  const result={...fields};
  for(const [key,examples] of Object.entries(legacyCustomerDefaults)) {
    if(examples.includes(result[key]))result[key]='';
  }
  return result;
}
const fieldDefs=[['evidence','核心依据与优势','textarea','wide'],['actions','希望承接的行动','textarea','wide'],['exceptions','行业或业务例外事项','textarea','wide'],['client','客户企业 / 品牌名称'],['provider','服务方'],['date','方案日期','date'],['business','主推业务 / 产品','textarea'],['audience','目标客户','textarea'],['region','重点服务区域','textarea'],['concern','本次优先关注的问题','textarea','two'],['duration','拟服务周期'],['platforms','拟关注 AI 平台'],['keywords','关键词 / 问题范围','textarea','two'],['questions','拟观察的问题（每行一个，建议3项）','textarea','wide'],['start','服务启动安排','textarea','wide'],['scope','拟服务项目与数量（未确认可保留待定）','textarea','wide'],['cadence','反馈、复测与复盘节奏','textarea','wide'],['review','内容核对安排','textarea','wide'],['fee','服务费用（留空不展示）'],['contact','服务对接与联系方式','text','two']];
let state = {...defaults};
if (!state.date) {const d = new Date(); state.date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
let changed = false;
const originalCopy = {};
document.querySelectorAll('#document [data-edit]').forEach(el => {
  el.classList.add('custom-text');
  el.querySelectorAll('.label').forEach(label => label.replaceWith(label.textContent.trim() + '：'));
  originalCopy[el.dataset.edit] = el.textContent.trim();
});
let copyState = {...originalCopy};
const fieldGroups = {
  business: ['client','business','audience','region'],
  direction: ['concern','evidence','actions'],
  advanced: ['questions'],
  contract: ['provider','date','duration','platforms','keywords','scope','fee','contact'],
  execution: ['start','cadence','review','exceptions']
};
const fieldInfo = {
  client: ['客户 / 品牌名称','wide','将显示在方案标题和页脚。'],
  business: ['1 · 推广什么（主推业务 / 产品）','wide','必填。明确本次推广的产品或服务及实际应用，避免只填行业名称。'],
  audience: ['2 · 影响谁（目标客户与区域）','wide','可写客群、采购角色与区域，例如：华东区制造企业的设备采购与技术人员。'],
  region: ['补充服务区域（选填）','wide','目标客户中已写明区域时可不重复填写；已有方案的区域记录会保留。'],
  concern: ['3 · 解决什么问题（优先关注）','wide','可以选预设词，再补充真实业务问题；预设只表示拟关注方向。'],
  evidence: ['4 · 凭什么选择（核心依据与优势）','wide','选择客户实际可提供的资料方向，并补充真实优势；勾选不代表已核实或自动包含专项服务。'],
  actions: ['5 · 怎样承接（希望客户采取的行动）','wide','按现有渠道选择，并补充咨询、购买、询价或演示入口；勾选不代表承诺线索或销量。'],
  exceptions: ['行业或业务例外事项（选填）','wide','补充采购周期、资料核对要求、季节性及其他特殊条件。'],
  platforms: ['拟关注 AI 平台','wide','尚未确定时可保留启动阶段共同确认。'],
  questions: ['拟观察的客户提问','wide','每行一个，建议先填写3个真实提问。'],
  keywords: ['关键词 / 问题范围','wide','先明确范围，再在启动阶段细化清单。'],
  scope: ['服务项目与数量','wide','列出内容类型、发布渠道与数量；未确认部分注明待定。'],
  start: ['服务启动安排','wide','说明起算方式与启动条件，不需要预先承诺日期。'],
  cadence: ['反馈与复测节奏','wide','说明周报、监测和阶段复盘的拟定频次。'],
  review: ['内容核对安排','wide','明确客户如何核对事实、汇总修改并确认发布。'],
  contact: ['服务对接与联系方式','wide','未确认可以保留启动时确认。'],
  fee: ['服务费用（选填）','','留空时，客户版不展示费用。']
};
function say(text) {document.getElementById('status').textContent = text;}
function dirty() {changed = true;}
function render() {
  document.querySelectorAll('#document [data-bind]').forEach(el => {
    const key=el.dataset.bind;
    const fallback={client:'客户企业',audience:'待启动阶段共同确认',business:'待填写本次主推业务',evidence:'待启动阶段核实资料与优势',actions:'待双方确认承接方式'};
    el.textContent = state[key] || fallback[key] || '';
  });
  renderBusinessFocus();
  syncPresets();
  const questions = document.getElementById('questions'); questions.replaceChildren();
  const lines = String(state.questions || '').split('\n').map(t => t.trim()).filter(Boolean);
  (lines.length ? lines : ['启动阶段共同确认拟观察的问题。']).forEach(text => {const li=document.createElement('li');li.textContent=text;questions.append(li);});
  document.getElementById('fee-row').classList.toggle('hidden', !String(state.fee || '').trim());
  document.dispatchEvent(new Event('geo:report-change'));
}
function copyPrefix(key) {
  if (/^w[1-5]$/.test(key)) return '工作：';
  if (/^d[1-5]$/.test(key)) return '交付：';
  if (/^c[1-5]$/.test(key)) return '贵司配合：';
  if (key === 'w6') return '工作与交付：';
  return '';
}
function editorValue(key, value) {
  if(key==='goals' && value===originalCopy.goals)return '';
  const prefix=copyPrefix(key); if (!prefix) return value;
  const base=prefix.slice(0,-1); return value.replace(new RegExp('^'+base+'[：:\\s]*'),'');
}
function syncCopyEditors() {
  document.querySelectorAll('[data-copy]').forEach(input => {input.value = editorValue(input.dataset.copy, copyState[input.dataset.copy] || '');});
}
function applyReport(data) {
  state = {...defaults, ...normalizeCustomerFields(data.fields)};
  copyState = {...originalCopy, ...data.copy};
  for (const input of document.querySelectorAll('#fields [name]')) input.value = state[input.name] || '';
  document.querySelectorAll('#document [data-edit]').forEach(el => {el.textContent = copyState[el.dataset.edit] || '';});
  document.querySelectorAll('[data-optional-input]').forEach(details=>{details.open=hasBusinessValue(details.dataset.optionalInput);});
  syncCopyEditors(); render();
}
function collect() {return {fields: {...state}, copy: {...copyState}};}
const presetOptions = {
  concern: ['选型与方案对比','供应商实力核验','产品原理与适用场景','信息准确性与口碑核对'],
  evidence: ['功能原理与场景资料','参数与选型资料','工艺与交付能力','资质与认证资料','真实应用案例','使用说明与限制'],
  actions: ['产品咨询','门店体验','提交需求与询价','技术交流与样品咨询','预约演示','申请试用']
};
function hasBusinessValue(key) {
  const value=String(state[key] || '').trim();
  return Boolean(value) && value!==String(defaults[key] || '').trim() && value!=='启动阶段确认本次主推的产品或服务';
}
function syncPresets() {
  document.querySelectorAll('[data-preset-field]').forEach(button=>{
    const lines=String(state[button.dataset.presetField] || '').split('\n').map(x=>x.trim()).filter(Boolean);
    button.setAttribute('aria-pressed',String(lines.includes(button.dataset.presetValue)));
  });
}
function renderBusinessFocus() {
  document.querySelectorAll('#document [data-focus]').forEach(target=>{
    target.replaceChildren();const key=target.dataset.focus;
    const block=target.closest('[data-focus-block]');
    const present=hasBusinessValue(key);if(block)block.hidden=!present;
    if(!present)return;
    for(const text of String(state[key]).split('\n').map(x=>x.trim()).filter(Boolean)){
      const chip=document.createElement('span');chip.className='focus-chip';chip.textContent=text;target.append(chip);
    }
  });
  document.querySelectorAll('#document [data-optional-field]').forEach(wrapper=>{wrapper.hidden=!hasBusinessValue(wrapper.dataset.optionalField);});
}
function requireBusiness() {
  const input=document.getElementById('field-business');
  const valid=Boolean(String(state.business || '').trim()) && state.business!=='启动阶段确认本次主推的产品或服务';
  input.setCustomValidity(valid?'':'请填写本次主推的产品或服务，再继续或导出客户版。');
  if(!valid){document.dispatchEvent(new Event('geo:business-required'));input.focus();input.reportValidity();}
  return valid;
}
function buildFields() {
  for (const [group, names] of Object.entries(fieldGroups)) {
    const container = document.querySelector(`[data-field-group="${group}"]`);
    for (const name of names) {
      const definition=fieldDefs.find(item=>item[0]===name);
      const [label,width='',hint='']=fieldInfo[name] || [definition[1],'',''];
      const type=definition[2] || 'text';
      const wrapper=document.createElement('label'); wrapper.className='field '+width;
      const title=document.createElement('span'); title.className='field-title'; title.textContent=label;
      const input=document.createElement(type==='textarea'?'textarea':'input');
      if(type!=='textarea') input.type=type;
      input.name=name; input.value=state[name] || ''; input.id='field-'+name;
      if(customerPlaceholders[name])input.placeholder=customerPlaceholders[name];
      if(name==='business'){input.required=true;input.setAttribute('aria-required','true');input.placeholder='填写本次主推的产品或服务';}
      if(type==='textarea') input.rows=name==='questions'||name==='scope'?4:3;
      if(hint){const help=document.createElement('span');help.className='field-hint';help.id='hint-'+name;help.textContent=hint;input.setAttribute('aria-describedby',help.id);wrapper.append(title,input,help);}else wrapper.append(title,input);
      input.addEventListener('input',()=>{input.setCustomValidity('');state[name]=input.value;render();dirty();});
      if(presetOptions[name]){
        const block=document.createElement('div');block.className='field-block '+width;
        const presets=document.createElement('div');presets.className='preset-options';presets.setAttribute('role','group');presets.setAttribute('aria-label',label+'预设词');
        for(const text of presetOptions[name]){
          const button=document.createElement('button');button.type='button';button.className='preset-chip';button.dataset.presetField=name;button.dataset.presetValue=text;button.textContent=text;button.setAttribute('aria-pressed','false');
          button.onclick=()=>{
            const source=input.value===defaults[name]?'':input.value;
            const lines=source.split('\n').map(x=>x.trim()).filter(Boolean);
            input.value=(lines.includes(text)?lines.filter(x=>x!==text):[...lines,text]).join('\n');
            input.dispatchEvent(new Event('input',{bubbles:true}));
          };presets.append(button);
        }
        block.append(wrapper,presets);container.append(block);
      }else if(name==='region' || name==='exceptions'){
        const details=document.createElement('details');details.className=name==='exceptions'?'business-exceptions wide':'optional-field wide';details.dataset.optionalInput=name;
        const summary=document.createElement('summary');summary.textContent=name==='region'?'补充服务区域（如有）':'补充行业或业务例外事项（如有）';
        details.append(summary,wrapper);container.append(details);
      }else container.append(wrapper);
    }
  }
}
function copyEditor(key, label, hint='') {
  const wrapper=document.createElement('label'); wrapper.className='field wide';
  const title=document.createElement('span');title.className='field-title';title.textContent=label;
  const input=document.createElement('textarea');input.dataset.copy=key;input.id='copy-'+key;
  input.value=editorValue(key,copyState[key] || '');
  if(key==='goals')input.placeholder='可留空沿用标准服务目标；如需调整，直接填写本次目标';
  input.rows=(key==='goals'||key==='optional'||key==='boundary')?4:3;
  input.addEventListener('input',()=>{copyState[key]=key==='goals'&&!input.value.trim()?originalCopy.goals:copyPrefix(key)+input.value;const target=document.querySelector(`#document [data-edit="${key}"]`);if(target)target.textContent=copyState[key];dirty();document.dispatchEvent(new Event('geo:report-change'));});
  wrapper.append(title,input);
  if(hint){const help=document.createElement('span');help.className='field-hint';help.textContent=hint;wrapper.append(help);}
  return wrapper;
}
function copySection(container, title, subtitle, entries, open=false) {
  const detail=document.createElement('details');detail.className='copy-section';detail.dataset.copySection=entries[0][0];detail.open=open;
  const summary=document.createElement('summary');const heading=document.createElement('span');heading.className='copy-section-title';heading.textContent=title;summary.append(heading);
  if(subtitle){const sub=document.createElement('small');sub.textContent=subtitle;summary.append(sub);}
  const fields=document.createElement('div');fields.className='copy-fields';
  for(const [key,label] of entries)fields.append(copyEditor(key,label));
  detail.append(summary,fields);container.append(detail);
}
function buildCopyEditors() {
  document.getElementById('goals-editor').append(copyEditor('goals','本次服务希望推动的方向（选填调整）','留空时沿用标准服务目标；填写后替换，清空后恢复标准目标。'));
  const schedule=document.getElementById('schedule-editors');
  const stages=[['第1周','了解业务，记录现状',1],['第2周','知识资料与信源准备',2],['第3周','首批内容制作与核对',3],['第4周','发布、复测与调整',4]];
  for(const [title,sub,n] of stages)copySection(schedule,title,sub,[['w'+n,'我们主要做什么'],['d'+n,'客户能看到什么'],['c'+n,'客户需要配合什么']],n===1);
  copySection(schedule,'排期说明','服务起算与调整条件',[['timing','对客说明']]);
  const annual=document.getElementById('annual-editors');
  const annualTitles=[['第1个月','建立基础与观察起点'],['第2—3个月','验证方向并补齐核心问题'],['第4—6个月','扩展产品与客户场景'],['第7—9个月','跟随业务变化深化运营'],['第10—12个月','整理成果与后续重点']];
  annualTitles.forEach(([title,subtitle],i)=>copySection(annual,title,subtitle,[['annual_stage'+(i+1)+'_work','阶段工作重点'],['annual_stage'+(i+1)+'_output','阶段交付']],i===1));
  copySection(annual,'每月固定交付','每个月执行、留档、复测与调整',[['monthly_plan','月度执行计划'],['monthly_content','内容与发布台账'],['monthly_monitor','监测与问题记录'],['monthly_review','月度复盘与下月安排']],true);
  copySection(annual,'持续运营与期满总结','兼容原有方案的运营与总结安排',[['w5','持续运营工作'],['d5','持续运营交付'],['w6','期满总结与建议'],['annual_note','年度排期与范围说明']]);
  const content=document.getElementById('content-editors');
  copySection(content,'具体工作','六项工作的实际内容与适用范围',[['a1','企业知识整理'],['a2','关键词与平台定位'],['a3','内容制作与核对'],['a4','公开信息与信源建设'],['a5','内容发布与留档'],['a6','复测与信息更新'],['optional','可选专项与范围说明']]);
  copySection(content,'进展反馈与监测','查看方式与观察口径',[['access','客户怎样查看进展'],['metric1','问题范围与可比性'],['metric2','监测记录与比例口径'],['metric3','监测结果的适用限制']]);
  copySection(content,'合作与总结','服务边界与下一步',[['boundary','服务范围与效果说明'],['end','期满交付与后续建议'],['next','下一步安排']]);
}
function downloadCustomer() {
  if(!requireBusiness())return;
  const doc=document.implementation.createHTMLDocument(state.client+'｜GEO服务初步执行方案');
  doc.documentElement.lang='zh-CN';
  const charset=doc.createElement('meta');charset.setAttribute('charset','utf-8');
  const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';
  doc.head.prepend(charset);doc.head.append(viewport,document.getElementById('report-style').cloneNode(true));
  const report=document.getElementById('document').cloneNode(true);report.hidden=false;
  report.querySelectorAll('.page').forEach(page=>page.hidden=false);
  report.querySelectorAll('[data-bind],[data-edit]').forEach(el=>{el.removeAttribute('data-bind');el.removeAttribute('data-edit');el.removeAttribute('contenteditable');});
  doc.body.className='client';doc.body.append(report);
  const blob=new Blob(['<!doctype html>\n'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
  a.download=(state.client||'客户企业').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')+'_GEO服务初步执行方案_客户版.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  say('已导出完整六页客户版，不包含方案库及编辑工具。');
}
document.getElementById('export').onclick=downloadCustomer;
document.getElementById('print').onclick=()=>{if(requireBusiness())window.print();};
window.addEventListener('beforeunload',event=>{if(changed){event.preventDefault();event.returnValue='';}});
buildFields();buildCopyEditors();applyReport({fields:state,copy:copyState});
