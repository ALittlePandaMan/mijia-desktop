import type {Device,DevicePanel,Json,Property} from '../types';
import {controlReason} from '../panel-layout';
import {curtainBindings,curtainCommand,type CurtainCommand} from '../curtain-detail';
import {icon} from '../icons';
import {element} from './dom';
import {modeOptionButton} from './mode-card';

export function curtainTransport(o:{device:Device;locked:boolean;label:string;active?:CurtainCommand;scope?:number;
 command:(meaning:CurtainCommand)=>{property:Property;value:Json}|undefined;
 write:(property:Property,value:Json,meaning:CurtainCommand)=>void}):HTMLElement{
 const controls=element('section','native-card curtain-transport');
 controls.setAttribute('aria-label',o.label);
 for(const [label,meaning,glyph] of [['打开','open','curtain-open'],['暂停','pause','pause'],['关闭','close','curtain-close']] as const){
  const command=o.command(meaning);
  if(!command)continue;
  const disabled=o.device.sharedReadOnly||controlReason(command.property,o.device.online,o.locked);
  controls.append(modeOptionButton({
   label,graphic:icon(glyph),selected:o.active===meaning,focusKey:o.scope===undefined?`curtain-${meaning}`:`window-${o.scope}-${meaning}`,
   press:disabled?undefined:()=>o.write(command.property,command.value,meaning),
   decorate:control=>control.classList.add('curtain-command'),
  }));
 }
 return controls;
}
/** The desktop curtain's drawing and transport, with no motion or IPC owner. */
export function curtainView(o:{device:Device;panel?:DevicePanel;busy:boolean;cached:boolean;active?:CurtainCommand;write:(property:Property,value:Json,meaning:CurtainCommand)=>void}):{view:HTMLElement;backdrop:HTMLElement;controls:HTMLElement}{
 const bindings=curtainBindings(o.panel,o.device.controlServiceId);
 const view=element('div','curtain-page-content'),backdrop=element('div','curtain-drawing',element('div','curtain-fabric curtain-left'),element('div','curtain-fabric curtain-right'));
 backdrop.dataset.curtainOpening=bindings?.opening??'double';
 const controls=curtainTransport({device:o.device,locked:o.busy||o.cached,label:'窗帘开合控制',active:o.active,
  command:meaning=>curtainCommand(bindings,meaning),write:o.write});
 view.append(backdrop);if(controls.childElementCount)view.append(controls);return {view,backdrop,controls};
}
