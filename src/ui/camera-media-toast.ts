import type {SavedCameraMedia} from '../camera-types';
import {clearToast,showToast} from './toast';
const completed=new Set<string>();
export function showCameraMediaSaved(owner:HTMLElement,file:SavedCameraMedia):void{
 if(!owner.isConnected)return;const key=file.kind+':'+file.id;if(completed.has(key))return;
 if(completed.size>=64)completed.delete(completed.values().next().value!);completed.add(key);
 showToast(owner,file.kind==='screenshot'?'截图已保存':'录像已保存');
}
export const clearCameraMediaToast=clearToast;
