import './ir-remote.css';
import type {Device} from '../types';
import {televisionLabels,type TelevisionRole} from '../television';
import {icon,officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {deviceSurfaces} from './device-surfaces';
import {notice} from './notice';

export interface RemoteKey {
  label?:string;
  press:()=>void;
  pending?:boolean;
  selected?:boolean;
  data?:Record<string,string>;
}

interface RemotePageProps {
  device:Device;
  template:string;
  keys?:Partial<Record<TelevisionRole,RemoteKey>>;
  back:()=>void;
  disabled?:boolean;
  busy?:boolean;
  loading?:boolean;
  error?:string;
  retry?:()=>void;
  extras?:HTMLElement;
  extrasOpen?:boolean;
}

export function remoteControlPage(p:RemotePageProps):HTMLElement{
  const back=button('','page-icon-button',p.back,'back');
  back.setAttribute('aria-label','返回家庭');
  const header=element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name)));
  const body=element('div','device-page-scroll ir-remote-content');
  const page=element('section','device-page page-ir-remote',header,body);
  page.dataset.presentationTemplate=p.template;
  page.dataset.visualAdapter='media-remote';
  if(p.loading)body.append(deviceWait(undefined,p.device.name,false));
  else if(p.error){
    const failure=notice({tone:'error',title:p.error});
    if(p.retry)failure.append(button('重试','button button-small button-secondary',p.retry));
    body.append(failure);
  }else{
    const extra=p.extras?element('details','ir-extra-keys',
      element('summary','ir-extra-heading',element('span','','更多功能'),icon('chevron')),p.extras):undefined;
    if(extra)extra.open=!!p.extrasOpen;
    const make=(role:TelevisionRole)=>{
      const key=p.keys?.[role],more=role==='menu'&&!key?extra:undefined;
      const control=button(role==='center'?'OK':'',`ir-key ir-${role}`,()=>{
        if(control.disabled)return;
        if(key)key.press();
        else if(more){
          more.open=!more.open;
          if(more.open)more.scrollIntoView({block:'nearest'});
        }
      });
      control.dataset.irRole=role;
      control.dataset.focusKey=`media-remote-${role}`;
      if(key?.data)Object.assign(control.dataset,key.data);
      control.setAttribute('aria-label',key?.label??(more?'更多功能':televisionLabels[role]));
      control.disabled=(!key&&!more)||!!key&&!!p.disabled;
      if(key?.pending)control.setAttribute('aria-busy','true');
      control.classList.toggle('is-sending',!!key?.pending);
      if(key?.selected!==undefined)control.setAttribute('aria-pressed',String(key.selected));
      if(more){
        control.setAttribute('aria-expanded',String(more.open));
        more.addEventListener('toggle',()=>control.setAttribute('aria-expanded',String(more.open)));
      }
      if(role==='up'||role==='down'||role==='left'||role==='right')control.append(element('span','ir-direction-dot'));
      else if(role!=='center')control.append(officialIcon(`ir:${role}`));
      return control;
    };
    const row=(className:string,roles:TelevisionRole[])=>element('div',className,...roles.map(make));
    const pad=row('ir-direction-pad',['up','left','center','right','down']);
    pad.setAttribute('role','group');
    pad.setAttribute('aria-label','方向和确认');
    const remote=element('section','ir-console',
      row('ir-top-row',['power','volume-down','volume-up']),
      element('div','ir-pad-area',pad),
      row('ir-bottom-row',['home','back','menu']));
    remote.setAttribute('aria-label','遥控器');
    remote.setAttribute('aria-busy',String(!!p.busy));
    body.append(remote);
    if(extra)body.append(extra);
  }
  return deviceSurfaces(element('div','device-stage',page));
}
