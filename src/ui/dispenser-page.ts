import {dismissOnBackdrop} from './dialog-dismiss';
import {operationFeedback,describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel} from '../types';
import {DispenserCommands,settingChoices,volumeChoices,volumeText,modeNameError,type DispenserMode,type DispenserView,type DispenserChange,type DispenserPicker} from '../dispenser';
import {element,button} from './dom';import {icon,officialIcon} from '../icons';import {deviceWait} from './device-loading';import {purifierWheel} from './purifier-wheel';
interface Props {device:Device;panel:DevicePanel;view:DispenserView;commands:DispenserCommands;cached:boolean;busy:boolean;artwork:()=>HTMLElement;back:()=>void;navigate:(v:DispenserView)=>void;changed:()=>void;change:(c:DispenserChange)=>Promise<boolean>;refresh:()=>void;compatibility:()=>void;error?:string;dndEnabled?:boolean|null}
const clone=(m:DispenserMode[])=>structuredClone(m);
const settingLabels={childLock:'童锁',screen:'自动熄屏',defaultMode:'默认出水模式'}as const;
const defaultMode=(m:DispenserMode)=>m.id>=1&&m.id<=4;
export function dispenserPage(p:Props):HTMLElement {
 p={...p,panel:p.commands.display?.(p.panel)??p.panel};
 const s=p.panel.dispenser,v=p.view,modes=s?.modes??[],mode=modes.find(m=>m.id===v.modeId),editing=v.page==='new'?v.draft:mode;
 const blocked=p.cached||p.busy||p.commands.blocked||!p.device.online||!!p.device.sharedReadOnly,configReady=!!s?.modeSource&&!s.modeError;
 const stage=element('div','device-stage'),page=element('section',`device-page page-dispenser page-dispenser-${v.page}`),header=element('header','device-page-header'),body=element('div','device-page-scroll dispenser-content');stage.append(page);page.append(header,body);
 const back=()=>{if(v.page==='sort'&&JSON.stringify(v.order)!==JSON.stringify(modes)||v.page==='cups'&&JSON.stringify(v.volumes)!==JSON.stringify(mode?.volumes)){v.discard=true;p.changed();return;}p.navigate(v.page==='cups'?{page:'mode',modeId:v.modeId}:{page:'home'});};
 const close=button('','page-icon-button',v.page==='home'?p.back:back,['sort','cups'].includes(v.page)?'close':'back');close.setAttribute('aria-label',v.page==='home'?'返回家庭':v.page==='mode'?'返回管线机':'取消编辑');header.append(close);
 const title=v.page==='home'?p.device.name:v.page==='mode'?mode?.name??'模式':v.page==='sort'?'编辑模式':v.page==='cups'?'编辑杯量':'';header.append(element('div','device-page-title',element('h2','',title)));
 const sendModes=async(next:DispenserMode[],expected=v.expected??s?.modeSource):Promise<boolean>=>{if(blocked||!configReady||!expected)return false;return p.change({operation:'modes',expected,modes:clone(next)});};
 const openPicker=(picker:DispenserPicker)=>{if(blocked)return;v.picker=picker;v.expected=s?.modeSource??undefined;p.changed();};
 const patchMode=(patch:Partial<DispenserMode>)=>{if(!editing)return;if(v.page==='new'){v.draft={...editing,...patch};p.changed();}else void sendModes(modes.map(m=>m.id===editing.id?{...m,...patch}:m));};
 const row=(title:string,value:string,onClick?:()=>void,disabled=false)=>{
  const node=button('','dispenser-setting-row',onClick??(()=>{}));node.disabled=disabled||!onClick;node.setAttribute('aria-label',title);node.append(element('span','dispenser-row-title',title),element('span','dispenser-row-value',value));if(onClick)node.append(icon('chevron'));return node;
 };
 const noWrites=()=>p.commands.pending||p.cached||!p.device.online;
 if(v.page==='home'){
  const status=!p.device.online?'已离线':s?.status===null||s?.status===undefined?'状态未读取':(['设备异常','待机中…','出水中…','缺水中…','管路高温杀菌中…','待机中…','待机中…'][s.status]??`设备状态 ${s.status}`),tone=!p.device.online||[0,3].includes(s?.status??-1)?'muted':s?.status===4?'warm':'normal';
  const background=element('div',`dispenser-backdrop dispenser-${tone}`),state=element('div','dispenser-status',status),water=element('div','dispenser-water');state.setAttribute('role','status');water.innerHTML=waveGraphic();background.append(state,water);page.insertBefore(background,body);
  body.classList.add('dispenser-home-content');
  if(s?.fault){body.append(element('div','native-card dispenser-warning',icon('warning'),element('span','',`设备异常（${s.fault}），请在设备上检查。`)));}
  else if([5,6].includes(s?.status??-1)&&v.dismissedDrain!==s?.status){const notice=element('div','native-card dispenser-warning',element('p','','请注意管路中的高温余水，按设备提示排水后再使用。'),button('知道了','',()=>{v.dismissedDrain=s?.status??undefined;p.changed();}));body.append(notice);}
  body.classList.toggle('dispenser-has-warning',!!body.querySelector('.dispenser-warning'));
  const card=element('section','native-card dispenser-mode-card'),heading=element('div','dispenser-card-heading',element('span','','设备上的模式'));
  const sort=button('','page-icon-button',()=>p.navigate({page:'sort',order:clone(modes),expected:s!.modeSource!,selected:undefined}),'edit');sort.disabled=blocked||!configReady;sort.setAttribute('aria-label','编辑设备上的模式');heading.append(sort);card.append(heading);
  for(const m of modes){const r=button('','dispenser-mode-row',()=>p.navigate({page:'mode',modeId:m.id}));r.disabled=noWrites();r.setAttribute('aria-label',m.name);r.append(modeArt(m,false),element('span','dispenser-mode-label',element('strong','',m.name),element('span','',`${m.id===1?s?.temperature??'--':m.temperature}℃ | ${volumeText(m.volumes[0])}`)),icon('chevron'));card.append(r);}
  if(!configReady)card.append(element('p','native-unavailable',s?.modeError??'请先读取设备上的模式。'));
  const add=button('','dispenser-mode-row',()=>{const id=Array.from({length:7},(_,i)=>i+5).find(id=>!modes.some(m=>m.id===id));if(id)p.navigate({page:'new',expected:s!.modeSource!,draft:{id,name:'',temperature:50,volumes:[150]}});});add.disabled=blocked||!configReady||modes.length>=8;add.append(element('span','dispenser-add-icon',icon('plus')),element('span','dispenser-mode-label','新建模式'));card.append(add);body.append(card);
  const history=row('饮水记录','',()=>p.navigate({page:'statistics'}));history.classList.add('native-card','dispenser-history');history.prepend(element('span','dispenser-history-symbol',officialIcon('dispenser:history')));body.append(history);
 }else if(v.page==='settings'){
  body.append(element('h1','dispenser-settings-title','设置'),element('p','dispenser-section-title','功能设置'));
  for(const field of ['childLock','screen','defaultMode']as const){const value=s?.[field],choices=field==='defaultMode'?[{value:0,title:'记忆上次'},...modes.map(m=>({value:m.id,title:m.name}))]:settingChoices[field].map((title,value)=>({title,value}));const label=choices.find(c=>c.value===value)?.title??(field==='defaultMode'&&value!=null?`未识别模式 ${value}`:'未读取');body.append(row(settingLabels[field],label,()=>openPicker({kind:'setting',field,expected:value!,value:value!}),blocked||value===null||value===undefined));}
  body.append(row('勿扰模式',p.dndEnabled==null?'未读取':p.dndEnabled?'已开启':'已关闭',()=>p.navigate({page:'dnd'})));
  body.append(row('管路高温杀菌','',()=>p.navigate({page:'sterilization'})));
 }else if(v.page==='mode'||v.page==='new'){
  if(!editing){body.append(element('p','native-unavailable','此模式已不存在，请重新读取。'));}
  else{
   const m=editing,isNew=v.page==='new';body.classList.add('dispenser-mode-content');
   if(isNew){body.append(element('h1','dispenser-settings-title','新建模式'));const input=element('input','dispenser-mode-name');input.type='text';input.value=m.name;input.placeholder='请输入模式名称';input.setAttribute('aria-label','模式名称');input.disabled=blocked;input.dataset.focusKey='dispenser-new-name';const error=element('p','dispenser-name-error',modeNameError(m.name,modes,m.id)??'');input.addEventListener('input',()=>{m.name=input.value;error.textContent=modeNameError(m.name,modes,m.id)??'';const save=page.querySelector<HTMLButtonElement>('.dispenser-save');if(save)save.disabled=blocked||!!error.textContent;});body.append(input,error);}
   else body.append(element('div','dispenser-mode-artwork',modeArt(m,true)));
   body.append(element('p','dispenser-section-title','模式设置'));
   if(!isNew)body.append(row('模式名称',m.name,()=>openPicker({kind:'name',value:m.name}),blocked||m.id===1));
   body.append(row('出水温度',`${m.id===1?s?.temperature??'--':m.temperature}℃`,()=>openPicker({kind:'temperature',value:m.temperature}),blocked||m.id===1),element('div','dispenser-separator'));
   const cupTitle=element('div','dispenser-cup-heading',element('p','dispenser-section-title','杯量设置'));
   if(!isNew&&!defaultMode(m)){const edit=button('','page-icon-button',()=>p.navigate({page:'cups',modeId:m.id,volumes:[...m.volumes],expected:s?.modeSource??undefined}),'edit');edit.disabled=blocked;edit.setAttribute('aria-label','编辑杯量');cupTitle.append(edit);}body.append(cupTitle);
   m.volumes.forEach((vol,index)=>body.append(row(index===0?'默认出水杯量':`杯量挡${index}`,volumeText(vol),()=>openPicker({kind:'volume',value:vol,index}),blocked)));
   if(!defaultMode(m)&&m.volumes.length<6)body.append(row('+添加杯量','',()=>openPicker({kind:'volume',value:150,add:true}),blocked));
   if(isNew){const save=button('保存','dispenser-save',()=>{if(!modeNameError(m.name,modes,m.id))void sendModes([...modes,m]).then(ok=>{if(ok)p.navigate({page:'home'});});});save.disabled=blocked||!!modeNameError(m.name,modes,m.id);body.append(save);}
  }
 }else if(v.page==='sort'||v.page==='cups'){
  const isSort=v.page==='sort',order=v.order??[],volumes=v.volumes??[];
  const save=button('','page-icon-button',()=>{const next=isSort?order:modes.map(m=>m.id===v.modeId?{...m,volumes}:m),destination:DispenserView=isSort?{page:'home'}:{page:'mode',modeId:v.modeId};if(JSON.stringify(next)===JSON.stringify(modes)){p.navigate(destination);return;}void sendModes(next).then(ok=>{if(ok)p.navigate(destination);});},'check');save.disabled=blocked;save.setAttribute('aria-label',isSort?'保存模式排列':'保存杯量排列');header.append(save);
  const card=element('section','native-card dispenser-sort-card');if(isSort)card.append(element('p','dispenser-section-title','设备上的模式'));
  let dragging:number|undefined;const move=(from:number,to:number)=>{if(from===to||from<0||to<0||to>=(isSort?order.length:volumes.length)||!isSort&&(from===0||to===0))return;if(isSort){const next=clone(order);next.splice(to,0,next.splice(from,1)[0]);v.order=next;}else{const next=[...volumes];next.splice(to,0,next.splice(from,1)[0]);v.volumes=next;}v.selected=undefined;p.changed();};
  (isSort?order:volumes).forEach((item,index)=>{const m=isSort?item as DispenserMode:undefined,protectedItem=isSort?m!.id===1:index===0;const r=element('div','dispenser-sort-row');r.draggable=!blocked&&(isSort||index!==0);r.dataset.index=String(index);const select=button('','dispenser-select',()=>{v.selected=v.selected===index?undefined:index;p.changed();});select.setAttribute('aria-label',isSort?`选择${m!.name}`:`选择杯量挡${index}`);select.setAttribute('aria-pressed',String(v.selected===index));select.classList.toggle('selected',v.selected===index);select.disabled=blocked||protectedItem;
   const handle=button('','dispenser-drag-handle',()=>{},'menu');handle.setAttribute('aria-label','拖动或按Alt方向键排序');handle.disabled=blocked||!isSort&&index===0;handle.addEventListener('keydown',e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();move(index,index+(e.key==='ArrowUp'?-1:1));}});
   r.append(select,...(m?[modeArt(m,false),element('strong','',m.name)]:[element('strong','',index===0?'默认出水杯量':`杯量挡${index}`),element('span','dispenser-row-value',volumeText(item as number))]),handle);r.addEventListener('dragstart',e=>{dragging=index;e.dataTransfer?.setData('text/plain',String(index));});r.addEventListener('dragover',e=>{e.preventDefault();});r.addEventListener('drop',e=>{e.preventDefault();if(dragging!==undefined)move(dragging,index);dragging=undefined;});card.append(r);
  });body.append(card);const remove=button('删除','dispenser-remove',()=>{if(v.selected===undefined)return;if(isSort)v.order=order.filter((m,i)=>i!==v.selected||m.id===1);else v.volumes=volumes.filter((_,i)=>i!==v.selected||i===0);v.selected=undefined;p.changed();},'trash');remove.disabled=blocked||v.selected===undefined;page.append(remove);
 }
 if(p.cached||!p.device.online||p.device.sharedReadOnly)describeOperation(page,p.cached?'正在读取当前设置…':!p.device.online?'设备离线，暂不能修改设置。':'此共享设备只有查看权限。');
 describeOperation(page,p.commands.message||p.error);
 if(p.commands.uncertain)page.append(operationFeedback('待确认，后台正在核验',()=>p.commands.adopt()));
 if(p.commands.opening.showing)page.append(element('div','dispenser-pending',deviceWait(p.artwork,p.device.name,false)));
 if(v.discard){const exit=()=>p.navigate(v.page==='cups'?{page:'mode',modeId:v.modeId}:{page:'home'});page.append(dialog('更改尚未保存，仍要退出？',[],[button('取消','',()=>{v.discard=false;p.changed();}),button('确定','',exit)],()=>{v.discard=false;p.changed();}));}
 if(v.picker){const picker=v.picker,closePicker=()=>{v.picker=undefined;p.changed();},content:HTMLElement[]=[],label=picker.kind==='setting'?settingLabels[picker.field]:picker.kind==='name'?'模式名称':picker.kind==='temperature'?'温度设置':'出水杯量';
  const ok=button('确定','',()=>{if(blocked)return;v.picker=undefined;if(picker.kind==='setting')void p.change({operation:'setting',field:picker.field,expected:picker.expected,value:picker.value});else if(picker.kind==='name')patchMode({name:picker.value});else if(picker.kind==='temperature')patchMode({temperature:picker.value});else if(editing){const volumes=[...editing.volumes];if(picker.add)volumes.push(picker.value);else volumes[picker.index??0]=picker.value;patchMode({volumes});}p.changed();});ok.disabled=blocked;
  if(picker.kind==='setting'){
   const choices=picker.field==='defaultMode'?[{value:0,title:'记忆上次'},...modes.map(m=>({value:m.id,title:m.name}))]:settingChoices[picker.field].map((title,value)=>({title,value}));ok.disabled=blocked||!choices.some(c=>c.value===picker.value);const list=element('div','dispenser-choices');for(const c of choices){const b=button(c.title,'dispenser-choice',()=>{picker.value=c.value;ok.disabled=blocked;for(const item of list.querySelectorAll('button')){item.classList.toggle('selected',item===b);item.setAttribute('aria-checked',String(item===b));}});b.setAttribute('role','radio');b.setAttribute('aria-checked',String(picker.value===c.value));b.classList.toggle('selected',picker.value===c.value);b.append(icon('check'));list.append(b);}list.setAttribute('role','radiogroup');list.setAttribute('aria-label',label);content.push(list);
  }else if(picker.kind==='name'){
   const input=element('input','dispenser-mode-name');input.value=picker.value;input.setAttribute('aria-label','模式名称');const error=element('p','dispenser-name-error',modeNameError(picker.value,modes,editing?.id)??'');ok.disabled=blocked||!!error.textContent;input.addEventListener('input',()=>{picker.value=input.value;error.textContent=modeNameError(picker.value,modes,editing?.id)??'';ok.disabled=blocked||!!error.textContent;});content.push(input,error);
  }else{
   const values=picker.kind==='temperature'?Array.from({length:61},(_,i)=>40+i):volumeChoices,unit=element('span','dispenser-wheel-unit',picker.kind==='volume'&&picker.value===999?'':picker.kind==='temperature'?'℃':'mL');
   const wheel=purifierWheel(label,values,picker.value,value=>{picker.value=value;unit.textContent=picker.kind==='volume'&&value===999?'':picker.kind==='temperature'?'℃':'mL';},n=>n===999?'持续出水':String(n));content.push(element('div','dispenser-wheel',wheel.node,unit));
  }
  page.append(dialog(label,content,[button('取消','',closePicker),ok],closePicker));
 }
 return deviceSurfaces(stage);
}
function dialog(label:string,content:HTMLElement[],buttons:HTMLButtonElement[],close:()=>void):HTMLElement{
 const backdrop=element('div','dispenser-dialog-backdrop'),d=element('section','dispenser-dialog',element('h3','',label),...content,element('footer','',...buttons));d.tabIndex=-1;d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label',label);dismissOnBackdrop(backdrop,close);backdrop.append(d);d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){const focus=[...d.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];const first=focus[0],last=focus.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===d)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===d)){e.preventDefault();first?.focus();}}});queueMicrotask(()=>{if(d.isConnected)d.focus();});return backdrop;
}
function modeArt(m:DispenserMode,hero:boolean):HTMLElement{const node=element('span',hero?'dispenser-hero-symbol':'dispenser-mode-symbol');node.setAttribute('aria-hidden','true');const modes:Record<number,string>={1:'normal_temp',2:'mix_milk',3:'make_tea',4:'boiling_water'};node.append(officialIcon('dispenser:'+(hero?'image':'icon')+':'+(modes[m.id]??'custom')));return node;}
function waveGraphic():string {
 // Original wave11099: three horizontal periods at5/4/3seconds;40dp height.
 const reduced=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
 const path=(half:number,amplitude:number)=>{let d='M-480 40L-480 14';for(let x=-480;x<1440;x+=half*4)d+=`Q${x+half} ${14-amplitude} ${x+half*2} 14Q${x+half*3} ${14+amplitude} ${x+half*4} 14`;return d+'L1920 40Z';};
 return '<svg viewBox="0 0 360 40" preserveAspectRatio="none" aria-hidden="true">'+[[80,5,.25],[100,4,.48],[120,3,.25]].map(([half,duration,opacity])=>`<g style="--wave-shift:${-half*4}px;animation-duration:${duration}s;opacity:${opacity}"><path d="${path(half,22.5)}">${reduced?'':`<animate attributeName="d" dur="2s" repeatCount="indefinite" values="${path(half,20)};${path(half,25)};${path(half,20)}"/>`}</path></g>`).join('')+'</svg>';
}
