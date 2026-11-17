import type {HomeCardStatus,HomeCardStatusField,Json} from '../src/types';
const f=(id:string,value:Json,text:string,kind:HomeCardStatusField['format']['kind']='boolean',rest:Partial<HomeCardStatusField>={}):HomeCardStatusField=>({id,value,text,writable:true,visible:true,live:true,format:{kind,label:'',unit:kind==='number'?'%':'',precision:kind==='number'?0:null,min:kind==='number'?0:null,max:kind==='number'?100:null,integral:kind==='number',percentage:false,options:[]},gates:[],...rest});
const number=(id:string,value:number,unit:string)=>{const field=f(id,value,`${value}${unit}`,'number');field.format.unit=unit;return field;};
export const captionStatuses=new Map<string,HomeCardStatus>([
 ['a',{did:'a',text:'45%',revision:1,fields:[f('2:1',true,'','boolean',{visible:false}),{...number('2:2',45,'%'),gates:[{enable:null,disable:[{field:'2:1',value:false}],unknown:false}]}]}],
 ['b',{did:'b',text:'23℃ 24℃',revision:1,fields:[f('2:1',true,'','boolean',{visible:false}),number('2:2',23,'℃'),{...number('7:1',24,'℃'),writable:false}]}],
 ['c',{did:'c',text:'自动',revision:1,fields:[f('2:1',true,'','boolean',{visible:false}),{...f('2:2',0,'自动','enum'),format:{...f('',0,'','enum').format,options:[{value:0,text:'自动'},{value:1,text:'睡眠'},{value:2,text:'最爱'}]}}]}],
 ['d',{did:'d',text:'待机',revision:1,fields:[{...f('2:1',0,'待机','enum',{writable:false}),format:{...f('',0,'','enum').format,options:[{value:0,text:'待机'},{value:1,text:'清扫中'},{value:2,text:'已暂停'}]}}]}],
 ['e',{did:'e',text:'已暂停',revision:1,fields:[{...f('2:1',8,'已暂停','enum'),format:{...f('',0,'','enum').format,options:[{value:7,text:'打开'},{value:8,text:'已暂停'},{value:9,text:'关闭'}]}}]}],
 ['f',{did:'f',text:'连接设备数 35',revision:1}],
 ['g',{did:'g',text:'关 开 开',revision:1,fields:[f('2:1',false,'关'),f('3:1',true,'开'),f('4:1',true,'开')]}]
]);
