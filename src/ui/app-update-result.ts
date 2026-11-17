import {isTauri} from '@tauri-apps/api/core';
import {api} from '../api';
import {button,element} from './dom';
import './app-update-result.css';

let opened=false;
/** A separate portal survives the home/settings/monitor render lifecycle. */
export async function showAppUpdateResult():Promise<void>{
 if(!isTauri()||opened)return;
 let result;try{result=await api.appUpdateResult();}catch{return;}
 if(!result||opened)return;opened=true;
 const root=document.getElementById('app'),wasInert=root?.inert??false,previous=document.activeElement;
 if(root)root.inert=true;
 const overlay=element('div','app-update-backdrop'),dialog=element('section','app-update-dialog');
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','app-update-result-title');dialog.tabIndex=-1;
 const title=element('h2','',`已更新到 v${result.version}`);title.id='app-update-result-title';
 dialog.append(element('header','app-update-result-heading',title,element('p','',`从 v${result.previousVersion} 更新至 v${result.version}`)));
 const content=element('div','app-update-result-content');
 content.append(element('h3','',`v${result.version}`));
 const lines=result.notes.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 for(const line of lines){
  if(/^#{1,3}\s/.test(line))continue;
  const text=line.replace(/^[-*]\s+/,'').replace(/\*\*(.*?)\*\*/g,'$1');
  const match=/^(新增|修复|改进|优化)[：:\s]?(.*)$/.exec(text);
  if(match)content.append(element('div','app-update-change',element('span','app-update-change-kind',match[1]),element('p','',match[2])));
  else content.append(element('p','app-update-change-text',text));
 }
 if(!lines.length)content.append(element('p','app-update-change-text','已完成版本更新，可查看完整更新内容。'));
 dialog.append(content);
 const error=element('p','app-update-result-error');error.hidden=true;error.setAttribute('role','alert');
 let pending=false;
 const dismiss=async()=>{
  if(pending)return;pending=true;ack.disabled=true;
  try{await api.acknowledgeAppUpdate(result.id);overlay.remove();if(root)root.inert=wasInert;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});}
  catch{error.textContent='暂时无法保存已读状态，请重试。';error.hidden=false;}
  finally{pending=false;ack.disabled=false;}
 };
 const details=button('查看完整更新内容','app-update-result-button',()=>{void api.openAppReleaseNotes().catch(()=>{error.textContent='无法打开更新日志，请稍后重试。';error.hidden=false;});});
 const ack=button('知道了','app-update-result-button app-update-result-primary',()=>{void dismiss();});
 dialog.append(element('footer','app-update-result-footer',error,element('div','app-update-result-actions',details,ack)));
 dialog.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void dismiss();}
  if(event.key==='Tab'){
   const controls=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){event.preventDefault();first?.focus();}
  }
 });
 overlay.append(dialog);document.body.append(overlay);queueMicrotask(()=>dialog.focus({preventScroll:true}));
}
