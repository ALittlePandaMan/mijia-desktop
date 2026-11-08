import type {Device,HomeCardEntry,HomeCardIntent,HomeCardStatus,Json} from './types';
import {readOnlyCategory} from './device-capabilities';

export function cardCaption(device:Device,room:string,statuses:HomeCardStatus[]=[]):string {
  let status=device.online?statuses.find(status=>status.did===device.did)?.text.trim():'离线';
  // A pre-update cached caption may still contain the old relay-mode summary.
  // Suppress only that obsolete switch caption until actual on/off reads arrive.
  if((device.specType?.split(':')[3]==='switch'||/\.switch\./.test(device.model))&&/^(?:无线开关|灵动开关)/.test(status??''))status=undefined;
  if((device.specType?.split(':')[3]==='switch'||/\.switch\./.test(device.model))&&/^[开关]{2,}$/.test(status??''))status=[...status!].join(' ');
  return [room,status].filter(Boolean).join(' | ');
}

/** Online is connectivity, never power. Unknown readings remain unselected. */
export function cardIntent(card:HomeCardEntry):HomeCardIntent {
  return card.kind==='power'?(card.selected?'off':'on'):card.action;
}
export function cardReportedIntent(card:HomeCardEntry):Json {
  return card.kind==='power'&&card.selected!==null?(card.selected?'on':'off'):null;
}
export function cardDisplay(card:HomeCardEntry,device:Device,value:Json|undefined,pending=false):HomeCardEntry {
  const selected=card.kind==='power'?(value==='on'?true:value==='off'?false:null):card.selected;
  const visible=card.visible&&device.online&&!device.sharedReadOnly&&!readOnlyCategory(device.specType),enabled=card.enabled&&visible;
  return {...card,selected,visible,enabled,highlight:visible&&enabled&&card.kind==='power'&&selected===true,
    action:card.kind==='curtain'&&pending&&['open','close'].includes(String(value))?'pause':card.action};
}
export function cardActive(card:HomeCardEntry|undefined,device:Device):boolean {
  return !!card&&device.online&&card.highlight;
}
