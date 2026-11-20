import {button,element} from './dom';
import './camera-week.css';
const dateKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
/** One seven-day control shared by doorbells, SD playback and cloud events. */
export function renderCameraWeek(host:HTMLElement,selected:string,choose:(date:string)=>void,options:{oldest?:string;available?:ReadonlySet<string>;now?:number}={}):void{
 const today=dateKey(new Date(options.now??Date.now())),anchor=new Date(today+'T12:00:00Z'),weekStart=new Date(anchor);weekStart.setUTCDate(weekStart.getUTCDate()-6);
 if(selected<dateKey(weekStart))anchor.setTime(new Date(selected+'T12:00:00Z').getTime());
 host.classList.add('camera-week-days');host.replaceChildren();
 for(let n=-6;n<=0;n++){const day=new Date(anchor);day.setUTCDate(day.getUTCDate()+n);const key=dateKey(day),b=button('','camera-week-day',()=>choose(key));
  b.append(element('span','','周'+'日一二三四五六'[day.getUTCDay()]),element('strong','',String(day.getUTCDate())));b.setAttribute('aria-label',key);b.setAttribute('aria-pressed',String(key===selected));b.disabled=key>today||!!options.oldest&&key<options.oldest||!!options.available&&!options.available.has(key);host.append(b);
 }
}
