import {dismissOnBackdrop} from './dialog-dismiss';
import {deviceSurfaces} from './device-surfaces';
import type { AppError,TimerReport,TimerDraft,TimerEntry,TimerMode,TimerChange } from '../types';
import { repeatText,timerDraftProblem,timerTimeSubtitle } from '../timers';
import { icon } from '../icons';
import { button,element } from './dom';
import {deviceWait} from './device-loading';

export function timerEntrance(open:()=>void):HTMLElement {
  const entry=button('','native-card native-feature outlet-timer-entry',open);entry.setAttribute('aria-label','查看定时');
  entry.append(element('span','native-feature-icon',icon('clock')),element('strong','','定时'),icon('chevron','native-feature-arrow original-right-chevron'));return entry;
}

export type TimerModal={kind:'add'|'repeat'|'delete'|'discard'}|{kind:'weekdays';days:number[]}|{kind:'time';on:boolean;hour:number;minute:number};
export interface TimerPageView {
  data?:TimerReport;loading:boolean;error?:AppError;busy:boolean;message?:string;draft?:TimerDraft;modal?:TimerModal;selection?:string[];
  writePending?:boolean;pendingChanges?:TimerChange[];
  artwork?:()=>HTMLElement;
  back:()=>void;retry:()=>void;edit:(entry?:TimerEntry,mode?:TimerMode)=>void;update:(draft:TimerDraft)=>void;show:(modal?:TimerModal)=>void;
  save:()=>void;select:(keys:string[]|undefined)=>void;remove:()=>void;discard:()=>void;toggle:(entry:TimerEntry)=>void;
}
const modeTitle=(mode:TimerMode)=>mode==='period'?'时间段定时':mode==='on'?'定时开启':'定时关闭';
function timerDialog(props:TimerPageView):HTMLElement|undefined {
  const modal=props.modal;if(!modal)return;
  const overlay=element('div','timer-modal-backdrop'),dialog=element('section',`timer-dialog timer-dialog-${modal.kind}`);dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const heading=(text:string)=>{const title=element('h3','',text);title.id='timer-dialog-title';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);};
  const actions=(ok:string,confirm:()=>void,disabled=false)=>{const submit=button(ok,'timer-dialog-confirm',confirm);submit.disabled=disabled||props.busy;dialog.append(element('div','timer-dialog-actions',button('取消','timer-dialog-cancel',()=>props.show()),submit));};
  if(modal.kind==='add'){
    heading('添加');for(const mode of ['period','on','off'] as const)dialog.append(button(modeTitle(mode),'timer-dialog-option',()=>props.edit(undefined,mode)));dialog.append(button('取消','timer-dialog-dismiss',()=>props.show()));
  }else if(modal.kind==='repeat'){
    heading('重复选项');for(const [label,days] of [['执行一次',[]],['每天',[0,1,2,3,4,5,6]]] as const){const choice=button(label,'timer-dialog-option',()=>{if(props.draft)props.update({...props.draft,weekdays:[...days]});props.show();});dialog.append(choice);}
    dialog.append(button('自定义','timer-dialog-option',()=>props.show({kind:'weekdays',days:[...(props.draft?.weekdays??[])]})));
  }else if(modal.kind==='weekdays'){
    heading('自定义');for(const day of [1,2,3,4,5,6,0]){const selected=modal.days.includes(day),choice=button(['周日','周一','周二','周三','周四','周五','周六'][day],`timer-dialog-option${selected?' selected':''}`,()=>props.show({...modal,days:selected?modal.days.filter(value=>value!==day):[...modal.days,day]}));choice.setAttribute('aria-pressed',String(selected));choice.append(element('span','timer-option-check',selected?icon('check'):null));dialog.append(choice);}
    actions('确定',()=>{if(props.draft)props.update({...props.draft,weekdays:[...modal.days].sort()});props.show();},modal.days.length===0);
  }else if(modal.kind==='time'){
    heading(modal.on?'开启':'关闭');dialog.append(element('p','timer-clock-subtitle',props.draft?timerTimeSubtitle(props.draft,modal.on,modal.hour,modal.minute):''));
    const wheels=element('div','timer-clock-wheels');
    for(const [unit,count,value] of [['hour',24,modal.hour],['minute',60,modal.minute]] as const){
      const wheel=element('div','timer-clock-wheel');wheel.setAttribute('role','spinbutton');wheel.tabIndex=0;wheel.setAttribute('aria-label',unit==='hour'?'小时':'分钟');wheel.setAttribute('aria-valuemin','0');wheel.setAttribute('aria-valuemax',String(count-1));wheel.setAttribute('aria-valuenow',String(value));
      const choose=(next:number)=>{props.show({...modal,[unit]:(next+count)%count});document.querySelector<HTMLElement>(`.timer-clock-wheel[aria-label="${unit==='hour'?'小时':'分钟'}"]`)?.focus({preventScroll:true});};
      for(let offset=-2;offset<=2;offset++){const number=(value+offset+count)%count,row=button(String(number).padStart(2,'0'),`timer-clock-number${offset===0?' selected':''}`,()=>choose(number));if(offset===0)row.append(element('small','',unit==='hour'?'时':'分'));row.tabIndex=-1;row.setAttribute('aria-label',`${number}${unit==='hour'?'时':'分'}`);wheel.append(row);}
      wheel.addEventListener('wheel',event=>{event.preventDefault();if(event.deltaY)choose(value+(event.deltaY>0?1:-1));},{passive:false});
      wheel.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();choose(value+(event.key==='ArrowDown'?1:-1));}});wheels.append(wheel);
    }
    dialog.append(wheels);actions('确定',()=>{if(props.draft)props.update({...props.draft,[modal.on?'onTime':'offTime']:`${String(modal.hour).padStart(2,'0')}:${String(modal.minute).padStart(2,'0')}`});props.show();});
  }else if(modal.kind==='delete'){
    heading('删除定时');dialog.append(element('p','timer-dialog-copy','要删除选中的定时吗？'));actions('删除',props.remove);
  }else{heading('放弃修改？');dialog.append(element('p','timer-dialog-copy','尚未保存的定时修改将被放弃。'));actions('放弃',props.discard);}
  dismissOnBackdrop(overlay,()=>{if(!props.busy&&!props.writePending)props.show();});overlay.append(dialog);return overlay;
}
export function renderTimerPage(props:TimerPageView):HTMLElement {
  const{data,loading,error,draft}=props;
  const writing=props.busy||props.writePending;
  const stage=element('div','device-stage timer-stage'),page=element('section','device-page page-timers');page.setAttribute('aria-label','定时');
  page.dataset.timerLoading=String(loading);
  const selecting=props.selection!==undefined;
  const backButton=button('','page-icon-button',props.back,draft||selecting?'close':'back');backButton.setAttribute('aria-label',draft?'返回定时列表':selecting?'取消选择':'返回插座控制');backButton.disabled=props.busy;
  const right=draft?button('','page-icon-button',props.save,'check'):selecting?button('','page-icon-button',()=>props.select(data?.entries.filter(entry=>!entry.editReason).map(entry=>entry.key)),'select-all'):element('span');
  if(right instanceof HTMLButtonElement){right.setAttribute('aria-label',draft?'保存定时':'全选定时');right.disabled=!!writing||loading||!!draft&&(!!timerDraftProblem(draft)||!!data?.writeReason);}
  page.classList.toggle('timer-selecting',selecting);
  page.append(element('header','device-page-header',backButton,element('div','device-page-title',element('h2','',draft?modeTitle(draft.mode):selecting?`已选择${props.selection?.length}项`:'定时')),right));
  const body=element('div','device-page-scroll timer-list');
  if(draft){
    const row=(title:string,value:string,action:()=>void)=>{const row=button('','timer-editor-row',action);row.disabled=props.busy;row.append(element('span','timer-editor-copy',element('strong','',title),element('span','',value)),icon('chevron','timer-editor-chevron original-right-chevron'));return row;};
    body.append(row('重复',repeatText(draft.weekdays),()=>props.show({kind:'repeat'})));
    for(const on of [true,false]){if(on&&draft.mode==='off'||!on&&draft.mode==='on')continue;const value=on?draft.onTime:draft.offTime;
      body.append(row(on?'定时开启':'定时关闭',value??'未设置',()=>{const now=new Date(Date.now()+8*3600*1000);props.show({kind:'time',on,hour:value?Number(value.slice(0,2)):now.getUTCHours(),minute:value?Number(value.slice(3,5)):now.getUTCMinutes()});}));}
  }else if(loading&&!data)body.append(deviceWait(props.artwork,'定时'));
  else if(error&&error.kind!=='timerWriteUncertain'){const message=element('p','timer-read-status',error.message);message.setAttribute('role','alert');body.append(message);}
  else if(data){
    for(const original of data.entries){
      const pending=props.pendingChanges?.find(change=>change.operation==='setEnabled'&&change.key===original.key);
      const entry=pending?.operation==='setEnabled'?{...original,enabled:pending.enabled}:original;
      const row=element('div','timer-row');row.dataset.enabled=String(entry.enabled);row.dataset.on=String(entry.on);
      const reason=data.writeReason??entry.editReason;
      const open=button('','timer-row-open',()=>selecting?props.select(props.selection?.includes(entry.key)?props.selection.filter(key=>key!==entry.key):[...props.selection??[],entry.key]):props.edit(entry));open.disabled=!!writing||!!entry.editReason;open.setAttribute('aria-description',entry.editReason??'右键或长按选择定时');
      open.append(element('div','timer-row-text',element('div','timer-time',entry.endTime?`${entry.time} - ${entry.endTime}`:entry.time),element('p','timer-repeat',`${entry.endTime?'时间段定时':entry.on?'定时开启':'定时关闭'} | ${entry.repeat}`)));
      let press:ReturnType<typeof setTimeout>|undefined;open.addEventListener('pointerdown',()=>{press=setTimeout(()=>{if(open.isConnected&&!reason&&!props.busy)props.select([entry.key]);},650);});for(const event of ['pointerup','pointercancel','pointerleave'])open.addEventListener(event,()=>clearTimeout(press));
      open.addEventListener('contextmenu',event=>{event.preventDefault();if(!reason&&!props.busy)props.select([entry.key]);});
      const toggle=selecting?button('','timer-selection-circle',()=>props.select(props.selection?.includes(entry.key)?props.selection.filter(key=>key!==entry.key):[...props.selection??[],entry.key])):button('',`outlet-delay-toggle${entry.enabled?' checked':''}`,()=>props.toggle(entry));toggle.disabled=!!writing||!!reason;toggle.setAttribute('aria-description',reason??'');
      if(pending){toggle.dataset.pending='sending';toggle.setAttribute('aria-busy','true');}
      if(selecting){const selected=props.selection?.includes(entry.key)??false;toggle.classList.toggle('selected',selected);toggle.setAttribute('aria-label','选择定时');toggle.setAttribute('aria-pressed',String(selected));if(selected)toggle.append(icon('check'));}
      else{toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',entry.enabled?'关闭此定时':'启用此定时');toggle.setAttribute('aria-checked',String(entry.enabled));}
      row.append(open,toggle);body.append(row);
    }
    if(!data.entries.length)body.append(element('p','timer-read-status',data.unsupportedCount?'暂时无法显示此设备的定时记录。':'没有普通定时记录。'));
    page.setAttribute('aria-description',['来自小米云 · 北京时间',data.writeReason,...data.warnings].filter(Boolean).join(' · '));
  }
  if(error&&draft&&error.kind!=='timerWriteUncertain'){const message=element('p','timer-read-status',error.message);message.setAttribute('role','alert');body.append(message);}
  if(error)page.setAttribute('aria-description',error.message);
  if(props.message)page.setAttribute('aria-description',props.message);
  if(writing){page.dataset.pending='sending';page.setAttribute('aria-busy','true');}
  page.append(body);
  if(!draft&&!selecting){const add=button('','timer-add-button',()=>props.show({kind:'add'}),'plus');add.setAttribute('aria-label','添加定时');add.disabled=!!writing||loading||!data||!!data.writeReason;add.setAttribute('aria-description',data?.writeReason??'');page.append(add);}
  if(selecting){const remove=button('删除','timer-delete-button',()=>props.show({kind:'delete'}),'trash');remove.disabled=!!writing||!props.selection?.length;page.append(element('footer','timer-selection-footer',remove));}
  const dialog=timerDialog(props);if(dialog)page.append(dialog);
  stage.append(page);return deviceSurfaces(stage);
}
