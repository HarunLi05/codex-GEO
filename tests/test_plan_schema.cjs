/* Pure schema checks: fixture values are deliberately fictitious. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const schema=require('../assets/plan-schema.js');

test('the shared browser and worker schema has exactly 19 fields and 46 copy fields',()=>{
  assert.deepEqual(schema.sections.map(s=>[s.id,s.fields.length]),[['profile',9],['service',11],['schedule',31],['operations',14]]);
  assert.equal(schema.allFields.length,65);
  assert.equal(new Set(schema.allFields.map(f=>f.path)).size,65);
  assert.equal(schema.allFields.filter(f=>f.path.startsWith('fields.')).length,19);
  assert(schema.allFields.every(f=>f.label&&f.destination));
  const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../assets/plan-schema.js'),'utf8'),sandbox);
  assert.equal(sandbox.GEOPlanSchema.allFields.length,65);
});
test('service stages cover every confirmed month once and unknown duration stays unknown',()=>{
  for(const n of [1,2,3,6,12,13,18,24,120]){
    const p=schema.periodStages(n);assert.equal(p.months,n);
    assert.deepEqual(p.stages.filter(s=>s.active).flatMap(s=>Array.from({length:s.end-s.start+1},(_,i)=>s.start+i)),Array.from({length:n},(_,i)=>i+1));
  }
  for(const value of ['',null,'not-confirmed','0','121'])assert.equal(schema.periodStages(value).known,false);
  for(const [text,n] of [['13个月，自启动日起算',13],['服务周期：13个月',13],['12个月＋赠送1个月',13],['12个月+1个月',13],['2年',24]])assert.equal(schema.parseDuration(text).months,n);
  assert.equal(schema.parseDuration('待双方确认').months,null);
});
test('confirmed amounts, resources and service boundaries come from input rather than model values',()=>{
  const facts={provider:'测试服务方',date:'2026-01-02',durationMonths:'13',fee:'测试报价：3000元\n税费口径尚待确认',scope:'仅提供资料整理，不含拍摄',platforms:'测试平台',resources:'生成额度42次；发布额度7次',resourceType:'execution_quota'};
  const fields=schema.canonicalFields(facts);
  assert.equal(fields.fee,facts.fee);assert.equal(fields.provider,facts.provider);assert.equal(fields.date,facts.date);assert.equal(fields.platforms,facts.platforms);
  assert(fields.scope.includes(facts.scope)&&fields.scope.includes(facts.resources));assert(fields.scope.includes('不等同于同量确认稿件、确认成片或发布交付'));
  const empty=schema.canonicalFields();assert.equal(empty.fee,'');assert.equal(empty.date,'');assert.equal(empty.duration,'服务周期待双方确认');
});
test('section validation rejects extra keys, missing fields and incomplete search questions',()=>{
  const result={fields:{},copy:{}};
  for(const f of schema.getSection('profile').fields){const [part,key]=f.path.split('.');result[part][key]='测试内容';}
  result.fields.questions=Array.from({length:5},(_,i)=>'测试问题'+i+'？').join('\n');
  assert(schema.validateSection(result,'profile'));
  assert(!schema.validateSection({...result,extra:'unexpected'},'profile'));
  assert(!schema.validateSection({...result,fields:{...result.fields,fee:'unrequested'}},'profile'));
  assert(!schema.validateSection({...result,fields:{...result.fields,questions:'重复问题？\n重复问题？'}},'profile'));
  assert(!schema.validateSection({...result,fields:{...result.fields,business:'【客户名称】'}},'profile'));
});
