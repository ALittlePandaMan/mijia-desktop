import {applyCardMetrics} from './card-metrics';
import type {Device,HomeCardEntry,HomeCardIntent,HomeCardPresentation,Json} from '../types';
import {updateCardControls} from './card-controls';
import {cardActive} from '../home-cards';
import {button,element} from './dom';
import {homeShortcut} from './home-shortcut';
import {officialIcon} from '../icons';
import {cardSize,type CardSize} from '../card-size';
/** Desktop card markup, independent of arrangement, drag, account, and IPC. */
export function deviceCardView(o:{size?:CardSize;device:Device;shortcut:HomeCardEntry|undefined;pending:boolean;artwork:HTMLElement;caption:string;selected:boolean;open:()=>void;activate:(intent:HomeCardIntent)=>void;presentation?:HomeCardPresentation;activateControl?:(id:string,value:Json)=>void}):HTMLElement {
 const {device,shortcut}=o;
 const card=element('article',`device-card${!device.online?' offline':''}${cardActive(shortcut,device)?' is-active':''}`);
 card.dataset.deviceId=device.did;card.dataset.focusKey=`device-${device.did}`;card.tabIndex=-1;
 card.dataset.cardSize=cardSize(o.size);
 card.setAttribute('aria-label',`${device.name}，${device.online?'在线':'离线'}，查看设备功能`);
 card.setAttribute('aria-pressed',String(o.selected));card.setAttribute('aria-description',device.unsupportedReason?`${device.name}：${device.unsupportedReason}`:device.name);
 const entrance=button('','device-card-open',()=>{});entrance.setAttribute('aria-label',card.getAttribute('aria-label')!);
 card.append(entrance,element('div','device-card-content',element('div','device-card-top',o.artwork,homeShortcut(device,shortcut,o.pending,o.activate)),element('div','device-card-label',element('h3','',device.name),element('p','device-room',o.caption))));
 const selected=element('span','device-select-indicator',officialIcon('home:selected'));selected.setAttribute('aria-hidden','true');card.append(selected);
 updateCardControls(card,o.presentation,o.activateControl??(()=>{}));applyCardMetrics(card,240,192,cardSize(o.size));card.addEventListener('click',o.open);return card;
}
