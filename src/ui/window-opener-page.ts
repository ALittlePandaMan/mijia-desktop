import {curtainExplicitlyPaused,curtainMotorMeaning,curtainStatus} from '../curtain-detail';
import type {Device,DevicePanel,Json,Property} from '../types';
import {openingPositionInput,openingPositionReading,windowOpenerCommand,windowOpenerRails} from '../window-opener';
import type {ControlNode} from './controls';
import {curtainTransport} from './curtain-view';
import {deviceSurfaces} from './device-surfaces';
import {deviceUnavailablePage} from './device-unavailable';
import {button,element} from './dom';

export function windowOpenerPage(o:{device:Device;panel:DevicePanel;locked:boolean;back:()=>void;
  control:(node:ControlNode)=>HTMLElement;write:(property:Property,value:Json)=>void}):HTMLElement {
  const rails=windowOpenerRails(o.panel,o.device.controlServiceId);
  if(!rails.length)return deviceUnavailablePage(o.device,o.back);
  const back=button('','page-icon-button',o.back,'back');
  back.setAttribute('aria-label','返回家庭');
  const content=element('div','device-page-scroll window-opener-content');
  for(const rail of rails){
    const label=rail.channel?`窗户 ${rail.channel.toUpperCase()}`:'开窗控制';
    if(rail.channel)content.append(element('h3','window-opener-channel',label));
    const status=curtainStatus(rail.status);
    const active=rail.motor?.pending?curtainMotorMeaning(rail.motor,rail.motor.value??null):
      status===1?'open':status===2?'close':curtainExplicitlyPaused(rail.status)?'pause':undefined;
    const controls=curtainTransport({device:o.device,locked:o.locked||!rail.online,label,active,scope:rail.siid,
      command:meaning=>windowOpenerCommand(rail,meaning),write:o.write});
    if(controls.childElementCount)content.append(controls);
    const property=rail.target??rail.position;
    if(!property)continue;
    const actual=openingPositionReading(rail.position);
    const current=rail.target?.pending?undefined:actual;
    content.append(o.control({name:'Slider',props:{
      property,theme:'curtain',curtainOpening:'single-left',unit:'%',
      label:current!==undefined||!rail.target?'开窗位置':'目标开度',
      locked:!rail.online||o.locked,valueProperty:openingPositionInput(rail.target,rail.position),
      previewLabel:'目标开度',liveReadout:current,
    }}));
  }
  const page=element('section','device-page page-curtain page-window-opener',
    element('header','device-page-header',back,element('div','device-page-title',element('h2','',o.device.name))),content);
  page.dataset.presentationTemplate='window-opener';
  return deviceSurfaces(element('div','device-stage',page));
}
