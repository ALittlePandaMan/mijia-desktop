import {deviceSurfaces} from './device-surfaces';
import { favoriteChange,type LightFavoriteDraft,type LightFavoriteOperation } from '../light-favorites';
import { controlReason,numericValue } from '../panel-layout';
import type { Device,Json,LightFavoritesReport,Property } from '../types';
import { button,element } from './dom';
import { renderControl } from './controls';
import { renderLightColor } from './light-color';

interface Props {
  draft:LightFavoriteDraft;report:LightFavoritesReport;operation?:LightFavoriteOperation;error?:string;
  device:Device;properties:Property[];cached:boolean;
  back:()=>void;save:()=>void;remove:()=>void;refresh:()=>void;
  change:(draft:LightFavoriteDraft)=>void;write:(property:Property,value:Json)=>void;failure:(error:unknown)=>void;interactionEnded:()=>void;
}
/** The plugin's collection editor really previews the light on release. Name
 * and tab changes are local; saving/deleting a collection does not write light
 * properties. Caller guards context and performs single-submit reconciliation. */
export function renderLightFavorite(props:Props):HTMLElement{
  const stage=element('div','device-stage'),page=element('section','device-page page-light-favorite'),draft=structuredClone(props.draft);
  const back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label','返回情景模式');
  const save=button('','page-icon-button',props.save,'check');save.setAttribute('aria-label','完成收藏');
  const pending=!!props.operation?.pending;
  page.dataset.pendingOperations=String(pending?1:0);page.dataset.favoriteOperation=props.operation?.phase??'idle';page.setAttribute('aria-busy',String(pending));
  page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',draft.id?'编辑收藏':'创建收藏')),save));
  const body=element('div','device-page-scroll light-favorite-content'),nameBox=element('div','light-favorite-name-box'),input=element('input','light-favorite-name');
  input.value=draft.name;input.maxLength=4;input.placeholder='请输入内容';input.setAttribute('aria-label','收藏名称');input.dataset.focusKey='favorite-name';input.disabled=pending;
  const error=element('p','light-favorites-error');error.setAttribute('role','alert');
  const validate=():void=>{try{favoriteChange(draft,props.report);save.disabled=pending;error.textContent=props.error??props.operation?.error?.message??'';}catch(e){save.disabled=true;error.textContent=input.value?(e as Error).message:props.error??'';}nameBox.classList.toggle('invalid',!!error.textContent);};
  const changed=():void=>{if(!page.isConnected)return;props.change(structuredClone(draft));validate();};
  input.addEventListener('input',()=>{draft.name=input.value;changed();});
  const clear=button('','page-icon-button',()=>{if(page.isConnected&&!pending){input.value='';draft.name='';changed();input.focus();}},'close');clear.setAttribute('aria-label','清空收藏名称');clear.disabled=pending;nameBox.append(input,clear);body.append(nameBox,error);
  const property=(name:string,value:number):Property|undefined=>{
    const matches=props.properties.filter(p=>p.siid===2&&p.name===name);if(matches.length!==1)return;const p=matches[0];
    // Draft values are not readback. Only a descriptor with an independently
    // confirmed readable state can be used for a live preview control.
    if(controlReason(p,props.device.online,props.cached||pending)||numericValue(p)===undefined)return p;
    return{...p,value};
  };
  const preview=(p:Property,value:number):void=>{if(p.name==='brightness')draft.brightness=value;else if(p.name==='color')draft.color=value;else if(p.name==='color-temperature')draft.temperaturePercent=Math.trunc((value-2700)/38);changed();};
  const environment={device:props.device,busy:props.cached||pending,write:(p:Property,v:Json)=>{
    if(!page.isConnected||pending)return;
    const source=props.properties.find(real=>real.siid===p.siid&&real.piid===p.piid);
    if(!source||numericValue(source)===undefined)return;
    if(typeof v==='number')preview(source,v);
    // The display clone contains form intent, never the confirmed rollback
    // baseline. PropertyOperations must receive the independently read source.
    props.write(source,v);
  },error:props.failure,interactionEnded:props.interactionEnded};
  const brightness=property('brightness',draft.brightness);
  if(brightness){const slider=renderControl({name:'Slider',props:{property:brightness,label:'亮度',unit:'%',theme:'brightness'}},environment);slider.querySelector('input')?.addEventListener('input',event=>preview(brightness,Number((event.target as HTMLInputElement).value)));body.append(slider);}
  if(props.properties.some(p=>p.name==='color'||p.name==='color-temperature'))body.append(renderLightColor({property:property('color',draft.color),temperature:property('color-temperature',2700+draft.temperaturePercent*38),tab:draft.tab,releaseProfile:'favorite',selectTab:tab=>{draft.tab=tab;changed();},preview},environment));
  if(draft.id){const remove=button('删除','light-favorite-delete',()=>{if(page.isConnected&&!pending)props.remove();});remove.disabled=pending;body.append(remove);}
  if(props.operation?.phase==='uncertain'){const refresh=button('','page-icon-button light-favorite-recheck',props.refresh,'refresh');refresh.setAttribute('aria-label','重新确认收藏');body.append(refresh);}
  page.append(body);stage.append(page);validate();return deviceSurfaces(stage);
}
