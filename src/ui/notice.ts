import {icon} from '../icons';
import {element} from './dom';

export interface Notice {tone:'success'|'warning'|'error';title:string;message?:string}

export function notice(info:Notice):HTMLElement {
 const glyph=info.tone==='success'?'check':info.tone==='warning'?'info':'warning';
 const box=element('div',`notice notice-${info.tone}`,icon(glyph),element('div','',element('strong','',info.title),info.message?element('p','',info.message):null));
 box.setAttribute('role',info.tone==='error'?'alert':'status');return box;
}
