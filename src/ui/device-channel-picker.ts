import {button,element} from './dom';

interface ChannelChoice {
 id:number;
 label:string;
 selected:boolean;
 status?:string;
 select:()=>void;
}

export function deviceChannelPicker(kind:'airer'|'washer',choices:readonly ChannelChoice[]):HTMLElement {
 const washer=kind==='washer';
 const group=element('div',`device-channel-picker ${washer?'washer-drums':'airer-rail-picker'}`);
 group.setAttribute('role','group');
 group.setAttribute('aria-label',washer?'选择洗衣筒':'晾杆选择');
 for(const choice of choices){
  const option=button(choice.label,`device-channel-choice ${washer?'washer-drum':'airer-rail-choice'}`,choice.select);
  option.dataset.focusKey=`${washer?'washer-drum':'airer-rail'}-${choice.id}`;
  option.setAttribute('aria-pressed',String(choice.selected));
  if(washer)option.dataset.drum=String(choice.id);
  if(choice.status)option.setAttribute('aria-description',choice.status);
  group.append(option);
 }
 return group;
}
