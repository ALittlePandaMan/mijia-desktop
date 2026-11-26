import type {CardControl,Device,HomeCardPresentation,HomeCardEntry} from '../src/types';
export const devices:Device[]=['灯具','空调','净化器','扫地机','窗帘','路由器'].map((name,i)=>({did:String.fromCharCode(97+i),name,model:'mock.device',roomId:'mock-room',roomName:'客厅',online:true}));
const control=(id:string,kind:CardControl['kind'],label:string,value:CardControl['value'],rest:Partial<CardControl>={}):CardControl=>({id,kind,label,value,enabled:true,reason:null,options:[],range:null,...rest});
const choice=(label:string,value:number)=>({label,value});
export const presentations=new Map<string,HomeCardPresentation>([
 ['a',{did:'a',templateId:'light',revision:1,headerControl:'power',rows:[['brightness']],controls:[control('power','toggle','电源',true),control('brightness','slider','亮度',45,{appearance:'white-brightness',range:{min:1,max:100,step:1,unit:'%'}})]}],
 ['b',{did:'b',templateId:'climate',revision:1,headerControl:'power',rows:[['temperature']],controls:[control('power','toggle','电源',true),control('temperature','stepper','目标温度',23,{appearance:'temperature',range:{min:16,max:30,step:1,unit:'℃'}})]}],
 ['c',{did:'c',templateId:'purifier',revision:1,headerControl:'power',rows:[['mode']],controls:[control('power','toggle','电源',true),control('mode','choices','模式',0,{options:[choice('自动',0),choice('睡眠',1),choice('最爱',2)]})]}],
 ['d',{did:'d',templateId:'vacuum',revision:1,headerControl:null,rows:[['sweep','charge']],controls:[control('sweep','action','开始清扫','vacuum:start-sweep'),control('charge','action','回充','battery:start-charge')]}],
 ['e',{did:'e',templateId:'curtain',revision:1,headerControl:null,rows:[['motor']],controls:[control('motor','choices','窗帘',8,{options:[choice('打开',7),choice('暂停',8),choice('关闭',9)]})]}],
]);
for(const p of presentations.values())if(p.headerControl)p.projections=[false,true].map(value=>({controlId:p.headerControl!,value,controls:p.controls.map(c=>({id:c.id,enabled:c.id===p.headerControl||value,value:null,label:c.label}))}));
presentations.get('d')!.projections=[{controlId:'sweep',value:'vacuum:start-sweep',controls:[{id:'sweep',enabled:true,value:'vacuum:pause-sweeping',label:'暂停'}]},{controlId:'sweep',value:'vacuum:pause-sweeping',controls:[{id:'sweep',enabled:true,value:'vacuum:start-sweep',label:'开始清扫'}]}];
export const shortcut=(did:string):HomeCardEntry|undefined=>did==='d'||did==='f'?undefined:{did,kind:'power',selected:true,enabled:true,visible:true,highlight:true,reason:null,binding:{siid:2,piid:1},action:'off',cardType:1};
