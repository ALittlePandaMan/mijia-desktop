import {afterEach,describe,expect,it,vi} from 'vitest';
import {cameraQualityButtonLabel,cameraQualityOptions,rememberCameraQuality,rememberedCameraQuality} from './camera-quality';
import {CameraQualityReadings} from './camera-quality-readings';
import cameraProfiles from './camera-profiles.json';

afterEach(()=>vi.unstubAllGlobals());
describe('camera quality persistence boundaries',()=>{
  const camera={homeId:'home-a',did:'camera-a',generation:1};
  function storage(){const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});return values;}
  it('restores the selected profile across openings without sharing it with another identity',()=>{
    storage();expect(rememberCameraQuality(camera,'model-a','uhd')).toBe(true);
    expect(rememberedCameraQuality({...camera,generation:9},'model-a')).toBe('uhd');
    for(const c of [{...camera,did:'camera-b'},{...camera,homeId:'home-b'}])expect(rememberedCameraQuality(c,'model-a')).toBe('auto');
    expect(rememberedCameraQuality(camera,'changed-model')).toBe('auto');
  });
  it('does not accept malformed or arbitrary stored profiles',()=>{
    const values=storage();rememberCameraQuality(camera,'model-a','sd');
    values.set([...values.keys()][0],'{bad-json');expect(rememberedCameraQuality(camera,'model-a')).toBe('auto');
    expect(rememberCameraQuality(camera,'model-a','url:arbitrary')).toBe(false);
  });
  it('keeps playback usable if the browser denies local storage',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('full')}});
    expect(rememberedCameraQuality(camera,'model-a')).toBe('auto');
    expect(rememberCameraQuality(camera,'model-a','hd')).toBe(false);
  });
});

describe('effective camera quality tiers',()=>{
 const presets=[{id:'sd',label:'流畅',wireValue:1},{id:'hd',label:'高清',wireValue:2},{id:'uhd',label:'超清',wireValue:3,resolution:'2960×1666'},{id:'auto',label:'自动',wireValue:0}];
 const low={width:848,height:480},high={width:2960,height:1666},middle={width:1920,height:1080};
 const options=(sizes={})=>cameraQualityOptions(presets,sizes);
 it('uses native tier names even when two models share the same wire value',()=>{
  const forModel=(model:string)=>cameraProfiles.media.find(p=>p.models.includes(model))!.qualities.map(q=>({id:q.id,label:q.label,wireValue:q.value}));
  const c302=forModel('xiaomi.camera.c302'),series069=forModel('xiaomi.camera.069a03');
  expect(cameraQualityOptions(c302).map(q=>[q.mode,q.label])).toEqual([['hd','高清'],['sd','流畅'],['auto','自动']]);
  expect(cameraQualityOptions(series069).map(q=>[q.mode,q.label])).toEqual([['uhd','超清'],['hd','高清'],['sd','流畅'],['auto','自动']]);
  expect(cameraQualityButtonLabel(c302,'hd')).toBe('高清');
  expect(cameraQualityButtonLabel(series069,'uhd')).toBe('超清');
 });
 it('merges an ultra preset that actually returns the low stream without hiding the real high stream',()=>{
  const sizes={sd:low,hd:high,uhd:low};
  expect(options(sizes).map(q=>[q.id,q.label,q.aliases])).toEqual([['hd','高清',[]],['sd','流畅',['uhd']],['auto','自动',[]]]);
  expect(cameraQualityButtonLabel(presets,'uhd',sizes)).toBe('流畅');
 });
 it('keeps three genuine sizes and merges high aliases under the high manual option',()=>{
  expect(options({sd:low,hd:middle,uhd:high}).map(q=>q.label)).toEqual(['超清','高清','流畅','自动']);
  expect(options({sd:low,hd:high,uhd:high})[0]).toMatchObject({id:'hd',aliases:['uhd'],label:'高清'});
  expect(cameraQualityButtonLabel(presets,'uhd',{hd:high,uhd:high})).toBe('高清');
  expect(options({sd:low,hd:low,uhd:high}).map(q=>[q.id,q.label,q.aliases])).toEqual([['uhd','超清',[]],['sd','流畅',['hd']],['auto','自动',[]]]);
  expect(cameraQualityOptions(presets.map(q=>q.id==='uhd'?{...q,wireValue:2}:q)).map(q=>q.id)).toEqual(['hd','sd','auto']);
  expect(cameraQualityOptions(presets.map(q=>q.id==='hd'?{...q,resolution:'2960×1666'}:q)).map(q=>q.id)).toEqual(['uhd','hd','sd','auto']);
  expect(cameraQualityOptions(presets,{sd:low,hd:high,auto:low}).map(q=>q.id)).toEqual(['uhd','hd','sd','auto']);
 });
 it('uses stable acknowledged frames separately for each lens and rejects storage, transition, and background frames',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify([{key:'oldCache',lenses:[[0,{sd:low,uhd:low}]]}])});
  const readings=new CameraQualityReadings(),context={homeId:'proof-home',generation:31,did:'lens-camera'};
  readings.bind(context,'fixture');readings.reset('hd');
  const observe=(lens:number,size=high,quality='hd',stream='codec-1')=>readings.observe(lens,size,stream,quality);
  observe(0);observe(0);expect(readings.sizes(0).hd).toBeUndefined();observe(0);expect(readings.sizes(0).hd).toEqual(high);
  readings.begin('uhd');for(let i=0;i<6;i++)observe(0,low,'sd');
  readings.confirm('uhd');for(let i=0;i<6;i++){readings.observe(0,low,'background');observe(0,low,'sd');}
  expect(readings.sizes(0).uhd).toBeUndefined();
  for(let i=0;i<3;i++){observe(0,low,'uhd','codec-2');observe(10,high,'uhd','codec-9');}
  expect(readings.sizes(0).uhd).toEqual(low);expect(readings.sizes(10).uhd).toEqual(high);
  readings.reset('sd');
  for(let i=0;i<3;i++){observe(0,low,'sd','codec-3');observe(10,low,'sd','codec-10');}
  expect(cameraQualityButtonLabel(presets,'uhd',readings.sizes(0))).toBe('流畅');
  expect(cameraQualityButtonLabel(presets,'uhd',readings.sizes(10))).toBe('超清');
  readings.bind({...context,generation:32},'fixture');readings.reset('uhd');expect(readings.sizes(0).uhd).toBeUndefined();
 });
});
