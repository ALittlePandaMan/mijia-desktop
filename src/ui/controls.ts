import { bathModeIcon, icon, type IconName } from '../icons';
import { coercePropertyInput, missingReadingText, reportedTime } from '../logic';
import { booleanValue, climateStepValue, controlReason, isReadableValue, numericValue, propertyReading } from '../panel-layout';
import type { CurtainOpening, Device, Json, Property } from '../types';
import { element } from './dom';
import { controlHeading } from './control-heading';
import { modeCard } from './mode-card';
import { powerCard, roundPowerButton } from './power-button';
import {deviceChoiceLabel,deviceModeLabel,devicePropertyLabel} from '../device-labels';
import {validChoices,validRange} from '../device-capabilities';
import {sensorStatusLabel} from '../sensor-status';
import {bindRangeInteraction,brightnessSurface,curtainSliderSurface,setRangeReadout,temperatureSurface,type BrightnessTone} from './adjustment-surfaces';

export interface ControlEnvironment {
  device: Device;
  busy: boolean;
  write: (property: Property, value: Json) => void;
  error: (error: unknown) => void;
  interactionEnded?: () => void;
}

interface BoundControl { property?: Property; label: string; disabledReason?: string; locked?:boolean }
interface PowerProps extends BoundControl {
  compact?: boolean;
  className?: string;
  glyph?: IconName;
  // An explicit value supports the light group's separate all-on/all-off cards.
  value?: boolean;
  values?: readonly [Json,Json];
  openLabel?: string;
  closeLabel?: string;
}
interface SliderProps extends BoundControl {
  style?: 'temperature';
  unit?: string;
  theme?: string;
  curtainOpening?: CurtainOpening;
  brightnessTone?: BrightnessTone;
  endpoints?: readonly [IconName,IconName];
  valueProperty?: Property;
  discrete?: boolean;
  choiceLabel?: (description: string) => string;
  previewValue?: (value: number | undefined) => void;
}
interface SelectorProps extends BoundControl {
  showValue?: boolean;
  choiceLabel?: (description: string) => string;
  choiceVisible?: (description: string) => boolean;
  choiceOrder?: (choice: NonNullable<Property['valueList']>[number]) => number;
  choiceIcon?: (description: string, selected: boolean) => IconName | undefined;
  choiceSymbol?: (description: string) => string | undefined;
}
export interface StatusProps {
  property?: Property;
  label: string;
  unit?: string;
  precision?: number;
  style?: 'metric' | 'inline';
  serviceName?: string;
  displayValue?: string;
}

export type ControlNode =
  | { name: 'Power'; props: PowerProps }
  | { name: 'Slider'; props: SliderProps }
  | { name: 'Selector'; props: SelectorProps }
  | { name: 'Status'; props: StatusProps }
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
  const reading=isReadableValue(props.property)?props.property.value:undefined;
  const state=props.values?reading===props.values[1]?true:reading===props.values[0]?false:undefined:booleanValue(props.property);
  const reason = reasonFor(props, env);
  const label = props.value !== undefined || state === undefined ? props.label : state ? props.closeLabel ?? props.label : props.openLabel ?? props.label;
  const wholeCard = props.value !== undefined && !props.compact;
  const control = roundPowerButton({
    label: props.value !== undefined || state === undefined ? label : `${label}：${state ? '已开启' : '已关闭'}`,
    graphic: icon(props.glyph ?? 'power'),
    on: props.value ?? state,
    pressed: props.value === undefined ? state ?? 'mixed' : undefined,
    className: props.className,
    wholeCard,
    press: !reason && !props.locked && props.property && state !== undefined
      ? () => env.write(props.property!, props.values ? props.values[state ? 0 : 1] : props.value ?? !state)
      : undefined,
  });
  if (reason && state !== undefined) control.setAttribute('aria-description', reason);
  bound(control, 'Power', props.property);
  return props.compact || wholeCard ? control : powerCard(label, control);
}

function renderSlider(props: SliderProps, env: ControlEnvironment): HTMLElement {
  const property = props.property;
  const choices = property?.valueList ?? [];
  const discrete = props.discrete === true;
  const index = isReadableValue(property) ? choices.findIndex(choice => JSON.stringify(choice.value) === JSON.stringify(property.value)) : -1;
  const value = discrete ? index >= 0 ? index : undefined : numericValue(props.valueProperty ?? property);
  const label = (description: string): string => deviceChoiceLabel(props.choiceLabel?.(description) ?? description,`档位${choices.findIndex(c=>c.description===description)+1}`);
  const text = (input: number): string => discrete ? choices[input] ? label(choices[input].description) : '' : `${input}${['%', '℃', '°', '档'].includes(props.unit ?? '') ? '' : props.unit ? ' ' : ''}${props.unit ?? ''}`;
  const temperature = props.style === 'temperature';
  const illumination = props.theme === 'illumination';
  const roundThumb = illumination || props.theme === 'temperature';
  const readingText = (input: number): string => `${illumination ? '亮度' : ''}${text(input)}`;
  const reason = reasonFor(props, env);
  const range = property && (discrete
    ? choices.length >= 2 && validChoices(property) ? [0, choices.length - 1, 1] : undefined
    : validRange(property) ? property.valueRange : undefined);
  let validInput = false;
  if (property && value !== undefined) { try { coercePropertyInput(property, String(value)); validInput = true; } catch { /* Keep the actual readback; never let a range input silently round it. */ } }
  const usable = property && range && value !== undefined && value >= range[0] && value <= range[1] && validInput;
  const heading = controlHeading(props.label, {
    className: temperature ? 'air-temperature-heading' : 'native-slider-heading',
    valueClass: temperature ? 'air-temperature-value' : 'native-slider-value',
    separator: !illumination,
  });
  if (usable) heading.setValue(temperature ? `${range[0]}-${range[1]}${props.unit ?? ''}` : readingText(value));
  const theme = props.theme ?? (property && ['target-humidity','relative-humidity','humidity'].includes(property.name) ? 'humidity' : '');
  const card = bound(element('section', `native-card ${temperature ? 'air-temperature-card' : `native-slider-card device-slider-card slider-${theme}`}${props.disabledReason ? ' control-off' : ''}`, heading.root), 'Slider', property);
  if (!property || !range) return card;

  const slider = element('input', temperature || props.theme==='curtain' ? '' : `native-slider${discrete ? ' native-discrete-slider' : ''}${roundThumb ? ' round-thumb-slider' : ''}`);
  slider.type = 'range'; slider.setAttribute('aria-label', illumination ? '照明亮度' : props.label); slider.disabled = !usable || !!reason || !!props.locked;
  slider.id = `slider-${property.siid}-${property.piid}`;
  if (reason && usable) slider.setAttribute('aria-description',reason);
  const [min, max, step] = range;
  slider.min = String(min); slider.max = String(max); slider.step = String(step);
  if (temperature) {
    const surface=temperatureSurface(slider,usable&&!slider.disabled?element('span','',text(value)):null,direction=>{
      try { env.write(property, climateStepValue(property, direction)); } catch (error) { env.error(error); }
    });
    for (const [index,direction] of ([-1,1] as const).entries()) {
      const stepButton=surface.buttons[index];
      let atLimit=false;
      if(usable&&!slider.disabled)try { climateStepValue(property, direction); } catch { atLimit=true; }
      stepButton.disabled=slider.disabled||atLimit;
    }
    card.append(surface.root);
  }
  const track = illumination ? element('div', 'illumination-track', slider) : slider;
  let gesture: ReturnType<typeof bindRangeInteraction> | undefined;
  if (!usable) {
    setRangeReadout(slider);
  } else {
    slider.value = String(value);
    let initialProgress = '';
    const output = temperature ? card.querySelector('.air-temperature-current') : null;
    const update = (fromInput: boolean) => {
      const value=Number(slider.value),label=text(value);
      if (output) output.textContent = label;
      if (!temperature) heading.setValue(readingText(value));
      setRangeReadout(slider, label);
      const progress=Math.max(0,Math.min(1,(value-min)/(max-min)));
      const percent=progress*100;
      if(illumination)track.style.setProperty('--illumination-progress',String(progress));
      else slider.style.setProperty('--fill', `${percent}%`);
      if(temperature)card.style.setProperty('--temperature-value-color',percent<25?'var(--text-secondary,#777)':'var(--on-color,#fff)');
      if(props.theme==='curtain'&&(fromInput||!card.style.getPropertyValue('--curtain-progress')))card.style.setProperty('--curtain-progress',`${percent}%`);
      if(fromInput)props.previewValue?.(value);
    };
    gesture = bindRangeInteraction(slider, card, {
      preview: update,
      start: () => { initialProgress = card.style.getPropertyValue('--curtain-progress'); },
      restore: () => {
        if(props.theme==='curtain'&&initialProgress)card.style.setProperty('--curtain-progress',initialProgress);
        props.previewValue?.(undefined);
      },
      commit: () => {
        try { env.write(property, coercePropertyInput(property, slider.value)); } catch (error) { env.error(error); }
      },
      ended: env.interactionEnded,
    });
    update(false);
  }
  if (props.theme === 'curtain') card.append(curtainSliderSurface(slider, () => gesture?.allowed() ?? false, props.curtainOpening));
  else if (props.theme === 'brightness') card.append(brightnessSurface(slider, props.brightnessTone, props.endpoints));
  else if (!temperature) card.append(track);
  return card;
}

function selectorIcon(description:string,caption:string):IconName{
  const label=`${description} ${caption}`;
  if(/定时|倒计时|预约|timer|timing|schedule|countdown/i.test(label))return 'clock';
  if(/防冻|制冷|冷风|freeze|cool|frost/i.test(label))return 'snowflake';
  if(/烘干|快干|快烘|柔烘|dry|baking/i.test(label))return 'wind';
  if(/加热|恒温|取暖|暖风|采暖|heat|warm|maintain/i.test(label))return 'sun';
  if(/节能|省电|eco|energy/i.test(label))return 'leaf';
  if(/睡眠|静音|sleep|silent|quiet/i.test(label))return 'moon';
  if(/除湿|加湿|湿润|humid/i.test(label))return 'droplet';
  if(/送风|循环风|风速|fan|wind/i.test(label))return 'fan';
  if(/关闭|停止|\boff\b|\bstop\b/i.test(label))return 'power';
  if(/智能|自动|smart|auto/i.test(label))return 'refresh';
  return 'menu';
}

function renderSelector(props: SelectorProps, env: ControlEnvironment): HTMLElement {
  const property = props.property;
  if(property&&!props.choiceVisible&&!props.choiceOrder&&validChoices(property)&&property.valueList!.length>1
    &&property.valueList!.every(choice=>typeof choice.value==='number')
    &&(/^(fan-level|fan-speed|wind-speed|speed-level|drying-level|ventilation-level|ventilate-level|ventilate-gear|blow-level)$/.test(property.name)
      ||/^(风速(?:档位|挡位)?|风量(?:档位|挡位)?|(?:换气|吹风|烘干)(?:档位|挡位))$/.test(props.label))){
    return renderSlider({property,label:props.label==='风速'?'风速档位':props.label,theme:'fan',discrete:true,
      disabledReason:props.disabledReason,locked:props.locked,
      choiceLabel:description=>props.choiceLabel?.(description)??property.valueList!.find(choice=>choice.description===description)?.localizedDescription??description},env);
  }
  const current = isReadableValue(property) ? property.valueList?.find(choice => JSON.stringify(choice.value) === JSON.stringify(property.value)) : undefined;
  const mode=/(?:^|-)mode$|^(?:program|washing-program)$/.test(property?.name??'')||/(模式|程序)$/.test(props.label);
  const label = (option:NonNullable<Property['valueList']>[number],index:number): string|undefined => {
    const translated=props.choiceLabel?.(option.description);
    if(mode)return deviceModeLabel(translated,option.localizedDescription,option.description);
    const fallback=`选项${index+1}`;
    return translated&&translated!=='未识别状态'?translated:deviceChoiceLabel(option.localizedDescription??option.description,fallback);
  };
  const caption = props.showValue && current && (!props.choiceOrder || props.choiceOrder(current) >= 0)
    ? label(current, property?.valueList?.indexOf(current) ?? 0) ?? '未识别模式'
    : undefined;
  const limitation = (env.device.sharedReadOnly ? '此共享设备只有查看权限。' : undefined)
    ?? controlReason(property, env.device.online, env.busy);
  const reason = limitation ?? props.disabledReason;
  const wrap = (card: HTMLElement) => {
    if (props.disabledReason) card.classList.add('control-off');
    return bound(card, 'Selector', property);
  };
  if (!property?.valueList?.length) {
    const card = wrap(modeCard(props.label, [], caption));
    card.setAttribute('aria-description', reason ?? '设备描述未提供可用的选项。');
    return card;
  }
  const order=props.choiceOrder;
  const choices=property.valueList.flatMap((option,index)=>{
    const caption=label(option,index);
    return caption&&(!order||order(option)>=0)&&(props.choiceVisible?.(option.description)??true)?[{option,caption}]:[];
  });
  if(order)choices.sort((a,b)=>order(a.option)-order(b.option));
  return wrap(modeCard(props.label, choices.map(({option, caption}) => {
    const selected = option === current;
    const glyph = props.choiceIcon?.(option.description, selected);
    const symbol = props.choiceSymbol?.(option.description);
    return {
      label: caption,
      ariaLabel: `${props.label}：${caption}`,
      focusKey: `choice-${property.siid}-${property.piid}-${JSON.stringify(option.value)}`,
      graphic: glyph?.startsWith('bath:') ? bathModeIcon(glyph.split(':')[1], selected)
        : glyph || !symbol ? icon(glyph ?? selectorIcon(option.description, caption)) : element('span', 'air-speed-symbol', symbol),
      selected,
      press: !current || reason || props.locked ? undefined : () => env.write(property, option.value),
      decorate: current && reason ? choice => choice.setAttribute('aria-description', reason) : undefined,
    };
  }), caption));
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
      let value = missingReadingText;
      if (typeof reading.value === 'number' && Number.isFinite(reading.value)) value = precision == null ? String(reading.value) : reading.value.toFixed(precision);
      else if (typeof reading.value === 'boolean') value = reading.value ? '开启' : '关闭';
      else if (typeof reading.value === 'string') value = reading.value.trim() || missingReadingText;
      if(property&&reading.source!=='missing'){
        const choice=property.valueList?.find(choice=>JSON.stringify(choice.value)===JSON.stringify(reading.value));
        if(choice)value=deviceChoiceLabel(choice.description,`状态${property.valueList!.indexOf(choice)+1}`,['status','fault'].includes(property.name)?'state':undefined);
        else value=sensorStatusLabel(node.props.serviceName,property,reading.value)??(typeof reading.value==='string'&&['status','fault','mode','occupancy-status','contact-state','charging-state','playing-state'].includes(property.name)?deviceChoiceLabel(reading.value,undefined,['status','fault'].includes(property.name)?'state':undefined):value);
      }
      const displayed = node.props.displayValue ?? value;
      const missing = displayed === missingReadingText;
      const output = element('div', missing ? 'reading-value reading-unavailable' : 'reading-value',
        displayed, !missing && unit && typeof reading.value === 'number' ? element('span', 'reading-unit', unit) : null);
      const view = bound(element('section', style ? `reading-${style}` : 'native-card reading-card', output,
        element('h3', '', property ? devicePropertyLabel(property, label) : label)), 'Status', property);
      view.dataset.valueKind = typeof reading.value === 'number' || missing && !!unit ? 'number' : 'text';
      view.dataset.readingSource = reading.source;
      const description=reading.source==='reported'&&property?`云端记录 · ${reportedTime(property)}`:reading.source==='recent'?'最近一次读取':undefined;
      if(description)view.setAttribute('aria-description',description);
      return view;
    }
    case 'Container': return element('div', node.props.className ?? '', ...node.items.map(item => renderControl(item, env)));
  }
}
