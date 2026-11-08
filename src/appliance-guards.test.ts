import {it,expect} from 'vitest';
import {expansionPanel} from './fixtures/expansion-panels';
import {applianceActionReason} from './appliance-guards';
it('only allows resume on paused washers and never starts a new unvalidated program',()=>{const p=expansionPanel('midjd8.washer.42a'),s=p.services.find(s=>s.name==='washer')!,a=s.actions.find(a=>a.name==='start-wash')!;
 for(const property of s.properties){property.code=0;if(property.name==='fault')property.value=property.valueList!.find(v=>/no faults?/i.test(v.description))!.value;}
 const lock=p.services.flatMap(s=>s.properties).find(p=>p.name==='physical-controls-locked');if(lock){lock.code=0;lock.value=false;}
 const status=s.properties.find(p=>p.name==='status')!;status.value=status.valueList!.find(v=>v.description.toLowerCase()==='idle')!.value;expect(applianceActionReason(p,a)).toBeDefined();
 status.value=status.valueList!.find(v=>v.description.toLowerCase()==='paused')!.value;expect(applianceActionReason(p,a)).toBeUndefined();status.code=-1;expect(applianceActionReason(p,a)).toBeDefined();
});
