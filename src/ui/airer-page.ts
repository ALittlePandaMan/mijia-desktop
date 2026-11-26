import {bindDialogFocus} from './dialog-focus';
import {dismissOnBackdrop} from './dialog-dismiss';
import {airerHero,airerLightCard,airerMotorCard,airerPositionCard} from './airer-controls';
import {airerPositionTarget,airerRailAllows,standardAirerLight,standardAirerRails} from '../airer-spec';
import type {SpecAirerCommands} from '../airer-spec-commands';
import {numericValue} from '../panel-layout';
import {deviceSurfaces} from './device-surfaces';
import {deviceChannelPicker} from './device-channel-picker';
import type {Device,DevicePanel,Property,Json} from '../types';
import {airerNumber,airerProperty,airerStatus,airerNightReason,airerLiftReason,type AirerCommands,type AirerIntent,type AirerView} from '../airer';
import {element,button} from './dom';import {icon} from '../icons';import {renderControl} from './controls';import {deviceWait} from './device-loading';import {purifierWheel} from './purifier-wheel';
type Commands=Pick<AirerCommands,'display'|'blocked'|'activeIntent'|'message'|'uncertain'|'adopt'|'motion'|'verifyMotion'>&{opening:Pick<AirerCommands['opening'],'showing'>};
function airerPositionLabel(current:number|undefined,target:number|undefined):string|undefined {
 if(target!==undefined&&target!==current)return `目标位置${target}%`;
 if(current!==undefined)return `当前位置${Math.round(current)}%`;
}

export function standardAirerPage(p:{device:Device;panel:DevicePanel;commands:Pick<SpecAirerCommands,'rail'|'activeIntent'|'error'|'select'|'lift'>;cached:boolean;busy:boolean;artwork:()=>HTMLElement;
 back:()=>void;write:(property:Property,value:Json)=>void;changed:()=>void}):HTMLElement {
 const {commands,device}=p,selected=commands.rail;
 const rails=selected?standardAirerRails(p.panel):[],rail=rails.find(choice=>choice.motor.siid===selected?.motor.siid),phase=rail?.phase;
 const target=rail&&airerPositionTarget(p.panel,rail.motor.siid),targetValue=numericValue(target);
 const active=device.online?commands.activeIntent:undefined;
 const blocked=p.cached||p.busy||!device.online||!!device.sharedReadOnly||!!commands.error;
 const page=element('section','device-page page-airer');page.dataset.presentationTemplate='airer';
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');
 const positionLabel=airerPositionLabel(rail?.position,targetValue);
 const movement=active==='up'?'上升中':active==='down'?'下降中':undefined;
 const limit=phase==='top'?'已到上限位':phase==='bottom'?'已到下限位':undefined;
 const status=!device.online?'设备离线':(target?.pending?undefined:movement)??positionLabel??limit;
 const caption=element('p','',status);caption.hidden=!status;
 const title=element('div','device-page-title',element('h2','',device.name),caption);
 const body=element('div','device-page-scroll airer-content',element('div','airer-hero',element('div','airer-product-picture',p.artwork())));
 if(rails.length>1)body.append(deviceChannelPicker('airer',rails.map((choice,index)=>({
  id:choice.motor.siid,label:choice.label==='晾杆'?`晾杆 ${index+1}`:choice.label,
  selected:choice.motor.siid===rail?.motor.siid,select:()=>commands.select(choice.motor.siid),
 }))));
 if(rail?.fault==='active'||phase==='blocked')body.append(element('div','native-card airer-fault',element('strong','','晾杆当前不可运行')));
 body.append(airerMotorCard(active,intent=>!blocked&&!!rail&&airerRailAllows(rail,intent),intent=>commands.lift(intent)));
 if(target)body.append(airerPositionCard(target,{device,busy:blocked||rail?.fault!=='normal'||phase==='blocked',
  write:p.write,error:()=>{},interactionEnded:p.changed},value=>{
   caption.textContent=value===undefined?status??'':`目标位置${value}%`;
   caption.hidden=value===undefined&&!status;
 }));
 const {power,brightness}=standardAirerLight(p.panel);
 const light=airerLightCard(power,brightness,{device,busy:blocked,write:p.write,error:()=>{},interactionEnded:p.changed});
 if(light)body.append(light);
 page.append(element('header','device-page-header',back,title),body);
 return deviceSurfaces(element('div','device-stage',page));
}
interface Props {device:Device;panel:DevicePanel;view:AirerView;commands:Commands;cached:boolean;busy:boolean;artwork:()=>HTMLElement;back:()=>void;home:()=>void;changed:()=>void;lift:(intent:AirerIntent)=>void;write:(p:Property,v:Json)=>void;night:()=>void;save:()=>void;compatibility:()=>void;refresh:()=>void;error?:string}
export function airerPage(p:Props):HTMLElement{
 const sourcePanel=p.panel;
 p={...p,panel:p.commands.display?.(p.panel)??p.panel};
 const stage=element('div','device-stage'),page=element('section',`device-page page-airer${p.view.page==='night'?' page-airer-night':''}`),header=element('header','device-page-header'),close=button('','page-icon-button',p.view.page==='night'?p.home:p.back,p.view.page==='night'?'close':'back');close.setAttribute('aria-label',p.view.page==='night'?'取消夜灯编辑':'返回家庭');
 const status=airerStatus(p.panel),blocked=p.busy||p.commands.blocked||p.cached||!p.device.online||!!p.device.sharedReadOnly;
 const title=element('div','device-page-title',element('h2','',p.view.page==='night'?'定时夜灯':p.device.name));header.append(close,title);page.append(header);stage.append(page);
 const body=element('div','device-page-scroll airer-content');page.append(body);
 if(p.view.page==='home'){
  const reported=airerNumber(sourcePanel,4,11,'current-position'),pos=reported!==undefined&&reported>=0&&reported<=100?reported:undefined;
  const target=airerPositionTarget(sourcePanel,2),targetValue=numericValue(target);
  const caption=element('p');title.append(caption);
  let positionPreview:number|undefined,motionPosition=pos;
  const updateCaption=()=>{
   const next=!p.device.online?'设备离线':positionPreview!==undefined?`目标位置${positionPreview}%`:
    p.commands.motion.local&&!target?.pending&&motionPosition!==undefined?`预计位置${Math.round(motionPosition)}%`:
    airerPositionLabel(pos,targetValue)??'当前位置--%';
   if(caption.textContent!==next)caption.textContent=next;
  };
  updateCaption();
  body.append(airerHero({position:pos,motion:p.commands.motion,finished:()=>void p.commands.verifyMotion(),
   caption:value=>{motionPosition=value;updateCaption();}}));
  const fault=airerNumber(p.panel,2,1,'fault');
  if(fault!==undefined&&fault!==0)body.append(element('div','native-card airer-fault',element('strong','',fault===1?'晾杆遇阻':fault===2?'晾杆超重':'电机故障')));
  const active=p.device.online?p.commands.activeIntent:undefined;
  body.append(airerMotorCard(active,intent=>!blocked&&(!fault||intent==='pause')&&!airerLiftReason(p.panel,intent),p.lift));
  if(target)body.append(airerPositionCard(target,{device:p.device,busy:blocked||fault!==0||status===undefined,
   write:p.write,error:()=>{},interactionEnded:p.changed},value=>{positionPreview=value;updateCaption();}));
  const lightCard=airerLightCard(airerProperty(p.panel,3,1,'on','bool'),airerProperty(p.panel,3,3,'brightness','uint8'),
   {device:p.device,busy:blocked,write:p.write,error:()=>{},interactionEnded:p.changed});
  if(lightCard)body.append(lightCard);
 }else if(p.view.draft){
  const draft=p.view.draft.target,why=airerNightReason(draft),save=button('','page-icon-button',p.save,'check');save.setAttribute('aria-label','保存夜灯设置');save.disabled=blocked||!!why;header.append(save);
  const toggle=button('','airer-night-row',()=>{draft.enabled=!draft.enabled;p.changed();});toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','定时夜灯');toggle.setAttribute('aria-checked',String(draft.enabled));toggle.disabled=blocked;toggle.append(element('span','','定时夜灯'),element('span',`airer-toggle${draft.enabled?' checked':''}`));body.append(toggle);
  if(draft.enabled){for(const kind of ['start','end']as const){const hour=kind==='start'?draft.startHour:draft.endHour,minute=kind==='start'?draft.startMinute:draft.endMinute,b=button('','airer-night-row',()=>{p.view.picker={kind,hour,minute};p.changed();});b.disabled=blocked;b.dataset.focusKey=`airer-night-${kind}`;b.append(element('span','',kind==='start'?'开始时间':'结束时间'),element('span','airer-night-time',`${kind==='end'&&hour<=8?'次日 ':''}${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`),icon('chevron'));body.append(b);}
   const source=airerProperty(p.panel,4,6,'brightness','uint8'),local=source?{...source,value:draft.brightness,code:0}:undefined,card=renderControl({name:'Slider',props:{property:local,label:'亮度',unit:'%',theme:'brightness'}},{device:p.device,busy:blocked,write:(_p,v)=>{if(typeof v==='number'){draft.brightness=v;p.changed();}},error:()=>{}});card.classList.add('airer-night-brightness');body.append(card);
  }body.append(element('p','airer-night-help','“定时夜灯”开启后，在该时间段内，开灯自动进入夜灯模式'));if(why)body.append(element('p','purifier-error',why));
 }
 if(p.commands.opening.showing)page.append(element('div','airer-pending',deviceWait(p.artwork,p.device.name,false)));
 if(p.view.picker&&p.view.draft){const picker=p.view.picker,draft=p.view.draft.target,overlay=element('div','purifier-modal-backdrop'),dialog=element('section','purifier-confirm airer-time-picker');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',picker.kind==='start'?'开始时间':'结束时间');dialog.append(element('h3','',picker.kind==='start'?'开始时间':'结束时间'));const minutes=()=>picker.kind==='end'&&picker.hour===8?[0]:Array.from({length:60},(_,i)=>i),minute=purifierWheel('分',minutes(),picker.minute,v=>{picker.minute=v;},v=>String(v).padStart(2,'0')),hours=picker.kind==='start'?[17,18,19,20,21,22,23]:[17,18,19,20,21,22,23,0,1,2,3,4,5,6,7,8],hour=purifierWheel('时',hours,picker.hour,v=>{picker.hour=v;if(v===8)picker.minute=0;minute.setValues(minutes(),picker.minute);},v=>String(v).padStart(2,'0'));dialog.append(element('div','purifier-dnd-wheels',element('div','purifier-wheel-column',hour.node,element('span','purifier-wheel-unit','时')),element('div','purifier-wheel-column',minute.node,element('span','purifier-wheel-unit','分'))));const close=()=>{p.view.picker=undefined;p.changed();};dialog.append(element('footer','',button('取消','',close),button('确定','',()=>{if(picker.kind==='start'){draft.startHour=picker.hour;draft.startMinute=picker.minute;}else{draft.endHour=picker.hour;draft.endMinute=picker.minute;}close();})));dismissOnBackdrop(overlay,close);overlay.append(dialog);page.append(overlay);bindDialogFocus(dialog,close);}
 
 return deviceSurfaces(stage);
}
