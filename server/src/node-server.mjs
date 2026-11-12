/** Optional Node host adapter; configure credentials through your service manager. */
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import worker from './worker.mjs';

const port=Number(process.env.PORT || 8787);
const host=process.env.HOST || '127.0.0.1';
if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('PORT must be a valid TCP port.');
const server=createServer(async (incoming,outgoing)=>{
  try {
    const headers=new Headers();
    for(const [name,value] of Object.entries(incoming.headers)) {
      if(Array.isArray(value))for(const part of value)headers.append(name,part);
      else if(value!==undefined)headers.set(name,value);
    }
    const controller=new AbortController();
    incoming.once('aborted',()=>controller.abort());
    outgoing.once('close',()=>{if(!outgoing.writableEnded)controller.abort();});
    const options={method:incoming.method,headers,signal:controller.signal};
    if(!['GET','HEAD'].includes(incoming.method)) {options.body=Readable.toWeb(incoming);options.duplex='half';}
    // Incoming Host is never used as a model destination or forwarded upstream.
    const request=new Request(new URL(incoming.url || '/',`http://127.0.0.1:${port}`),options);
    const response=await worker.fetch(request,process.env);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  }catch {
    if(!outgoing.headersSent)outgoing.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    outgoing.end(JSON.stringify({error:{code:'INTERNAL_ERROR',message:'生成服务暂时出现异常，请稍后重试。'}}));
  }
});
server.requestTimeout=75000;
server.headersTimeout=15000;
server.listen(port,host,()=>process.stdout.write('GEO assistant service started.\n'));
