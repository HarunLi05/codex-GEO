'use strict';
(() => {
  const KEY = 'yizhantui.geo.workspace.v1';
  const MAX_VERSIONS = 30;
  const generic = collect();
  const templates = {generic};
  const $ = id => document.getElementById(id);
  let store = {schema: 1, revision: '', activeId: '', plans: []};
  let timer, pending = false, conflict = false, available = true, selectedVersion = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const time = value => new Date(value).toLocaleString('zh-CN', {hour12: false});
  const now = () => new Date().toISOString();
  const current = () => store.plans.find(p => p.id === store.activeId);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const error = message => { $('storage-error').hidden = false; $('storage-error').textContent = message; $('persist-status').textContent = '尚未保存'; };
  const clearError = () => { $('storage-error').hidden = true; };
  function persist() {
    if (conflict) return false;
    try {
      // Check the disk revision again before every write; a second tab must never silently overwrite work.
      const disk = localStorage.getItem(KEY);
      if (disk && JSON.parse(disk).revision !== store.revision) { lock(); return false; }
      const revision = id();
      localStorage.setItem(KEY, JSON.stringify({...store, revision}));
      store.revision = revision;
      available = true; changed = false; clearError();
      $('persist-status').textContent = '已保存到此浏览器 · ' + time(current()?.updatedAt || now());
      return true;
    } catch (e) {
      available = false; changed = true;
      error('保存失败：浏览器存储不可用或空间不足。当前编辑仍在页面中，请先“备份全部方案”或导出客户版，避免关闭后丢失。');
      return false;
    }
  }
  function lock() {
    conflict = true; changed = true;
    error('另一个标签页修改了方案库，本页已暂停自动保存以避免覆盖。请先备份本页方案，再刷新获取最新记录。');
  }
  function snapshot(plan, label, force = false) {
    const last = plan.versions[0];
    if (!force && last && equal(last.data, plan.data)) return;
    plan.versions.unshift({id: id(), at: now(), label, data: clone(plan.data)});
    plan.versions = plan.versions.slice(0, MAX_VERSIONS);
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return !conflict && available;
    const plan = current();
    if (!plan) return false;
    plan.data = clone(collect()); plan.name = state.client.trim() || '未命名方案'; plan.updatedAt = now();
    const last = plan.versions[0];
    if (!last || Date.now() - Date.parse(last.at) >= 5 * 60 * 1000) snapshot(plan, '自动留存');
    if (!persist()) return false;
    pending = false; renderPlans(); return true;
  }
  function schedule() {
    pending = true; changed = true;
    $('persist-status').textContent = conflict ? '保存已暂停' : '正在保存…';
    clearTimeout(timer); timer = setTimeout(flush, 600);
  }
  function apply(data) {
    applyReport(data);
    changed = false;
    $('current-plan-name').textContent = current()?.name || state.client;
    say('编辑会自动保存；可从“更多操作”保存历史版本。');
    document.dispatchEvent(new Event('geo:plan-applied'));
  }
  function renderPlans() {
    const list = $('plan-list'); list.replaceChildren();
    const query = $('search-plans').value.trim().toLowerCase();
    const plans = [...store.plans].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).filter(p => p.name.toLowerCase().includes(query));
    for (const plan of plans) {
      const button = document.createElement('button'); button.className = 'plan-card'; button.type = 'button';
      button.setAttribute('aria-current', String(plan.id === store.activeId)); button.dataset.planId = plan.id;
      const title = document.createElement('strong'); title.textContent = plan.name;
      const meta = document.createElement('span'); meta.textContent = time(plan.updatedAt) + ' · ' + plan.versions.length + '个版本';
      button.append(title, meta); button.onclick = () => {open(plan.id); document.dispatchEvent(new Event('geo:library-choice'));}; list.append(button);
    }
    if (!plans.length) { const el = document.createElement('div'); el.className='empty-list'; el.textContent='没有匹配的方案，可以新建或更换搜索词。'; list.append(el); }
    $('current-plan-name').textContent = current()?.name || '';
  }
  function open(planId) {
    if (planId === store.activeId) return;
    if (!flush() || conflict) return;
    const before = clone(store);
    snapshot(current(), '切换前留存'); store.activeId = planId;
    if (persist()) {apply(current().data); renderPlans(); document.dispatchEvent(new Event('geo:plan-opened'));} else store = before;
  }
  function makePlan(template, name) {
    const data = clone(templates[template]);
    data.fields.client = name || '';
    const d = new Date(); data.fields.date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const plan = {id: id(), name: data.fields.client || '未命名客户方案', data, updatedAt: now(), versions: []};
    snapshot(plan, '创建方案'); return plan;
  }
  function manualSave() {
    if (!flush() || conflict) return;
    snapshot(current(), '手动保存', true);
    if (persist()) {renderPlans(); say('已保存一个历史版本，可从“历史版本”查看与恢复。');}
  }
  function renderHistory() {
    const list = $('history-list'); list.replaceChildren(); $('version-preview').hidden = true;
    for (const version of current().versions) {
      const row = document.createElement('div'); row.className = 'version-item';
      const text = document.createElement('div'); text.textContent = version.label;
      const stamp = document.createElement('small'); stamp.textContent = time(version.at); text.append(stamp);
      const button = document.createElement('button'); button.textContent = '查看';
      button.onclick = () => {
        selectedVersion = version; $('version-title').textContent = version.label + ' · ' + time(version.at);
        $('version-summary').textContent = Object.entries(version.data.fields).map(([key,value]) => (fieldDefs.find(f=>f[0]===key)?.[1] || key) + '：' + value).join('\n\n') + '\n\n正文：\n' + Object.values(version.data.copy).join('\n\n');
        $('version-preview').hidden = false;
      };
      row.append(text,button); list.append(row);
    }
  }
  function dataValid(data) {
    return data && typeof data === 'object' && data.fields && typeof data.fields === 'object' && data.copy && typeof data.copy === 'object' &&
      Object.values(data.fields).every(x=>typeof x==='string') && Object.values(data.copy).every(x=>typeof x==='string');
  }
  function storeValid(value) {
    return value && value.schema === 1 && Array.isArray(value.plans) && value.plans.length > 0 && typeof value.revision === 'string' &&
      value.plans.every(p => p && typeof p.id==='string' && typeof p.name==='string' && typeof p.updatedAt==='string' && dataValid(p.data) && Array.isArray(p.versions) && p.versions.every(v=>typeof v.id==='string' && typeof v.at==='string' && typeof v.label==='string' && dataValid(v.data))) &&
      new Set(value.plans.map(p=>p.id)).size === value.plans.length && value.plans.some(p=>p.id===value.activeId);
  }
  function backup() {
    // Include live unsaved edits even after a storage error or a multi-tab conflict.
    const data = clone(store); const plan = data.plans.find(p=>p.id===data.activeId);
    if (plan) {plan.data = clone(collect()); plan.name = state.client.trim() || '未命名方案'; plan.updatedAt=now();}
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='GEO方案库备份_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('create-plan').onclick = () => {
    if (!flush() || conflict) return;
    const name = $('new-name').value.trim();
    if (!name) {$('new-name').setCustomValidity('请填写客户或方案名称'); $('new-name').reportValidity(); return;}
    $('new-name').setCustomValidity(''); const before=clone(store); snapshot(current(),'新建前留存');
    const plan=makePlan($('new-template').value,name); store.plans.push(plan); store.activeId=plan.id;
    if (persist()) {apply(plan.data); renderPlans(); $('new-dialog').close(); document.dispatchEvent(new Event('geo:plan-opened'));} else store=before;
  };
  $('new-name').oninput=()=> $('new-name').setCustomValidity('');
  $('new-plan').onclick=()=>{document.getElementById('plan-menu').open=false; $('new-name').value=''; $('new-dialog').showModal();};
  $('copy-plan').onclick=()=>{
    if (!flush() || conflict) return;
    const before=clone(store);
    const plan={id:id(),name:current().name+'（副本）',data:clone(current().data),updatedAt:now(),versions:[]};
    plan.data.fields=normalizeCustomerFields(plan.data.fields); if(String(plan.data.fields.client||'').trim())plan.data.fields.client=plan.name; snapshot(plan,'复制方案'); store.plans.push(plan); store.activeId=plan.id;
    if(persist()){apply(plan.data);renderPlans();document.dispatchEvent(new Event('geo:plan-opened'));} else store=before;
  };
  $('show-history').onclick=()=>{if(!flush() || conflict)return; renderHistory();$('history-dialog').showModal();};
  $('close-history').onclick=()=> $('history-dialog').close();
  $('restore-version').onclick=()=>{
    if(!selectedVersion || !flush() || conflict)return;
    const before=clone(store); const data=clone(selectedVersion.data); snapshot(current(),'恢复前备份',true);
    current().data=data; current().name=data.fields.client || '未命名方案'; current().updatedAt=now(); snapshot(current(),'恢复历史版本',true);
    if(persist()){apply(data);renderPlans();$('history-dialog').close();say('已恢复历史版本，恢复前的内容也已留存。');} else store=before;
  };
  $('save').onclick=manualSave; $('search-plans').oninput=renderPlans; $('backup-plans').onclick=backup;
  $('import-plans').onchange=async event=>{
    const file=event.target.files[0]; if(!file)return;
    try {
      const incoming=JSON.parse(await file.text()); if(!storeValid(incoming))throw Error('invalid');
      if(!flush() || conflict)return;
      const before=clone(store);
      // Import as new documents, retaining every existing plan and avoiding ID collisions.
      for(const p of incoming.plans){const plan=clone(p);plan.id=id();plan.name+='（导入）';plan.data.fields=normalizeCustomerFields(plan.data.fields);if(String(plan.data.fields.client||'').trim())plan.data.fields.client=plan.name;plan.versions=plan.versions.slice(0,MAX_VERSIONS);store.plans.push(plan);}
      if(persist()){renderPlans();say('已导入 '+incoming.plans.length+' 个方案，原有方案已保留。');} else store=before;
    }catch(e){error('导入失败：请选择有效的“GEO方案库备份”JSON文件，现有记录未被替换。');}finally{event.target.value='';}
  };
  document.addEventListener('input',event=>{if(event.target.closest('#fields') || event.target.closest('[data-edit]'))schedule();});
  window.addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
  window.addEventListener('storage',event=>{if(event.key===KEY)lock();});
  window.addEventListener('beforeunload',flush,{capture:true});
  try {
    const raw=localStorage.getItem(KEY);
    if(raw){const parsed=JSON.parse(raw);if(!storeValid(parsed))throw Error('invalid store');store=parsed;}
    else {const plan=makePlan('generic','');store.plans=[plan];store.activeId=plan.id;}
    if(persist()){apply(current().data);snapshot(current(),'打开前留存');persist();}
    else apply(current().data);
  } catch(e) {
    // A damaged database is never overwritten. Editing and a local backup remain available.
    conflict=true;const plan=makePlan('generic','临时方案（未保存）');store.plans=[plan];store.activeId=plan.id;apply(plan.data);
    error('无法读取已有方案库，本次未覆盖原始存储。请先备份当前编辑内容，并保留此浏览器数据以便排查。');
  }
  renderPlans();
})();
