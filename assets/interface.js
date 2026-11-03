'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const pageTitles=['项目重点','时间与交付','实际工作','进展反馈','合作范围'];
  let view='details', serviceTab='config', page='p1';
  function closeLibrary(){document.body.classList.remove('library-open');$('sidebar-backdrop').hidden=true;$('toggle-library').setAttribute('aria-expanded','false');}
  function showView(name,{scroll=true}={}) {
    view=name;
    for(const item of ['details','service','preview']) {
      $('view-'+item).hidden=item!==name;
      $('step-'+item).setAttribute('aria-selected',String(item===name));
      $('step-'+item).tabIndex=item===name?0:-1;
    }
    document.body.classList.remove('view-details','view-service','view-preview');document.body.classList.add('view-'+name);
    $('document').hidden=name!=='preview';
    $('preview-shortcut').hidden=name==='preview';
    closeLibrary();$('plan-menu').open=false;
    updatePreflight();
    if(scroll)window.scrollTo({top:0,behavior:'instant'});
  }
  function showService(name) {
    serviceTab=name;
    for(const item of ['config','schedule','content']) {
      $('service-'+item).hidden=item!==name;
      $('service-tab-'+item).setAttribute('aria-selected',String(item===name));
      $('service-tab-'+item).tabIndex=item===name?0:-1;
    }
  }
  function showPage(name) {
    page=name;
    document.querySelectorAll('#document .page').forEach(el=>el.hidden=el.id!==name);
    document.querySelectorAll('[data-page]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.page===name)));
    const n=Number(name.slice(1));$('preview-page-label').textContent=`第 ${n} / 5 页 · ${pageTitles[n-1]}`;
    $('edit-preview-page').textContent=['修改客户资料','修改执行排期','修改工作说明','修改反馈说明','修改合作配置'][n-1];
    $('edit-preview-extra').hidden=!['p4','p5'].includes(name);
    $('edit-preview-extra').textContent=name==='p4'?'修改反馈频次':'修改边界与总结';
  }
  function updatePreflight() {
    const fields=[['client','客户名称'],['business','主推业务'],['audience','目标客户'],['scope','服务项目与数量']];
    const pending=fields.filter(([key])=>!String(state[key]||'').trim() || state[key]===defaults[key] || (key==='client'&&state[key]==='未命名客户方案')).map(([,label])=>label);
    $('preflight').textContent=pending.length?'建议补充或确认：'+pending.join('、')+'。当前仍可导出初步沟通版。':'已填写基本业务信息。导出前请确认排期、数量和服务范围符合本次约定。';
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>showView(button.dataset.view));
  document.querySelectorAll('[data-go-view]').forEach(button=>button.onclick=()=>showView(button.dataset.goView));
  document.querySelectorAll('[data-service-tab]').forEach(button=>button.onclick=()=>showService(button.dataset.serviceTab));
  document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>showPage(button.dataset.page));
  $('preview-shortcut').onclick=()=>showView('preview');
  $('home-link').onclick=event=>{event.preventDefault();showView('details');};
  $('edit-preview-page').onclick=()=>{
    if(page==='p1')showView('details');
    else {
      showView('service');showService(page==='p2'?'schedule':page==='p5'?'config':'content');
      const section=page==='p3'?'a1':page==='p4'?'access':page==='p2'?'w1':null;
      if(section){const editor=document.querySelector(`[data-copy-section="${section}"]`);if(editor)editor.open=true;}
    }
  };
  $('edit-preview-extra').onclick=()=>{
    showView('service');
    if(page==='p4'){showService('config');document.getElementById('field-cadence').focus();}
    else {showService('content');document.querySelector('[data-copy-section="boundary"]').open=true;}
  };
  $('toggle-library').onclick=()=>{const open=!document.body.classList.contains('library-open');document.body.classList.toggle('library-open',open);$('sidebar-backdrop').hidden=!open;$('toggle-library').setAttribute('aria-expanded',String(open));if(open)$('search-plans').focus();};
  $('toggle-library').setAttribute('aria-expanded','false');$('toggle-library').setAttribute('aria-controls','plan-sidebar');
  function closeLibraryAndFocus(){closeLibrary();$('toggle-library').focus();}
  $('close-library').onclick=closeLibraryAndFocus;$('sidebar-backdrop').onclick=closeLibraryAndFocus;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(document.body.classList.contains('library-open'))closeLibraryAndFocus();$('plan-menu').open=false;}});
  // Tabs follow the standard arrow-key pattern; navigation never discards form input.
  document.querySelectorAll('[role="tablist"]').forEach(list=>list.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...list.querySelectorAll('[role="tab"]')];const index=tabs.indexOf(document.activeElement);if(index<0)return;
    event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[target].click();tabs[target].focus();
  }));
  $('plan-menu').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{$('plan-menu').open=false;}));
  document.addEventListener('click',event=>{if(!$('plan-menu').contains(event.target))$('plan-menu').open=false;});
  $('history-dialog').addEventListener('close',()=>document.querySelector('#plan-menu summary').focus());
  document.addEventListener('geo:report-change',updatePreflight);
  document.addEventListener('geo:library-choice',()=>{closeLibrary();if(getComputedStyle($('toggle-library')).display!=='none')$('toggle-library').focus();});
  document.addEventListener('geo:plan-opened',()=>{showView('details');showService('config');showPage('p1');});
  showService(serviceTab);showPage(page);showView(view,{scroll:false});
})();
