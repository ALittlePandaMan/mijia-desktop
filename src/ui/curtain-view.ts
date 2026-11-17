import type {Device,DevicePanel,Json,Property} from '../types';
import {findProperty,enumValue,controlReason} from '../panel-layout';
import {button,element} from './dom';
/** The desktop curtain's drawing and transport, with no motion or IPC owner. */
export function curtainView(o:{device:Device;panel?:DevicePanel;busy:boolean;cached:boolean;write:(property:Property,value:Json,meaning:'open'|'pause'|'close')=>void}):{view:HTMLElement;backdrop:HTMLElement;controls:HTMLElement}{
 const motor=findProperty(o.panel,['curtain'],['motor-control']),target=findProperty(o.panel,['curtain'],['target-position']);
 const view=element('div','curtain-page-content'),backdrop=element('div','curtain-drawing',element('div','curtain-fabric curtain-left'),element('div','curtain-fabric curtain-right'));
 const controls=element('section','native-card curtain-transport');
 for(const [label,meaning,glyph] of [['打开','open','curtain-open'],['暂停','pause','pause'],['关闭','close','curtain-close']] as const){
  const endpoint=o.device.model==='xiaomi.curtain.acn009'&&meaning!=='pause'?target:motor;
  const desired=endpoint===target?(meaning==='open'?100:0):enumValue(motor,meaning);
  const reason=(o.device.sharedReadOnly?'此共享设备仅有读取权限。':undefined)??controlReason(endpoint,o.device.online,o.busy||o.cached)??(desired===undefined?'设备描述未提供对应的窗帘控制枚举。':undefined);
  const control=button(label,'curtain-command',()=>{if(!control.disabled&&endpoint&&desired!==undefined)o.write(endpoint,desired as Json,meaning);},glyph);control.disabled=!!reason;if(reason)control.setAttribute('aria-description',reason);controls.append(control);
 }
 view.append(backdrop,controls);return {view,backdrop,controls};
}
