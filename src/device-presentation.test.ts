import {describe,it,expect} from 'vitest';
import {deviceChoiceLabel,devicePropertyLabel,deviceServiceLabel,deviceUnit} from './device-labels';
import {dailyPanel} from './daily-scope';
import {sensorReadingVisible} from './sensor-presentation';
import {sensorStatusLabel} from './sensor-status';
import observed from './fixtures/daily-remaining-panels.json';
import type {DevicePanel,Property} from './types';
describe('Chinese daily presentation, separate from source values and control IDs',()=>{
 it('localizes each bath heater mode from the actual observed descriptor',()=>{
  const panel=observed.models.find(p=>p.model==='yeelink.bhf_light.v13')!;
  const choices=panel.services.find(s=>s.name==='ptc-bath-heater')!.properties.find(p=>p.name==='mode')!.valueList!;
  expect(choices.map(c=>deviceChoiceLabel(c.description))).toEqual(['空闲','除湿','除雾','快速除雾','快速制热','其他']);
  expect(deviceServiceLabel({name:'ptc-bath-heater',description:'PTC Bath Heater'})).toBe('浴霸');
 });
 it('retains only immediate presence readings and does not mutate the source',()=>{
  for(const model of ['xiaomi.sensor_occupy.03','linp.sensor_occupy.hb01']){
   const original=observed.models.find(p=>p.model===model)! as unknown as DevicePanel,before=JSON.stringify(original),visible=dailyPanel(original);
   expect(visible.services.flatMap(s=>s.properties.map(p=>p.name)).some(name=>['has-someone-duration','no-one-duration','no-one-determine-time'].includes(name))).toBe(false);
   expect(visible.services.flatMap(s=>s.properties.map(p=>p.name))).toEqual(expect.arrayContaining(['occupancy-status','illumination']));
   expect(JSON.stringify(original)).toBe(before);
  }
 });
 it('preserves relevant readings and removes config/fault/duration details only from sensor presentation',()=>{
  expect(sensorReadingVisible('occupancy-sensor','battery','battery-level')).toBe(true);
  expect(sensorReadingVisible('gas-sensor','gas-sensor','status')).toBe(true);
  expect(sensorReadingVisible('gas-sensor','gas-sensor','gas-concentration')).toBe(true);
  expect(sensorReadingVisible('occupancy-sensor','occupancy-sensor','fault')).toBe(false);
  expect(sensorReadingVisible('temperature-humidity-sensor','temperature-humidity-sensor','temperature')).toBe(true);
  expect(sensorReadingVisible('fan','fan','off-delay-time')).toBe(true);
 });
 it('uses semantic status without guessing enum numeric meanings or translating user text',()=>{
  const p:Property={siid:2,piid:5,name:'occupancy-status',description:'Occupancy Status',format:'bool',access:['read']};
  expect(sensorStatusLabel('occupancy-sensor',p,false)).toBe('无人');
  expect(sensorStatusLabel('occupancy-sensor',p,true)).toBe('有人');
  expect(sensorStatusLabel('occupancy-sensor',{...p,valueList:[{value:false,description:'设备自定义'}]},false)).toBeUndefined();
  expect(deviceChoiceLabel('No One')).toBe('无人');expect(deviceChoiceLabel('None')).toBe('未确定');
  expect(deviceChoiceLabel('Unpublished Value','选项2')).toBe('选项2');
  expect(deviceChoiceLabel('-2')).toBe('-2');expect(deviceChoiceLabel('0°')).toBe('0°');
  expect(deviceChoiceLabel('Normal',undefined,'state')).toBe('正常');expect(deviceChoiceLabel('Normal')).toBe('标准');
  expect(devicePropertyLabel({...p,name:'mode'},'用户中文标题')).toBe('用户中文标题');
  expect(deviceUnit('seconds')).toBe('秒');expect(deviceUnit('celsius')).toBe('℃');
 });
});
