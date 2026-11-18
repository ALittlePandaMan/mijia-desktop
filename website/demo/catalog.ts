import type {Device} from './desktop/src/types';
import products from './products.json';

export const demoRooms=[{id:'living',name:'客厅'},{id:'bedroom',name:'卧室'},{id:'kitchen',name:'厨房'},{id:'bathroom',name:'洗手间'},{id:'balcony',name:'阳台'}] as const;
export type RoomId=typeof demoRooms[number]['id'];
export type ProductId=keyof typeof products;
export type DeviceKind=Exclude<ProductId,'ac-standing'>;
const catalog=[
 {id:'switch',kind:'switch',name:'智能开关',room:'living'},
 {id:'curtain',kind:'curtain',name:'电动窗帘',room:'living'},
 {id:'fan',kind:'fan',name:'落地扇',room:'living'},
 {id:'ac',kind:'ac',name:'客厅空调',room:'living'},
 {id:'tv',kind:'tv',name:'客厅电视',room:'living'},
 {id:'thermo',kind:'thermo',name:'温湿度计',room:'living'},
 {id:'bedroom-light',kind:'light',name:'卧室筒灯',room:'bedroom'},
 {id:'bedroom-curtain',kind:'curtain',name:'卧室窗帘',room:'bedroom'},
 {id:'bedroom-ac',kind:'ac',name:'卧室空调',room:'bedroom'},
 {id:'kitchen-light',kind:'light',name:'厨房照明',room:'kitchen'},
 {id:'kitchen-thermo',kind:'thermo',name:'厨房温湿度计',room:'kitchen'},
 {id:'bathroom-light',kind:'light',name:'洗手间照明',room:'bathroom'},
 {id:'bathroom-thermo',kind:'thermo',name:'洗手间温湿度计',room:'bathroom'},
 {id:'balcony-airer',kind:'airer',name:'晾衣架',room:'balcony'},
 {id:'balcony-washer',kind:'washer',name:'洗衣机',room:'balcony'},
] as const satisfies readonly {id:string;kind:DeviceKind;name:string;room:RoomId}[];
export type DeviceId=typeof catalog[number]['id'];
export type DemoDevice=Device&{did:DeviceId;kind:DeviceKind;roomId:RoomId;artworkId:ProductId};
export const devices:DemoDevice[]=catalog.map(item=>{const artworkId=item.id==='ac'?'ac-standing':item.kind,product=products[artworkId];return {did:item.id,kind:item.kind,name:item.name,artworkId,model:product.model,specType:`urn:miot-spec-v2:device:${product.category}:00000000:demo:1`,online:true,roomId:item.room,roomName:demoRooms.find(room=>room.id===item.room)!.name};});
export function demoDevice(id:string):DemoDevice|undefined{return devices.find(device=>device.did===id);}
