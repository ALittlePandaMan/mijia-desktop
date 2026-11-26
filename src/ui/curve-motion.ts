/** A new device/history view draws once; ordinary rerenders keep its curves still. */
let scope='';
const revealed=new Set<string>();
export function setCurveMotionScope(next:string):void {
 if(next!==scope){scope=next;revealed.clear();}
}
export function claimCurveEntrance(key:string):boolean {
 if(revealed.has(key))return false;
 revealed.add(key);return true;
}
export function curveEntranceOptions(first:boolean) {
 return {animation:first&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches,animationDuration:900,animationEasing:'cubicOut' as const,animationDurationUpdate:0};
}
