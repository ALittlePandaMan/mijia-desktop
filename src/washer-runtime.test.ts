import {describe,it,expect,vi} from 'vitest';
import {WasherRuntimeCommands,type WasherRuntimeControl} from './washer-runtime';
import type {ControlResult,DeviceContext,DevicePanel} from './types';
const context:DeviceContext={homeId:'h',generation:1,did:'washer'};
const panel:DevicePanel={did:'washer',model:'midjd8.washer.42',services:[]};
const pause:WasherRuntimeControl={key:'pause',label:'暂停',kind:'action',siid:2,aiid:3,piid:null,value:null,enabled:true,reason:null,confirmation:null};
function setup(){const transport={action:vi.fn<(c:DeviceContext,s:number,a:number,inputs:unknown[])=>Promise<ControlResult>>(),write:vi.fn<(c:DeviceContext,s:number,p:number,value:unknown)=>Promise<ControlResult>>(),read:vi.fn<(c:DeviceContext)=>Promise<DevicePanel>>()},accept=vi.fn(),failed=vi.fn();const commands=new WasherRuntimeCommands(transport,vi.fn(),accept,failed);commands.bind(context,'account');return{commands,transport,accept,failed};}
describe('washer runtime one-shot UI commands',()=>{
 it('blocks another send while pending and after uncertain return until an explicit read',async()=>{
  const{commands,transport}=setup();let resolve!:(value:ControlResult)=>void;transport.action.mockImplementation(()=>new Promise(r=>{resolve=r;}));const pending=commands.execute(context,pause);expect(commands.pending).toBe(true);await commands.execute(context,pause);expect(transport.action).toHaveBeenCalledTimes(1);resolve({verified:false,message:'未确认',panel});await pending;expect(commands.blocked).toBe(true);commands.bind({...context,generation:2},'account');expect(commands.blocked).toBe(true);await commands.execute({...context,generation:2},pause);expect(transport.action).toHaveBeenCalledTimes(1);transport.read.mockResolvedValue(panel);await commands.refresh({...context,generation:2});expect(commands.blocked).toBe(false);expect(transport.read).toHaveBeenCalledTimes(1);expect(transport.action).toHaveBeenCalledWith(context,2,3,[]);
 });
 it('accepts a verified native result without inventing progress or sending a follow-up action',async()=>{
  const{commands,transport,accept}=setup();transport.action.mockResolvedValue({verified:true,message:'已回读',panel});await commands.execute(context,pause);expect(commands.blocked).toBe(false);expect(commands.message).toBe('已回读');expect(accept).toHaveBeenCalledWith(context,panel);expect(transport.action).toHaveBeenCalledTimes(1);
 });
 it('uses the exact native property binding for cancellation and leaves confirmation to Rust',async()=>{
  const{commands,transport}=setup();transport.write.mockResolvedValue({verified:false,message:'预约仍未确认',panel});await commands.execute(context,{...pause,key:'cancel',kind:'property',piid:1,aiid:null,value:false});expect(transport.write).toHaveBeenCalledWith(context,2,1,false);expect(transport.action).not.toHaveBeenCalled();expect(commands.blocked).toBe(true);
 });
 it('wrong-device replies and failed refreshes remain blocked instead of implying success',async()=>{
  const{commands,transport,accept}=setup();transport.action.mockResolvedValue({verified:true,message:'ok',panel:{...panel,did:'other'}});await commands.execute(context,pause);expect(commands.blocked).toBe(true);expect(accept).not.toHaveBeenCalled();transport.read.mockRejectedValue(Error('offline'));await commands.refresh(context);expect(commands.blocked).toBe(true);expect(commands.message).toBe('offline');
 });
 it('late results and expired sessions cannot update or log out a different active account',async()=>{
  const{commands,transport,accept,failed}=setup();let reject!:(e:unknown)=>void;transport.action.mockImplementation(()=>new Promise((_,r)=>{reject=r;}));const pending=commands.execute(context,pause);commands.bind({...context,homeId:'other'},'new-account');reject({kind:'authExpired',message:'expired'});await pending;expect(accept).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();expect(commands.blocked).toBe(false);
 });
});
