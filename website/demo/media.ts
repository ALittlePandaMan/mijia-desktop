/** Browser exports only. Captures generated canvases, never camera/microphone. */
export const timestamp=()=>{const d=new Date(),n=(x:number)=>String(x).padStart(2,'0');return `${d.getFullYear()}${n(d.getMonth()+1)}${n(d.getDate())}-${n(d.getHours())}${n(d.getMinutes())}${n(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`;};
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}
export class DemoMedia {
 private recorder?:MediaRecorder;private chunks:Blob[]=[];private stream?:MediaStream;private limit?:number;private ending?:Promise<void>;private complete?:()=>void;private name='';private started=0;
 index:number|undefined;
 frameSize:{width:number;height:number}|undefined;
 constructor(private changed:()=>void){}
 get supported(){return typeof MediaRecorder!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function'&&!!this.mime;}
 private get mime(){if(typeof MediaRecorder==='undefined')return '';return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type))??'';}
 get elapsed(){return Math.floor((performance.now()-this.started)/1000);}
 async screenshot(canvas:HTMLCanvasElement,index:number){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)download(blob,`米家Desktop-截图-${index+1}-${timestamp()}.png`);}
 start(canvas:HTMLCanvasElement,index:number){
  if(!this.supported||this.recorder||this.ending)return;
  const mime=this.mime;let stream:MediaStream|undefined;
  try{stream=canvas.captureStream(20);const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});this.stream=stream;this.recorder=recorder;this.index=index;this.frameSize={width:canvas.width,height:canvas.height};this.started=performance.now();this.chunks=[];this.name=`米家Desktop-录制-${index+1}-${timestamp()}.${mime.includes('mp4')?'mp4':'webm'}`;
   recorder.addEventListener('dataavailable',event=>{if(event.data.size)this.chunks.push(event.data);});
   recorder.addEventListener('stop',()=>{if(this.chunks.length)download(new Blob(this.chunks,{type:recorder.mimeType}),this.name);this.chunks=[];this.release();});
   recorder.addEventListener('error',()=>{if(recorder.state!=='inactive')recorder.stop();else this.release();});
   recorder.start(1000);this.limit=window.setTimeout(()=>{void this.stop();},60000);this.changed();
  }catch{stream?.getTracks().forEach(track=>track.stop());this.release();}
 }
 stop():Promise<void>{if(this.ending)return this.ending;if(!this.recorder)return Promise.resolve();if(this.recorder.state==='inactive'){this.release();return Promise.resolve();}const recorder=this.recorder;this.ending=new Promise(resolve=>{this.complete=resolve;});recorder.stop();this.changed();return this.ending;}
 private release(){clearTimeout(this.limit);this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;this.recorder=undefined;this.index=undefined;this.frameSize=undefined;this.changed();this.complete?.();this.complete=undefined;this.ending=undefined;}
}
