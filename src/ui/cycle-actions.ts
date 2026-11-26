import {button,element} from './dom';

export function cycleActions(className:string, ...actions:HTMLButtonElement[]):HTMLElement {
  return element('footer', `cycle-actions ${className}`, ...actions);
}

export function cycleButton(label:string,press:()=>void,kind:'secondary'|'primary'|'suspend'='secondary'):HTMLButtonElement {
  const style=kind==='suspend'?'primary cycle-suspend':kind==='primary'?'primary':'';
  return button(label,style,press);
}
