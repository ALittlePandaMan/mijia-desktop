import type {DeviceEventsState} from '../device-events';
import {cameraDate} from '../camera-browser';
import {cameraDatePicker} from './camera-date-picker';
import {deviceChoiceLabel} from '../device-labels';
import {button,element} from './dom';
export function renderDeviceEvents(state:DeviceEventsState):HTMLElement{
 const view=element('section','category-page-content device-event-history device-card-stack');
 const minimum=new Date();minimum.setDate(minimum.getDate()-366);const date=button(state.date.replace(/-/g,'/'),'input',()=>cameraDatePicker(date,state.date,value=>void state.load(value),cameraDate(minimum.getTime()/1000)));date.setAttribute('aria-label','选择记录日期');
 view.append(element('div','native-card event-date-card',element('h3','','设备记录'),date));
 view.setAttribute('aria-busy',String(state.loading));if(!state.complete)view.setAttribute('aria-description','记录可能不完整。');
 if(state.error)view.append(element('p','error-message',state.error.message));
 if(!state.records.length&&!state.loading&&!state.error)view.append(element('div','native-card category-empty',element('p','','当天暂无记录')));
 for(const record of state.records){
  const card=element('article','native-card event-record',element('h3','',record.label),element('time','',new Date(record.time*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})));
  const names:Record<string,string>={'lock-action':'操作','operation-method':'方式','operation-position':'位置','operation-id':'用户编号','abnormal-condition':'异常','door-state':'门状态'};
  for(const arg of record.arguments){if(arg.name==='current-time')continue;const value=typeof arg.value==='number'&&arg.display===String(arg.value)?arg.display:deviceChoiceLabel(arg.display,'未知状态');card.append(element('p','',`${names[arg.name]??'详情'}：${value}`));}
  view.append(card);
 }
 if(state.nextCursor)view.append(button('加载更多','native-card category-action',()=>void state.load(state.date,true)));
 return view;
}
