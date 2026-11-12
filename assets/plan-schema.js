/* Shared field names and review groups; contains no customer data. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GEOPlanSchema=factory();})(globalThis,function(){
  'use strict';
  const field=(path,label,destination,note='')=>({path,label,destination,note});
  const sections=[
    {id:'profile',label:'客户资料与目标',fields:[
      field('fields.client','客户 / 品牌名称','客户资料 → 企业与业务'),field('fields.business','主推业务 / 产品','客户资料 → 推广什么'),field('fields.audience','目标客户','客户资料 → 影响谁'),field('fields.region','补充服务区域','客户资料 → 补充服务区域'),field('fields.concern','优先关注的问题','客户资料 → 解决什么问题'),field('fields.evidence','核心依据与优势','客户资料 → 凭什么选择','核实资质、案例和履历，资料缺失不能写成已具备。'),field('fields.actions','希望承接的行动','客户资料 → 怎样承接'),field('fields.questions','拟观察的客户提问','客户资料 → 补充问题清单与调整标准目标','每行一个，共5个真实提问，包含售后或退改等服务保障。'),field('copy.goals','本次服务希望推动的方向','客户资料 → 补充问题清单与调整标准目标')]},
    {id:'service',label:'服务内容与报价',fields:[
      ...[['provider','服务方'],['date','方案日期'],['duration','服务周期'],['platforms','拟关注 AI 平台'],['keywords','关键词 / 问题范围'],['scope','服务项目与数量'],['fee','服务费用']].map(([key,label])=>field('fields.'+key,label,'服务安排 → 服务内容与报价',['provider','date','duration','platforms','scope','fee'].includes(key)?'来自你填写的服务配置；核对后复制，不由模型另定金额、数量或周期。':'')),
      ...[['start','服务启动安排'],['cadence','反馈与复测节奏'],['review','内容核对安排'],['exceptions','行业或业务例外事项']].map(([key,label])=>field('fields.'+key,label,'服务安排 → 服务内容与报价 → 启动与配合'))]},
    {id:'schedule',label:'首月与全期排期',fields:[
      ...[1,2,3,4].flatMap(n=>[['w','我们主要做什么'],['d','客户能看到什么'],['c','客户需要配合什么']].map(([prefix,label])=>field('copy.'+prefix+n,'第'+n+'周 · '+label,'服务安排 → 首月排期 → 第'+n+'周'))),field('copy.timing','首月排期说明','服务安排 → 首月排期 → 排期说明'),
      ...[1,2,3,4,5].flatMap(n=>[['work','阶段工作重点'],['output','阶段交付']].map(([suffix,label])=>field('copy.annual_stage'+n+'_'+suffix,'阶段'+n+' · '+label,'服务安排 → 年度运营 → 对应阶段'))),
      ...[['monthly_plan','月度执行计划'],['monthly_content','内容与发布台账'],['monthly_monitor','监测与问题记录'],['monthly_review','月度复盘与下月安排'],['w5','持续运营工作'],['d5','持续运营交付'],['w6','期满总结与建议'],['annual_note','全期排期与范围说明']].map(([key,label])=>field('copy.'+key,label,'服务安排 → 年度运营'))]},
    {id:'operations',label:'工作说明与反馈',fields:[
      ...[['a1','企业知识整理'],['a2','关键词与平台定位'],['a3','内容制作与核对'],['a4','公开信息与信源建设'],['a5','内容发布与留档'],['a6','复测与信息更新'],['optional','可选专项与范围说明']].map(([key,label])=>field('copy.'+key,label,'服务安排 → 工作说明 → 具体工作')),
      ...[['access','客户怎样查看进展'],['metric1','问题范围与可比性'],['metric2','监测记录与比例口径'],['metric3','监测结果的适用限制']].map(([key,label])=>field('copy.'+key,label,'服务安排 → 工作说明 → 进展反馈与监测')),
      ...[['boundary','服务范围与效果说明'],['end','期满交付与后续建议'],['next','下一步安排']].map(([key,label])=>field('copy.'+key,label,'服务安排 → 工作说明 → 合作与总结'))]}
  ];
  const allFields=sections.flatMap(s=>s.fields);
  const lockedPaths=['fields.provider','fields.date','fields.duration','fields.platforms','fields.scope','fields.fee'];
  const placeholder=/【[^】]+】|\$\{[^}]+\}|\{\{[^}]+\}\}|\[(?:客户|企业|品牌|产品|品类|地区|区域|名称|请填|待填)[^\]]*\]|[（(](?:客户名称|企业名称|品牌名称|产品名称|请填写|待填写|请替换)[^）)]*[）)]|(?:请替换|产品名称待填)/u;
  function getSection(id){return sections.find(s=>s.id===id);}
  function periodStages(months){
    const count=Number(months);const known=Number.isInteger(count)&&count>=1&&count<=120;
    const n=known?count:12;
    return {known,months:known?n:null,stages:[[1,1],[2,3],[4,6],[7,9],[10,Math.max(12,n)]].map(([start,end],i)=>({index:i+1,start,end:Math.min(end,n),active:start<=n,label:start>n?'本周期不另设此阶段':start===Math.min(end,n)?'第'+start+'个月':'第'+start+'—'+Math.min(end,n)+'个月'}))};
  }
  function parseDuration(text){
    const source=String(text||'').trim();
    const prefix='^(?:(?:拟|计划)\\s*)?(?:服务(?:周期|期限|期)?[：:\\s]*)?';
    let m=source.match(new RegExp(prefix+'(\\d{1,3})\\s*(?:个)?月\\s*(?:[+＋]\\s*(?:加赠|赠送|赠)?|加赠|赠送|赠)\\s*(\\d{1,3})\\s*(?:个)?月'));
    if(m)return periodStages(Number(m[1])+Number(m[2]));
    m=source.match(new RegExp(prefix+'(\\d{1,3})\\s*(?:个)?月'));if(m)return periodStages(Number(m[1]));
    m=source.match(new RegExp(prefix+'(\\d{1,2})\\s*年'));return periodStages(m?Number(m[1])*12:null);
  }
  function canonicalFields(facts={}){
    const text=key=>String(facts[key]||'').trim();
    const p=periodStages(text('durationMonths'));
    const type={execution_quota:'以下为服务执行使用的系统资源额度，不等同于同量确认稿件、确认成片或发布交付。',deliverables:'以下为已提供的交付数量；具体计数、分配与执行安排按双方确认计划记录。',unspecified:'以下数量的计量口径尚需确认，不自动视为成品交付承诺。'}[text('resourceType')]||'以下数量的计量口径尚需确认，不自动视为成品交付承诺。';
    const scope=['实际服务范围：',text('scope')||'尚未提供已确认服务范围，启动前共同明确。'];
    if(text('resources'))scope.push('数量与资源配置：',text('resources'),type);
    return {provider:text('provider')||'服务方待确认',date:text('date'),duration:p.known?p.months+'个月，自双方确认的服务启动日起算':'服务周期待双方确认',platforms:text('platforms')||'启动阶段共同确认目标AI平台',scope:scope.join('\n'),fee:text('fee')};
  }
  function validateSection(value,id){
    const section=getSection(id);if(!section||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='copy,fields')return false;
    for(const part of ['fields','copy']){
      const entries=value[part];if(!entries||typeof entries!=='object'||Array.isArray(entries))return false;
      const expected=section.fields.filter(f=>f.path.startsWith(part+'.')).map(f=>f.path.split('.')[1]);
      if(Object.keys(entries).length!==expected.length||expected.some(k=>!Object.hasOwn(entries,k)))return false;
      for(const key of expected){const text=entries[key];const path=part+'.'+key;
        if(typeof text!=='string'||text.length>16000)return false;
        if(!text.trim()&&!['fields.fee','fields.date'].includes(path))return false;
        if(!lockedPaths.includes(path)&&(placeholder.test(text)||/^(?:null|undefined|N\/A|请填写|待填写)$/i.test(text.trim())))return false;
        if(path==='fields.questions'){
          const lines=text.split('\n').map(s=>s.trim()).filter(Boolean);
          if(lines.length!==5||new Set(lines.map(s=>s.replace(/\s+/g,''))).size!==5||lines.some(s=>s.length>600||!/[？?]$/u.test(s)))return false;
        }
      }
    }
    return true;
  }
  return {sections,allFields,lockedPaths,getSection,periodStages,parseDuration,canonicalFields,validateSection};
});
