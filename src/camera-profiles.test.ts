import {describe,it,expect} from 'vitest';
import profiles from './camera-profiles.json';
import {cameraCardProfile,cloudDoorbellProfile} from './camera-profiles';
import {isCloudDoorbell} from './doorbell';
import {dedicatedPage} from './device-presentation-route';
describe('shared camera storage profiles',()=>{
 it.each(profiles.cloudDoorbells.flatMap(p=>p.models))('%s routes to cloud history without an SD adapter',model=>{
  expect(isCloudDoorbell(model)).toBe(true);expect(dedicatedPage(model)).toBe('doorbell-cloud');expect(cameraCardProfile(model)).toBeUndefined();
 });
 it.each(profiles.sd.flatMap(p=>p.models))('%s keeps its camera route and original card adapter',model=>{
  expect(cameraCardProfile(model)).toBeDefined();expect(isCloudDoorbell(model)).toBe(false);expect(dedicatedPage(model)).not.toBe('doorbell-cloud');
 });
 it('does not classify audio chimes, locks or an unknown brand model as cloud doorbells',()=>{
  for(const model of ['linp.doorbell.g03','linp.doorbell.g04','madv.doorbell.dltxq','loock.lock.fixture','madv.cateye.unverified'])expect(cloudDoorbellProfile(model)).toBeUndefined();
  expect(cloudDoorbellProfile('loock.cateye.v01')?.endpoint).toBe('/common/app/get/cloudlist');
  expect(cloudDoorbellProfile('midr.cateye.sd400')?.freeRetentionDays).toBeNull();
 });
});
