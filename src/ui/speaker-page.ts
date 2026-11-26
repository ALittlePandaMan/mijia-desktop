import './speaker-page.css';
import {audioBindings,speakerMetadataSupported,type SpeakerState} from '../speaker';
import {readOnlyCategory} from '../device-capabilities';
import {numericValue} from '../panel-layout';
import type {IconName} from '../icons';
import type {DevicePanel,Json,Property} from '../types';
import {button,element} from './dom';
import {renderControl,type ControlEnvironment} from './controls';
import {deviceSurfaces} from './device-surfaces';
import {deviceUnavailablePage} from './device-unavailable';

type Track=NonNullable<ReturnType<typeof audioBindings>['next']>;
type Props=Omit<ControlEnvironment,'busy'>&{
 panel:DevicePanel;cached:boolean;busy:boolean;state:SpeakerState;artwork:()=>HTMLElement;back:()=>void;
 play:(track:Track)=>void;pending:(track:Track)=>boolean;setPlayback:(property:Property,value:Json)=>void;
};
const transportButtons=[['next','下一首'],['playback','播放控制'],['previous','上一首']] as const;

export function speakerTransport(...controls: HTMLElement[]): HTMLElement {
 return element('div','speaker-transport device-control-unit',...controls);
}

export function speakerTransportButton(label:string,glyph:IconName,disabled:boolean,press:()=>void):HTMLButtonElement {
 const control=button(label,'native-card category-action',()=>{if(!control.disabled)press();},glyph);
 control.disabled=disabled;
 return control;
}

export function speakerPage(p:Props):HTMLElement {
 const privatePlayer=speakerMetadataSupported(p.device.model);
 if(privatePlayer)p.state.seedPanel(p.panel);
 const bindings=audioBindings(p.device,p.panel);
 const busy=p.busy||p.cached,readOnly=!!p.device.sharedReadOnly||readOnlyCategory(p.panel.specType);
 const controls=element('div','device-card-stack');
 if(bindings.volume){
   const raw=bindings.volume;
   const value=p.state.report?.volume??numericValue(raw);
   const property=privatePlayer?{...raw,value,code:value===undefined?raw.code:0,valueRange:[0,100,1],valueList:undefined}:raw;
   const percent=property.unit==='percentage'||property.valueRange?.[1]===100;
   const slider=renderControl({name:'Slider',props:{property,label:'音量',unit:percent?'%':undefined,theme:'volume',
     locked:readOnly,discrete:!!property.valueList,choiceLabel:description=>String(property.valueList?.find(c=>c.description===description)?.value??description)}},
     {...p,busy,write:(property,value:Json)=>{if(privatePlayer&&typeof value==='number')void p.state.volume(value);else p.write(property,value);}});
   slider.dataset.capabilityRole='speaker.volume';
   controls.append(slider);
 }
 const transport=speakerTransport();
 for(const [direction,label] of transportButtons){
   if(direction==='playback'){
     const control=playbackControl(p,bindings,!p.device.online||readOnly||busy);
     if(control)transport.append(control);
     continue;
   }
   const track=bindings[direction];
   if(!privatePlayer&&!track)continue;
   const disabled=!p.device.online||readOnly||busy||(privatePlayer?p.state.stepPending(direction):!!track&&p.pending(track));
   const control=speakerTransportButton(label,`speaker:${direction}`,disabled,()=>{
     if(privatePlayer)void p.state.step(direction);
     else if(track)p.play(track);
   });
   control.dataset.capabilityRole=`play-control.${direction}`;
   control.dataset.focusKey=`speaker:${direction}`;
   transport.append(control);
 }
 if(transport.childElementCount)controls.append(transport);
 if(!controls.childElementCount)return deviceUnavailablePage(p.device,p.back);
 const back=button('','page-icon-button',p.back,'back');
 back.setAttribute('aria-label','返回家庭');
 const page=element('section','device-page page-speaker',
   element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))),
   element('div','device-page-scroll device-controls-region',
     element('div','category-product',p.artwork(),element('h1','',p.device.name)),controls));
 page.dataset.presentationTemplate='speaker';
 return deviceSurfaces(element('div','device-stage',page));
}

function playbackControl(p:Props,bindings:ReturnType<typeof audioBindings>,disabled:boolean):HTMLButtonElement|undefined{
 const {play,pause,state}=bindings;
 if(!play&&!pause)return;
 const {binding,playing,resumable,privatePlayer}=p.state.playbackStatus(bindings);
 const track=playing?pause:resumable?play:undefined;
 const control=speakerTransportButton(playing?'暂停':'播放',playing?'speaker:pause':'speaker:play',disabled||!track||p.pending(track),()=>{
   if(!track)return;
   if(privatePlayer)void p.state.setPlayback(!playing,track.action);
   else if(binding)p.setPlayback(binding.property,playing?binding.paused:binding.playing);
 });
 control.dataset.capabilityRole='play-control.playback';
 control.dataset.focusKey='speaker:playback';
 if(state?.pending){
   control.dataset.pending=state.pending;
   control.setAttribute('aria-busy','true');
 }
 return control;
}
