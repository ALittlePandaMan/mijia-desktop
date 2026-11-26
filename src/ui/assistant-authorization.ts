import {button,element} from './dom';
import {qrImage} from './qr-image';
import {icon,officialIcon} from '../icons';
import {settingsCopy} from './settings-content';
import {assistantConnectionView,type AssistantAuthorizationController} from '../assistant-authorization';
export function assistantAuthorization(controller:AssistantAuthorizationController,loggedIn:boolean):HTMLElement{
 const card=element('section','settings-card settings-assistant');card.setAttribute('aria-label','云端助手授权');
 const status=controller.status,view=assistantConnectionView(status,loggedIn,!!controller.qr);
 const badge=element('span','settings-mcp-status',view.label);badge.dataset.state=view.authorized?'running':status?.state==='connectionFailed'?'error':'waiting';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');
 const copy=settingsCopy(view.authorized?'已连接当前米家账号':'智能家居助手连接',view.authorized?'':view.caption);
 card.append(element('header','settings-assistant-heading',element('span','settings-assistant-brand',officialIcon('desktop:app')),copy,badge));
 const actions=element('div','settings-assistant-actions');
 if(view.showVerification){const start=button(controller.busy?'处理中…':'重新验证登录','settings-action settings-mcp-button settings-mcp-button-primary',()=>{void controller.start();});start.dataset.focusKey='assistant-authorize';start.disabled=controller.busy;actions.append(start);}
 if(view.retry){const retry=button(view.refreshLabel,'settings-action settings-mcp-button',()=>{void controller.load(true);});retry.prepend(icon('refresh'));retry.dataset.focusKey='assistant-retry';retry.disabled=controller.busy;actions.append(retry);}
 if(controller.qr){const box=element('div','settings-assistant-qr',qrImage(controller.qr.qrDataUrl,'云端助手授权二维码'),element('p','settings-assistant-caption','请使用与当前米家相同的小米账号扫码确认。'));box.append(button('取消扫码','settings-action settings-mcp-button',()=>{void controller.cancel();}));card.append(box);}
 if(actions.childElementCount)card.append(actions);

 if(controller.message){const error=element('p','settings-assistant-caption',controller.message);error.setAttribute('role','alert');card.append(error);}return card;
}
