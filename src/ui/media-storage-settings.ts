import {api} from '../api';
import {normalizeError} from '../logic';
import {button,element} from './dom';
export interface MediaStorageView{directory:string;screenshotDirectory:string;recordingDirectory:string;isDefault:boolean}
/** This preference belongs to the machine, independently of selected homes. */
class MediaStorageSettings{
 readonly root=element('section','settings-card settings-media-storage');
 private path=element('p','settings-media-path','正在读取…');private notice=element('p','settings-caption');
 private change=button('更改位置','settings-action settings-media-change',()=>{void this.write(()=>api.chooseMediaStorage());});
 private reset=button('恢复默认','settings-action settings-media-reset',()=>{void this.write(()=>api.resetMediaStorage());});
 private open=button('打开目录','settings-action',()=>{void this.write(async()=>{await api.openMediaStorage();return null;});});
 private retry=button('重试','settings-action',()=>this.load());
 private view?:MediaStorageView;private reading=false;private busy=false;private loaded=false;private revision=0;
 constructor(){
  this.change.dataset.focusKey='media-directory-change';this.reset.dataset.focusKey='media-directory-reset';this.open.dataset.focusKey='media-directory-open';this.notice.setAttribute('role','status');
  this.path.setAttribute('aria-label','截图和录制的保存位置');this.retry.dataset.focusKey='media-directory-retry';this.retry.hidden=true;
  this.root.append(element('div','settings-row',element('span','settings-row-label','默认保存位置')),this.path,element('div','settings-media-actions',this.change,this.open,this.reset),this.notice,this.retry);
 }
 load():void{
  if(this.loaded||this.reading||this.busy)return;this.reading=true;this.notice.textContent='';this.retry.hidden=true;this.render();const revision=this.revision;
  void api.mediaStorage().then(view=>{if(revision===this.revision){this.view=view;this.loaded=true;}}).catch(error=>{if(revision===this.revision){this.notice.textContent=normalizeError(error).message;this.retry.hidden=false;}}).finally(()=>{if(revision===this.revision){this.reading=false;this.render();}});
 }
 private async write(run:()=>Promise<MediaStorageView|null>):Promise<void>{
  if(this.busy||this.reading)return;const revision=++this.revision;this.busy=true;this.notice.textContent='';this.retry.hidden=true;this.render();
  try{const view=await run();if(revision===this.revision&&view){this.view=view;this.loaded=true;}}
  catch(error){if(revision===this.revision)this.notice.textContent=normalizeError(error).message;}
  finally{if(revision===this.revision){this.busy=false;this.render();}}
 }
 private render():void{
  this.root.setAttribute('aria-busy',String(this.reading||this.busy));this.change.disabled=this.reset.disabled=this.reading||this.busy;
  this.reset.disabled||=this.view?.isDefault===true;
  this.open.disabled=this.reading||this.busy||!this.view;
  this.path.textContent=this.view?this.view.directory:this.reading?'正在读取…':'未能读取保存位置';
  this.path.title=this.view?`截图：${this.view.screenshotDirectory}\n录制：${this.view.recordingDirectory}`:'';
 }
}
let settings:MediaStorageSettings|undefined;
export function mediaStorageSettings():HTMLElement{settings??=new MediaStorageSettings();settings.load();return settings.root;}
