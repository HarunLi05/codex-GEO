import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

async function freePort() {
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
test('optional Node adapter serves authenticated metadata and never needs a model key for health',async()=>{
  const port=await freePort();
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/node-server.mjs',import.meta.url))],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ASSISTANT_ACCESS_TOKEN:'adapter-unit-test-token-never-a-real-secret',DEEPSEEK_API_KEY:'',GEMINI_API_KEY:'',ALLOWED_ORIGINS:'https://harunli05.github.io'},
    stdio:['ignore','pipe','pipe']
  });
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Node adapter did not start')),5000);
      child.stdout.on('data',chunk=>{if(chunk.toString().includes('service started')){clearTimeout(timer);resolve();}});
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Node adapter exited '+code));});
    });
    const base='http://127.0.0.1:'+port;
    let response=await fetch(base+'/config');assert.equal(response.status,401);
    response=await fetch(base+'/config',{headers:{Authorization:'Bearer adapter-unit-test-token-never-a-real-secret',Origin:'https://harunli05.github.io'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://harunli05.github.io');
    const config=await response.json();assert(config.providers.every(item=>item.configured===false));
    response=await fetch(base+'/generate',{method:'POST',headers:{Authorization:'Bearer adapter-unit-test-token-never-a-real-secret','Content-Type':'application/json'},body:JSON.stringify({provider:'deepseek',companyInfo:'测试公司资料',promotionDirection:'介绍测试产品'})});
    assert.equal(response.status,503);assert.equal((await response.json()).error.code,'PROVIDER_NOT_CONFIGURED');
  }finally {
    if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  }
});
