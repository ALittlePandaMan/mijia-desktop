import {deviceWait} from './device-loading';
import {describeOperation} from './operation-feedback';
import {icon} from '../icons';
import {sceneKinds,sceneNames,type RouterSceneState,type SceneRow} from '../router-scene';
import {button,element} from './dom';
function resultRow(row:SceneRow,open?:()=>void):HTMLElement {
 const box=element('div','scene-result-row'),head=element('div','scene-result-head',element('strong','',row.name),element('span','',row.time??''));box.append(head);
 const values=element('div','scene-metrics');for(const m of row.metrics)values.append(element('div','',element('span','',m.label),element('strong','',m.value)));box.append(values);
 if(!row.metrics.length)box.append(element('p','scene-note','此项暂无可显示的结果。'));
 if(open&&row.id)box.append(button('查看详情','scene-detail-link',open));return box;
}
export function routerScenePage(s:RouterSceneState):HTMLElement {
 const box=element('div','router-scene'),r=s.report,nav=element('nav','scene-tabs');nav.setAttribute('aria-label','测速页面');
 for(const[tab,label]of [['manual','手动测速'],['history','测速记录']]as const){const b=button(label,s.tab===tab?'selected':'',()=>s.show(tab));b.setAttribute('aria-pressed',String(s.tab===tab));nav.append(b);}box.append(nav);
 if(s.tab==='manual'){
  box.append(element('h2','','检测项目'));
  if(s.loading&&!r)box.append(deviceWait(undefined,'测速状态'));
  if(r){
   box.append(element('p','scene-note','检测投入预估'),element('div','scene-estimate',element('span','','预计投入时长'),element('span','',`${r.durationMinutes.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}分钟`)),element('p','scene-note','检测项设置'));
   const list=element('section','scene-projects');for(const kind of sceneKinds){const label=element('label','scene-project'),check=element('input');check.type='checkbox';check.checked=s.selected.includes(kind);check.disabled=s.blocked||s.stage==='configured';check.addEventListener('change',()=>s.toggle(kind));label.append(element('span','scene-project-check',check,icon('check')),element('span','',sceneNames[kind]));list.append(label);}box.append(list);
   describeOperation(box,s.message);
   if(s.active&&r.percent!==null){const progress=element('progress');progress.max=100;progress.value=r.percent;progress.setAttribute('aria-label','测速进度');box.append(progress,element('p','scene-duration',`${Math.round(r.percent)}%`));}
   if(s.active){const stop=button(s.stage==='configuring'?'取消准备':'停止测速','router-tool-action scene-stop',()=>s.request('stop'));stop.disabled=s.pending||s.stage==='stopping'||!!r.reason;box.append(stop);}else{const start=button(s.stage==='configured'?'确认项目并开始':'开始测速','router-tool-action',()=>s.request('start'));start.disabled=s.blocked||!s.selected.length;box.append(start);if(s.stage==='configured')box.append(button('取消准备','router-tool-action scene-stop',()=>s.request('stop')));}
   if(!r.startEnabled&&!s.active)box.append(element('p','scene-note','路由器当前尚未允许开始新的测速，请稍后重新进入查看。'));
   box.setAttribute('aria-busy',String(s.pending));
   if(r.reason)box.append(element('p','router-warning',r.reason));
   if(r.rows.length){box.append(element('h3','',r.receipt?.stage==='complete'?'本次测速结果':s.active?'已读取的测速数据':'最近一次测速结果'));for(const row of r.rows)box.append(resultRow(row));}
  }
  if(s.error&&!r){const error=element('p','router-warning',s.error.message);error.setAttribute('role','alert');box.append(error);}
 }else{
  const filters=element('div','scene-filters'),kind=element('select'),days=element('select');kind.setAttribute('aria-label','测速类型');days.setAttribute('aria-label','时间范围');
  for(const k of sceneKinds){const option=element('option','',sceneNames[k]);option.value=k;option.selected=s.kind===k;kind.append(option);}for(const d of [1,3,7]){const option=element('option','',`最近 ${d} 天`);option.value=String(d);option.selected=s.days===d;days.append(option);}
  kind.addEventListener('change',()=>s.selectHistory(kind.value as typeof s.kind,s.days));days.addEventListener('change',()=>s.selectHistory(s.kind,Number(days.value)));filters.append(kind,days);box.append(filters);
  if(s.historyLoading)box.append(deviceWait(undefined,'测速记录'));
  else if(s.historyError){const error=element('p','router-warning',s.historyError.message);error.setAttribute('role','alert');box.append(error);}
  else if(s.history){if(!s.history.rows.length)box.append(element('p','router-empty','此时间范围暂无测速记录'));for(const row of s.history.rows)box.append(resultRow(row,()=>{void s.openDetail(row);}));if(s.history.totalPages>1){const pager=element('div','scene-pager'),prev=button('上一页','',()=>s.selectHistory(s.kind,s.days,s.page-1)),next=button('下一页','',()=>s.selectHistory(s.kind,s.days,s.page+1));prev.disabled=s.page<=1;next.disabled=s.page>=Math.min(100,s.history.totalPages);pager.append(prev,element('span','',`${s.page} / ${s.history.totalPages}`),next);box.append(pager);}}
 }
 if(s.modal){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm scene-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',s.modal==='start'?'开始测速':s.modal==='stop'?'停止测速':'测速详情');
  if(s.modal==='detail'){dialog.append(element('h3','','测速详情'));if(s.detailLoading)dialog.append(deviceWait(undefined,'测速详情'));else if(s.detailError)dialog.append(element('p','router-warning',s.detailError.message));else if(s.detail)dialog.append(resultRow(s.detail));dialog.append(element('footer','',button('关闭','',()=>s.dismiss())));}
  else{dialog.append(element('h3','',s.modal==='start'?'开始测速':'停止测速'),element('p','',s.modal==='start'?'测速会占用网络带宽并消耗流量，可能影响正在使用的网络。测试流量与网络质量数据由中国信通院的测速服务处理。是否继续？':'现在停止将无法获得完整评估，已完成的测试数据会保留。是否继续？'),element('footer','',button('取消','',()=>s.dismiss()),button('确定','',()=>{void s.confirm();})));}
  overlay.append(dialog);box.append(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay)s.dismiss();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();s.dismiss();}else if(e.key==='Tab'){const items=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],i=items.indexOf(document.activeElement as HTMLButtonElement);if(items.length&&(e.shiftKey&&i<=0||!e.shiftKey&&i===items.length-1)){e.preventDefault();items[e.shiftKey?items.length-1:0].focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.querySelector<HTMLButtonElement>('button')?.focus();});
 }return box;
}
