import {cookingPanel,fryerStyleCategory,type CookingCategory,type CookingCommand,type CookingPhase,type CookingView} from '../cooking';
import type {Device,DevicePanel,Json,Property} from '../types';
import {deviceUnit} from '../device-labels';
import {booleanValue,controlReason,numericValue} from '../panel-layout';
import {validRange} from '../device-capabilities';
import {icon,type IconName} from '../icons';
import {button,element} from './dom';
import {actionFooter,footerButton} from './action-footer';
import {cookingBubbles,fryerDetailHero,fryerModeArtwork,fryerSettingRow,fryerStopDialog,fryerValuePicker,fryerWarmRow,type FryerSetting} from './fryer-page';
import {deviceUnavailablePage} from './device-unavailable';
import {reservationPicker} from './reservation-picker';

export interface CookingEditor {picker?:FryerSetting;confirmStop?:boolean;reservation?:boolean}

const phaseLabels:Record<CookingPhase,string>={ready:'待机中',cooking:'烹饪中',warming:'保温中',scheduled:'预约中',paused:'已暂停'};
const colors=['#39bdc5','#f3ac3e','#f48369','#4bb9ea','#8f74e4','#e77496'];
const fryerArt:Record<string,number>={manual:0,afcustom:0,frenchfries:1,affrozenfries:1,chickenwing:2,afchickenwings:2,
  sweetpotato:3,afsweetpotato:3,eggtart:4,tart:4,steak:5,beefsteak:5,afbeefsteak:5,
  porkbelly:6,afporkbelly:6,shrimp:7,afshrimp:7,cake:8,pizza:9,driedfruit:10,defrost:11,reheat:12};
const namedArt:Record<string,number>={'默认':0,'默认烹饪':0,'手动模式':0,'自定义烹饪':0,'薯条':1,'冷冻薯条':1,'鸡翅':2,'红薯':3,'蜜薯':3,'蛋挞':4,'牛排':5,'五花肉':6,'虾':7,'蛋糕':8,'披萨':9,'果干':10,'解冻':11,'复热':12};
function cookingIcon(meaning:string,index:number):HTMLElement {
  const glyph:IconName=/warm|heat|保温/.test(meaning)?'sun':/soup|congee|porridge|粥|汤/.test(meaning)?'droplet':/steam|炖|蒸/.test(meaning)?'wind':'device';
  const mark=element('span','cooking-mode-icon',icon(glyph));
  mark.style.setProperty('--cooking-mode-color',colors[index%colors.length]);
  return mark;
}

const settingText=(property:Property,value:number)=>property.unit==='seconds'&&value>=60
  ?`${Math.floor(value/60)}分钟${value%60?`${value%60}秒`:''}`:`${value}${deviceUnit(property.unit)}`;

export function cookingPage(p:{device:Device;panel?:DevicePanel;category:CookingCategory;
  view:CookingView;select:(view:CookingView)=>void;execute:(command:CookingCommand)=>void;
  busy:boolean;actionBusy?:boolean;animationOwner:object;back:()=>void;editor:CookingEditor;changed:()=>void;
  write:(property:Property,value:Json)=>void}):HTMLElement {
  const state=cookingPanel(p.panel);
  if(!state?.modes.length)return deviceUnavailablePage(p.device,p.back);
  const standard=fryerStyleCategory(p.category);
  const glyph=(mode:typeof state.modes[number],index:number,kind:'icon'|'image')=>{
    const art=fryerArt[mode.meaning]??namedArt[mode.label];
    return standard&&Number.isInteger(art)?fryerModeArtwork(art,kind):cookingIcon(mode.meaning+' '+mode.label,index);
  };
  const selected=p.view&&'mode' in p.view?state.modes.find(mode=>mode.value===(p.view&&'mode' in p.view?p.view.mode:undefined)):undefined;
  const active=p.device.online&&state.active;
  const task=p.view&&'task' in p.view;
  const running=active&&(task||!!selected&&selected.value===state.selected?.value);
  const detail=!!(task||selected);
  const title=task?state.selected?.label??'当前任务':selected?.label??p.device.name;
  const back=button('','page-icon-button',()=>detail?p.select(undefined):p.back(),'back');
  back.setAttribute('aria-label',detail?'返回模式':'返回家庭');
  const body=element('div',`device-page-scroll fryer-content ${detail?'fryer-detail':'fryer-home'}`);
  const page=element('section','device-page page-fryer page-cooker',
    element('header','device-page-header',back,element('div','device-page-title',element('h2','',title))),body);
  page.dataset.presentationTemplate=p.category;
  const remaining=state.remaining==null?undefined:`剩余 ${Math.ceil(state.remaining)} 分钟`;
  if(!detail){
    if(active&&state.phase){
      const taskButton=button('','fryer-task',()=>p.select({task:true}));
      taskButton.append(element('span','fryer-task-icon',icon('clock')),
        element('span','fryer-task-copy',element('strong','',state.selected?.label??'当前任务'),
          element('small','',[phaseLabels[state.phase],remaining].filter(Boolean).join(' · '))),icon('chevron'));
      body.append(taskButton);
    }
    const grid=element('div','fryer-mode-grid');
    for(const [index,mode] of state.modes.entries()){
      const tile=button('','fryer-mode',()=>p.select({mode:mode.value}));
      tile.append(glyph(mode,index,'icon'),element('span','',mode.label));grid.append(tile);
    }
    body.append(element('section','fryer-modes',element('p','fryer-section-title','设备上的模式'),grid));
  }else{
    const time=state.duration&&numericValue(state.duration);
    const shownMode=selected??state.selected;
    const art=running&&state.phase&&['cooking','paused','warming'].includes(state.phase)?cookingBubbles(p.animationOwner,state.phase==='cooking'):
      shownMode?glyph(shownMode,state.modes.indexOf(shownMode),'image'):undefined;
    const minutes=selected&&state.programMinutes?.(selected.value);
    const estimate=standard&&time!==undefined&&state.duration&&time>0?settingText(state.duration,time)
      :minutes&&minutes>0?`${Math.ceil(minutes)} 分钟`:undefined;
    const headline=running&&state.phase?phaseLabels[state.phase]:estimate?`大约需要 ${estimate}`
      :selected?.label??(state.phase?phaseLabels[state.phase]:undefined);
    body.append(fryerDetailHero(art,headline,running?remaining:undefined));
    if(running&&state.temperature!=null&&Number.isFinite(state.temperature)){
      body.append(element('section','fryer-fields',element('div','fryer-field',element('span','','当前温度'),
        element('span','fryer-field-value',`${state.temperature}℃`))));
    }
    const disabled=p.busy||!p.device.online||!!p.device.sharedReadOnly;
    if(standard&&(selected||running)){
      const settings=element('section','fryer-fields');
      const locked=disabled||state.phase!=='ready';
      const unavailable=(property:Property)=>locked||!!controlReason(property,p.device.online,p.busy);
      if(state.warm){
        const field=state.warm,warm=booleanValue(field);
        settings.append(fryerWarmRow(warm,()=>p.write(field,!warm),unavailable(field)||warm===undefined));
      }
      for(const [kind,property] of [['temperature',state.target],['time',state.duration]] as const){
        if(!property)continue;
        const value=numericValue(property);
        const range=validRange(property)?property.valueRange as [number,number,number]:undefined;
        const values=property.valueList?.map(option=>option.value).filter((choice):choice is number=>typeof choice==='number');
        const lockedField=unavailable(property)||value===undefined||!(range||values?.length);
        const row=fryerSettingRow(kind,value===undefined?undefined:settingText(property,value),()=>{p.editor.picker=kind;p.changed();},lockedField);
        row.dataset.siid=String(property.siid);row.dataset.piid=String(property.piid);row.dataset.propertyName=property.name;
        settings.append(row);
        if(p.editor.picker===kind&&value!==undefined&&(range||values?.length)){
          const close=()=>{p.editor.picker=undefined;p.changed();};
          page.append(fryerValuePicker({kind,value,range,values,seconds:property.unit==='seconds',blocked:lockedField,format:value=>settingText(property,value),close,
            apply:next=>{p.editor.picker=undefined;p.write(property,next);p.changed();}}));
        }
      }
      if(settings.childElementCount)body.append(settings);
    }
    const footer=actionFooter('fryer-actions');
    const add=(label:string,command:CookingCommand|undefined,primary=false)=>{
      if(!command)return;
      const kind=primary||command.kind==='pause'||command.kind==='resume'?'primary':'secondary';
      const action=footerButton(label,()=>p.execute(command),kind);
      if(command.kind==='pause'||command.kind==='resume')action.classList.add('action-white-text');
      action.disabled=disabled||!!p.actionBusy;footer.append(action);
    };
    if(running){
      if(state.stop){
        const stop=state.stop,reserved=state.phase==='scheduled';
        const end=footerButton(reserved?'取消预约':standard?'终止':'结束烹饪',()=>{p.editor.confirmStop=true;p.changed();});
        end.disabled=disabled||!!p.actionBusy;footer.append(end);
        if(p.editor.confirmStop){
          const close=()=>{p.editor.confirmStop=false;p.changed();};
          page.append(fryerStopDialog(reserved,close,()=>{close();p.execute(stop);},end.disabled));
        }
      }
      add('暂停',state.pause,true);add('继续',state.resume,true);
    }
    else if(selected){
      const reservation=state.reservation;
      if(reservation?.schedulable&&reservation.mode===selected.value){
        const locked=disabled||!!p.actionBusy||!reservation.available;
        const reserve=footerButton('预约',()=>{p.editor.reservation=true;p.changed();});
        reserve.disabled=locked;
        footer.append(reserve);
        if(p.editor.reservation){
          const duration=reservation.cookingMinutes+reservation.ventingMinutes;
          const delay=(at:number)=>Math.floor(at/60)-Math.floor(Date.now()/60_000);
          const close=()=>{p.editor.reservation=false;p.changed();};
          page.append(reservationPicker({durationMinutes:duration,earliestAt:Math.floor(Date.now()/60_000)*60+(duration+1)*60,
            blocked:locked,close,problem:at=>delay(at)<=duration?'请选择更晚的完成时间。':
              delay(at)>reservation.limitMinutes?'请选择 24 小时内的完成时间。':undefined,
            submit:at=>{const command=reservation.command(delay(at));if(command){close();p.execute(command);}},
          }));
        }
      }
      const start=state.start(selected.value);
      const field=state.modeSetting;
      if(start)add('开始',start,true);
      else if(field&&selected.value!==null&&selected.value!==state.selected?.value){
        const select=footerButton('设为当前模式',()=>{if(!select.disabled)p.write(field,selected.value);},'primary');
        select.disabled=disabled||!!p.actionBusy||state.phase!=='ready'||!!controlReason(field,p.device.online,p.busy);
        footer.append(select);
      }
    }
    if(footer.childElementCount)body.append(footer);
  }
  return element('div','device-stage',page);
}
