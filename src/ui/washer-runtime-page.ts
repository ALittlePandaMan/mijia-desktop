import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel} from '../types';
import type {WasherProgram} from '../washer';
import type {WasherRuntimeCommands,WasherRuntimeControl} from '../washer-runtime';
import {button,element} from './dom';
import {icon,officialIcon} from '../icons';

interface Props {device:Device;panel:DevicePanel;programs:WasherProgram[];commands:WasherRuntimeCommands;cached:boolean;confirmation?:WasherRuntimeControl;back:()=>void;refresh:()=>void;choose:(control:WasherRuntimeControl)=>void;cancel:()=>void;submit:()=>void}
function runtimeIcon(state:string):HTMLElement{const art=element('span',`washer-runtime-art state-${state}`);const name=state==='paused'?'WashStatusCardPause':state==='completed'?'WashCompleted':state==='delay'?'WashDelayTimeBlue':'WashStatusCardDoing';art.append(officialIcon('std:'+name));return art;}
export function washerRuntimePage(p:Props):HTMLElement{
 const s=p.panel.washerRuntime,stage=element('div','device-stage'),page=element('section','device-page page-washer washer-subpage washer-runtime-page');
 page.dataset.runtimeState=s?.state??'unknown';page.dataset.runtimePending=String(p.commands.pending);
 const program=p.programs.find(program=>program.value===s?.mode),title=s?.cleaning?'风道清洁':program?.title??p.device.name;
 page.append(element('header','device-page-header',button('','page-icon-button',p.back,'back'),element('div','device-page-title',element('h2','',title))));page.querySelector('header button')?.setAttribute('aria-label','返回家庭');
 const scroll=element('div','device-page-scroll washer-runtime-scroll'),hero=element('div','washer-runtime-hero');
 const text:Record<string,string>={busy:'运行中',paused:'暂停中',delay:'预约中',completed:'已完成',off:'已关机',idle:'待机中',unknown:'状态暂未确认'};
 hero.append(runtimeIcon(s?.state??'unknown'),element('h3','',text[s?.state??'unknown']??'状态暂未确认'));
 const desc=element('p','washer-runtime-description');
 if(s?.weighing&&['busy','paused'].includes(s.state))desc.append('自动称重');
 else if(s?.state==='delay'&&s.reservationMinutes!==null){const at=new Date(Date.now()+s.reservationMinutes*60000),now=new Date(),tomorrow=at.toDateString()!==now.toDateString();desc.append('预计 ',element('strong','',`${tomorrow?'明天 ':''}${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`),' 完成');}
 else if(s?.state==='completed')desc.append(s.hasDrying?'洗烘已完成，请及时取出衣物':'洗涤已完成，请及时晾晒');
 else if(s&&['busy','paused'].includes(s.state)&&s.remainingMinutes!==null)desc.append('剩余 ',element('strong','',String(s.remainingMinutes)),' 分钟');
 hero.append(desc);scroll.append(hero);
 if(s?.steps.length){const list=element('ol','washer-runtime-steps');list.setAttribute('aria-label','洗涤进度');for(const[at,step]of s.steps.entries()){const row=element('li',`washer-runtime-step ${step.progress}`);row.dataset.stage=String(step.id);row.setAttribute('aria-current',step.progress==='current'?'step':'false');row.append(element('span','washer-runtime-marker',step.progress==='done'?icon('check'):null),element('span','washer-runtime-index',String(at+1).padStart(2,'0')),element('span','',step.label));list.append(row);}scroll.append(list);}
 describeOperation(page,p.commands.message);
 page.append(scroll);
 const controls=s?.controls??[],footer=element('footer','washer-runtime-footer'),blocked=p.cached||!p.device.online||!!p.device.sharedReadOnly||p.commands.blocked;
 const lock=controls.find(c=>c.key==='lock');
 if(lock){const row=button('','washer-runtime-lock',()=>p.choose(lock));row.disabled=blocked||!lock.enabled;row.setAttribute('role','switch');row.setAttribute('aria-checked',String(!!s?.locked));row.setAttribute('aria-label','童锁');row.setAttribute('aria-description',lock.reason??'');row.append(element('span','','童锁'),element('span',`settings-toggle${s?.locked?' checked':''}`));footer.append(row);}
 const buttons=element('div','washer-runtime-buttons');for(const control of controls.filter(c=>c.key!=='lock')){const b=button(control.label,`washer-runtime-control${control.key==='stop'||control.key==='off'?' destructive':''}`,()=>p.choose(control));b.dataset.runtimeControl=control.key;b.disabled=blocked||!control.enabled;b.setAttribute('aria-description',control.reason??'');b.setAttribute('aria-busy',String(p.commands.pending));buttons.append(b);}if(buttons.childElementCount)footer.append(buttons);page.append(footer);
 if(p.confirmation){const overlay=element('div','washer-runtime-confirm-backdrop'),dialog=element('section','washer-runtime-confirm',element('p','',p.confirmation.confirmation??''));dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',p.confirmation.label);const cancel=button('取消','',p.cancel),submit=button(p.confirmation.label,p.confirmation.key==='stop'?'destructive':'',p.submit);cancel.disabled=submit.disabled=p.commands.pending;dialog.append(element('div','washer-runtime-confirm-actions',cancel,submit));dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancel?submit:cancel).focus();}});overlay.append(dialog);overlay.addEventListener('click',e=>{if(e.target===overlay&&!p.commands.pending)p.cancel();});page.append(overlay);queueMicrotask(()=>{if(cancel.isConnected)cancel.focus({preventScroll:true});});}
 stage.append(page);return deviceSurfaces(stage);
}
