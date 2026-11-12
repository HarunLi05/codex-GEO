import test from 'node:test';
import assert from 'node:assert/strict';
import * as workerEntry from '../src/worker.mjs';
import {createWorker,validateResult} from '../src/worker.mjs';

const TOKEN='unit-test-access-token-not-a-real-credential';
const env={ASSISTANT_ACCESS_TOKEN:TOKEN,DEEPSEEK_API_KEY:'unit-deepseek-key',GEMINI_API_KEY:'unit-gemini-key'};
const origin='https://harunli05.github.io';
const input={provider:'deepseek',companyInfo:'示例机械企业，提供设备选型及售后服务。',promotionDirection:'向企业采购介绍设备和交付能力。',constraints:'仅使用已有资料，不编造认证。'};
const result={
  clientName:'示例机械企业',business:'提供设备选型与交付服务；产品型号尚未提供，启动时核实。',
  targetAudience:'有设备采购需求的企业采购和技术人员。',region:'客户尚未提供具体服务范围，启动时核实。',
  concern:'完善设备选型和交付信息，支持企业采购了解。',evidence:'已提供设备选型与售后方向；客户尚未提供资质、参数和案例，需核实后补充。',
  actions:'联系企业咨询选型与交付条件，实际咨询入口需启动时核实。',goal:'支持产品了解及咨询，不承诺订单或固定排名。',
  questions:['选择设备供应商前应了解哪些行业背景信息？','如何核实示例机械企业的业务与服务范围？','比较设备方案时应核对哪些参数与适用条件？','采购示例机械企业的设备前应确认哪些交付条件？','示例机械企业提供哪些售后支持，采购前如何确认？'],
  exceptions:'参数、资质和案例需客户核实；交付、售后和价格按实际合同确定。'
};
const responseDeep=value=>new Response(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}),{headers:{'Content-Type':'application/json'}});
const responseGemini=value=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]}),{headers:{'Content-Type':'application/json'}});
function request(path='/generate',body=input,options={}) {
  return new Request('https://assistant.example'+path,{method:body===null?'GET':'POST',headers:{Origin:origin,Authorization:'Bearer '+TOKEN,...(body===null?{}:{'Content-Type':'application/json'}),...options.headers},...(body===null?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),...options});
}
function noNetwork(){throw Error('Unexpected upstream request');}

// Every network call below is an injected mock; test data never reaches providers.
test('Workers module entry exports a fetch handler and only supported function bindings',()=>{
  assert.equal(typeof workerEntry.default.fetch,'function');
  for(const [name,value] of Object.entries(workerEntry)) {
    if(name==='default')continue;
    assert.equal(typeof value,'function',`Worker named export ${name} must be a function, not a configuration constant`);
  }
});
test('service fails closed without access token and authenticates metadata',async()=>{
  const worker=createWorker({fetcher:noNetwork});
  let response=await worker.fetch(request('/config',null),{});assert.equal(response.status,503);assert.equal(response.headers.get('X-GEO-Plan-Version'),'2');
  response=await worker.fetch(request('/config',null),{...env,ASSISTANT_ACCESS_TOKEN:'too-short'});assert.equal(response.status,503);
  response=await worker.fetch(request('/config',null,{headers:{Origin:origin}}),env);assert.equal(response.status,401);assert.equal(response.headers.get('X-GEO-Plan-Version'),'2');assert(!await response.text().then(text=>text.includes('configured')));
  response=await worker.fetch(request('/config',null),env);assert.equal(response.status,200);
  const body=await response.text();assert(!body.includes(TOKEN));assert(!body.includes('unit-deepseek-key'));
  const config=JSON.parse(body);assert.equal(config.providers.length,2);
  assert.equal(config.providers[0].id,'deepseek');assert.equal(config.providers[1].model,'gemini-flash-latest');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('CORS uses exact origins and preflight exposes no credentials',async()=>{
  const worker=createWorker({fetcher:noNetwork});
  const denied=await worker.fetch(request('/config',null,{headers:{Origin:'https://untrusted.example',Authorization:'Bearer '+TOKEN}}),env);
  assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
  const allowed=await worker.fetch(new Request('https://assistant.example/generate',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type, authorization'}}),env);
  assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'),null);
  const arbitrary=await worker.fetch(new Request('https://assistant.example/generate',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'DELETE'}}),env);
  assert.equal(arbitrary.status,403);
});
test('DeepSeek receives only the fixed host, server key and strict JSON request',async()=>{
  const calls=[];const worker=createWorker({fetcher:async(url,options)=>{calls.push({url,options});return responseDeep(result);}});
  const response=await worker.fetch(request(),env);assert.equal(response.status,200);
  const body=await response.json();assert.deepEqual(body.result,result);assert.equal(body.provider,'deepseek');
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].options.headers.Authorization,'Bearer unit-deepseek-key');
  const payload=JSON.parse(calls[0].options.body);assert.deepEqual(payload.response_format,{type:'json_object'});
  assert.equal(typeof payload.messages[0].content,'string');assert(payload.messages[0].content.includes('questions必须恰好有5个'));assert(payload.messages[0].content.includes('绝不编造'));assert(!payload.messages[0].content.includes(input.companyInfo));assert(payload.messages[1].content.includes('示例机械企业'));
  assert(!JSON.stringify(body).includes('unit-deepseek-key'));
});
test('Gemini uses header authentication, declared schema and configurable model',async()=>{
  const calls=[];const worker=createWorker({fetcher:async(url,options)=>{calls.push({url,options});return responseGemini(result);}});
  const response=await worker.fetch(request('/generate',{...input,provider:'gemini'}),{...env,GEMINI_MODEL:'models/gemini-flash-latest'});
  assert.equal(response.status,200);assert.equal((await response.json()).provider,'gemini');
  assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.equal(calls[0].options.headers['x-goog-api-key'],'unit-gemini-key');assert(!calls[0].url.includes('key='));
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.generationConfig.responseMimeType,'application/json');
  assert.deepEqual(payload.generationConfig.responseSchema.required,Object.keys(result));
  assert.equal(payload.generationConfig.responseSchema.properties.questions.minItems,5);
});
test('Gemini internal thought parts are ignored and never returned',async()=>{
  const worker=createWorker({fetcher:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'PRIVATE_REASONING_MUST_NOT_RETURN'},{text:JSON.stringify(result)}]}}]}))});
  const response=await worker.fetch(request('/generate',{...input,provider:'gemini'}),env);
  assert.equal(response.status,200);const text=await response.text();assert(!text.includes('PRIVATE_REASONING_MUST_NOT_RETURN'));assert.deepEqual(JSON.parse(text).result,result);
});
test('invalid output is repaired once on the same provider and never silently accepted',async()=>{
  let count=0;const worker=createWorker({fetcher:async(url)=>{assert(url.includes('api.deepseek.com'));count++;return responseDeep(count===1?{...result,questions:result.questions.slice(0,4)}:result);}});
  let response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal(count,2);
  count=0;const broken=createWorker({fetcher:async()=>{count++;return responseDeep('模型解释：'+JSON.stringify(result));}});
  response=await broken.fetch(request(),env);assert.equal(response.status,502);assert.equal(count,2);
  assert.equal((await response.json()).error.code,'INVALID_MODEL_RESULT');
});
test('a single enclosing code fence can be normalized without accepting prose',async()=>{
  const worker=createWorker({fetcher:async()=>responseDeep('```json\n'+JSON.stringify(result)+'\n```')});
  const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.deepEqual((await response.json()).result,result);
});
test('upstream failures never echo provider bodies, company material or keys, and do not switch providers',async()=>{
  for(const status of [400,401,403,429,503]) {
    let calls=0;const worker=createWorker({fetcher:async(url)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');return new Response('unit-deepseek-key COMPANY-PRIVATE '+input.companyInfo,{status});}});
    const response=await worker.fetch(request(),env);const text=await response.text();
    assert.equal(calls,1);assert(!text.includes('unit-deepseek-key'));assert(!text.includes('COMPANY-PRIVATE'));assert(!text.includes(input.companyInfo));
    assert.equal(response.status,status===429?429:502);
  }
});
test('missing selected model key is reported before any network call',async()=>{
  const worker=createWorker({fetcher:noNetwork});
  const response=await worker.fetch(request('/generate',{...input,provider:'gemini'}),{ASSISTANT_ACCESS_TOKEN:TOKEN,DEEPSEEK_API_KEY:'unit-key'});
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'PROVIDER_NOT_CONFIGURED');
});
test('invalid input, model names, huge bodies and forged provider types fail safely',async()=>{
  const worker=createWorker({fetcher:noNetwork});
  for(const body of [{...input,provider:['deepseek']},{...input,provider:'arbitrary'},{...input,companyInfo:''},{...input,promotionDirection:42},{...input,companyInfo:'x'.repeat(12001)}]) {
    assert.equal((await worker.fetch(request('/generate',body),env)).status,400);
  }
  assert.equal((await worker.fetch(request('/generate','{broken'),env)).status,400);
  assert.equal((await worker.fetch(request('/generate','x'.repeat(98305)),env)).status,413);
  assert.equal((await worker.fetch(request('/config',null),{...env,GEMINI_MODEL:'../../malicious?key=secret'})).status,503);
});
test('a streamed body cannot bypass the byte limit by omitting Content-Length',async()=>{
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(98305));controller.close();}});
  const req=new Request('https://assistant.example/generate',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:stream,duplex:'half'});
  const response=await createWorker({fetcher:noNetwork}).fetch(req,env);assert.equal(response.status,413);
});
test('timeout aborts the fixed upstream call and returns a sanitized error',async()=>{
  const worker=createWorker({timeoutMs:5,fetcher:(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('secret timeout details')),{once:true}))});
  const response=await worker.fetch(request(),env);assert.equal(response.status,504);
  const text=await response.text();assert(!text.includes('secret timeout details'));
});
test('schema checks exact fields, five distinct concrete questions and unresolved placeholders',()=>{
  assert.equal(validateResult(result),true);
  assert.equal(validateResult({...result,clientName:'示例企业（上海）有限公司'}),true);
  assert.equal(validateResult({...result,extra:'unexpected'}),false);
  assert.equal(validateResult({...result,questions:[...result.questions.slice(0,4),result.questions[0]]}),false);
  assert.equal(validateResult({...result,business:'【产品名称】'}),false);
  assert.equal(validateResult({...result,evidence:'{{资质}}'}),false);
  assert.equal(validateResult({...result,goal:'null'}),false);
  assert.equal(validateResult({...result,questions:result.questions.map(value=>value.slice(0,-1))}),false);
});
