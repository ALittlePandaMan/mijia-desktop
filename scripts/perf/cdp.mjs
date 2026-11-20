// App-owned WebView diagnostics. No OS input injection or arbitrary host discovery.
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function pages(port=9442){const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)});return(await response.json()).filter(t=>t.type==='page');}
export async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let serial=0;
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Application diagnostic connection closed'));}pending.clear();};ws.addEventListener('close',fail);
 ws.addEventListener('message',event=>{const result=JSON.parse(event.data),p=pending.get(result.id);if(!p)return;pending.delete(result.id);clearTimeout(p.timer);result.error?p.reject(Error(result.error.message)):p.resolve(result.result);});
 const call=(method,params={},timeoutMs=45000)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out (the renderer may be suspended)`));},timeoutMs);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 return{call,evaluate,invoke:(command,args={})=>evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`),close(){fail();ws.close();}};
}
export async function main(port=9442){for(let n=0;n<120;n++){try{const target=(await pages(port)).find(t=>!t.url.includes('widget.html'));if(target)return await connect(target);}catch{}await delay(250);}throw Error('Main WebView unavailable');}
export async function until(client,expression,attempts=180){for(let n=0;n<attempts;n++){if(await client.evaluate(expression))return;await delay(200);}throw Error(`Condition not reached: ${expression}`);}
