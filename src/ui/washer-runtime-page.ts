import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel} from '../types';
import {isDryerPanel,type WasherProgram} from '../washer';
import type {WasherRuntimeCommands,WasherRuntimeControl,WasherRuntimeSnapshot} from '../washer-runtime';
import {washerHomeStatus,washerRuntimeControls,washerRuntimeFinish,washerRuntimeMode,washerStageLabel} from '../washer-runtime';
import {dismissOnBackdrop} from './dialog-dismiss';
import {button,element} from './dom';
import {icon,officialIcon} from '../icons';
import {cycleActions,cycleButton} from './cycle-actions';

interface Props {device:Device;panel:DevicePanel;programs:WasherProgram[];commands:Pick<WasherRuntimeCommands,'pending'|'message'|'blocked'> & Partial<Pick<WasherRuntimeCommands,'display'>>;cached:boolean;readAt?:number;drum?:string;confirmation?:WasherRuntimeControl;back:()=>void;refresh:()=>void;choose:(control:WasherRuntimeControl)=>void;cancel:()=>void;submit:()=>void}
function runtimeIcon(state:string):HTMLElement{
 const art=element('span',`washer-runtime-art state-${state}`);art.setAttribute('aria-hidden','true');
 if(state==='busy'||state==='paused'){art.append(element('i'),element('i'),element('i'));return art;}
 art.append(officialIcon('std:'+(state==='completed'?'WashCompleted':state==='delay'?'WashDelayTimeBlue':'WashStatusCardDoing')));return art;
}
export function washerRuntimeFrame(p:{title:string;kind:'washer'|'dryer'|'dishwasher'|'sterilizer';runtime?:WasherRuntimeSnapshot|null;readAt?:number;drum?:string;back:()=>void}){
 const s=p.runtime,stage=element('div','device-stage'),page=element('section','device-page page-washer washer-subpage washer-runtime-page');
 const dryer=p.kind==='dryer',cycle=p.kind==='dishwasher'||p.kind==='sterilizer';
 const labels={washer:'洗衣机',dryer:'干衣机',dishwasher:'洗碗机',sterilizer:'消毒柜'};
 const finishText=cycle?'完成':dryer?'完成烘干':'完成洗护';
 if(p.kind!=='washer')page.dataset.presentationTemplate=p.kind;
 page.dataset.runtimeState=s?.state??'unknown';
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label',`返回${labels[p.kind]}`);
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.title),p.drum?element('p','',p.drum):null)));
 const scroll=element('div','device-page-scroll washer-runtime-scroll'),hero=element('div','washer-runtime-hero');
 const text:Record<string,string>={busy:'工作中',paused:'暂停中',delay:'预约中',completed:'已完成',off:'已关机',idle:'待机中',unknown:'状态暂未确认'};
 const status=s?.state==='busy'&&s.active&&!s.steps.length?washerHomeStatus(s):text[s?.state??'unknown'];
 hero.append(runtimeIcon(s?.state??'unknown'),element('h3','',status??'状态暂未确认'));
 const desc=element('p','washer-runtime-description');
 if(s?.weighing&&['busy','paused'].includes(s.state))desc.append('自动称重');
 else if(s?.state==='delay'){const finish=washerRuntimeFinish(s,p.readAt);if(finish)desc.append('预计',element('strong','',finish),finishText);}
 else if(s?.state==='completed')desc.append(cycle?'':dryer?'烘干已完成，请及时取出衣物':s.hasDrying?'洗烘已完成，请及时取出衣物':'洗涤已完成，请及时晾晒');
 else if(s&&['busy','paused'].includes(s.state)&&s.remainingMinutes!==null){desc.append(`剩余${s.remainingMinutes}分钟`);const finish=washerRuntimeFinish(s,p.readAt);if(finish)desc.append('，预计',element('strong','',finish),finishText);}
 hero.append(desc);scroll.append(hero);
 if(s?.steps.length){const list=element('ol','washer-runtime-steps');list.setAttribute('aria-label',dryer?'烘干进度':'洗涤进度');for(const[at,step]of s.steps.entries()){const row=element('li',`washer-runtime-step ${step.progress}`);row.dataset.stage=String(step.id);row.setAttribute('aria-current',step.progress==='current'?'step':'false');row.append(element('span','washer-runtime-marker',step.progress==='done'?icon('check'):null),element('span','washer-runtime-index',String(at+1).padStart(2,'0')),element('span','',washerStageLabel(step.label)));list.append(row);}scroll.append(list);}
 page.append(scroll);
 stage.append(page);
 return {stage,page};
}
export function washerRuntimePage(p:Props):HTMLElement{
 const panel=p.commands.display?.(p.panel)??p.panel,s=panel.washerRuntime;
 const {stage,page}=washerRuntimeFrame({title:(s&&washerRuntimeMode(s,p.programs))??p.device.name,kind:isDryerPanel(panel)?'dryer':'washer',
  runtime:s,readAt:p.readAt,drum:p.drum,back:p.back});
 page.dataset.runtimePending=String(p.commands.pending);
 const controls=s&&!p.device.sharedReadOnly?washerRuntimeControls(s):[],blocked=p.cached||!p.device.online||p.commands.blocked;
 const buttons=cycleActions('washer-runtime-footer');
 for(const control of controls){
  const suspend=control.key==='pause'||control.key==='resume';
  const b=cycleButton(control.label,()=>p.choose(control),suspend?'suspend':'secondary');
  b.dataset.runtimeControl=control.key;
  b.dataset.focusKey=`washer-runtime-${suspend?'suspend':control.key}`;
  b.disabled=blocked||!control.enabled;
  b.setAttribute('aria-busy',String(p.commands.pending));
  buttons.append(b);
 }
 if(buttons.childElementCount)page.append(buttons);
 if(p.confirmation){
  const confirmation=p.confirmation;
  const overlay=element('div','washer-runtime-confirm-backdrop');
  const dialog=element('section','washer-runtime-confirm',element('p','',confirmation.confirmation??''));
  const dismiss=()=>{
   buttons.querySelector<HTMLButtonElement>(`[data-runtime-control="${confirmation.key}"]`)?.focus({preventScroll:true});
   p.cancel();
  };
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',confirmation.label);
  const cancel=button('取消','',dismiss),submit=button(confirmation.label,confirmation.key==='stop'?'destructive':'',p.submit);
  dialog.append(element('div','washer-runtime-confirm-actions',cancel,submit));
  dialog.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}
   else if(event.key==='Tab'){event.preventDefault();(document.activeElement===cancel?submit:cancel).focus();}
  });
  overlay.append(dialog);dismissOnBackdrop(overlay,dismiss);page.append(overlay);
  queueMicrotask(()=>{if(cancel.isConnected)cancel.focus({preventScroll:true});});
 }
 return deviceSurfaces(stage);
}
