import type {RouterPasswordState} from '../router-password';
import {officialIcon} from '../icons';
import {button,element} from './dom';
const ns='http://www.w3.org/2000/svg';
function symbol(kind:'qr'|'eye',shown=false):SVGSVGElement{return kind==='qr'?officialIcon('router:qr'):officialIcon(shown?'router:eye':'router:eye-off');}
export function routerPasswordCard(s?:RouterPasswordState):HTMLElement {
 const card=element('section','router-password-card'),head=element('div','router-password-head',element('strong','',s?.revealed?'无线网络':'Wi-Fi密码')),tools=element('div','router-password-tools');card.dataset.passwordReady=String(!!s?.report&&!s.error);card.dataset.revealed=String(!!s?.revealed);
 if(s?.report?.qr){const qr=button('','router-password-qr',()=>s.share());qr.setAttribute('aria-label','分享Wi-Fi');qr.disabled=!!s.error;qr.append(symbol('qr'));tools.append(qr);}
 const eye=button('','router-password-eye',()=>s?.toggle());eye.disabled=!s?.report||!!s.error;eye.setAttribute('aria-label',s?.revealed?'隐藏密码':'显示密码');eye.setAttribute('aria-expanded',String(!!s?.revealed));eye.append(symbol('eye',s?.revealed));tools.append(eye);head.append(tools);card.append(head);
 if(s?.revealed&&s.report){const rows=element('div','router-password-rows');for(const row of s.report.rows)rows.append(element('p','',row.label+'：'+row.ssid),element('p','','Wi-Fi密码：'+(row.password||'此无线网络没有设置密码')));card.append(rows);}
 if(s?.error)card.append(element('p','router-password-error',s.error.message));
 return card;
}
export function routerPasswordDialog(s:RouterPasswordState):HTMLElement|undefined {
 if(!s.matrix)return;
 const overlay=element('div','router-modal-backdrop router-share-backdrop'),dialog=element('section','router-share-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','分享Wi-Fi');dialog.tabIndex=-1;
 const size=s.matrix.length,svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`-4 -4 ${size+8} ${size+8}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Wi-Fi连接二维码');svg.setAttribute('shape-rendering','crispEdges');
 const bg=document.createElementNS(ns,'rect');bg.setAttribute('x','-4');bg.setAttribute('y','-4');bg.setAttribute('width',String(size+8));bg.setAttribute('height',String(size+8));bg.setAttribute('fill','#fff');const path=document.createElementNS(ns,'path');path.setAttribute('fill','#191919');path.setAttribute('d',s.matrix.flatMap((row,y)=>row.flatMap((v,x)=>v?[`M${x} ${y}h1v1h-1z`]:[])).join(''));svg.append(bg,path);
 dialog.append(element('h3','','分享Wi-Fi'),element('div','router-share-code',svg),element('p','','请使用手机相机或系统扫码工具扫描二维码，即可连接至Wi-Fi网络'));overlay.append(dialog);
 overlay.addEventListener('click',e=>{if(e.target===overlay)s.dismiss();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();s.dismiss();}else if(e.key==='Tab'){e.preventDefault();dialog.focus();}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
 return overlay;
}
