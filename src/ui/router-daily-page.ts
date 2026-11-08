import {dismissOnBackdrop} from './dialog-dismiss';
import {deviceWait} from './device-loading';
import {icon,officialIcon} from '../icons';
import type {RouterDailyState} from '../router-daily';import {button,element} from './dom';
export function dailyRouterTool(s:RouterDailyState,kind:'optimize'|'speed'):HTMLElement {
 const box=element('div','router-daily-tool'),r=s.report;
 if(s.loading&&!r)box.append(deviceWait(undefined,'功能状态'));
 if(kind==='speed'){
  box.append(element('div','router-tool-orb original-tool-art',officialIcon('router:speed')),element('h2','','场景测速'),element('p','router-tool-description',r?.sceneInstalled?'原版场景测速插件已安装。此功能依赖米家手机插件的授权和网络检测环境，当前桌面端尚不能独立执行。请在手机米家中使用。':'当前路由器尚未提供可在桌面独立运行的场景测速。请在手机米家中使用。'));
 }else{
  box.append(element('div',`router-tool-orb${r?.recommended?' suggested':''}`,icon(s.scanning?'refresh':!r?.ready?'info':r.recommended?'warning':'check')),element('h2','',r?.ready?r.recommended?'建议优化':'Wi-Fi 环境良好':'Wi-Fi 环境检测'));
  if(r?.ready){const rows=element('section','router-tool-results');for(const[label,recommended]of [['2.4GHz 信道',r.channels[0]],['5GHz 信道',r.channels[1]],...(r.kind==='network'?[['雷达干扰',r.radar],['设备连接',r.clients>0]] as [string,boolean][]:[])]as [string,boolean][]){rows.append(element('div','',element('span','',label),element('span',recommended?'suggested':'',recommended?'建议优化':'良好')));}box.append(rows);}
  box.append(element('p','router-tool-description',r?.kind==='channel'?'显示路由器最近一次检测结果；开始检测可更新信道环境。': '检测无线环境与设备连接情况。'));
  const scan=button('开始检测','router-tool-action',()=>{void s.scan();});scan.disabled=s.loading||s.scanning||s.pending||s.applied||!r?.supported;box.append(scan);
  if(r?.ready&&r.recommended){const apply=button('优化信道','router-tool-action',()=>s.request());apply.disabled=!!r.reason||s.pending||s.applied||s.scanning;box.append(apply);}
 }
 if(s.error&&!r){const note=element('p','router-warning',!r?s.error?.message:undefined);note.setAttribute('role','status');box.append(note);}
 if(s.confirmation){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Wi-Fi优化提示');dialog.append(element('h3','','提示'),element('p','','优化可能造成 Wi-Fi 设备短暂断开连接。是否继续？'),element('footer','',button('取消','',()=>s.dismiss()),button('确定','',()=>{void s.optimize();})));dismissOnBackdrop(overlay,()=>{if(!s.pending)s.dismiss();});overlay.append(dialog);box.append(overlay);}
 return box;
}
