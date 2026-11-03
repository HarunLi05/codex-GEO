'use strict';
const defaults={client:'客户企业 / 品牌名称',provider:'壹站推',date:'',duration:'待双方确认',business:'启动阶段确认本次主推的产品或服务',audience:'启动阶段明确目标客户及主要需求',region:'按贵司实际服务范围确认',concern:'确认企业信息是否完整、相关问题中如何呈现，以及优先建设哪些内容。',platforms:'启动阶段根据客户使用场景确认目标 AI 平台',questions:'寻找这类产品或服务时，有哪些企业值得了解？\n选择服务商时应关注哪些条件？\n贵司的产品、服务流程和适用场景是什么？',start:'从双方确认的服务启动日计算；具体日期及启动条件另行确认。',keywords:'关键词及问题范围：首周拟定，第2周共同确认。',scope:'基础工作：企业资料与知识库整理、关键词与问题规划、内容制作、约定发布、监测与服务反馈。\n文章、视频、发布数量及渠道：待双方确认服务清单。\n专项工作是否包含：另行列明。',fee:'',review:'由贵司核对内容涉及的业务事实、价格、参数及品牌表达，汇总反馈后沟通修改，确认版本再发布。具体核对时限与修改安排在启动时确认。',cadence:'拟每周反馈一次服务进展，按月安排内容与发布工作，结合阶段监测开展复盘。具体反馈、复测及复盘频次，须在启动前共同确认。',contact:'启动时确认服务对接人与联系方式'};
const fieldDefs=[['client','客户企业 / 品牌名称'],['provider','服务方'],['date','方案日期','date'],['business','主推业务 / 产品','textarea'],['audience','目标客户','textarea'],['region','重点服务区域','textarea'],['concern','本次优先关注的问题','textarea','two'],['duration','拟服务周期'],['platforms','拟关注 AI 平台'],['keywords','关键词 / 问题范围','textarea','two'],['questions','拟观察的问题（每行一个，建议3项）','textarea','wide'],['start','服务启动安排','textarea','wide'],['scope','拟服务项目与数量（未确认可保留待定）','textarea','wide'],['cadence','反馈、复测与复盘节奏','textarea','wide'],['review','内容核对安排','textarea','wide'],['fee','服务费用（留空不展示）'],['contact','服务对接与联系方式','text','two']];
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
  direction: ['concern','platforms','questions'],
  contract: ['provider','date','duration','keywords','scope','fee','contact'],
  execution: ['start','cadence','review']
};
const fieldInfo = {
  client: ['客户 / 品牌名称','wide','将显示在方案标题和页脚。'],
  business: ['主推业务 / 产品','wide','本次重点推广什么？写明产品或服务及真实特点。'],
  audience: ['目标客户','','客户是谁，通常有什么需求？'],
  region: ['重点服务区域','','可写城市、商圈，或线上销售覆盖范围。'],
  concern: ['客户希望解决的问题','wide','例如增加产品认知、完善品牌信息、支持咨询购买。'],
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
  document.querySelectorAll('#document [data-bind]').forEach(el => {el.textContent = state[el.dataset.bind] || '';});
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
  const prefix=copyPrefix(key); if (!prefix) return value;
  const base=prefix.slice(0,-1); return value.replace(new RegExp('^'+base+'[：:\\s]*'),'');
}
function syncCopyEditors() {
  document.querySelectorAll('[data-copy]').forEach(input => {input.value = editorValue(input.dataset.copy, copyState[input.dataset.copy] || '');});
}
function applyReport(data) {
  state = {...defaults, ...data.fields};
  copyState = {...originalCopy, ...data.copy};
  for (const input of document.querySelectorAll('#fields [name]')) input.value = state[input.name] || '';
  document.querySelectorAll('#document [data-edit]').forEach(el => {el.textContent = copyState[el.dataset.edit] || '';});
  syncCopyEditors(); render();
}
function collect() {return {fields: {...state}, copy: {...copyState}};}
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
      if(type==='textarea') input.rows=name==='questions'||name==='scope'?4:3;
      if(hint){const help=document.createElement('span');help.className='field-hint';help.id='hint-'+name;help.textContent=hint;input.setAttribute('aria-describedby',help.id);wrapper.append(title,input,help);}else wrapper.append(title,input);
      input.addEventListener('input',()=>{state[name]=input.value;render();dirty();});
      container.append(wrapper);
    }
  }
}
function copyEditor(key, label, hint='') {
  const wrapper=document.createElement('label'); wrapper.className='field wide';
  const title=document.createElement('span');title.className='field-title';title.textContent=label;
  const input=document.createElement('textarea');input.dataset.copy=key;input.id='copy-'+key;
  input.value=editorValue(key,copyState[key] || '');input.rows=(key==='goals'||key==='optional'||key==='boundary')?4:3;
  input.addEventListener('input',()=>{copyState[key]=copyPrefix(key)+input.value;const target=document.querySelector(`#document [data-edit="${key}"]`);if(target)target.textContent=copyState[key];dirty();document.dispatchEvent(new Event('geo:report-change'));});
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
  document.getElementById('goals-editor').append(copyEditor('goals','本次服务希望推动的方向','说明准备怎样回应客户需求，避免承诺固定排名或销量。'));
  const schedule=document.getElementById('schedule-editors');
  const stages=[['第1周','了解业务，记录现状',1],['第2周','知识资料与信源准备',2],['第3周','首批内容制作与核对',3],['第4周','发布、复测与调整',4]];
  for(const [title,sub,n] of stages)copySection(schedule,title,sub,[['w'+n,'我们主要做什么'],['d'+n,'客户能看到什么'],['c'+n,'客户需要配合什么']],n===1);
  copySection(schedule,'第2个月起','持续运营',[['w5','我们主要做什么'],['d5','客户能看到什么']]);
  copySection(schedule,'服务期满','总结与后续沟通',[['w6','总结工作与交付']]);
  copySection(schedule,'排期说明','服务起算与调整条件',[['timing','对客说明']]);
  const content=document.getElementById('content-editors');
  copySection(content,'具体工作','六项工作的实际内容与适用范围',[['a1','企业知识整理'],['a2','关键词与平台定位'],['a3','内容制作与核对'],['a4','公开信息与信源建设'],['a5','内容发布与留档'],['a6','复测与信息更新'],['optional','可选专项与范围说明']]);
  copySection(content,'进展反馈与监测','查看方式与观察口径',[['access','客户怎样查看进展'],['metric1','问题范围与可比性'],['metric2','监测记录与比例口径'],['metric3','监测结果的适用限制']]);
  copySection(content,'合作与总结','服务边界与下一步',[['boundary','服务范围与效果说明'],['end','期满交付与后续建议'],['next','下一步安排']]);
}
function downloadCustomer() {
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
  say('已导出完整五页客户版，不包含方案库及编辑工具。');
}
document.getElementById('export').onclick=downloadCustomer;
document.getElementById('print').onclick=()=>window.print();
window.addEventListener('beforeunload',event=>{if(changed){event.preventDefault();event.returnValue='';}});
buildFields();buildCopyEditors();applyReport({fields:state,copy:copyState});
