import {it,expect} from 'vitest';
import {deviceReadingDisplay} from './device-readings';
import {expansionPanel} from './fixtures/expansion-panels';
it('decodes the original stove hex payloads without changing device facts',()=>{const p=expansionPanel('chunmi.i_stove.x1');const prop=p.services.find(s=>s.siid===11)!.properties.find(p=>p.piid===10)!;prop.value='005A';prop.code=0;const before=JSON.stringify(prop);expect(deviceReadingDisplay(p,prop)).toBe('90℃');expect(JSON.stringify(prop)).toBe(before);prop.value='broken';expect(deviceReadingDisplay(p,prop)).toBe('暂无数据');p.model='other';expect(deviceReadingDisplay(p,prop)).toBeUndefined();});
it('decodes remaining minutes/seconds and rejects malformed seconds',()=>{const p=expansionPanel('chunmi.i_stove.x1'),prop=p.services.find(s=>s.siid===11)!.properties.find(p=>p.piid===38)!;prop.code=0;prop.value='000A1E';expect(deviceReadingDisplay(p,prop)).toBe('10分30秒');prop.value='000AFF';expect(deviceReadingDisplay(p,prop)).toBe('暂无数据');});
