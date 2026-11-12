import test from 'node:test';
import assert from 'node:assert/strict';
import planSchema from '../../assets/plan-schema.js';
import {createWorker} from '../src/worker.mjs';

// All model transports are mocked. No customer data or real credentials are used.
const TOKEN='v2-unit-test-access-token-not-a-real-credential';
const env={ASSISTANT_ACCESS_TOKEN:TOKEN,DEEPSEEK_API_KEY:'v2-test-deepseek-key',GEMINI_API_KEY:'v2-test-gemini-key'};
const origin='https://harunli05.github.io';
const serviceFacts={
  provider:'示例GEO服务团队',date:'2026-11-12',durationMonths:13,platforms:'DeepSeek、Gemini',
  scope:'企业资料整理、内容制作、发布与监测，按确认计划执行。',fee:'总服务费用人民币26800元，支付方式启动前确认。',
  resources:'全年图文资源额度360次、视频资源额度48次。',resourceType:'execution_quota'
};
const baseInput={
  version:2,provider:'deepseek',companyInfo:'示例工控企业主营工业传感器，面向设备采购方提供选型咨询与售后支持。',
  promotionDirection:'让企业采购了解传感器的选型条件和实际交付服务。',constraints:'未提供认证与专利，不能编造。',serviceFacts
};
const questions=[
  '企业采购工业传感器前需要了解哪些行业背景？',
  '怎样核实示例工控企业的业务与品牌信息？',
  '比较工业传感器时应该核对哪些参数和工况？',
  '采购示例工控企业的传感器前如何确认交付条件？',
  '示例工控企业提供哪些传感器售后支持？'
];
function sectionResult(id) {
  const result={fields:{},copy:{}};
  for(const descriptor of planSchema.getSection(id).fields) {
    const [part,key]=descriptor.path.split('.');
    result[part][key]=descriptor.label+'：依据客户现有资料核实安排，具体执行范围共同确认。';
  }
  if(id==='profile') {
    Object.assign(result.fields,{client:'示例工控企业',business:'工业传感器选型与售后支持，明确型号与参数尚待核实。',questions:questions.join('\n')});
    result.copy.goals='支持企业采购了解传感器选型条件并咨询实际服务，不承诺销量或固定排名。';
  }
  return result;
}
function modelResponse(provider,result) {
  const text=typeof result==='string'?result:JSON.stringify(result);
  const data=provider==='deepseek'?{choices:[{message:{content:text}}]}:{candidates:[{content:{parts:[{text}]}}]};
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
}
function request(body,path='/generate') {
  return new Request('https://assistant.example'+path,{method:body===null?'GET':'POST',headers:{Origin:origin,Authorization:'Bearer '+TOKEN,...(body===null?{}:{'Content-Type':'application/json'})},...(body===null?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
function noNetwork(){throw Error('Unexpected upstream request');}
function stringsOf(value) {
  if(typeof value==='string')return [value];
  if(!value||typeof value!=='object')return [];
  return Object.values(value).flatMap(stringsOf);
}
function promptText(payload){return stringsOf(payload).join('\n');}

test('v2 authenticated configuration advertises all review sections without exposing credentials',async()=>{
  const response=await createWorker({fetcher:noNetwork}).fetch(request(null,'/config'),env);
  assert.equal(response.status,200);const config=await response.json();
  assert.equal(config.planVersion,2);
  assert.deepEqual(config.sections,planSchema.sections.map(({id,label})=>({id,label})));
  assert.equal(config.limits.companyInfo,12000);assert.equal(config.limits.promotionDirection,4000);
  assert.equal(config.limits.constraints,2000);
  const text=JSON.stringify(config);assert(!text.includes(TOKEN));assert(!text.includes(env.DEEPSEEK_API_KEY));assert(!text.includes(env.GEMINI_API_KEY));
});

for(const provider of ['deepseek','gemini']) {
  for(const section of planSchema.sections.map(item=>item.id)) {
    test(`${provider} v2 generates only the ${section} section using its declared JSON shape`,async()=>{
      const calls=[];const generated=sectionResult(section);
      const worker=createWorker({fetcher:async(url,options)=>{calls.push({url,options});return modelResponse(provider,generated);}});
      const response=await worker.fetch(request({...baseInput,provider,section}),env);
      assert.equal(response.status,200);const body=await response.json();
      assert.equal(body.version,2);assert.equal(body.section,section);assert.equal(body.provider,provider);assert.equal(typeof body.requestId,'string');
      const expected=section==='service'?{fields:{...generated.fields,...planSchema.canonicalFields(serviceFacts)},copy:{}}:generated;
      assert.deepEqual(body.result,expected);assert.equal(planSchema.validateSection(body.result,section),true);assert.equal(calls.length,1);
      const payload=JSON.parse(calls[0].options.body);
      if(provider==='deepseek') {
        assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
        assert.equal(calls[0].options.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY);
        assert.deepEqual(payload.response_format,{type:'json_object'});
        assert(payload.max_tokens>0);assert(payload.max_tokens<=8000);
      }else {
        assert.match(calls[0].url,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/);
        assert.equal(calls[0].options.headers['x-goog-api-key'],env.GEMINI_API_KEY);
        assert.equal(payload.generationConfig.responseMimeType,'application/json');
        const schema=payload.generationConfig.responseJsonSchema;
        assert.equal(schema.type,'object');
        assert.deepEqual([...schema.required].sort(),['copy','fields']);
        const supportedKeywords=new Set(['$id','$defs','$ref','$anchor','type','format','title','description','enum','items','prefixItems','minItems','maxItems','minimum','maximum','anyOf','oneOf','properties','additionalProperties','required']);
        const checkSchema=value=>{
          for(const [key,entry] of Object.entries(value)) {
            assert(supportedKeywords.has(key),`unsupported Gemini JSON Schema keyword: ${key}`);
            if(key==='properties')for(const child of Object.values(entry))checkSchema(child);
          }
        };
        checkSchema(schema);
        for(const part of ['fields','copy']) {
          const expectedKeys=Object.keys(generated[part]).sort();
          assert.deepEqual(Object.keys(schema.properties[part].properties).sort(),expectedKeys);
          assert.deepEqual([...(schema.properties[part].required||[])].sort(),expectedKeys);
          assert.equal(schema.properties[part].additionalProperties,false);
          assert(Object.values(schema.properties[part].properties).every(field=>field.type==='string'));
        }
      }
      const text=promptText(payload);assert(text.includes(baseInput.companyInfo));assert(text.includes(baseInput.promotionDirection));
      if(section==='schedule')assert((payload.max_tokens||payload.generationConfig.maxOutputTokens)>=7000);
    });
  }
}

test('v2 service prices, quantities and duration are canonical facts rather than model output',async()=>{
  for(const provider of ['deepseek','gemini']) {
    const generated=sectionResult('service');
    Object.assign(generated.fields,{provider:'模型虚构服务方',date:'2030-01-01',duration:'99个月',platforms:'虚构模型',scope:'9999篇成稿与999条成片均保证发布',fee:'服务费用1元，包含全部税费'});
    const worker=createWorker({fetcher:async()=>modelResponse(provider,generated)});
    const response=await worker.fetch(request({...baseInput,provider,section:'service'}),env);
    assert.equal(response.status,200);const {result}=await response.json();
    for(const [key,value] of Object.entries(planSchema.canonicalFields(serviceFacts)))assert.equal(result.fields[key],value);
    assert(result.fields.scope.includes('360次'));assert(result.fields.scope.includes('48次'));
    assert(result.fields.scope.includes('不等同于同量确认稿件、确认成片或发布交付'));
    assert(!JSON.stringify(result).includes('9999'));assert(!JSON.stringify(result).includes('99个月'));assert(!JSON.stringify(result).includes('服务费用1元'));
  }
});

test('v2 service may omit model-generated locked fields but must not gain unknown keys',async()=>{
  const generated=sectionResult('service');
  for(const path of planSchema.lockedPaths)delete generated.fields[path.split('.')[1]];
  let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return modelResponse('deepseek',generated);}});
  let response=await worker.fetch(request({...baseInput,section:'service'}),env);
  assert.equal(response.status,200);assert.equal(calls,1);
  assert.deepEqual((await response.json()).result.fields,{...generated.fields,...planSchema.canonicalFields(serviceFacts)});
  calls=0;const extra={...generated,fields:{...generated.fields,unexpectedFee:'新增未授权费用'}};
  const invalid=createWorker({fetcher:async()=>{calls++;return modelResponse('deepseek',extra);}});
  response=await invalid.fetch(request({...baseInput,section:'service'}),env);
  assert.equal(response.status,502);assert.equal(calls,2);assert.equal((await response.json()).error.code,'INVALID_MODEL_RESULT');
});

test('v2 absent service facts stay explicitly unconfirmed and do not turn into an annual quote',async()=>{
  let payload;const generated=sectionResult('service');
  const worker=createWorker({fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return modelResponse('deepseek',generated);}});
  const response=await worker.fetch(request({...baseInput,section:'service',serviceFacts:{}}),env);
  assert.equal(response.status,200);const {result}=await response.json();
  for(const [key,value] of Object.entries(planSchema.canonicalFields({})))assert.equal(result.fields[key],value);
  assert.equal(result.fields.date,'');assert.equal(result.fields.fee,'');
  assert(result.fields.duration.includes('待双方确认'));assert(!result.fields.duration.includes('12'));
  const text=promptText(payload);assert.match(text,/未(?:提供|知|确认)|尚未|待确认/);assert.match(text,/不.*(?:编造|默认|推定)|不得|不能/);
});

test('v2 quota and deliverable modes preserve the supplied scope distinction in locked output',async()=>{
  for(const resourceType of ['execution_quota','deliverables','unspecified']) {
    const facts={...serviceFacts,resourceType};
    const worker=createWorker({fetcher:async()=>modelResponse('deepseek',sectionResult('service'))});
    const response=await worker.fetch(request({...baseInput,section:'service',serviceFacts:facts}),env);
    assert.equal(response.status,200);const {result}=await response.json();
    assert.equal(result.fields.scope,planSchema.canonicalFields(facts).scope);
    if(resourceType==='execution_quota')assert(result.fields.scope.includes('不等同于同量确认稿件'));
    if(resourceType==='deliverables')assert(result.fields.scope.includes('已提供的交付数量'));
    if(resourceType==='unspecified')assert(result.fields.scope.includes('计量口径尚需确认'));
  }
});

test('v2 rejects monetary commitments outside locked scope and fee, repairs once and sanitizes failures',async()=>{
  const amounts=['¥26800','￥26800','人民币26800','RMB 26800','CNY26800','26800元','2.68万元'];
  const destinations={profile:['fields','business'],service:['fields','cadence'],schedule:['copy','w1'],operations:['copy','a1']};
  for(const provider of ['deepseek','gemini']) {
    for(const amount of amounts) {
      for(const [section,[part,key]] of Object.entries(destinations)) {
        const invalid=sectionResult(section);
        invalid[part][key]='PRIVATE_CLIENT_QUOTE：新增服务需支付'+amount+'，不得回传这段原始错误内容。';
        let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return modelResponse(provider,invalid);}});
        const response=await worker.fetch(request({...baseInput,provider,section}),env);
        assert.equal(response.status,502,`${provider}/${section}/${amount}`);assert.equal(calls,2);
        const text=await response.text();assert.equal(JSON.parse(text).error.code,'INVALID_MODEL_RESULT');
        assert(!text.includes('PRIVATE_CLIENT_QUOTE'));assert(!text.includes(amount));assert(!text.includes('新增服务需支付'));
      }
    }
    const good=sectionResult('operations');const bad=structuredClone(good);bad.copy.a1='PRIVATE_CLIENT_QUOTE：执行该项另收费人民币26800元。';
    let calls=0;const repairing=createWorker({fetcher:async()=>modelResponse(provider,++calls===1?bad:good)});
    const response=await repairing.fetch(request({...baseInput,provider,section:'operations'}),env);
    assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual((await response.json()).result,good);
    const facts={...serviceFacts,scope:'按已提供范围完成资料整理；相关服务费用人民币26800元。',fee:'服务费用人民币26800元，分项调整费用¥1000，具体付款方式双方确认。'};
    const canonical=createWorker({fetcher:async()=>modelResponse(provider,sectionResult('service'))});
    const accepted=await canonical.fetch(request({...baseInput,provider,section:'service',serviceFacts:facts}),env);
    assert.equal(accepted.status,200);const {result}=await accepted.json();
    assert.equal(result.fields.scope,planSchema.canonicalFields(facts).scope);assert.equal(result.fields.fee,facts.fee);
  }
});

test('v2 schedule replaces out-of-period stages while retaining active stages including month thirteen',async()=>{
  for(const provider of ['deepseek','gemini']) {
    for(const durationMonths of [1,3,13]) {
      const generated=sectionResult('schedule');
      for(const stage of planSchema.periodStages(durationMonths).stages) {
        generated.copy['annual_stage'+stage.index+'_work']='未来阶段继续安排内容制作与发布工作，需客户核实后执行。';
        generated.copy['annual_stage'+stage.index+'_output']='未来阶段提供内容与发布记录，供客户检查。';
      }
      const expected=structuredClone(generated);
      for(const stage of planSchema.periodStages(durationMonths).stages) {
        if(!stage.active)for(const suffix of ['work','output'])expected.copy['annual_stage'+stage.index+'_'+suffix]='本服务周期不另设此阶段。';
      }
      const worker=createWorker({fetcher:async()=>modelResponse(provider,generated)});
      const response=await worker.fetch(request({...baseInput,provider,section:'schedule',serviceFacts:{...serviceFacts,durationMonths}}),env);
      assert.equal(response.status,200);const {result}=await response.json();assert.deepEqual(result,expected);
      if(durationMonths===13) {
        assert.equal(result.copy.annual_stage5_work,generated.copy.annual_stage5_work);
        assert.equal(result.copy.annual_stage5_output,generated.copy.annual_stage5_output);
      }
    }
  }
});

test('v2 schedule sends actual short, extended and unknown period stages to the model',async()=>{
  for(const durationMonths of [1,3,13,120,'']) {
    let payload;const facts={...serviceFacts,durationMonths};
    const worker=createWorker({fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return modelResponse('deepseek',sectionResult('schedule'));}});
    const response=await worker.fetch(request({...baseInput,section:'schedule',serviceFacts:facts}),env);
    assert.equal(response.status,200);const text=promptText(payload);
    for(const stage of planSchema.periodStages(durationMonths).stages)assert(text.includes(stage.label),`missing ${durationMonths || 'unknown'}-month stage label ${stage.label}`);
    if(durationMonths==='')assert.match(text,/参考|未知|未(?:提供|确定|确认)|待确认/);
    if(durationMonths===13)assert(text.includes('第10—13个月'));
    if(durationMonths===1)assert(text.includes('本周期不另设此阶段'));
  }
});

test('v2 prompts separate client business from GEO scope and do not turn quota into finished work',async()=>{
  for(const section of ['service','schedule','operations']) {
    let payload;const worker=createWorker({fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return modelResponse('deepseek',sectionResult(section));}});
    assert.equal((await worker.fetch(request({...baseInput,section}),env)).status,200);
    const text=promptText(payload);
    assert(text.includes(serviceFacts.scope));assert(text.includes(serviceFacts.resources));assert(text.includes(serviceFacts.fee));
    assert.match(text,/客户.*(?:主营|业务|产品)/);assert.match(text,/(?:我方|服务方|GEO).*服务/);
    assert.match(text,/额度/);assert.match(text,/不(?:等同|代表|能).*成(?:稿|片)|不得.*成(?:稿|片)/);
    assert.match(text,/税费|税率/);assert.match(text,/全天|24小时/);assert.match(text,/视频拍摄|拍摄/);
    assert.match(text,/只输出|仅输出/);assert.match(text,/工具|执行/);
  }
});

test('v2 malformed, extra and placeholder output is repaired only once on the selected provider',async()=>{
  const original=sectionResult('profile');
  const invalidCases=[
    '模型解释：'+JSON.stringify(original),
    {...original,extra:'unexpected'},
    {...original,fields:{...original.fields,extra:'unexpected'}},
    {...original,fields:{...original.fields,business:'【产品名称】'}},
    {...original,fields:{...original.fields,questions}},
    {...original,fields:{...original.fields,questions:questions.slice(0,4).join('\n')}},
    {...original,fields:{...original.fields,questions:[...questions.slice(0,4),questions[0]].join('\n')}},
    {...original,copy:{goals:''}}
  ];
  for(const provider of ['deepseek','gemini']) {
    for(const invalid of invalidCases) {
      const urls=[];const worker=createWorker({fetcher:async url=>{urls.push(url);return modelResponse(provider,invalid);}});
      const response=await worker.fetch(request({...baseInput,provider,section:'profile'}),env);
      assert.equal(response.status,502);assert.equal(urls.length,2);assert.equal(urls[0],urls[1]);
      const body=await response.json();assert.equal(body.error.code,'INVALID_MODEL_RESULT');assert(!JSON.stringify(body).includes('模型解释'));
    }
    let calls=0;const repairing=createWorker({fetcher:async()=>modelResponse(provider,++calls===1?invalidCases[1]:original)});
    const response=await repairing.fetch(request({...baseInput,provider,section:'profile'}),env);
    assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual((await response.json()).result,original);
  }
});

test('v2 rejects invalid protocol, facts, dates and duration before contacting a provider',async()=>{
  const worker=createWorker({fetcher:noNetwork});
  const invalidFacts=[
    [],null,{durationMonths:0},{durationMonths:121},{durationMonths:1.5},{durationMonths:'13个月'},
    {date:'2026-2-01'},{date:'2026-02-30'},{date:'not-a-date'},
    {provider:'x'.repeat(121)},{platforms:'x'.repeat(1001)},{scope:'x'.repeat(6001)},
    {fee:'x'.repeat(2001)},{resources:'x'.repeat(4001)},{resourceType:'automatic'},
    {scope:42},{fee:[]},{platforms:{}},{resources:false},
    ...Object.keys(serviceFacts).map(key=>({[key]:null}))
  ];
  const invalidInputs=[
    {...baseInput,section:'unknown'},{...baseInput,section:[]},{...baseInput,version:3},
    ...invalidFacts.map(facts=>({...baseInput,section:'service',serviceFacts:facts}))
  ];
  for(const input of invalidInputs)assert.equal((await worker.fetch(request(input),env)).status,400,JSON.stringify(input.serviceFacts));
});

test('v2 accepts a numeric duration string and normalizes it in locked service fields',async()=>{
  const facts={...serviceFacts,durationMonths:'13'};
  const worker=createWorker({fetcher:async()=>modelResponse('deepseek',sectionResult('service'))});
  const response=await worker.fetch(request({...baseInput,section:'service',serviceFacts:facts}),env);
  assert.equal(response.status,200);const {result}=await response.json();
  assert.equal(result.fields.duration,'13个月，自双方确认的服务启动日起算');
  assert.deepEqual(result.fields,{...sectionResult('service').fields,...planSchema.canonicalFields(facts)});
});

test('v2 accepts full Chinese source limits within 96KiB but enforces a streamed byte cap',async()=>{
  const full={...baseInput,section:'operations',companyInfo:'企'.repeat(12000),promotionDirection:'推'.repeat(4000),constraints:'约'.repeat(2000),serviceFacts:{...serviceFacts,provider:'服'.repeat(120),platforms:'台'.repeat(1000),scope:'项'.repeat(6000),fee:'费'.repeat(2000),resources:'额'.repeat(4000)}};
  assert(Buffer.byteLength(JSON.stringify(full))<96*1024);
  const worker=createWorker({fetcher:async()=>modelResponse('deepseek',sectionResult('operations'))});
  assert.equal((await worker.fetch(request(full),env)).status,200);
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(96*1024));controller.enqueue(new Uint8Array(1));controller.close();}});
  const req=new Request('https://assistant.example/generate',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:stream,duplex:'half'});
  assert.equal((await createWorker({fetcher:noNetwork}).fetch(req,env)).status,413);
});

test('v2 upstream failures remain sanitized and do not trigger repair or change providers',async()=>{
  for(const provider of ['deepseek','gemini']) {
    for(const status of [401,429,503]) {
      let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return new Response('PRIVATE_COMPANY '+env.DEEPSEEK_API_KEY+baseInput.companyInfo,{status});}});
      const response=await worker.fetch(request({...baseInput,provider,section:'schedule'}),env);
      assert.equal(response.status,status===429?429:502);assert.equal(calls,1);
      const text=await response.text();assert(!text.includes('PRIVATE_COMPANY'));assert(!text.includes(env.DEEPSEEK_API_KEY));assert(!text.includes(baseInput.companyInfo));
    }
  }
});
