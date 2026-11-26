import {button,element} from './dom';
import {cameraDate} from '../camera-time';
import './camera-week.css';
const dateKey=(date:Date)=>date.toISOString().slice(0,10);
/** One seven-day control shared by doorbells, SD playback and cloud events. */
export function renderCameraWeek(host:HTMLElement,selected:string,choose:(date:string)=>void,options:{oldest?:string;available?:ReadonlySet<string>;now?:number}={}):void{
 const today=cameraDate((options.now??Date.now())/1000),anchor=new Date(today+'T00:00:00Z'),weekStart=new Date(anchor);weekStart.setUTCDate(weekStart.getUTCDate()-6);
 if(selected<dateKey(weekStart))anchor.setTime(new Date(selected+'T00:00:00Z').getTime());
 host.classList.add('camera-week-days');host.replaceChildren();
 for(let n=-6;n<=0;n++){const day=new Date(anchor);day.setUTCDate(day.getUTCDate()+n);const key=dateKey(day),b=button('','camera-week-day',()=>choose(key));
  b.append(element('span','','周'+'日一二三四五六'[day.getUTCDay()]),element('strong','',String(day.getUTCDate())));b.setAttribute('aria-label',key);b.setAttribute('aria-pressed',String(key===selected));b.disabled=key>today||!!options.oldest&&key<options.oldest||!!options.available&&!options.available.has(key);host.append(b);
 }
}
