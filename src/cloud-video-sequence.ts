export interface CloudVideoMedia{data:string;duration:number;parts?:{data:string;duration:number}[]}
/** Reset the decoder at a cloud configuration boundary, retaining one timeline. */
export class CloudVideoSequence{
 private parts:{url:string;duration:number;start:number}[]=[];private index=0;private revision=0;private abort?:AbortController;
 constructor(private video:HTMLVideoElement,private error:(message:string)=>void=()=>{}){
  video.addEventListener('ended',()=>{if(this.active&&this.index+1<this.parts.length)void this.change(this.index+1,0,true).catch(e=>{if(e?.name!=='AbortError')this.error('下一段云录像暂时无法播放，请重试。');});});
 }
 get active():boolean{return this.parts.length>0;}
 get ended():boolean{return this.active&&this.index===this.parts.length-1&&this.video.ended;}
 get duration():number{return this.parts.reduce((n,p)=>n+p.duration,0);}
 get currentTime():number{return (this.parts[this.index]?.start??0)+Math.max(0,this.video.currentTime||0);}
 async load(media:CloudVideoMedia):Promise<void>{
  this.dispose();const owned=this.parts,parts=media.parts?.length?media.parts:[media];let start=0,total=0;
  try{for(const part of parts){if(!Number.isFinite(part.duration)||part.duration<=0||typeof part.data!=='string'||part.data.length>68*1024*1024)throw Error('云录像数据无效。');
    const bytes=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0));total+=bytes.length;if(bytes.length<16||total>48*1024*1024||String.fromCharCode(...bytes.subarray(4,8))!=='ftyp')throw Error('云录像格式无效。');
    this.parts.push({url:URL.createObjectURL(new Blob([bytes],{type:'video/mp4'})),duration:part.duration,start});start+=part.duration;
   }
   if(!this.parts.length||this.parts.length>100||start>600)throw Error('云录像长度无效。');
   await this.change(0,0,false);
  }catch(e){if(this.parts===owned)this.dispose();throw e;}
 }
 seek(time:number):void{
  if(!this.active)return;const t=Math.max(0,Math.min(time,this.duration-.001)),index=this.parts.findIndex(p=>t>=p.start&&t<p.start+p.duration);
  if(index<0)return;if(index===this.index){this.video.currentTime=t-this.parts[index].start;return;}
  void this.change(index,t-this.parts[index].start,!this.video.paused).catch(e=>{if(e?.name!=='AbortError')this.error('云录像跳转失败，请重试。');});
 }
 private async change(index:number,offset:number,play:boolean):Promise<void>{
  const part=this.parts[index];if(!part)return;const revision=++this.revision;this.abort?.abort();const abort=this.abort=new AbortController(),rate=this.video.playbackRate,muted=this.video.muted;
  const ready=new Promise<void>((resolve,reject)=>{
   const done=(error?:Error)=>{clearTimeout(timeout);abort.signal.removeEventListener('abort',cancel);this.video.removeEventListener('loadedmetadata',loaded);this.video.removeEventListener('error',failed);error?reject(error):resolve();};
   const loaded=()=>done(),failed=()=>done(Error('云录像解码失败。')),cancel=()=>done(new DOMException('Cancelled','AbortError'));
   const timeout=setTimeout(()=>done(Error('云录像加载超时，请重试。')),15000);
   this.video.addEventListener('loadedmetadata',loaded,{once:true});this.video.addEventListener('error',failed,{once:true});abort.signal.addEventListener('abort',cancel,{once:true});
  });
  this.index=index;this.video.src=part.url;this.video.load();await ready;if(revision!==this.revision)return;
  this.video.muted=muted;this.video.playbackRate=rate;this.video.currentTime=offset;if(play)await this.video.play();
 }
 dispose():void{++this.revision;this.abort?.abort();this.abort=undefined;for(const part of this.parts)URL.revokeObjectURL(part.url);this.parts=[];this.index=0;}
}
