import './speaker-page.css';
import {renderCategoryPage,type CategoryPageProps} from './category-page';
import {speakerMetadataSupported,type SpeakerPlayer,type SpeakerState} from '../speaker';
import {button,element} from './dom';
import {operationFeedback} from './operation-feedback';
import {numericValue} from '../panel-layout';

/** Known Xiaomi players use the original output-volume protocol. */
export function speakerPage(p:CategoryPageProps&{player?:SpeakerPlayer;playerError?:string;retry?:()=>void;state?:SpeakerState}):HTMLElement {
 const privatePlayer=speakerMetadataSupported(p.device.model),state=p.state;
 if(privatePlayer)state?.seedPanel(p.panel);
 const volume=state?.report?.volume??numericValue(p.panel.services.find(s=>s.name==='speaker')?.properties.find(p=>p.name==='volume'));
 const panel=privatePlayer?{...p.panel,services:p.panel.services.map(s=>s.name==='speaker'?{...s,properties:s.properties.map(prop=>prop.name==='volume'?{...prop,value:volume??undefined,code:volume==null?undefined:0,valueRange:[0,100,1],valueList:undefined}:prop.name==='mute'?{...prop,value:volume==null?undefined:volume===0,code:volume==null?undefined:0}:prop)}:s)}:p.panel;
 const view=renderCategoryPage({...p,panel,write:(property,value)=>{if(privatePlayer&&state){if(property.name==='mute')void state.mute();else if(property.name==='volume')void state.volume(Number(value));}else p.write(property,value);}});view.dataset.speakerStyle='minimal';
 view.querySelectorAll<HTMLElement>('[data-capability-role]').forEach(n=>{if(!['speaker.volume','play-control.previous','play-control.next'].includes(n.dataset.capabilityRole??''))n.remove();});
 view.querySelectorAll('.category-private-notes,.category-empty').forEach(n=>n.remove());
 if(privatePlayer){
  view.querySelector('.category-actions')?.remove();
  const actions=element('div','speaker-transport daily-actions device-control-unit');
  for(const[operation,label]of [['previous','上一首'],['next','下一首']]as const){const b=button(label,'native-card category-action',()=>{if(!b.disabled)void state?.step(operation)},`speaker:${operation}`);b.dataset.capabilityRole=`play-control.${operation}`;b.disabled=!state||!p.device.online||!!p.device.sharedReadOnly||p.busy||!!p.cached;actions.append(b);}view.querySelector('.category-controls')?.append(actions);
  if(state?.message)view.append(operationFeedback(state.message,state.uncertain?()=>state.adopt():undefined));
 }
 if(p.playerError)view.setAttribute('aria-description',p.playerError);
 return view;
}
