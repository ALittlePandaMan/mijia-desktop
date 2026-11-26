import {element} from './dom';

export function deviceWait(_artwork?:()=>HTMLElement,name='设备',compact=true):HTMLElement{return deviceLoading(undefined,name,compact);}

/** A quiet three-dot indicator; loading never displays a substitute device icon. */
export function deviceLoading(_artwork:HTMLElement|undefined,name:string,compact=false):HTMLElement {
  const view=element('div','device-loading');
  view.setAttribute('role','status');
  view.setAttribute('aria-label',`正在加载${name}`);
  view.setAttribute('aria-busy','true');
  view.dataset.deviceLoading='true';
  view.classList.toggle('device-loading-compact',compact);
  const dots=element('span','device-loading-dots',element('i'),element('i'),element('i'));
  dots.setAttribute('aria-hidden','true');
  view.append(dots);
  return view;
}
