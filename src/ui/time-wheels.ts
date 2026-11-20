import {element} from './dom';
import {purifierWheel} from './purifier-wheel';

/** Both DND pages edit the same 24-hour local draft, with their own appearance. */
export function timeWheels(draft:{hour:number;minute:number},theme:'purifier'|'dispenser'):HTMLElement {
 const wheels=element('div',`${theme}-dnd-wheels`);
 for(const [key,count,label]of [['hour',24,'时'],['minute',60,'分']]as const){
  const wheel=purifierWheel(label,Array.from({length:count},(_,i)=>i),draft[key],value=>{draft[key]=value;},value=>String(value).padStart(2,'0'));
  wheels.append(element('div',theme==='purifier'?'purifier-wheel-column':'dispenser-wheel',wheel.node,element('span',`${theme}-wheel-unit`,label)));
 }
 return wheels;
}
