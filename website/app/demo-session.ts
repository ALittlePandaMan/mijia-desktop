import {DemoStore} from '../demo/store';

type Connection={node:HTMLIFrameElement;ready:boolean;visible:boolean};
class DemoSession {
 private frames=new Map<string,Connection>();
 private revision=0;
 private store=new DemoStore({visible:()=>[...this.frames.values()].some(frame=>frame.visible)});
 private unsubscribe=this.store.subscribe(environment=>{
  this.revision++;
  for(const [id,frame] of this.frames)if(frame.ready&&frame.visible)this.publish(id,environment);
 });
 constructor(){window.addEventListener('message',this.receive);}
 private publish(id:string,environment=false){
  this.frames.get(id)?.node.contentWindow?.postMessage({type:'mijia-demo:state',instance:id,revision:this.revision,environment,snapshot:this.store.snapshot()},location.origin);
 }
 private receive=(event:MessageEvent)=>{
  if(event.origin!==location.origin||!event.data||typeof event.data!=='object')return;
  const data=event.data,frame=this.frames.get(data.instance);
  if(!frame||event.source!==frame.node.contentWindow)return;
  if(data.type==='mijia-demo:ready'){frame.ready=true;this.publish(data.instance);}
  if(data.type==='mijia-demo:command'&&frame.ready)this.store.command(data.command);
 };
 connect(id:string,node:HTMLIFrameElement){
  this.frames.set(id,{node,ready:false,visible:true});
  return {
   visible:(visible:boolean)=>{const frame=this.frames.get(id);if(frame){const changed=frame.visible!==visible;frame.visible=visible;if(changed&&visible&&frame.ready)this.publish(id);}},
   close:()=>{if(this.frames.get(id)?.node===node)this.frames.delete(id);if(!this.frames.size){this.unsubscribe();this.store.dispose();window.removeEventListener('message',this.receive);session=undefined;}}
  };
 }
}
let session:DemoSession|undefined;
export function connectDemoSession(id:string,node:HTMLIFrameElement){return(session??=new DemoSession()).connect(id,node);}
