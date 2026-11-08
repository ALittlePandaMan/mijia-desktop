import {describe,it,expect,vi} from 'vitest';
import jsQR from 'jsqr';
import {RouterPasswordState,wifiQrMatrix,type RouterPasswordReport} from './router-password';

const context={homeId:'h',generation:1,did:'fixture'},report:RouterPasswordReport={did:'fixture',model:'xiaomi.router.rn02',rows:[{label:'2.4GHz Wi-Fi',ssid:'fixture',password:'fixture-pass'}],qr:'WIFI:T:WPA;P:fixture-pass;S:fixture;H:false;;'};
function decode(m:boolean[][]):string|undefined {
 const scale=5,quiet=4,n=(m.length+quiet*2)*scale,data=new Uint8ClampedArray(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const row=Math.floor(y/scale)-quiet,col=Math.floor(x/scale)-quiet,dark=m[row]?.[col]??false,p=(y*n+x)*4;data[p]=data[p+1]=data[p+2]=dark?0:255;data[p+3]=255;}
 return jsQR(data,n,n)?.data;
}
describe('router Wi-Fi disclosure',()=>{
 it('produces independently decodable UTF-8 QR data, including escaped punctuation',()=>{const payload='WIFI:T:WPA;P:a\\;b;S:客厅\\:网络;H:false;;';expect(decode(wifiQrMatrix(payload))).toBe(payload);});
 it('keeps the password hidden until explicit disclosure and clears it on exit',async()=>{const state=new RouterPasswordState(async()=>report,vi.fn(),vi.fn());state.bind(context,'account');await state.load(context);expect(state.revealed).toBe(false);state.toggle();expect(state.revealed).toBe(true);state.share();expect(state.modalOpen).toBe(true);state.close();expect(state.report).toBeUndefined();expect(state.matrix).toBeUndefined();expect(state.revealed).toBe(false);});
 it('ignores a late response after the account or device changes',async()=>{let resolve!:(value:RouterPasswordReport)=>void;const state=new RouterPasswordState(()=>new Promise(r=>{resolve=r;}),vi.fn(),vi.fn());state.bind(context,'account');const pending=state.load(context);state.bind({...context,generation:2},'another');resolve(report);await pending;expect(state.report).toBeUndefined();expect(state.loading).toBe(false);});
 it('does not disclose a mismatched device report',async()=>{const state=new RouterPasswordState(async()=>({...report,did:'other'}),vi.fn(),vi.fn());state.bind(context,'account');await state.load(context);state.toggle();state.share();expect(state.report).toBeUndefined();expect(state.revealed).toBe(false);expect(state.modalOpen).toBe(false);});
});
