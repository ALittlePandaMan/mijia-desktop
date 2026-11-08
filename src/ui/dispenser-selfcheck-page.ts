import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel} from '../types';
import {checkNext,checkPhase,checkState,checkSupported,checkTitles,type CheckOperation,type DispenserSelfCheck} from '../dispenser-selfcheck';
import {button,element} from './dom';import {icon} from '../icons';import {deviceWait} from './device-loading';import {sterilizationState} from '../dispenser-sterilization';
interface Props{device:Device;panel:DevicePanel;commands:DispenserSelfCheck;view:'selfcheck'|'selfcheck-history'|'selfcheck-report';cached:boolean;busy:boolean;artwork:()=>HTMLElement;back:()=>void;changed:()=>void;history:()=>void;report:()=>void;run:(operation:CheckOperation,expected:number[])=>void}
const labels=['未检测','正常','异常','超时','检测中'];
export function dispenserSelfCheckPage(p:Props):HTMLElement{
 const c=p.commands,values=checkState(p.panel),phase=values?checkPhase(values):undefined,stage=element('div','device-stage'),page=element('section',`device-page page-dispenser-selfcheck ${p.view}`);stage.append(page);
 const back=button('','page-icon-button',()=>{if(p.view==='selfcheck'&&phase&&phase!=='idle'&&phase!=='report'){c.confirming=true;p.changed();}else p.back();},'back');back.setAttribute('aria-label',p.view==='selfcheck'?'返回管线机设置':'返回设备自检');
 const title=p.view==='selfcheck'?'设备自检':p.view==='selfcheck-history'?'检测记录':'检测报告',header=element('header','device-page-header',back,element('div','device-page-title',element('h2','',title)));
 if(p.view==='selfcheck'&&(phase==='idle'||phase==='report')){const history=button('','page-icon-button',p.history,'records');history.setAttribute('aria-label','检测记录');header.append(history);}page.append(header);
 const body=element('div','device-page-scroll dispenser-selfcheck-body');page.append(body);
 if(p.view==='selfcheck-history'){
  if(c.recordsLoading&&!c.records)body.append(deviceWait(p.artwork,'检测记录',false));
  else if(c.recordsError)body.append(element('p','native-unavailable',c.recordsError.message));
  else if(!c.records?.records.length)body.append(element('p','selfcheck-empty',c.records?.rejected?'记录格式无法确认，未显示。':'暂无数据'));
  else{for(const r of c.records.records){const b=button('','selfcheck-record',()=>{c.selected=r;p.report();});const date=new Date(r.time*1000);b.append(element('span','',Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):'时间未知'),element('strong','',r.statuses.every(v=>v===1||v===2)?'检测完成':'检测失败'),icon('chevron'));body.append(b);}if(c.records.rejected||c.records.truncated)body.append(element('p','native-unavailable',`部分记录无法显示${c.records.truncated?'，结果达到查询上限':''}。`));}
  return deviceSurfaces(stage);
 }
 if(p.view==='selfcheck-report'||phase==='report'){
  const report=p.view==='selfcheck-report'?c.selected?.statuses:values;if(!report){body.append(element('p','native-unavailable','检测结果不可用。'));return deviceSurfaces(stage);}
  if(p.view==='selfcheck-report'&&c.selected?.time){const date=new Date(c.selected.time*1000),info=element('section','selfcheck-report-group',element('p','','设备名称',element('span','',p.device.name)),element('p','','检测时间',element('span','',Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):'时间未知')));body.append(info);}else body.append(element('h1','selfcheck-report-title','检测报告'));
  for(const [label,states] of [['异常',[2]],['未检测',[0,3,4]],['正常',[1]]] as const){const entries=report.map((value,i)=>({value,i})).filter(x=>(states as readonly number[]).includes(x.value));if(!entries.length)continue;const group=element('section','selfcheck-report-group',element('h2','',label));for(const entry of entries)group.append(element('p','',checkTitles[entry.i],element('span','',labels[entry.value])));body.append(group);}
  return deviceSurfaces(stage);
 }
 if(!values){body.append(element('p','native-unavailable','自检状态未能实时读取。'));return deviceSurfaces(stage);}
 if(phase==='idle'){
  const art=element('div','selfcheck-art');art.append(p.artwork());body.append(art,element('p','selfcheck-description','设备自检是一个检测设备异常的功能，通过模拟设备运行中的状态检测设备可能出现的故障，让设备更加智能'),element('p','selfcheck-notice','注意事项：\n1. 确保设备处于联网在线状态；\n2. 将设备固件版本升级至最新版本；\n3. 设备自检中请勿断电。'));
 }else{
  const title=phase==='auto'?'故障排查':'手动检测',indices=phase==='auto'?[0,1,2,3,4,5]:phase==='cup'?[6]:[7,8];body.append(element('h1','selfcheck-progress-title',title));
  for(const i of indices)body.append(element('p','selfcheck-step',element('span','',checkTitles[i]),element('strong','',labels[values[i]])));
  if(phase==='cup')body.append(element('p','selfcheck-notice','请将杯子放入出水口处遮挡红外，约5秒后移走杯子完成检测。'));if(phase==='heat')body.append(element('p','selfcheck-notice','请将容积约1L的杯子放到出水口接水，在设备上选择100℃和300至500mL，点击取水，等待自动结束完成检测。'));
 }
 const next=checkNext(values),supported=checkSupported(p.panel),physical=sterilizationState(p.panel),notReady=phase==='idle'&&physical.status!==1,disabled=p.busy||p.cached||c.blocked||!supported||notReady||!p.device.online||!!p.device.sharedReadOnly,footer=element('footer','selfcheck-footer');
 if(!supported)footer.append(element('p','native-unavailable','此设备的自检动作尚未核实。'));
 if(notReady)footer.append(element('p','native-unavailable','设备需要处于待机状态，杀菌后请先排空余水。'));
 if(phase==='idle'){const agree=button('','selfcheck-agree',()=>{c.checked=!c.checked;p.changed();});agree.setAttribute('role','checkbox');agree.setAttribute('aria-checked',String(c.checked));agree.append(element('span',c.checked?'checked':''),document.createTextNode('我已知晓以上风险及注意事项'));footer.append(agree);}
 if(next){const action=button(phase==='idle'?'开始检测':'下一步','selfcheck-action',()=>p.run(next,values));action.disabled=disabled||phase==='idle'&&!c.checked;footer.append(action);}
 describeOperation(page,c.message);page.append(footer);
 if(c.confirming){const close=()=>{c.confirming=false;p.changed();},overlay=element('div','sterilization-confirm-backdrop'),dialog=element('section','sterilization-confirm',element('h3','','检测未结束，仍要结束设备检测？'));dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');const cancel=button('取消','',close),confirm=button('确定','',()=>{c.confirming=false;p.run('stop',values);});confirm.disabled=disabled;dialog.append(element('footer','',cancel,confirm));overlay.append(dialog);overlay.addEventListener('click',e=>{if(e.target===overlay)close();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancel&&!confirm.disabled?confirm:cancel).focus();}});page.append(overlay);queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});}
 return deviceSurfaces(stage);
}
