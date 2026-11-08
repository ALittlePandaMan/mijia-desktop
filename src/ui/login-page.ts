import {element,button} from './dom';
import type {AppError,QrView} from '../types';

export interface LoginPageProps {
  qrState:string;qr?:QrView;error?:AppError;
  startQr:()=>void;cancelQr:()=>void;
}
function qrIcon():SVGSVGElement {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('aria-hidden','true');
  svg.innerHTML='<g fill="none" stroke="currentColor" stroke-width="3"><path d="M3 3h9v9H3zM20 3h9v9h-9zM3 20h9v9H3zM20 18v6h9v5h-9M28 17v2"/></g>';
  return svg;
}
export function loginPage(p:LoginPageProps):HTMLElement {
  const root=element('main','login-screen account-login');
  const art=element('aside','account-art');art.setAttribute('aria-hidden','true');
  const content=element('section','account-layout');
  const card=element('section','account-login-content');card.setAttribute('aria-label','扫码登录');
  const qr=element('div','account-qr',element('h2','','扫码登录'),element('p','account-qr-help','使用米家 App 或小米账号扫码确认'));
  const imageBox=element('div','account-qr-image-box');imageBox.setAttribute('aria-live','polite');
  if(p.qrState==='ready'&&p.qr){
    const img=element('img','qr-image');img.alt='小米账号登录二维码';
    if(/^data:image\/(png|svg\+xml|jpeg|webp|gif);/.test(p.qr.qrDataUrl))img.src=p.qr.qrDataUrl;
    imageBox.append(img);
  }else imageBox.append(qrIcon(),element('span','',p.qrState==='loading'?'正在获取二维码…':p.qrState==='expired'?'二维码已失效':'获取登录二维码'));
  qr.append(imageBox);
  if(p.qrState==='ready')qr.append(element('p','account-scan-status','等待扫码确认'),button('刷新二维码','account-primary login-action',p.startQr));
  else{
    const start=button(p.qrState==='expired'||p.qrState==='error'?'重新获取二维码':'获取登录二维码','account-primary login-action',p.startQr);
    start.disabled=p.qrState==='loading';qr.append(start);
  }
  if(p.qrState==='ready'||p.qrState==='loading')qr.append(button('取消登录','account-cancel',p.cancelQr));
  card.append(qr);
  if(p.error){const error=element('p','account-error',p.error.message);error.setAttribute('role','alert');card.append(error)}
  content.append(card);root.append(art,content);return root;
}
