import {notice,type Notice} from './notice';
/** Shared desktop presentation. No account, IPC, or transport imports.
 * The host binds existing desktop behavior or an isolated browser simulation. */
import type {Device,DevicePanel,Property,Json,DeviceContext,HomeSnapshot,SensorHistory,AppError,EnergyReport} from '../types';
import {button,element} from './dom';
import type {IconName} from '../icons';
import {booleanValue,numericValue,findProperty,isReadableValue,climateBindings,climateChoiceIndex,climateChoiceLabel,fanModeLabel,lightGroupCounts,splitChildren,switchServices,panelLayout} from '../panel-layout';
import {capabilityCategory} from '../device-capabilities';
import {missingReadingText,normalizeError,reportedValueText,sameContext} from '../logic';
import {deviceChoiceLabel,deviceServiceLabel,deviceUnit} from '../device-labels';
import {airPurifierBindings,environmentCategory,fanDetailBindings,simpleClimateBindings,type SimpleClimateCategory} from '../environment-controls';
import {historyExtremes,sensorHistorySlots} from '../history';
import {historyChart,sensorHistoryEntry} from './history-chart';
import {deviceWait} from './device-loading';
import {productHeader} from './product-header';
import {switchPolicy} from '../switch-mode';
import {renderLightColor} from './light-color';
import {lightColorTab,lightTint,rgbValue,type LightColorTab} from '../light-color';
import {fanLightPower,lightChannelBindings} from '../light-bindings';
import {climateMeter,energySupported} from '../energy';
import {energyEntrance} from './energy-page';
import type {ControlNode,StatusProps} from './controls';
import {powerCardRow} from './power-button';
import {sensorDetailReadings} from '../sensor-presentation';
import {deviceUnavailablePage} from './device-unavailable';
import {swingControlCard} from './swing-control';
export interface DevicePresenterHost {
 panel?:DevicePanel;context?:DeviceContext;panelEpoch:number;controlBusy:boolean;panelIsCached:boolean;panelNotice?:Notice;
 snapshot?:HomeSnapshot;linkedPanels:ReadonlyMap<string,DevicePanel>;linkedErrors?:ReadonlyMap<string,string>;
 sensorHistory?:SensorHistory;historyLoading:boolean;historyError?:AppError;
 energyData?:EnergyReport;energyLoading:boolean;energyError?:AppError;
 control:(node:ControlNode,device:Device)=>HTMLElement;
 deviceArtwork:(device:Device,className?:string,switchCount?:number,product?:boolean)=>HTMLElement;
 nativeSlider:(p:Property,label:string,unit:string,device:Device,disabled:boolean,theme:string)=>HTMLElement;
 nativeTemperatureControl:(p:Property|undefined,device:Device,disabled:boolean)=>HTMLElement;
 nativeClimateChoices:(p:Property|undefined,title:string,device:Device,disabled:boolean)=>HTMLElement;
 lightTab?:(siid:number)=>LightColorTab|undefined; selectLightTab?:(siid:number,tab:LightColorTab)=>void;
 render:(preserve?:boolean)=>void;
 setBoundProperty:(p:Property,value:Json,did:string)=>Promise<unknown>;
 setProperty:(p:Property,value:Json)=>Promise<unknown>;
}


export function lightGroupPowerRow(property: Property | undefined, render: (node: ControlNode) => HTMLElement): HTMLElement {
  return powerCardRow('light-power-row', ...[true,false].map(value=>render({
    name:'Power',props:{property,label:value?'全开':'全关',value,className:value?'power-open':'power-close',
      glyph:value?'light-all-on':'light-all-off'},
  })));
}

export function renderLightPage(this: DevicePresenterHost, device: Device, group: boolean): HTMLElement {
    const channels=lightChannelBindings(this.panel,this.panel?.specType??device.specType);
    const primary=channels[0],rgb=!!primary?.color,state=booleanValue(primary?.on);
    const view=element('div',`light-page-content${rgb?' yeelight-page-content':''}`);
    const hero=element('div','light-hero');hero.setAttribute('aria-hidden','true');
    let status=state===undefined?undefined:state?'已开启':'已关闭';
    if (group) {
      const counts = lightGroupCounts(device, this.snapshot?.devices ?? [], this.linkedPanels);
      status = !counts || !counts.on && !counts.off ? undefined : counts.on === counts.total ? `${counts.total}个灯开启`
        : counts.off === counts.total ? `${counts.total}个灯关闭` : `${counts.on}个灯开启 · ${counts.off}个灯关闭`;
    }
    if(status&&((channels.length===1&&primary.on)||group))view.dataset.headerStatus=status;
    if(rgb)view.dataset.lightTheme='rgb';
    view.append(hero);
    const fan=fanLightPower(this.panel);
    for(const channel of channels){
      if(channels.length>1)view.append(element('h3','light-channel-label',deviceServiceLabel(channel.service)));
      renderLightChannel.call(this,view,device,channel,group,channel===primary,channel===primary?fan:undefined);
    }
    return view;
}

function renderLightChannel(this:DevicePresenterHost,view:HTMLElement,device:Device,channel:ReturnType<typeof lightChannelBindings>[number],group:boolean,primary:boolean,fan:Property|undefined):void {
    const {on,brightness,temperature,color,mode,service}=channel;
    const state=booleanValue(on),off=!!on&&state!==true,rgb=!!color;
    let tab=this.lightTab?.(service.siid)??lightColorTab(mode,!!temperature,rgb);
    if(tab==='temperature'&&!temperature&&color)tab='color';
    if(group)view.append(lightGroupPowerRow(on,node=>this.control(node,device)));
    else{
      const items:ControlNode[]=[];
      if(on)items.push({name:'Power',props:{property:on,label:'电源',openLabel:rgb?'开灯':'开启',closeLabel:rgb?'关灯':'关闭',className:rgb?'yeelight-power':undefined}});
      if(fan)items.push({name:'Power',props:{property:fan,label:'风扇',glyph:'fan',openLabel:'开启风扇',closeLabel:'关闭风扇',className:'light-fan-power'}});
      if(items.length)view.append(this.control({name:'Container',props:{className:'light-power-row detail-power-row'},items},device));
    }
    const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    const tint=(property?:Property,value?:number)=>{
      if(!primary||!color)return;
      const active=property?.name==='color'?'color':property?.name==='color-temperature'?'temperature':tab;
      const background=lightTint(state,property&&property===brightness?value:numericValue(brightness),property===color?value:rgbValue(color),property&&property===temperature?{...temperature!,value}:temperature,active);
      if(background)view.dataset.lightTint=background;else delete view.dataset.lightTint;
      const page=view.closest<HTMLElement>('.device-page');
      if(background)page?.style.setProperty('--light-tint',background);else page?.style.removeProperty('--light-tint');
    };
    tint();
    const disabledReason=off?'设备开启后可调节。':undefined;
    if(brightness){
      const card=this.control({name:'Slider',props:{property:brightness,label:'亮度',unit:'%',theme:'brightness',brightnessTone:rgb?'rgb':'white',disabledReason}},device);
      if(rgb){card.classList.add('yeelight-brightness');const input=card.querySelector('input');input?.addEventListener('input',()=>tint(brightness,Number(input.value)));}
      view.append(card);
    }
    if(color){
      const env={device,busy:this.controlBusy||this.panelIsCached,write:(property:Property,value:Json)=>{if(current())void this.setBoundProperty(property,value,device.did);},error:(error:unknown)=>{if(current()){this.panelNotice={tone:'error' as const,title:normalizeError(error).message};this.render(true);}},interactionEnded:()=>{if(current())this.render(true);}};
      view.append(renderLightColor({property:color,temperature,mode,tab,heading:'temperature-only',disabledReason,
        selectTab:next=>{if(current()){tab=next;this.selectLightTab?.(service.siid,next);tint();}},preview:(p,value)=>{if(current())tint(p,value);}},env));
    }else if(temperature)view.append(this.nativeSlider(temperature,'色温','K',device,off,'temperature'));
  }

function appendClimateMeter(host: DevicePresenterHost, view: HTMLElement, device: Device): void {
  if (!climateMeter(device, host.panel)) return;
  const hasHistory = energySupported(device, host.panel);
  view.append(energyEntrance(host.energyData, host.panel,
    hasHistory,
    hasHistory && host.energyLoading, !hasHistory));
}

export function renderAirConditionerPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const core=climateBindings(this.panel,undefined,device.controlServiceId);
    const {on,mode,target,fan,indoor,horizontal,vertical}=core??{};
    const state = booleanValue(on);
    const value = numericValue(target);
    const view = element('div', `air-conditioner-content${state !== true ? ' device-is-off' : ''}`);
    const status = state === undefined ? undefined : state ? '开机' : '关机';
    const indoorValue = numericValue(indoor);
    const hero = element('div', 'air-conditioner-hero',
      target ? element('div', 'air-conditioner-temperature', element('strong', value === undefined ? 'reading-unavailable' : '', String(value ?? missingReadingText)), value === undefined ? null : element('span', '', '℃')) : null,
      status ? element('p', '', status) : null,
      indoor ? element('p', '', '室内温度 ', indoorValue === undefined ? element('span', 'reading-unavailable', missingReadingText) : `${indoorValue}℃`) : null);
    if(!core)hero.append(element('div','category-product',this.deviceArtwork(device,'',3,true)));
    view.append(hero);
    appendClimateMeter(this, view, device);
    if(on)view.append(this.control({ name: 'Power', props: { property: on, label: '电源', openLabel: '开启', closeLabel: '关闭', className: 'air-conditioner-power' } }, device));
    if(target)view.append(target.valueRange ? this.nativeTemperatureControl(target, device, state !== true) : this.nativeClimateChoices(target, '温度调节', device, state !== true));
    if(mode?.valueList?.some(choice=>climateChoiceIndex(choice,'mode')>=0))view.append(this.nativeClimateChoices(mode, '模式', device, state !== true));
    if(fan?.valueList?.some(choice=>climateChoiceIndex(choice,'fan')>=0))view.append(this.nativeClimateChoices(fan, '风速', device, state !== true));
    for(const [property,label,glyph] of [[horizontal,'左右摆风','swing-horizontal'],[vertical,'上下摆风','swing-vertical']] as const){
      if(property)view.append(this.control({name:'Power',props:{property,label,glyph,disabledReason:state!==true?'设备开启后可调节。':undefined}},device));
    }
    return view;
  }

export function renderAirPurifierPage(this:DevicePresenterHost,device:Device):HTMLElement {
  const view=element('div','category-page-content device-controls-region');
  const bindings=this.panel&&airPurifierBindings(device,this.panel);
  if(!bindings)return view;
  const {on,fan,mode,uv,anion,plasma,favorite}=bindings;
  const controls=element('div','device-card-stack');
  const active=on?.values?isReadableValue(on.property)&&on.property.value===on.values[1]:booleanValue(on?.property);
  const locked=!!on&&active!==true;
  if(on)controls.append(this.control({name:'Power',props:{...on,label:'电源',openLabel:'开启',closeLabel:'关闭'}},device));
  const selected=isReadableValue(mode)?mode.valueList?.find(choice=>choice.value===mode.value):undefined;
  const favoriteActive=selected&&/^(favou?rite|喜爱|最爱)$/i.test(selected.description.trim());
  if(fan)controls.append(this.control({name:'Slider',props:{property:fan,label:favorite?'喜爱风速':fan.valueList?'风速档位':'风速',
    unit:deviceUnit(fan.unit)||(favorite?'档':''),theme:'fan',discrete:!!fan.valueList,
    choiceLabel:description=>fan.valueList?.find(x=>x.description===description)?.localizedDescription??description,
    locked:locked||favorite&&!favoriteActive}},device));
  if(mode)controls.append(this.control({name:'Selector',props:{property:mode,label:'模式',showValue:true,
    choiceLabel:description=>mode.valueList?.find(x=>x.description===description)?.localizedDescription??deviceChoiceLabel(description),locked}},device));
  for(const [binding,label,glyph] of [[uv,'紫外净化','sun'],[anion,'负离子','leaf'],[plasma,'等离子','shield']] as const){
    if(binding)controls.append(this.control({name:'Power',props:{...binding,label,glyph,locked}},device));
  }
  view.append(element('div','category-product',this.deviceArtwork(device,'',3,true),element('h1','',device.name)),controls);
  return view;
}

export function renderSimpleClimatePage(this: DevicePresenterHost,device: Device,category: SimpleClimateCategory): HTMLElement {
  const view=element('div','category-page-content device-controls-region');
  if(!this.panel)return view;
  const {on,target,mode,fan}=simpleClimateBindings(device,this.panel,category);
  const stack=element('div','device-card-stack');
  const disabled=!!on&&booleanValue(on)!==true;
  const disabledReason=disabled?'设备开启后可调节。':undefined;
  if(on)stack.append(this.control({name:'Power',props:{property:on,label:'电源',openLabel:'开启',closeLabel:'关闭'}},device));
  if(target){
    const temperature=target.name==='target-temperature';
    const title=temperature?'目标温度':'目标湿度',unit=deviceUnit(target.unit);
    const discrete=!!target.valueList?.length;
    stack.append(this.control({name:'Slider',props:{property:target,label:title,unit,discrete,
      style:temperature&&!discrete?'temperature':undefined,disabledReason,
      choiceLabel:description=>`${target.valueList?.find(option=>option.description===description)?.value??description}${unit}`}},device));
  }
  if(mode)stack.append(this.control({name:'Selector',props:{property:mode,label:'模式',showValue:true,
    choiceLabel:description=>mode.valueList?.find(option=>option.description===description)?.localizedDescription??climateChoiceLabel(description),disabledReason}},device));
  if(fan)stack.append(fan.valueList?.length?this.nativeClimateChoices(fan,'风速',device,disabled):
    this.nativeSlider(fan,'风速',deviceUnit(fan.unit),device,disabled,'fan'));
  view.append(element('div','category-product',this.deviceArtwork(device,'',3,true),element('h1','',device.name)),stack);
  return view;
}

export function renderStatusReadingsPage(this:DevicePresenterHost, device:Device, template:'sensor-readings'|'security-readings'|'cleaner-battery'|'water-faucet'|'shower',
  readings:readonly (StatusProps & {metric:string})[], back:()=>void, error?:string):HTMLElement {
  if(!readings.length&&!error)return deviceUnavailablePage(device,back);
  const backButton=button('','page-icon-button',back,'back');
  backButton.setAttribute('aria-label','返回家庭');
  const page=element('section',`device-page page-status-readings page-${template}`);
  page.dataset.presentationTemplate=template;page.dataset.visualAdapter=template;
  const stack=element('div','device-card-stack');
  for(const {metric,...props} of readings){
    const card=this.control({name:'Status',props},device);
    card.classList.add('device-control-unit');card.dataset.reading=metric;
    stack.append(card);
  }
  page.append(
    element('header','device-page-header',backButton,element('div','device-page-title',element('h2','',device.name))),
    element('div','device-page-scroll device-controls-region',
      element('div','category-product',this.deviceArtwork(device,'',3,true)),
      error?notice({tone:'error',title:error}):stack));
  return element('div','device-stage',page);
}

export function renderTemperatureHumidityPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'sensor-page-content');
    const metrics=element('div','sensor-hero-metrics');
    const supplemental=element('div','sensor-hero-readings');
    for(const {metric,label,unit,...props} of sensorDetailReadings('temperature-humidity-sensor',this.panel)){
      const primary=metric==='temperature'||metric==='humidity';
      const reading=this.control({name:'Status',props:{...props,
        label:primary&&unit?`${label}(${unit})`:metric==='battery'?'电量':label,
        unit:primary?undefined:unit,style:primary?'metric':'inline'}},device);
      reading.dataset.reading=metric;
      (primary?metrics:supplemental).append(reading);
    }
    if(metrics.childElementCount||supplemental.childElementCount)
      view.append(element('div','sensor-hero',metrics,supplemental.childElementCount?supplemental:null));
    if(panelLayout(device,this.panel)!=='temperature-humidity-sensor')return view;
    const card = element('section', 'sensor-history-card');
    card.dataset.historyState = this.historyLoading ? 'loading' : this.historyError ? 'error' : 'loaded';
    if (this.sensorHistory) card.dataset.fetchedAt = String(this.sensorHistory.fetchedAt);
    const displayedHistory = sensorHistorySlots(this.sensorHistory);
    for (const [name, title, unit, precision] of [['temperature', '温度', '℃', 1], ['humidity', '湿度', '%', 0]] as const) {
      const channel = this.sensorHistory?.channels.find(channel => channel.name === name);
      const slots = displayedHistory[name];
      const message = this.historyError?.message ?? channel?.error ?? (!historyExtremes(slots) ? '暂无云端记录' : undefined);
      const content=this.historyLoading&&!this.sensorHistory?deviceWait(()=>this.deviceArtwork(device),'历史数据'):message ? element('div', 'sensor-history-placeholder', message) : historyChart(slots, unit, precision);
      card.append(sensorHistoryEntry(title,content));
    }
    card.setAttribute('aria-description','显示最近24小时的云端记录；暂不含蓝牙设备内历史。');
    view.append(card);
    return view;
  }

export function outletChannelList(host: Pick<DevicePresenterHost,'panel'|'deviceArtwork'|'control'>, device: Device): HTMLElement {
    const channels = switchServices(host.panel);
    const card = element('section', 'native-card outlet-channels', element('div', 'native-card-heading', '电源'));
    for (const service of channels) {
      const property = service.properties.find(p => p.name === 'on' && p.format === 'bool');
      const label = service.name === 'air-condition-outlet' ? '插座电源' : channels.length === 1 ? '开关' : deviceServiceLabel(service);
      const row = element('div', service.name === 'air-condition-outlet' ? 'outlet-channel is-climate-relay' : 'outlet-channel', host.deviceArtwork(device), element('strong', '', label));
      row.append(host.control({ name: 'Power', props: { property, label: service.name === 'air-condition-outlet' ? label : channels.length === 1 ? device.name : service.description, compact: true } }, device));
      if (property?.lastReported) {const description=reportedValueText(property);if(description){row.setAttribute('aria-description',description);row.setAttribute('aria-description',description);row.dataset.readingSource='reported';}}
      card.append(row);
    }
    return card;
  }

export function renderOutletPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'outlet-page-content');
    view.append(productHeader(this.deviceArtwork(device,'',1,true),device.name,'outlet-hero'),outletChannelList(this,device));
    if (capabilityCategory(this.panel?.specType) === 'air-condition-outlet') {
      appendClimateMeter(this, view, device);
      return view;
    }
    if(energySupported(device,this.panel)){
      view.append(energyEntrance(this.energyData,this.panel,true,this.energyLoading));
      if(this.energyError)view.append(notice({tone:'warning',title:this.energyError.message}));
      return view;
    }
    const power = findProperty(this.panel, ['power-consumption'], ['electric-power']);
    const consumption = findProperty(this.panel, ['power-consumption'], ['power-consumption']);
    if(power||consumption)view.append(energyEntrance(undefined,this.panel,false,false));
    return view;
  }

export function nativeTemperatureControl(this: DevicePresenterHost, property: Property | undefined, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '温度调节', unit: '℃', style: 'temperature', disabledReason: disabledByPower ? '空调开启后可调节温度。' : undefined } }, device);
  }

export function nativeClimateChoices(this: DevicePresenterHost, property: Property | undefined, title: string, device: Device, disabledByPower: boolean): HTMLElement {
    const category=environmentCategory(device,this.panel);
    if((category==='air-conditioner'||category==='air-condition-outlet')&&(title==='模式'||title==='风速')){
      const kind=title==='模式'?'mode':'fan';
      const labels=kind==='mode'?['制冷','制热','送风','除湿']:['低速','中速','高速','自动'];
      const icons:IconName[]=kind==='mode'?['snowflake','sun','fan','droplet']:['fan-low','fan-medium','fan-high','refresh'];
      const options=property?.valueList??[];
      const order=(choice:typeof options[number])=>climateChoiceIndex(choice,kind);
      const unique=(choice:typeof options[number])=>{
        const rank=order(choice);
        return rank>=0&&options.filter(option=>order(option)===rank).length===1?rank:-1;
      };
      const rankFor=(description:string)=>options.find(option=>option.description===description);
      return this.control({name:'Selector',props:{property,label:title,showValue:true,choiceOrder:unique,
        choiceLabel:description=>labels[order(rankFor(description)??{description,value:null})],
        choiceIcon:description=>icons[order(rankFor(description)??{description,value:null})],
        disabledReason:disabledByPower?'设备开启后可调节。':undefined}},device);
    }
    const glyphs: Record<string, IconName> = { cool: 'snowflake', heat: 'sun', fan: 'fan', dry: 'droplet', low:'fan-low',medium:'fan-medium',high:'fan-high' };
    return this.control({ name: 'Selector', props: { property, label: title, showValue:true,
      choiceLabel:description=>property?.valueList?.find(option=>option.description===description)?.localizedDescription??climateChoiceLabel(description),
      choiceIcon: description => glyphs[description.toLowerCase().trim()], disabledReason: disabledByPower ? '设备开启后可调节。' : undefined } }, device);
  }

export function switchKeyList(): HTMLElement {
  return element('section', 'native-card switch-keys', element('div', 'native-card-heading', '按键'));
}

export function switchKeyRow(artwork: HTMLElement, name: string, subtitle: string, toggle: HTMLElement): HTMLElement {
  return element('div', 'switch-key-row', artwork,
    element('div', 'switch-key-label', element('strong', '', name), element('span', '', subtitle)), toggle);
}

export function renderSwitchPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'switch-page-content');
    const title = device.controlServiceId != null ? device.name : device.controlGroupName || device.name;
    const channelCount = splitChildren(this.snapshot?.devices ?? [], device).length || switchServices(this.panel).length || 1;
    view.append(productHeader(this.deviceArtwork(device,'',channelCount,true),title,'switch-hero'));
    const keys = switchKeyList();
    const children = splitChildren(this.snapshot?.devices ?? [], device);
    if (children.length) {
      for (const child of children) {
        const linked = child.did === this.context?.did ? this.panel : this.linkedPanels.get(child.did);
        // The parent already reads these exact service IIDs. Use that current
        // channel data while its independent child request is still pending.
        const parent=this.panel?.model===child.model?this.panel:undefined;
        const panel=linked??parent;
        const property = linked?findProperty(linked,['switch'],['on']):parent?.services.find(s=>s.name==='switch'&&s.siid===child.controlServiceId)?.properties.find(p=>p.name==='on');
        keys.append(renderSwitchKey.call(this, child, child.name, property, this.linkedErrors?.get(child.did),panel));
      }
    } else {
      const services = switchServices(this.panel);
      for (const service of services) keys.append(renderSwitchKey.call(this, device, services.length === 1 ? device.name : deviceServiceLabel(service), service.properties.find(item => item.name === 'on')));
      if (!services.length) keys.append(element('p', 'native-unavailable', '暂无可用按键'));
    }
    view.append(keys);
    return view;
  }

function renderSwitchKey(this: DevicePresenterHost, device: Device, name: string, property: Property | undefined, error?: string,panel:DevicePanel|undefined=this.panel): HTMLElement {
    const policy=switchPolicy(panel,property);
    const room=device.roomName || '未分配房间';
    const subtitle=policy.label?`${room} | 已转${policy.label}`:room;
    const toggle = this.control({ name: 'Power', props: { property, label: name, compact: true, disabledReason: error??policy.reason } }, device);
    const row = switchKeyRow(this.deviceArtwork(device,'switch-key-artwork',device.controlServiceId == null && device.model === 'linp.switch.e2db3' ? 3 : 1,true), name, subtitle, toggle);
    if(policy.label){
      row.dataset.switchMode=policy.label;
      toggle.classList.add('is-on');
      toggle.setAttribute('aria-pressed','true');
      toggle.setAttribute('aria-label',`${name}：已转${policy.label}，保持供电`);
    }
    return row;
  }

export function renderFanPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'fan-page-content');
    if(!this.panel)return view;
    const {on,mode,gear,continuous,horizontal,vertical,horizontalAngle,verticalAngle,humidity,temperature}=fanDetailBindings(device,this.panel);
    const state=booleanValue(on),disabled=!!on&&state!==true;
    view.classList.toggle('device-is-off',disabled);
    const climate = element('div', 'fan-climate');
    for (const [property,label] of [[humidity,'湿度(%)'],[temperature,'室温(℃)']] as const) {
      if(property){
        const value=numericValue(property);
        climate.append(element('div','',element('strong',value===undefined?'reading-unavailable':'',String(value??missingReadingText)),element('span','',label)));
      }
    }
    const hero=element('div',`fan-hero${climate.childElementCount?'':' fan-hero-compact'}`,
      state!==undefined?element('div','fan-big-status',state?'运行中':'关机'):null,
      climate.childElementCount?climate:null);
    if(hero.childElementCount)view.append(hero);
    if(on)view.append(this.control({name:'Power',props:{property:on,label:'电源',openLabel:'开启',closeLabel:'关闭'}},device));
    if(mode)view.append(this.control({name:'Selector',props:{property:mode,label:'模式',choiceLabel:fanModeLabel,
      choiceIcon:description=>/natural|自然/i.test(description)?'leaf':/sleep|睡眠/i.test(description)?'moon':/smart|智能|auto|自动/i.test(description)?'climate':'wind',
      disabledReason:disabled?'风扇开启后可调节模式。':undefined}},device));
    if(gear)view.append(nativeFanSpeed.call(this,gear,device,disabled));
    else if(continuous)view.append(this.nativeSlider(continuous,'风速档位',deviceUnit(continuous.unit),device,disabled,'fan'));
    for(const [property,angle,label,direction] of [[horizontal,horizontalAngle,'左右摆风','horizontal'],[vertical,verticalAngle,'上下摆风','vertical']] as const){
      if(!property)continue;
      if(angle)view.append(swingControlCard({power:property,angle,title:label,direction,locked:disabled},{
        device,busy:this.controlBusy||this.panelIsCached,
        write:(endpoint,value)=>{void this.setProperty(endpoint,value);},
        error:error=>{this.panelNotice={tone:'error',title:normalizeError(error).message};this.render();},
      },node=>this.control(node,device)));
      else view.append(this.control({name:'Power',props:{property,label,glyph:direction==='horizontal'?'swing-horizontal':'swing-vertical',
        disabledReason:disabled?'风扇开启后可调节摆风。':undefined}},device));
    }
    return view;
  }

function nativeFanSpeed(this: DevicePresenterHost, property: Property, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '风速档位', theme: 'fan', discrete: true, choiceLabel: description => description.replace(/^Level\s*(\d+)$/i, '$1档'), disabledReason: disabledByPower ? '风扇开启后可调节风速。' : undefined } }, device);
  }
