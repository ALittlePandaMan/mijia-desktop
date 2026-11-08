import type {RouterAdvancedReport,RouterRadioValues,RouterWifiValues} from './types';
import {wifiProblem} from './router-wifi';
export type RadioField='encryption'|'power'|'channel'|'bandwidth';
export const encryptionLabels:Record<string,string>={ccmp:'超强加密(WPA3)','psk2+ccmp':'强混合加密(WPA3/WPA2)',psk2:'强加密(WPA2)','mixed-psk':'混合加密(WPA/WPA2)',none:'无加密 (允许所有人连接)',owe:'无加密 (允许所有人连接)'};
export const powerLabels:Record<string,string>={max:'穿墙',mid:'标准',min:'节能'};
const keys=['on','encryption','power','hidden','channel','bandwidth']as const;
export function radioValues(r:RouterAdvancedReport):RouterRadioValues[]|undefined{if(r.bands.length!==2||r.bands.some(b=>b.channel===null||b.bandwidth===null))return;return r.bands.map(b=>({on:b.on,encryption:b.encryption==='owe'?'none':b.encryption,power:b.power,hidden:b.hidden,channel:b.channel!,bandwidth:b.bandwidth!}));}
export function radioMatches(r:RouterAdvancedReport,bands:RouterRadioValues[]):boolean{const actual=radioValues(r);return !!actual&&actual.length===bands.length&&actual.every((b,i)=>keys.every(k=>b[k]===bands[i][k]));}
export function mergeRadioDraft(old:RouterAdvancedReport,r:RouterAdvancedReport,draft:RouterRadioValues[]):{bands:RouterRadioValues[];conflict:boolean}{const base=radioValues(old),next=radioValues(r);if(!base||!next)return{bands:structuredClone(draft),conflict:true};let conflict=false;for(const[i,b]of draft.entries())for(const k of keys){if(b[k]!==base[i][k]){if(next[i][k]!==base[i][k]&&next[i][k]!==b[k])conflict=true;Object.assign(next[i],{[k]:b[k]});}}return{bands:next,conflict};}
export function channelLabel(r:RouterAdvancedReport,index:number,value:number):string{if(index===0&&r.switches.find(s=>s.field==='channelAdj')?.value)return'自动';const b=r.bands[index];return value===0?`自动${b.activeChannel?`(${b.activeChannel})`:''}`:String(value)+(index===0&&r.radio.remind2g&&[12,13].includes(value)?'（不建议）':'');}
export function widthLabel(r:RouterAdvancedReport,index:number,value:number):string{if(index===0&&r.switches.find(s=>s.field==='channelAdj')?.value)return'20';const widths=r.bands[index].widths;return value===0?widths.join('/')||'自动':String(value);}
export function radioOptions(r:RouterAdvancedReport,index:number,field:RadioField):{value:string|number;label:string}[]{if(field==='encryption')return r.radio.encryptions.map(value=>({value,label:encryptionLabels[value]??value}));if(field==='power')return['max','mid','min'].map(value=>({value,label:powerLabels[value]}));if(field==='channel')return r.bands[index].channels.map(c=>({value:c.value,label:channelLabel(r,index,c.value)}));const widths=[...r.bands[index].widths];if(index>0&&[160,320].includes(widths.at(-1)??0))widths.pop();return[0,...widths].map(value=>({value,label:widthLabel(r,index,value)}));}
export function linkedRadioEdit(r:RouterAdvancedReport,bands:RouterRadioValues[],index:number,field:keyof RouterRadioValues,value:string|number|boolean,merged:boolean):{bands:RouterRadioValues[];adjusted:boolean;synchronized:boolean}{
 const next=structuredClone(bands),b=next[index];Object.assign(b,{[field]:value});const synchronized=merged&&['on','hidden','encryption'].includes(field);if(synchronized)for(const other of next)Object.assign(other,{[field]:value});let adjusted=false;
 if(field==='channel'||field==='bandwidth'){
  const option=r.bands[index].channels.find(c=>c.value===b.channel),available=[...(option?.widths??[])];if(b.channel!==165)available.unshift(0);
  const narrow=index===1&&b.bandwidth===0&&r.bands[index].widths.includes(160)&&available.filter(v=>v>20).length<3;
  if(field==='channel'&&b.channel!==0&&(!available.includes(b.bandwidth)||narrow)){b.bandwidth=available.at(-1)??0;adjusted=true;}
  else if(field==='bandwidth'&&b.bandwidth!==0&&!available.includes(b.bandwidth)){b.channel=0;adjusted=true;}
  else if(field==='bandwidth'&&narrow&&available.includes(b.bandwidth)){b.channel=0;adjusted=true;}
 }
 return{bands:next,adjusted,synchronized};
}
export function radioProblem(r:RouterAdvancedReport,bands:RouterRadioValues[],wifi:RouterWifiValues):string|undefined{
 if(r.radio.writeReason)return r.radio.writeReason;const base=radioValues(r);if(!base||bands.length!==2)return'频段配置尚未读取。';
 for(const[i,b]of bands.entries()){
  if(!r.radio.encryptions.includes(b.encryption)||!powerLabels[b.power])return'加密或信号选项无效。';
  if(!r.radio.canSwitch&&b.on!==base[i].on)return'Mesh模式下暂不支持此功能。';
  if(!b.on&&base[i].on&&r.radio.connection?.protectedBands.includes(i))return'当前电脑连接的Wi-Fi无法关闭，否则应用将与路由器失去联系。';
  if(!b.on&&base[i].on&&r.radio.relayBand!==null&&(wifi.merged||r.radio.relayBand===i))return'关闭此Wi-Fi会中断无线中继连接。';
  if(b.channel!==base[i].channel||b.bandwidth!==base[i].bandwidth){if(!r.radio.channelVisible||i===0&&r.switches.find(s=>s.field==='channelAdj')?.value)return'当前模式不允许修改此频段的信道和带宽。';const c=r.bands[i].channels.find(c=>c.value===b.channel);if(!c||b.bandwidth!==0&&!c.widths.includes(b.bandwidth))return'当前信道不支持所选带宽。';}
 }
 if(wifi.merged){for(const k of ['on','hidden','encryption']as const)if(bands.some((b,i)=>b[k]!==base[i][k])&&bands.some(b=>b[k]!==bands[0][k]))return'多频合一时开启、加密和隐藏设置必须同步。';}
 const report={...r.wifi,enabled:[true,true],encrypted:bands.map(b=>b.encryption!=='none'),values:structuredClone(r.wifi.values)};bands.forEach((b,i)=>{if(b.encryption==='none')report.values.bands[i].password=wifi.bands[i].password;});return wifiProblem(report,wifi);
}
