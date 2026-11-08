import {dismissOnBackdrop} from './dialog-dismiss';
import {operationFeedback,describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel} from '../types';
import {fridgeProperty,fridgeCurrent,fridgeChoices,fridgeRange,fridgeReason,type FridgeCommands,type FridgeField,type FridgeView,type FridgeSnapshot} from '../fridge';
import {element,button} from './dom';import {icon,officialIcon} from '../icons';import {deviceWait} from './device-loading';
interface Props{device:Device;panel:DevicePanel;view:FridgeView;commands:FridgeCommands;cached:boolean;busy:boolean;artwork:()=>HTMLElement;back:()=>void;home:()=>void;settings:()=>void;compatibility:()=>void;changed:()=>void;write:(field:FridgeField,value:number)=>void;reset:(snapshot:FridgeSnapshot)=>void;refresh:()=>void;error?:string}
export function fridgePage(p:Props):HTMLElement{
 p={...p,panel:p.commands.display?.(p.panel)??p.panel};
 const stage=element('div','device-stage'),page=element('section',`device-page page-fridge${p.view.page==='settings'?' page-fridge-settings':''}`),header=element('header','device-page-header',button('','page-icon-button',p.view.page==='home'?p.back:p.home,'back'),element('div','device-page-title',element('h2','',p.view.page==='home'?p.device.name:'设置'))),body=element('div','device-page-scroll fridge-content');
 header.querySelector('button')!.setAttribute('aria-label',p.view.page==='home'?'返回家庭':'返回冰箱');page.append(header,body);stage.append(page);
 const blocked=p.busy||p.commands.blocked||p.cached||!p.device.online||!!p.device.sharedReadOnly;
 const visible=(field:FridgeField)=>p.commands.target?.field===field?p.commands.target.value:fridgeCurrent(p.panel,field);
 const modeCard=(field:'mode'|'maternal',title:string)=>{
  const card=element('section','native-card fridge-modes'),heading=element('div','fridge-card-heading',element('strong','',title));
  const choices=element('div','fridge-mode-options'),value=visible(field);for(const choice of fridgeChoices(p.panel,field)){
   const selected=choice.value===value,b=button('','fridge-mode',()=>{if(choice.value!==fridgeCurrent(p.panel,field))p.write(field,choice.value);});b.setAttribute('aria-label',choice.label);b.setAttribute('aria-pressed',String(selected));b.dataset.focusKey=`fridge-${field}-${choice.value}`;b.classList.toggle('selected',selected);b.disabled=blocked||!!fridgeReason(p.panel,field);
   const glyph=choice.meaning==='Smart'?'smart':choice.meaning==='Quick Cooling'?'cool':choice.meaning==='Quick Frozen'?'freeze':choice.meaning==='Premium'?'premium':choice.meaning==='Maternal-infant Products'?'maternal':'freeze';b.append(element('span','fridge-mode-circle',officialIcon('fridge:'+glyph)),element('span','',choice.label));choices.append(b);
  }if(!choices.children.length)choices.append(element('p','native-unavailable','此型号没有已确认的可选模式。'));card.append(heading,choices);return card;
 };
 if(p.view.page==='home'){
  const hero=element('div','fridge-hero'),metrics=element('div','fridge-setpoints');for(const[field,label]of[['refrigerating','冷藏室'],['freezing','冷冻室']]as const){if(!fridgeProperty(p.panel,field))continue;metrics.append(element('div','fridge-setpoint',element('strong','',String(fridgeCurrent(p.panel,field)??'--')),element('span','',`${label}(℃)`)));}hero.append(metrics);body.append(hero);
  const fault=p.panel.services.find(s=>s.name==='fridge')?.properties.find(q=>q.name==='fault'),door=p.panel.services.find(s=>s.name==='fridge')?.properties.find(q=>q.name==='door-not-close-remind');
  if(fault?.code===0&&typeof fault.value==='number'&&fault.value!==0)body.append(element('div','native-card fridge-warning',icon('warning'),element('span','',`设备异常（${fault.value}）`)));
  if(door?.code===0&&door.valueList?.some(v=>v.description==='Some'&&v.value===door.value))body.append(element('div','native-card fridge-warning',icon('warning'),element('span','','请检查冰箱门是否关好')));
  body.append(modeCard('mode','冰箱模式'));
  for(const[field,title]of[['refrigerating','冷藏室'],['freezing','冷冻室']]as const){
   const card=element('section','native-card fridge-temperature'),range=fridgeRange(p.panel,field),value=visible(field),reason=fridgeReason(p.panel,field);card.append(element('div','fridge-card-heading',element('strong','',title),element('span','',range?`|  ${range[0]}~${range[1]}°C`:'')));
   if(!range||value===undefined){card.append(element('p','native-unavailable',reason??'请先读取当前温度设置。'));body.append(card);continue;}
   const[min,max,step]=range,valid=value>=min&&value<=max,row=element('div','fridge-temperature-row'),output=element('span','fridge-temperature-value',valid?`${value}°C`:'--'),track=element('div','fridge-temperature-track'),slider=element('input','fridge-temperature-slider');slider.type='range';slider.min=String(min);slider.max=String(max);slider.step=String(step);slider.value=String(Math.max(min,Math.min(max,value)));slider.disabled=blocked||!!reason;slider.setAttribute('aria-label',`${title}温度`);slider.dataset.focusKey=`fridge-${field}-temperature`;
   const paint=(n:number)=>{track.style.setProperty('--fill',`${(n-min)/(max-min)*100}%`);output.textContent=`${n}°C`;slider.setAttribute('aria-valuetext',`${n}°C`);};paint(Number(slider.value));if(!valid)output.textContent='--';
   let cancelled=false,interacting=false,initial=slider.value,observer:MutationObserver|undefined,pointer:number|undefined;
   const end=(cancel=false)=>{if(!interacting)return;interacting=false;cancelled=cancel;delete card.dataset.interacting;window.removeEventListener('pointerup',up,true);window.removeEventListener('blur',blur);observer?.disconnect();observer=undefined;if(cancel&&slider.isConnected){slider.value=initial;paint(Number(initial));}requestAnimationFrame(()=>{if(slider.isConnected)p.changed();});};
   const up=(e:PointerEvent)=>{if(e.pointerId===pointer)end();},blur=()=>end(true);
   slider.addEventListener('pointerdown',e=>{if(slider.disabled||e.button!==0||interacting)return;cancelled=false;interacting=true;initial=slider.value;pointer=e.pointerId;card.dataset.interacting='true';window.addEventListener('pointerup',up,true);window.addEventListener('blur',blur);observer=new MutationObserver(()=>{if(!slider.isConnected)end(true);});observer.observe(document.documentElement,{childList:true,subtree:true});});
   slider.addEventListener('pointercancel',()=>end(true));slider.addEventListener('keydown',()=>{cancelled=false;});slider.addEventListener('input',()=>paint(Number(slider.value)));slider.addEventListener('change',()=>{if(slider.isConnected&&!slider.disabled&&!cancelled)p.write(field,Number(slider.value));});
   const controls=([-1,1]as const).map(direction=>{const b=button('','fridge-temperature-step',()=>p.write(field,Math.min(max,Math.max(min,value+direction*step))),direction===-1?'minus':'plus');b.setAttribute('aria-label',`${title}${direction===-1?'温度减一':'温度加一'}`);b.dataset.focusKey=`fridge-${field}-${direction}`;b.disabled=blocked||!!reason||(direction===-1?value<=min:value>=max);return b;});track.append(slider,output);row.append(controls[0],track,controls[1]);card.append(row);body.append(card);
  }
  if(fridgeProperty(p.panel,'maternal'))body.append(modeCard('maternal','母婴室'));
 }else{
  body.append(element('h1','fridge-setting-title','设置'),element('div','fridge-setting-product',p.artwork(),element('strong','',p.device.name)));
  const info=button('更多设备信息','fridge-setting-row',()=>{p.view.info=true;p.changed();});info.append(icon('chevron'));body.append(info,element('p','fridge-setting-label','功能设置'));
 }
 describeOperation(page,p.commands.message||p.error);
 if(p.commands.uncertain)page.append(operationFeedback('待确认，后台正在核验',()=>p.commands.adopt()));
 if(p.commands.opening.showing)page.append(element('div','fridge-pending',deviceWait(p.artwork,p.device.name,false)));
 if(p.view.reset){const expected={...p.view.reset},close=()=>{p.view.reset=undefined;p.changed();};page.append(fridgeDialog('确定恢复出厂设置吗？',[element('p','','恢复出厂后，冰箱当前的设定模式及温度将被还原，是否继续？')],[button('取消','',close),button('确定','',()=>{if(!blocked){p.view.reset=undefined;p.reset(expected);}})],close));}
 if(p.view.info){const close=()=>{p.view.info=false;p.changed();},rows:HTMLElement[]=[];for(const[name,label]of[['manufacturer','制造商'],['model','产品型号'],['firmware-revision','固件版本']]as const){const q=p.panel.services.find(s=>s.name==='device-information')?.properties.find(q=>q.name===name);rows.push(element('p','fridge-device-info',element('span','',label),element('span','',q?.code===0&&typeof q.value==='string'?q.value:name==='model'?p.device.model:'未读取')));}page.append(fridgeDialog('设备信息',rows,[button('关闭','',close)],close));}
 if(p.view.help){const backdrop=element('div','fridge-help-backdrop'),dialog=element('section','fridge-help'),close=()=>{p.view.help=false;p.changed();};dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','冰箱模式说明');dialog.tabIndex=-1;dialog.append(element('h3','','冰箱模式'));
  const cool=fridgeRange(p.panel,'refrigerating')?.[0],frozen=fridgeRange(p.panel,'freezing')?.[0];for(const[title,text]of[['智能模式','一键智能设置，冷藏室温度设定为5°C，冷冻室温度设定为-18°C，让食材保持良好状态'],['速冷模式',`冷藏室温度设为${cool??'--'}°C，快速冷却食物，可用于冰镇饮料，饭菜快速降温`],['速冻模式',`冷冻室${frozen??'--'}°C急速冷冻，适用于一次性存放大量食材及食物快速深度冷冻，锁住海鲜和肉类水分及营养`]])dialog.append(element('h4','',title),element('p','',text));const ok=button('知道了','',close);dialog.append(ok);dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){e.preventDefault();ok.focus();}});dismissOnBackdrop(backdrop,close);backdrop.append(dialog);page.append(backdrop);queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
 }
 return deviceSurfaces(stage);
}
function fridgeDialog(label:string,children:HTMLElement[],buttons:HTMLButtonElement[],close:()=>void):HTMLElement{
 const backdrop=element('div','fridge-dialog-backdrop'),dialog=element('section','fridge-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',label);dialog.tabIndex=-1;dialog.append(element('h3','',label),...children,element('footer','',...buttons));dismissOnBackdrop(backdrop,close);backdrop.append(dialog);dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){if(e.shiftKey&&(document.activeElement===dialog||document.activeElement===buttons[0])){e.preventDefault();buttons.at(-1)?.focus();}else if(!e.shiftKey&&(document.activeElement===dialog||document.activeElement===buttons.at(-1))){e.preventDefault();buttons[0]?.focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});return backdrop;
}
