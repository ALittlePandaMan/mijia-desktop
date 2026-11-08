import {button,element} from './dom';
import {icon} from '../icons';
import {scalePicture,type ScalePicture} from './scale-assets';
import type {AccountProfile,Device} from '../types';
import {oldestScaleTime,type ScaleState,type ScaleMember,type ScaleRecord,type ScaleMetric,type ScaleChange,type ScaleView} from '../scale';
import './scale-page.css';
type Props={device:Device;state:ScaleState;back:()=>void;profile?:AccountProfile};
const fmt=(n:number|null|undefined,digits=1)=>n==null||!Number.isFinite(n)?'--':n.toLocaleString('zh-CN',{maximumFractionDigits:digits});
const date=(n:number,clock=false)=>new Date(n).toLocaleString('zh-CN',clock?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}:{year:'numeric',month:'2-digit',day:'2-digit'});
const iso=(n:number)=>{const d=new Date(n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const metricNames:Record<ScaleMetric,string>={weight:'体重',bodyFat:'体脂率',muscle:'肌肉量',bmi:'BMI'};
const metricUnit=(key:ScaleMetric)=>key==='bodyFat'?'%':key==='bmi'?'':'kg';
const ref=(r:ScaleRecord)=>({key:r.key,timeMs:r.timeMs});
let chartSerial=0;
/** One retained screen per navigation; readings never recreate focused controls. */
export class ScalePage{
 private props?:Props;private stage?:HTMLElement;private page?:HTMLElement;private body?:HTMLElement;private header?:HTMLElement;private title?:HTMLElement;private subtitle?:HTMLElement;private right?:HTMLButtonElement;private back?:HTMLButtonElement;private message?:HTMLElement;
 private viewKey='';private did='';private account='';private viewUpdate?:()=>void;private modals:HTMLElement[]=[];private selected=new Set<string>();private selecting=false;private reportBack:ScaleView='home';
 private get state():ScaleState{return this.props!.state;}
 dispose():void{this.clearModals();this.stage=undefined;this.page=undefined;this.props=undefined;this.viewUpdate=undefined;this.viewKey='';this.did='';this.account='';this.selected.clear();this.selecting=false;}
 update(p:Props):HTMLElement{
  if(this.did!==p.device.did){this.dispose();this.did=p.device.did;}this.props=p;
  if(!this.stage){this.stage=element('div','device-stage');this.page=element('section','device-page page-scale');this.page.dataset.presentationTemplate='scale-original';this.stage.append(this.page);
   this.back=button('','page-icon-button',()=>this.goBack(),'back');this.back.setAttribute('aria-label','返回');
   this.title=element('h2');this.subtitle=element('p','scale-header-subtitle');const center=element('div','device-page-title',this.title,this.subtitle);
   this.right=button('','page-icon-button scale-header-more',()=>this.headerAction(),'more');this.right.setAttribute('aria-label','更多操作');this.header=element('header','device-page-header',this.back,center,this.right);
   this.body=element('div','device-page-scroll scale-content');this.message=element('p','scale-message');this.message.setAttribute('role','status');this.page.append(this.header,this.body,this.message);
  }
  const s=p.state,key=s.view+(s.view==='report'?':'+s.selected?.key:'');
  if(this.account!==String(s.accountId)){this.account=String(s.accountId);this.selected.clear();this.clearModals();}
  if(this.viewKey!==key){this.clearModals();this.selected.clear();this.selecting=false;this.viewKey=key;this.body!.replaceChildren();this.body!.scrollTop=0;this.page!.dataset.scaleView=s.view;this.buildView();}
  const member=this.currentMember();this.title!.textContent=s.view==='home'?p.device.name:s.view==='history'||s.view==='records'?`${this.memberName(member)} ▾`:s.view==='members'?'成员管理':s.view==='report'?'身体成分报告':'';
  this.title!.classList.toggle('scale-member-heading',s.view==='history'||s.view==='records');this.title!.onclick=s.view==='history'||s.view==='records'?()=>this.memberDialog():null;this.title!.tabIndex=s.view==='history'||s.view==='records'?0:-1;this.title!.onkeydown=e=>{if((s.view==='history'||s.view==='records')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();this.memberDialog();}};
  this.subtitle!.textContent=s.view==='home'?(s.loading?'正在同步云端数据':s.error?'云端同步未完成':p.device.online?'云端已同步数据':'设备离线 · 可查看已同步记录'):'';
  this.right!.hidden=!['home','records','members'].includes(s.view);this.right!.disabled=s.writing||s.loading||s.view!=='home'&&!s.report?.canWrite;this.right!.setAttribute('aria-label',s.view==='members'?'添加成员':s.view==='records'?'选择记录':'更多操作');
  this.message!.textContent=s.message;this.message!.hidden=!s.message;this.page!.setAttribute('aria-busy',String(s.loading||s.pageLoading!==undefined||s.writing));this.viewUpdate?.();return this.stage!;
 }
 private currentMember():ScaleMember|undefined{return this.state.members.find(m=>m.accountId===this.state.accountId);}
 private memberName(m?:ScaleMember):string{return m?.master?this.props?.profile?.displayName||m.name:m?.name||'选择使用者';}
 private avatar(m?:ScaleMember):HTMLElement{
  const source=m?.master?this.props?.profile?.avatarUrl||m.icon:m?.icon;
  if(source?.startsWith('https://')){const holder=scalePicture('avatar1','scale-avatar'),image=element('img');image.src=source;image.alt='';image.decoding='async';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>image.remove(),{once:true});holder.append(image);return holder;}
  const n=Number(source);return scalePicture(('avatar'+(n>=1&&n<=6?n:1)) as ScalePicture,'scale-avatar');
 }
 private navigate(view:ScaleView,record?:ScaleRecord):void{if(view==='report')this.reportBack=this.state.view;this.state.navigate(view,record);}
 private goBack():void{const s=this.state;if(this.modals.length){this.closeModal();return;}if(s.view==='home'){this.props!.back();return;}this.navigate(s.view==='report'?this.reportBack:s.view==='records'?'history':'home');}
 private headerAction():void{if(this.state.view==='members'){this.memberEditor();return;}if(this.state.view==='records'){this.selecting=!this.selecting;this.selected.clear();this.viewUpdate?.();return;}const list=element('div','scale-menu-list');list.append(button('刷新数据','scale-menu-row',()=>{this.closeModal();void this.state.refresh();},'refresh'),button('成员管理','scale-menu-row',()=>{this.closeModal();this.navigate('members');},'room'));this.modal('更多操作',list);}
 private buildView():void{switch(this.state.view){case'home':this.home();break;case'history':this.history();break;case'records':this.records(false);break;case'unclaimed':this.records(true);break;case'members':this.members();break;case'report':this.report();break;}}
 private home():void{
  const user=button('','scale-user-switch',()=>this.memberDialog()),userAvatar=element('span'),name=element('strong'),hint=element('small','','点击更换使用者');user.append(userAvatar,element('span','scale-user-copy',name,hint));
  const whole=element('span','scale-weight-whole','--'),fraction=element('span','scale-weight-fraction'),weight=element('div','scale-weight',whole,fraction,element('span','scale-weight-unit','kg')),measured=element('p','scale-measured'),comparison=element('p','scale-comparison');
  const hero=element('section','scale-hero',weight,measured,comparison),trend=element('div','scale-home-trend');trend.setAttribute('aria-label','最近体重趋势');
  const syncText=element('span','','新称重请在手机米家同步'),refresh=button('刷新','scale-sync-refresh',()=>{void this.state.refresh();});const sync=element('section','scale-sync-card',element('span','scale-sync-icon',icon('link')),syncText,refresh);
  const values:HTMLElement[]=[];const stats=element('div','scale-summary-metrics');for(const[label,unit]of [['BMI',''],['体脂率','%'],['肌肉量','kg']]){const value=element('strong'),item=element('div','scale-summary-metric',element('div','',value,element('small','',unit)),element('span','',label));values.push(value);stats.append(item);}
  const report=button('查看报告','scale-report-button',()=>{const r=this.state.report?.records[this.state.homeIndex];if(r)this.navigate('report',r);});
  const summary=element('section','scale-summary-card',stats,report),entries=element('div','scale-entry-grid');for(const[k,label,view]of [['history','历史数据','history'],['pending','待领数据','unclaimed']]as const){const b=button('','scale-entry',()=>this.navigate(view));b.append(scalePicture(k),element('span','',label));entries.append(b);}
  const note=element('p','scale-read-note');this.body!.append(user,hero,trend,sync,summary,entries,note);
  let avatarKey='',chartRecords:ScaleRecord[]|undefined;let selectPoint:(index:number)=>void=()=>{};
  this.viewUpdate=()=>{const s=this.state,m=this.currentMember(),r=s.report?.records[s.homeIndex],a=JSON.stringify([m,this.props?.profile]);if(a!==avatarKey){avatarKey=a;userAvatar.replaceChildren(this.avatar(m));}name.textContent=this.memberName(m);user.disabled=s.writing||!s.members.length;hint.textContent=m?.master?'主用户 · 点击更换使用者':'点击更换使用者';
   if(r){const parts=r.weight.toFixed(1).split('.');whole.textContent=parts[0];fraction.textContent='.'+parts[1];}else{whole.textContent='--';fraction.textContent='';}
   measured.textContent=r?date(r.timeMs,true):s.loading?'正在读取测量记录':'暂无测量记录';const previous=s.report?.records[s.homeIndex+1];let diff='';if(r&&previous){const delta=r.weight-previous.weight;diff=`比 ${date(previous.timeMs)} ${delta===0?'持平':(delta>0?'上升':'下降')+fmt(Math.abs(delta))+'kg'}`;}const bmi=r?.bmi;comparison.textContent=[bmi==null?'':bmi<18.5?'偏低':bmi<24?'标准':bmi<28?'偏高':'过高',diff].filter(Boolean).join('  |  ');
   [r?.bmi,r?.bodyFat,r?.muscle].forEach((v,i)=>values[i].textContent=fmt(v));report.disabled=!r;refresh.disabled=s.loading||s.writing;refresh.textContent=s.loading?'同步中':'刷新';syncText.textContent=s.error?'云端同步失败，请重试':'新称重请在手机米家同步';sync.classList.toggle('scale-sync-error',!!s.error);
   note.textContent=s.error?s.error.message:s.report?.omittedRecords?`${s.report.omittedRecords} 条记录的格式或归属无法确认，未显示。`:!s.members.length?'请添加使用者，或在手机米家中完成成员设置。':'';note.hidden=!note.textContent;
   const rows=s.report?.records;if(rows!==chartRecords){chartRecords=rows;selectPoint=this.chart(trend,rows??[],'weight',index=>s.chooseHome(index),true);}selectPoint(s.homeIndex);
  };
 }
 private history():void{
  const tabs=element('div','scale-range-tabs'),buttons:HTMLButtonElement[]=[];for(const[days,label]of [[7,'近7天'],[30,'近30天'],[90,'近90天'],[180,'近半年'],[0,'自定义']]as const){const b=button(label,'',()=>{if(days)void this.state.preset(days);else this.rangeDialog();});buttons.push(b);tabs.append(b);}
  const dates=button('','scale-range-date',()=>this.rangeDialog()),label=element('span'),value=element('strong'),unit=element('small'),metric=button('','scale-history-metric',()=>this.metricDialog());metric.append(element('span','',label,element('span','scale-history-number',value,unit)),icon('chevron'));
  const chart=element('div','scale-history-chart'),loading=element('p','scale-page-status'),more=button('加载更多','scale-text-button',()=>{void this.state.loadHistory(true);}),all=button('全部记录','scale-primary',()=>this.navigate('records'));
  this.body!.append(tabs,dates,metric,chart,loading,more,element('footer','scale-page-footer',all));let chartKey='';
  this.viewUpdate=()=>{const s=this.state;buttons.forEach((b,i)=>{const selected=[7,30,90,180,0][i]===s.rangeDays;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('selected',selected);});dates.textContent=`${date(s.range.start)} - ${date(s.range.end)} ▾`;label.textContent=metricNames[s.metric];value.textContent=fmt(s.history?.records[0]?.[s.metric]);unit.textContent=metricUnit(s.metric);
   const key=JSON.stringify([s.metric,s.history?.records.map(r=>r.key)]);if(key!==chartKey){chartKey=key;this.chart(chart,s.history?.records??[],s.metric,r=>this.navigate('report',s.history!.records[r]));}
   loading.textContent=s.pageLoading==='history'?'正在读取记录…':s.pageError?s.pageError.message:s.history?.omittedRecords?`有 ${s.history.omittedRecords} 条记录无法确认归属。`:s.history?.nextBefore?`已加载 ${s.history.records.length} 条，继续加载可补全此区间。`:'';loading.classList.toggle('scale-error',!!s.pageError);
   more.hidden=!s.history?.nextBefore;more.disabled=!!s.pageLoading||(s.history?.records.length??0)>=200;more.textContent=s.history?.records.length===200?'已达200条，请缩小日期范围':'加载更早记录';all.disabled=!s.accountId;
  };
 }
 private records(pending:boolean):void{
  const heading=element('div','scale-pending-heading',element('h3','',pending?'待认领数据':'全部记录'));if(pending){const info=button('','page-icon-button',()=>this.info('待认领数据','未识别到唯一用户的体重记录。请核对体重和时间，勾选后将数据认领至所选使用者。'),'info');info.setAttribute('aria-label','待认领数据说明');heading.append(info);}
  const tips=element('p','scale-record-tips',pending?'未识别到唯一用户的体重数据，请在下方勾选认领':''),target=button('','scale-range-date',()=>this.memberDialog()),list=element('div','scale-record-list'),status=element('p','scale-page-status'),more=button('加载更早记录','scale-text-button',()=>{void(pending?this.state.loadUnclaimed(true):this.state.loadHistory(true));});
  const remove=button('删除','scale-secondary',()=>this.recordAction(pending?'deleteUnclaimed':'deleteRecords')),claim=button('认领','scale-primary',()=>this.recordAction('claim')),footer=element('footer','scale-page-footer scale-record-actions',remove,pending?claim:null);
  this.body!.append(heading,tips,target,list,status,more,footer);let last:ScaleRecord[]|undefined,lastSelecting=false;const controls=new Map<string,HTMLInputElement>();
  this.viewUpdate=()=>{const s=this.state,r=pending?s.unclaimed:s.history,selecting=pending||this.selecting;target.textContent=pending?`认领至：${this.memberName(this.currentMember())} ▾`:`${date(s.range.start)} - ${date(s.range.end)}`;target.disabled=s.writing;tips.hidden=!pending;footer.hidden=!selecting;
   const records=r?.records??[];if(records!==last||selecting!==lastSelecting){last=records;lastSelecting=selecting;controls.clear();const nodes:HTMLElement[]=[];let day='';for(const record of records){const group=pending?(Date.now()-record.timeMs<7*86400000?'近7天':'更多'):date(record.timeMs);if(group!==day){day=group;nodes.push(element('p','scale-record-group',group));}
    const copy=element('span','scale-record-copy',element('strong','',`体重 ${fmt(record.weight)} kg`),element('time','',date(record.timeMs,true)));
    if(selecting){const check=element('input','scale-record-check');check.type='checkbox';check.setAttribute('aria-label',`选择 ${date(record.timeMs,true)} ${fmt(record.weight)} kg`);check.addEventListener('change',()=>{if(check.checked&&this.selected.size>=20){check.checked=false;status.textContent='每次最多选择20条记录。';return;}if(check.checked)this.selected.add(record.key);else this.selected.delete(record.key);this.viewUpdate?.();});controls.set(record.key,check);nodes.push(element('label','scale-record-row',copy,check));}
    else{const row=button('','scale-record-row',()=>this.navigate('report',record));row.append(copy,icon('chevron'));nodes.push(row);}
   }if(!records.length)nodes.push(this.empty());list.replaceChildren(...nodes);const available=new Set(records.map(v=>v.key));for(const key of this.selected)if(!available.has(key))this.selected.delete(key);}
   for(const[key,input]of controls){input.checked=this.selected.has(key);input.disabled=s.writing||!s.report?.canWrite||!this.currentMember()?.canEdit;}
   remove.disabled=claim.disabled=!this.selected.size||s.writing||!!s.pageLoading||!this.currentMember()?.canEdit;claim.textContent=s.writing?'提交中…':this.selected.size?`认领（${this.selected.size}）`:'认领';
   status.textContent=s.pageLoading?'正在读取记录…':s.pageError?s.pageError.message:r?.omittedRecords?`${r.omittedRecords} 条记录无法确认格式或归属，未显示。`:records.length&&!r?.nextBefore?'没有更多数据了':'';status.classList.toggle('scale-error',!!s.pageError);
   more.hidden=!r?.nextBefore;more.disabled=!!s.pageLoading||s.writing||records.length>=200;more.textContent=records.length>=200?'已达200条，请缩小范围查看':'加载更早记录';
  };
 }
 private report():void{
  const record=this.state.selected;if(!record){this.body!.append(this.empty());this.viewUpdate=()=>{};return;}
  const user=element('div','scale-report-user',this.avatar(this.currentMember()),element('span','',element('strong','',this.memberName(this.currentMember())),element('small','',date(record.timeMs,true))));
  const weight=element('div','scale-report-weight',element('strong','',fmt(record.weight)),element('small','','kg')),metrics=element('section','scale-report-metrics');
  const fields:[string,string,string][]=[['bmi','BMI',''],['bfp','体脂率','%'],['slm','肌肉量','kg'],['heartRate','心率','次/分'],['bwp','水分率','%'],['bmc','骨盐量','kg'],['smm','骨骼肌量','kg'],['vfl','内脏脂肪等级',''],['pp','蛋白质率','%'],['bmr','基础代谢','kcal'],['ma','身体年龄','岁']];
  for(const[key,label,unit]of fields)metrics.append(element('div','scale-report-row',element('span','',label),element('strong','',fmt(record.metrics[key]),element('small','',unit))));
  this.body!.append(user,weight,metrics,element('p','scale-read-note','显示该次已同步测量的原始指标；未上报的指标显示 --。'));
  this.viewUpdate=()=>{};
 }
 private members():void{
  const list=element('div','scale-members-list'),add=button('添加成员','scale-primary',()=>this.memberEditor()),note=element('p','scale-read-note','成员资料保存在米家云端，新称重及蓝牙成员同步请在手机米家完成。');this.body!.append(list,element('footer','scale-page-footer',add),note);let key='';
  this.viewUpdate=()=>{const s=this.state,next=JSON.stringify([s.members,this.props?.profile]);if(key!==next){key=next;list.replaceChildren(...s.members.map(m=>{const row=button('','scale-member-row',()=>this.memberEditor(m));row.append(this.avatar(m),element('span','scale-user-copy',element('strong','',this.memberName(m)),element('small','',m.master?'主用户':m.height?`${fmt(m.height,0)} cm`:'')),icon('chevron'));row.disabled=!m.canEdit;return row;}));if(!s.members.length)list.append(element('p','scale-page-status','暂无成员，请添加使用者。'));}add.disabled=s.writing||s.loading||!s.report?.canWrite;};
 }
 private empty():HTMLElement{return element('div','scale-empty',scalePicture('empty'),element('span','','暂无内容'));}
 /** SVG viewBox scales without layout reads, chart libraries or observers. */
 private chart(host:HTMLElement,records:ScaleRecord[],metric:ScaleMetric,choose:(index:number)=>void,compact=false):(index:number)=>void{
  const points=records.map((r,index)=>({r,index,value:r[metric]})).filter((p):p is typeof p&{value:number}=>p.value!=null&&Number.isFinite(p.value)).reverse();if(!points.length){host.replaceChildren(this.empty());return()=>{};}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',compact?'0 0 360 118':'0 0 360 220');svg.setAttribute('role','group');svg.setAttribute('aria-label',metricNames[metric]+'趋势，选择数据点查看');
  const height=compact?82:174,low=Math.floor(Math.min(...points.map(p=>p.value))-1),high=Math.ceil(Math.max(...points.map(p=>p.value))+1),x=(i:number)=>8+i*326/Math.max(1,points.length-1),y=(n:number)=>8+(high-n)/(high-low)*height;
  const make=(tag:string,attrs:Record<string,string>)=>{const node=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
  for(let i=0;i<4;i++){const value=low+(high-low)*i/3,py=y(value);svg.append(make('line',{x1:'8',y1:String(py),x2:'334',y2:String(py),class:'scale-chart-grid'}));const text=make('text',{x:'356',y:String(py+3),'text-anchor':'end',class:'scale-chart-label'});text.textContent=fmt(value);svg.append(text);}
  const path=points.map((p,i)=>`${i?'L':'M'}${x(i)} ${y(p.value)}`).join(' '),id='scale-trend-'+(++chartSerial),defs=make('defs',{}),gradient=make('linearGradient',{id,x1:'0',x2:'0',y1:'0',y2:'1'});gradient.append(make('stop',{offset:'0%','stop-color':'var(--scale-accent)','stop-opacity':'.14'}),make('stop',{offset:'100%','stop-color':'var(--scale-accent)','stop-opacity':'0'}));defs.append(gradient);svg.append(defs,make('path',{d:`${path}L${x(points.length-1)} ${height+8}L8 ${height+8}Z`,fill:`url(#${id})`} ),make('path',{d:path,class:'scale-chart-line'}));
  const nodes:{node:SVGElement;index:number}[]=[];for(const[pIndex,p]of points.entries()){const g=make('g',{role:'button',tabindex:'0','aria-label':`${date(p.r.timeMs,true)} ${fmt(p.value)} ${metricUnit(metric)}`,class:'scale-chart-point'}),hit=make('circle',{cx:String(x(pIndex)),cy:String(y(p.value)),r:'12',fill:'transparent'}),dot=make('circle',{cx:String(x(pIndex)),cy:String(y(p.value)),r:'4',class:'scale-chart-dot'});g.append(hit,dot);g.addEventListener('click',()=>choose(p.index));g.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(p.index);}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();nodes[Math.max(0,Math.min(nodes.length-1,pIndex+(e.key==='ArrowLeft'?-1:1)))]?.node.focus();}});nodes.push({node:g,index:p.index});svg.append(g);
   if(pIndex===0||pIndex===points.length-1||pIndex%Math.max(1,Math.ceil(points.length/6))===0){const text=make('text',{x:String(x(pIndex)),y:String(height+27),'text-anchor':pIndex===0?'start':pIndex===points.length-1?'end':'middle',class:'scale-chart-label'});text.textContent=date(p.r.timeMs).replace(/^\d{4}\//,'');svg.append(text);}
  }host.replaceChildren(svg);return index=>{for(const p of nodes)p.node.setAttribute('aria-pressed',String(p.index===index));};
 }
 private memberDialog():void{
  const list=element('div','scale-member-options');for(const m of this.state.members){const row=button('','scale-member-option',()=>{this.closeModal();void this.state.select(m.accountId);});row.classList.toggle('selected',m.accountId===this.state.accountId);row.append(this.avatar(m),element('span','scale-user-copy',element('strong','',this.memberName(m)),m.master?element('small','','主用户'):null));if(m.accountId===this.state.accountId)row.append(icon('check')!);list.append(row);}
  const manage=button('','scale-member-option',()=>{this.closeModal();this.navigate('members');});manage.append(scalePicture('members','scale-avatar'),element('strong','','成员管理'));list.append(manage);this.modal('选择使用者',list,'scale-member-picker');
 }
 private metricDialog():void{const list=element('div','scale-menu-list');for(const[key,label]of Object.entries(metricNames)){list.append(button(label,'scale-menu-row',()=>{this.state.metric=key as ScaleMetric;this.closeModal();this.viewUpdate?.();}));}this.modal('选择指标',list);}
 private rangeDialog():void{const start=element('input'),end=element('input');start.type=end.type='date';start.value=iso(this.state.range.start);end.value=iso(this.state.range.end);start.min=end.min=iso(oldestScaleTime);start.max=end.max=iso(Date.now());const error=element('p','scale-error'),content=element('div','scale-form',this.field('开始日期',start),this.field('结束日期',end),error),apply=button('确定','scale-primary',()=>{const lo=new Date(start.value+'T00:00:00').getTime(),hi=new Date(end.value+'T23:59:59.999').getTime();if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>hi||hi>Date.now()+86400000){error.textContent='请选择有效的起止日期。';return;}this.closeModal();void this.state.setRange(lo,hi);});content.append(apply);this.modal('选择日期范围',content);}
 private field(label:string,control:HTMLElement):HTMLElement{const row=element('label','scale-form-field',element('span','',label),control);control.setAttribute('aria-label',label);return row;}
 private memberEditor(member?:ScaleMember):void{
  if(!this.state.report?.canWrite||member&&!member.canEdit)return;const name=element('input'),sex=element('select'),birth=element('input'),height=element('input');name.maxLength=20;name.value=member?.name??'';name.required=true;name.autocomplete='off';for(const[v,t]of [['','请选择'],['1','男'],['2','女']]){const o=element('option','',t);o.value=v;sex.append(o);}sex.value=String(member?.sex??'');birth.type='date';birth.min='1900-01-01';birth.max=iso(Date.now());birth.value=member?.birth!=null?iso(member.birth):'';height.type='number';height.min='90';height.max='220';height.step='1';height.value=member?.height?String(member.height):'';
  const form=element('form','scale-form'),error=element('p','scale-error'),avatars=element('div','scale-avatar-options');let selectedAvatar=Math.max(1,Math.min(6,Number(member?.icon)||1));const avatarButtons:HTMLButtonElement[]=[];
  if(!member?.master)for(let i=1;i<=6;i++){const b=button('','scale-avatar-choice',()=>{selectedAvatar=i;for(const[x,node]of avatarButtons.entries())node.setAttribute('aria-pressed',String(x+1===i));});b.setAttribute('aria-label','头像 '+i);b.setAttribute('aria-pressed',String(i===selectedAvatar));b.append(scalePicture(('avatar'+i)as ScalePicture,'scale-avatar'));avatarButtons.push(b);avatars.append(b);}
  const save=button('保存','scale-primary',()=>form.requestSubmit()),remove=member&&!member.master?button('删除成员','scale-delete-member',()=>this.confirm('删除成员',`确认删除“${this.memberName(member)}”的云端成员资料？此操作无法撤销。`,async()=>{const ok=await this.state.mutate({kind:'removeMember',accountId:member.accountId,baseline:member.revision});if(ok)this.clearModals();})):undefined;
  form.append(avatars,this.field('姓名',name),this.field('性别',sex),this.field('生日',birth),this.field('身高（cm）',height),error,save);if(remove)form.append(remove);this.modal(member?'编辑成员':'添加成员',form);
  form.addEventListener('submit',e=>{e.preventDefault();if(this.state.writing)return;const born=new Date(birth.value+'T00:00:00').getTime(),cm=Number(height.value);if(!name.value.trim()||!sex.value||!Number.isFinite(born)||!Number.isInteger(cm)||cm<90||cm>220){error.textContent='请完整填写姓名、性别、生日及90–220 cm的身高。';return;}
   const draft={name:name.value.trim(),sex:Number(sex.value),birth:born,height:cm,icon:selectedAvatar},controls=[...form.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select')];for(const control of controls)control.disabled=true;void this.state.mutate({kind:'saveMember',accountId:member?.accountId??null,baseline:member?.revision??null,draft}).then(ok=>{if(ok&&form.isConnected)this.closeModal();else if(form.isConnected)error.textContent=this.state.message;}).finally(()=>{for(const control of controls)control.disabled=false;});
  });
 }
 private recordAction(kind:'claim'|'deleteUnclaimed'|'deleteRecords'):void{
  const s=this.state,report=kind==='deleteRecords'?s.history:s.unclaimed,records=(report?.records??[]).filter(r=>this.selected.has(r.key));if(!records.length||!s.accountId||s.writing)return;const change:ScaleChange={kind,accountId:s.accountId,records:records.map(ref)};
  this.confirm(kind==='claim'?'认领数据':'删除数据',kind==='claim'?`将选中的 ${records.length} 条记录认领至“${this.memberName(this.currentMember())}”？`:`确认删除选中的 ${records.length} 条云端记录？此操作无法撤销。`,async()=>{const ok=await s.mutate(change);if(ok)this.selected.clear();this.viewUpdate?.();});
 }
 private info(title:string,text:string):void{this.modal(title,element('p','scale-dialog-copy',text));}
 private confirm(title:string,text:string,run:()=>Promise<void>):void{const content=element('div','',element('p','scale-dialog-copy',text)),cancel=button('取消','scale-secondary',()=>this.closeModal()),confirm=button('确定','scale-primary',()=>{if(this.state.writing)return;confirm.disabled=cancel.disabled=true;void run().finally(()=>{if(confirm.isConnected)this.closeModal();});});content.append(element('div','scale-confirm-actions',cancel,confirm));this.modal(title,content);}
 private modal(title:string,content:HTMLElement,className=''):void{
  if(!this.page)return;const focused=document.activeElement instanceof HTMLElement?document.activeElement:undefined,overlay=element('div','scale-modal-backdrop'),dialog=element('section','scale-modal '+className);dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);dialog.tabIndex=-1;const close=button('','page-icon-button',()=>this.closeModal(),'close');close.setAttribute('aria-label','关闭');if(className!=='scale-member-picker')dialog.append(element('header','scale-modal-header',element('h3','',title),close));dialog.append(content);overlay.append(dialog);
  this.header!.inert=this.body!.inert=true;const previous=this.modals.at(-1);if(previous)previous.inert=true;this.modals.push(overlay);this.page.append(overlay);const closeLayer=()=>{if(this.modals.at(-1)!==overlay)return;this.modals.pop();overlay.remove();const top=this.modals.at(-1);if(top)top.inert=false;else this.header!.inert=this.body!.inert=false;if(focused?.isConnected)focused.focus({preventScroll:true});};Object.assign(overlay,{closeLayer});
  overlay.addEventListener('click',e=>{if(e.target===overlay&&!this.state.writing)closeLayer();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!this.state.writing)closeLayer();}else if(e.key==='Tab'){const list=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];if(!list.length){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===dialog||document.activeElement===list[0])){e.preventDefault();list.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0]?.focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus({preventScroll:true});});
 }
 private closeModal():void{const top=this.modals.at(-1) as(HTMLElement&{closeLayer?:()=>void})|undefined;top?.closeLayer?.();}
 private clearModals():void{for(const node of this.modals)node.remove();this.modals=[];if(this.header)this.header.inert=false;if(this.body)this.body.inert=false;}
}
