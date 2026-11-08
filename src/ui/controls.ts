import { icon, type IconName } from '../icons';
import { coercePropertyInput, reportedTime } from '../logic';
import { booleanValue, climateStepValue, controlReason, isReadableValue, numericValue, propertyReading } from '../panel-layout';
import type { Device, Json, Property } from '../types';
import { button, element } from './dom';
import {deviceChoiceLabel,devicePropertyLabel} from '../device-labels';
import {sensorStatusLabel} from '../sensor-status';

export interface ControlEnvironment {
  device: Device;
  busy: boolean;
  write: (property: Property, value: Json) => void;
  error: (error: unknown) => void;
  interactionEnded?: () => void;
}

interface BoundControl { property?: Property; label: string; disabledReason?: string }
interface PowerProps extends BoundControl {
  style: 'round' | 'wide' | 'setting';
  className?: string;
  glyph?: IconName;
  // An explicit value supports the light group's separate all-on/all-off cards.
  value?: boolean;
  openLabel?: string;
  closeLabel?: string;
  showToggle?: boolean;
}
interface SliderProps extends BoundControl {
  style?: 'temperature';
  unit?: string;
  theme?: string;
  valueProperty?: Property;
  discrete?: boolean;
  choiceLabel?: (description: string) => string;
}
interface SelectorProps extends BoundControl {
  style: 'fan' | 'p69' | 'climate' | 'standard';
  showValue?: boolean;
  choiceLabel?: (description: string) => string;
  choiceIcon?: (description: string) => IconName | undefined;
  choiceSymbol?: (description: string) => string | undefined;
}

export type ControlNode =
  | { name: 'Power'; props: PowerProps }
  | { name: 'Slider'; props: SliderProps }
  | { name: 'Selector'; props: SelectorProps }
  | { name: 'Status'; props: { property?: Property; label: string; unit?: string; precision?: number; style?: 'metric' | 'inline'; showSource?: boolean; serviceName?:string;displayValue?:string } }
  | { name: 'Container'; props: { className?: string }; items: ControlNode[] };

function bound<T extends HTMLElement>(node: T, name: string, property?: Property): T {
  node.dataset.control = name;
  if (property) { node.dataset.siid = String(property.siid); node.dataset.piid = String(property.piid); node.dataset.propertyName=property.name; }
  if(property?.pending){node.dataset.pending=property.pending;node.setAttribute('aria-busy','true');node.setAttribute('aria-description',property.pending==='uncertain'?'待确认，正在查询实际状态':'正在确认设备状态');}
  return node;
}

function reasonFor(props: BoundControl, env: ControlEnvironment): string | undefined {
  return (env.device.sharedReadOnly?'此共享设备只有查看权限。':undefined) ?? controlReason(props.property, env.device.online, env.busy) ?? props.disabledReason;
}

function renderPower(props: PowerProps, env: ControlEnvironment): HTMLElement {
  const state = booleanValue(props.property);
  const reason = reasonFor(props, env) ?? (state === undefined ? '开关状态尚未读取，请先读取状态。' : undefined);
  const label = props.value !== undefined ? props.label : state === true ? props.closeLabel ?? props.label : props.openLabel ?? props.label;
  const className = props.style === 'round' ? `native-power${state === true ? ' is-on' : ''}` : props.style === 'setting' ? `p69-setting-row${props.disabledReason ? ' control-off' : ''}` : 'native-card native-wide-power device-row-card';
  const control = button(props.style === 'round' || props.style === 'setting' ? '' : label, `${className}${props.className ? ` ${props.className}` : ''}`, () => {
    if (!control.disabled && props.property && state !== undefined) env.write(props.property, props.value ?? !state);
  }, props.style === 'setting' ? undefined : props.glyph ?? 'power');
  if (props.style === 'setting') {
    control.append(element('span', 'p69-setting-icon', props.glyph ? icon(props.glyph) : null), element('span', 'p69-setting-title', label), element('span', `p69-toggle${state === true ? ' checked' : ''}`));
  }
  else if (props.showToggle) control.append(element('span', `p69-toggle${state === true ? ' checked' : ''}`));
  control.disabled = !!reason;
  control.setAttribute('aria-label', `${props.label}：${state === undefined ? '状态未知' : state ? '已开启' : '已关闭'}`);
  if (props.value === undefined) control.setAttribute('aria-pressed', state === undefined ? 'mixed' : String(state));
  if (reason) control.setAttribute('aria-description',reason);
  return bound(control, 'Power', props.property);
}

function renderSlider(props: SliderProps, env: ControlEnvironment): HTMLElement {
  const property = props.property;
  const choices = property?.valueList ?? [];
  const discrete = props.discrete === true;
  const index = isReadableValue(property) ? choices.findIndex(choice => JSON.stringify(choice.value) === JSON.stringify(property.value)) : -1;
  const value = discrete ? index >= 0 ? index : undefined : numericValue(props.valueProperty ?? property);
  const label = (description: string): string => deviceChoiceLabel(props.choiceLabel?.(description) ?? description,`档位${choices.findIndex(c=>c.description===description)+1}`);
  const text = (input: number): string => discrete ? choices[input] ? label(choices[input].description) : '未读取' : `${input}${['%', '℃', '°'].includes(props.unit ?? '') ? '' : props.unit ? ' ' : ''}${props.unit ?? ''}`;
  const temperature = props.style === 'temperature';
  const valueClass = temperature ? 'air-temperature-value' : 'native-slider-value';
  const card = bound(element('section', `native-card ${temperature ? 'air-temperature-card' : `native-slider-card device-slider-card slider-${props.theme ?? ''}`}${props.disabledReason ? ' control-off' : ''}`, element('div', temperature ? 'air-temperature-heading' : 'native-slider-heading', element('strong', '', props.label), element('span', '', '|'), element('span', valueClass, value === undefined ? '未读取' : text(value)))), 'Slider', property);
  const reason = reasonFor(props, env);
  const range = discrete ? choices.length >= 2 && !property?.valueRange ? [0, choices.length - 1, 1] : undefined : !property?.valueList ? property?.valueRange : undefined;
  let validInput = false;
  if (property && value !== undefined) { try { coercePropertyInput(property, String(value)); validInput = true; } catch { /* Keep the actual readback; never let a range input silently round it. */ } }
  if (!property || !range || range.length !== 3 || range.some(item => !Number.isFinite(item)) || range[1] <= range[0] || range[2] <= 0 || value === undefined || value < range[0] || value > range[1] || !validInput) {
    card.append(element('p', 'native-unavailable', reason ?? (discrete ? '当前值不在设备提供的档位中，请重新读取状态。' : '设备描述未提供可用的范围或实时状态，无法显示滑杆。'))); return card;
  }
  const [min, max, step] = range;
  if(temperature)card.querySelector('.air-temperature-value')!.textContent=`${min}-${max}${props.unit??''}`;
  const slider = element('input', temperature ? 'air-temperature-slider' : `native-slider${discrete ? ' native-discrete-slider' : ''}`);
  slider.id = `slider-${property.siid}-${property.piid}`; slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = String(step); slider.value = String(value);
  slider.setAttribute('aria-label', temperature ? '目标温度' : props.label); slider.disabled = !!reason; if (reason) slider.setAttribute('aria-description',reason);
  const update = () => {
    const output = card.querySelector(temperature?'.air-temperature-current':`.${valueClass}`); if (output&&props.theme!=='curtain') output.textContent = text(Number(slider.value));
    slider.setAttribute('aria-valuetext', text(Number(slider.value)));
    const percent=Math.max(0,Math.min(100,(Number(slider.value)-min)/(max-min)*100));
    slider.style.setProperty('--fill', `${percent}%`);
    if(temperature)card.style.setProperty('--temperature-value-color',percent<25?'#777':'#fff');
    if(props.theme==='curtain'&&(!card.style.getPropertyValue('--curtain-progress')||interacting))card.style.setProperty('--curtain-progress',`${percent}%`);
  };
  slider.addEventListener('input', update);
  let interacting=false,cancelled=false,pointer:number|undefined,initialInput='',initialProgress='',interactionObserver:MutationObserver|undefined;
  const alive=():boolean=>card.isConnected&&card.contains(slider);
  const endInteraction=(cancel=false):void=>{
    if(!interacting)return;interacting=false;pointer=undefined;cancelled=cancel;delete card.dataset.interacting;
    window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('blur',blur);
    interactionObserver?.disconnect();interactionObserver=undefined;
    if(cancel&&alive()){slider.value=initialInput;slider.dispatchEvent(new Event('input'));if(props.theme==='curtain'&&initialProgress)card.style.setProperty('--curtain-progress',initialProgress);}
    requestAnimationFrame(()=>{if(alive())env.interactionEnded?.();});
  };
  const pointerUp=(event:PointerEvent)=>{if(event.pointerId===pointer)endInteraction();},blur=()=>endInteraction(true);
  slider.addEventListener('pointerdown',event=>{
    if(slider.disabled||interacting||!alive()||event.button!==0)return;
    interacting=true;cancelled=false;pointer=event.pointerId;initialInput=slider.value;initialProgress=card.style.getPropertyValue('--curtain-progress');card.dataset.interacting='true';
    window.addEventListener('pointerup',pointerUp,true);window.addEventListener('blur',blur);
    interactionObserver=new MutationObserver(()=>{if(!alive())endInteraction(true);});interactionObserver.observe(document.documentElement,{childList:true,subtree:true});
  });
  slider.addEventListener('pointerup',pointerUp);
  for(const event of ['pointercancel','lostpointercapture'])slider.addEventListener(event,e=>{if((e as PointerEvent).pointerId===pointer)endInteraction(true);});
  slider.addEventListener('keydown',()=>{if(alive()&&!slider.disabled)cancelled=false;});
  slider.addEventListener('change', () => {
    if (slider.disabled||cancelled||!alive()) return;
    try { env.write(property, coercePropertyInput(property, slider.value)); } catch (error) { env.error(error); }
  });
  if (temperature) {
    const controls = element('div', 'air-temperature-controls');
    const track=element('div','air-temperature-track',slider,element('span','air-temperature-current',text(value)));
    for (const [direction, glyph, label] of [[-1, 'minus', '降低目标温度'], [1, 'plus', '升高目标温度']] as const) {
      const stepButton = button('', 'air-temperature-step', () => {
        if (stepButton.disabled) return;
        try { env.write(property, climateStepValue(property, direction)); } catch (error) { env.error(error); }
      }, glyph);
      stepButton.setAttribute('aria-label', label);
      let atLimit = false; try { climateStepValue(property, direction); } catch { atLimit = true; }
      stepButton.disabled = !!reason || atLimit;
      if (reason) stepButton.setAttribute('aria-description',reason); else if (atLimit) stepButton.setAttribute('aria-description',direction < 0 ? '已到设备支持的最低温度。' : '已到设备支持的最高温度。');
      controls.append(stepButton); if (direction < 0) controls.append(track);
    }
    card.append(controls);
  }
  else if(props.theme==='curtain'){
    const surface=element('div','curtain-slider-surface',element('span','curtain-slider-panel curtain-slider-left',element('i','curtain-slider-handle')),element('span','curtain-slider-panel curtain-slider-right',element('i','curtain-slider-handle')));
    surface.setAttribute('aria-hidden','true');const track=element('div','curtain-slider-track',surface,slider);card.append(track);
    // Both halves represent the same opening: centre is closed, either end is
    // open. Keep the native range for keyboard and assistive-technology input.
    const point=(x:number)=>{const rect=track.getBoundingClientRect(),handle=surface.querySelector<HTMLElement>('.curtain-slider-handle')!.getBoundingClientRect(),shown=parseFloat(card.style.getPropertyValue('--curtain-progress'))/100,inset=Math.abs(handle.x+handle.width/2-rect.x-rect.width/2)-shown*rect.width*.42,opening=Math.min(1,Math.max(0,(Math.abs(x-rect.x-rect.width/2)-inset)/(rect.width*.42))),value=min+opening*(max-min);slider.value=String(Math.min(max,Math.max(min,min+Math.round((value-min)/step)*step)));slider.dispatchEvent(new Event('input',{bubbles:true}));};
    let dragPointer:number|undefined;
    slider.addEventListener('pointerdown',event=>{if(slider.disabled||event.button!==0)return;dragPointer=event.pointerId;event.preventDefault();slider.focus({preventScroll:true});slider.setPointerCapture(event.pointerId);point(event.clientX);});
    slider.addEventListener('pointermove',event=>{if(interacting&&event.pointerId===pointer&&!slider.disabled){event.preventDefault();point(event.clientX);}});
    slider.addEventListener('pointerup',event=>{if(event.pointerId!==dragPointer)return;dragPointer=undefined;if(slider.disabled||cancelled||event.button!==0)return;point(event.clientX);slider.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  else if (props.theme === 'brightness') card.append(element('div', 'brightness-track', slider, element('span', 'brightness-endpoint brightness-min', icon('light')), element('span', 'brightness-endpoint brightness-max', icon('sun'))));
  else card.append(slider);
  if (discrete) card.append(element('div', 'fan-speed-labels', ...choices.map(choice => element('span', '', label(choice.description)))));
  const limitation = controlReason(property, env.device.online, env.busy);
  update(); if (limitation && !env.busy) card.append(element('p', 'native-unavailable', limitation));
  return card;
}

const selectorStyles = {
  fan: { card: 'fan-modes', grid: 'fan-mode-choices', item: 'fan-mode', symbol: '', text: '' },
  p69: { card: 'p69-choice-card', grid: 'p69-choice-grid', item: 'p69-choice', symbol: 'p69-choice-symbol', text: 'p69-choice-label' },
  climate: { card: 'air-choices-card', grid: 'air-choices', item: 'air-choice', symbol: 'air-choice-symbol', text: 'air-choice-label' },
  standard: { card: 'p69-choice-card', grid: 'p69-choice-grid', item: 'p69-choice', symbol: 'p69-choice-symbol', text: 'p69-choice-label' },
};

function renderSelector(props: SelectorProps, env: ControlEnvironment): HTMLElement {
  const property = props.property;
  const current = isReadableValue(property) ? property.valueList?.find(choice => JSON.stringify(choice.value) === JSON.stringify(property.value)) : undefined;
  const style = selectorStyles[props.style];
  const label = (description: string): string => {const translated=props.choiceLabel?.(description)??description,fallback=`选项${(property?.valueList?.findIndex(c=>c.description===description)??0)+1}`;return translated==='未识别状态'?fallback:deviceChoiceLabel(translated,fallback);};
  const heading = element('h3', '', props.style === 'p69' || props.style === 'standard' ? element('strong', '', props.label) : props.label);
  if (props.showValue) heading.append(element('span', '', '|'), element('span', '', current ? label(current.description) : '未读取'));
  const card = bound(element('section', `native-card ${style.card}${props.disabledReason ? ' control-off' : ''}`, heading), 'Selector', property);
  const limitation = (env.device.sharedReadOnly?'此共享设备只有查看权限。':undefined) ?? controlReason(property, env.device.online, env.busy) ?? (!current ? '当前值不在设备提供的选项中，请重新读取状态。' : undefined);
  const reason = limitation ?? props.disabledReason;
  if (!property?.valueList?.length) { card.append(element('p', 'native-unavailable', reason ?? '设备描述未提供可用的选项。')); return card; }
  const grid = element('div', style.grid); grid.style.setProperty('--choices', String(property.valueList.length));
  for (const option of property.valueList) {
    const selected = !!current && JSON.stringify(current.value) === JSON.stringify(option.value);
    const choice = button('', `${style.item}${selected ? ' selected' : ''}`, () => { if (!choice.disabled) env.write(property, option.value); });
    const glyph = props.choiceIcon?.(option.description); const text = props.choiceSymbol?.(option.description);
    const symbol = element('span', style.symbol);
    if (glyph) symbol.append(icon(glyph)); else if (text) symbol.append(element('span', props.style === 'climate' ? 'air-speed-symbol' : 'p69-gear-number', text));
    else symbol.append(element('span', 'selector-text-symbol', label(option.description)));
    if (props.style === 'fan' && glyph) choice.append(icon(glyph)); else choice.append(symbol);
    choice.append(element('span', style.text, label(option.description)));
    choice.disabled = !!reason; choice.setAttribute('aria-label', `${props.label}：${label(option.description)}`); choice.setAttribute('aria-pressed', String(selected));
    if (reason) choice.setAttribute('aria-description',reason);
    grid.append(choice);
  }
  card.append(grid); if (limitation && !env.busy) card.append(element('p', 'native-unavailable', limitation));
  return card;
}

// Category templates declare a tree of named controls. All brands share the
// same implementations, validation and property binding; visual profiles are props.
export function renderControl(node: ControlNode, env: ControlEnvironment): HTMLElement {
  switch (node.name) {
    case 'Power': return renderPower(node.props, env);
    case 'Slider': return renderSlider(node.props, env);
    case 'Selector': return renderSelector(node.props, env);
    case 'Status': {
      const { property, label, unit, precision, style } = node.props;
      const reading = propertyReading(property);
      let value = property?.code!=null&&property.code!==0?'暂不可用':'暂无数据';
      if (typeof reading.value === 'number' && Number.isFinite(reading.value)) value = precision == null ? String(reading.value) : reading.value.toFixed(precision);
      else if (typeof reading.value === 'boolean') value = reading.value ? '开启' : '关闭';
      else if (typeof reading.value === 'string') value = reading.value.trim()||'暂无数据';
      if(property&&reading.source!=='missing'){
        const choice=property.valueList?.find(choice=>JSON.stringify(choice.value)===JSON.stringify(reading.value));
        if(choice)value=deviceChoiceLabel(choice.description,`状态${property.valueList!.indexOf(choice)+1}`,['status','fault'].includes(property.name)?'state':undefined);
        else value=sensorStatusLabel(node.props.serviceName,property,reading.value)??(typeof reading.value==='string'&&['status','fault','mode','occupancy-status','contact-state','charging-state','playing-state'].includes(property.name)?deviceChoiceLabel(reading.value,undefined,['status','fault'].includes(property.name)?'state':undefined):value);
      }
      const view = bound(element('section', style ? `reading-${style}` : 'native-card reading-card', element('div', 'reading-value', node.props.displayValue??value, unit && typeof reading.value==='number' ? element('span', 'reading-unit', unit) : null), element('h3', '', property?devicePropertyLabel(property,label):label)), 'Status', property);
      view.dataset.valueKind = typeof reading.value === 'number' ? 'number' : 'text';
      if(node.props.serviceName==='magnet-sensor'&&property?.name==='contact-state')view.dataset.readingPresentation='metric';
      view.dataset.readingSource = reading.source;
      const description=reading.source==='reported'&&property?`云端记录 · ${reportedTime(property)}`:reading.source==='missing'?(property?.code!=null&&property.code!==0?`实时读取失败（${property.code}）`:'状态未读取'):undefined;
      if(description)view.setAttribute('aria-description',description);
      return view;
    }
    case 'Container': return element('div', node.props.className ?? '', ...node.items.map(item => renderControl(item, env)));
  }
}
