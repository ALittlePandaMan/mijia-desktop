import {describe,expect,it} from 'vitest';
import {cardActive,cardCaption,cardDisplay,cardIntent,cardReportedIntent} from './home-cards';
import type {Device,HomeCardEntry} from './types';
const device:Device={did:'d',name:'Outlet',model:'fixture.only',online:true,roomId:'r',roomName:'Room'};
const card:HomeCardEntry={did:'d',kind:'power',selected:false,visible:true,highlight:false,enabled:true,reason:null,binding:{siid:2,piid:1},action:'on',cardType:1};
describe('official homepage state presentation',()=>{
  it('keeps switch captions to actual relay states, including cached mode migration',()=>{
    const sw={...device,model:'yeelink.switch.ylsw6'};
    expect(cardCaption(sw,'厨房',[{did:device.did,text:'无线开关 1路 · 灵动开关 2路'}])).toBe('厨房');
    expect(cardCaption(sw,'厨房',[{did:device.did,text:'开关关'}])).toBe('厨房 | 开 关 关');
    expect(cardCaption(sw,'厨房',[{did:device.did,text:'关 关 关'}])).toBe('厨房 | 关 关 关');
  });
  it('shows a device reading only when it belongs to this online device, with no online placeholder or dangling separator',()=>{
    expect(cardCaption(device,'客厅')).toBe('客厅');
    expect(cardCaption(device,'客厅',[{did:'another',text:'连接设备数 35'}])).toBe('客厅');
    expect(cardCaption(device,'餐厅',[{did:'d',text:'常温温度 25.0℃'}])).toBe('餐厅 | 常温温度 25.0℃');
    expect(cardCaption(device,'客厅',[{did:'d',text:'  '}])).toBe('客厅');
    expect(cardCaption({...device,online:false},'客厅',[{did:'d',text:'连接设备数 35'}])).toBe('客厅 | 离线');
  });
  it('never treats online or an unknown read as powered on',()=>{
    expect(cardActive(undefined,device)).toBe(false);
    const unknown=cardDisplay({...card,selected:null,enabled:false},device,null);
    expect(unknown.selected).toBe(null);expect(cardActive(unknown,device)).toBe(false);
  });
  it('optimistically changes only a supported power card and keeps the desired intent explicit',()=>{
    const on=cardDisplay(card,device,'on',true);expect(cardActive(on,device)).toBe(true);expect(cardIntent(on)).toBe('off');
    const off=cardDisplay(on,device,'off',true);expect(cardActive(off,device)).toBe(false);expect(cardIntent(off)).toBe('on');
    expect(cardReportedIntent(card)).toBe('off');expect(card.selected).toBe(false);
  });
  it('gate, connectivity and shared permission suppress highlight independently of the last power value',()=>{
    for(const value of [{...card,enabled:false},{...card,visible:false}])expect(cardActive(cardDisplay(value,device,'on'),device)).toBe(false);
    for(const target of [{...device,online:false},{...device,sharedReadOnly:true}]){
      const hidden=cardDisplay(card,target,'on');expect(hidden.visible).toBe(false);expect(hidden.enabled).toBe(false);expect(cardActive(hidden,target)).toBe(false);
    }
  });
  it('curtain position and a pending motor action never produce a power highlight',()=>{
    const curtain={...card,kind:'curtain' as const,selected:true,action:'close' as const,cardType:3};
    const moving=cardDisplay(curtain,device,'open',true);
    expect(cardActive(moving,device)).toBe(false);expect(cardIntent(moving)).toBe('pause');expect(cardReportedIntent(curtain)).toBe(null);
  });
});
