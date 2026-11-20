import {describe,it,expect} from 'vitest';
import {updateCheckMessage} from './update-feedback';
import type {AppUpdateStatus} from './application-settings';
describe('explicit update check feedback',()=>{
 const state=(state:AppUpdateStatus['state'],latestVersion:string|null=null)=>({state,latestVersion}) as AppUpdateStatus;
 it('reports current, new version and failure without backend prose',()=>{
  expect(updateCheckMessage(state('current'))).toBe('当前已是最新版本。');
  expect(updateCheckMessage(state('available','v1.0.1'))).toBe('发现新版本 v1.0.1，可以更新。');
  expect(updateCheckMessage(state('error'))).toBe('检查更新失败，请重试。');
 });
 it('does not turn progress or empty versions into completion notifications',()=>{
  for(const value of ['idle','checking','downloading','ready','installing'] as const)expect(updateCheckMessage(state(value))).toBeUndefined();
  expect(updateCheckMessage(state('available'))).toBeUndefined();
 });
});
