import {afterEach,describe,expect,it,vi} from 'vitest';
import {rememberCameraQuality,rememberedCameraQuality} from './camera-quality';

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
