import {button,element} from './dom';

export function actionFooter(className:string, ...actions:(HTMLButtonElement | undefined)[]):HTMLElement {
  return element('footer', `device-action-footer ${className}`.trim(), ...actions);
}

export function footerButton(label:string,press:()=>void,kind:'secondary'|'primary'='secondary'):HTMLButtonElement {
  return button(label,kind === 'secondary' ? '' : 'primary',press);
}
