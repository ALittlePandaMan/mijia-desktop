import {describe,expect,it,vi} from 'vitest';
import {WasherCommands,type WasherCommandResult,type WasherProgramPreview} from './washer-commands';
import type {DeviceContext,DevicePanel} from './types';
import type {WasherDraft} from './washer';
const context:DeviceContext={homeId:'home',generation:3,did:'washer'};
const draft:WasherDraft={program:'smart',values:{temperature:40,night:false}};
const panel:DevicePanel={did:'washer',model:'midjd8.washer.42',services:[]};
const preview:WasherProgramPreview={panel,estimatedMinutes:42,canStart:true,reason:null,requestId:null};
const result:WasherCommandResult={status:'confirmed',phase:'start',message:'已回读确认',panel};
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;return{promise:new Promise<T>((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
function fixture(){const transport={preview:vi.fn().mockResolvedValue(preview),start:vi.fn().mockResolvedValue(result),confirm:vi.fn().mockResolvedValue(result)},accept=vi.fn(),failed=vi.fn(),changed=vi.fn(),ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];return{transport,accept,failed,state:new WasherCommands(transport,changed,accept,failed,()=>ids.shift()!)};}
describe('washer local drafts and one-shot command lifecycle',()=>{
 it('ignores obsolete preview and reply after the device is closed',async()=>{
  const{transport,state,accept}=fixture(),old=deferred<WasherProgramPreview>();transport.preview.mockReturnValueOnce(old.promise);
  const first=state.refresh(context,draft);await state.refresh(context,{...draft,values:{temperature:60}});old.resolve({...preview,canStart:false});await first;expect(state.preview?.canStart).toBe(true);
  const pending=deferred<WasherCommandResult>();transport.start.mockReturnValueOnce(pending.promise);const write=state.start(context,{...draft,values:{temperature:60}});state.reset();pending.resolve(result);await write;expect(accept).not.toHaveBeenCalled();expect(state.preview).toBeUndefined();
 });
 it('submits once, immediately locks editing, and requires the previewed draft',async()=>{
  const{transport,state}=fixture();await state.refresh(context,draft);await state.start(context,{...draft,values:{temperature:60}});expect(transport.start).not.toHaveBeenCalled();
  const response=deferred<WasherCommandResult>();transport.start.mockReturnValueOnce(response.promise);const call=state.start(context,draft);expect(state.pending).toBe(true);expect(state.locked).toBe(true);await state.start(context,draft);expect(transport.start).toHaveBeenCalledTimes(1);response.resolve(result);await call;expect(state.result?.status).toBe('confirmed');expect(state.canStart).toBe(false);
 });
 it('a lost reply cannot repeat start and explicit confirmation is read-only',async()=>{
  const{transport,state}=fixture();await state.refresh(context,draft);transport.start.mockRejectedValueOnce({kind:'network',message:'lost',retryable:true});await state.start(context,draft);await state.start(context,draft);expect(transport.start).toHaveBeenCalledTimes(1);expect(state.requestId).toBeDefined();
  await state.refresh(context,draft);expect(transport.confirm).toHaveBeenCalledWith(context,'00000000-0000-0000-0000-000000000001');expect(transport.start).toHaveBeenCalledTimes(1);expect(state.result?.status).toBe('confirmed');
 });
 it('an unsent action may be retried only after confirmation and another explicit start',async()=>{
  const{transport,state}=fixture();await state.refresh(context,draft);transport.start.mockResolvedValueOnce({...result,status:'uncertain',phase:'parameters',panel:null});await state.start(context,draft);transport.confirm.mockResolvedValueOnce({...result,status:'notStarted',phase:'parameters'});await state.confirm(context,draft);expect(state.canStart).toBe(true);expect(transport.start).toHaveBeenCalledTimes(1);await state.start(context,draft);expect(transport.start.mock.calls[1][1]).toBe('00000000-0000-0000-0000-000000000002');
 });
 it('unknown live state never permits start and recovered receipts cannot write',async()=>{
  const{transport,state}=fixture();transport.preview.mockResolvedValueOnce({...preview,canStart:false,reason:'unknown'});await state.refresh(context,draft);await state.start(context,draft);expect(transport.start).not.toHaveBeenCalled();
  transport.preview.mockResolvedValueOnce({...preview,canStart:false,requestId:'existing-request'});await state.refresh(context,draft);await state.start(context,draft);expect(state.locked).toBe(true);await state.confirm({...context,generation:4},draft);expect(transport.confirm).not.toHaveBeenCalled();await state.confirm(context,draft);expect(transport.confirm).toHaveBeenCalledWith(context,'existing-request');
 });
 it('reservation is an absolute local draft until the explicit start',async()=>{
  const{transport,state,accept}=fixture();state.reservationAt=1793300000000;await state.refresh(context,draft);expect(transport.preview.mock.calls[0][1].reservationAt).toBe(1793300000000);expect(transport.start).not.toHaveBeenCalled();expect(accept).not.toHaveBeenCalled();
  await state.start(context,draft);expect(transport.start.mock.calls[0][2]).toEqual({program:'smart',values:draft.values,reservationAt:1793300000000});
 });
 it('replies for another device cannot change the current panel',async()=>{
  const{transport,state,accept}=fixture();await state.refresh(context,draft);transport.start.mockResolvedValueOnce({...result,panel:{...panel,did:'other'}});await state.start(context,draft);expect(accept).not.toHaveBeenCalled();expect(state.requestId).toBeDefined();expect(state.error).toContain('不匹配');
 });
});
