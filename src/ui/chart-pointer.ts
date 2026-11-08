import type { EChartsType } from 'echarts/core';

const bindings=new WeakMap<EChartsType,()=>void>();
/** zrender's native SVG route trusts offsetX/Y. WebView reports those in the
 * ancestor CSS zoom's visual pixels, whereas ECharts consumes SVG coordinates.
 * Normalize native client coordinates before zrender's bubbling handlers. */
export function bindSvgChartPointer(chart:EChartsType):void {
 if(bindings.has(chart))return;
 const host=chart.getDom(),controller=new AbortController();
 const normalize=(event:Event)=>{
  if(chart.isDisposed())return;
  const svg=host.querySelector('svg');if(!svg)return;
  const touch=event as TouchEvent,point=touch.touches?.[0]??touch.changedTouches?.[0]??event as MouseEvent;
  if(!Number.isFinite(point.clientX)||!Number.isFinite(point.clientY))return;
  let x:number,y:number;
  try{
   const matrix=svg.getScreenCTM();if(!matrix)throw Error('SVG matrix unavailable');
   const local=new DOMPoint(point.clientX,point.clientY).matrixTransform(matrix.inverse());x=local.x;y=local.y;
  }catch{
   const rect=svg.getBoundingClientRect();if(!rect.width||!rect.height)return;
   x=(point.clientX-rect.left)*chart.getWidth()/rect.width;y=(point.clientY-rect.top)*chart.getHeight()/rect.height;
  }
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const normalized=event as Event&{zrX?:number;zrY?:number};normalized.zrX=x;normalized.zrY=y;
 };
 for(const type of ['pointerdown','pointermove','pointerup','pointerout','mousedown','mousemove','mouseup','mouseout','click','dblclick','contextmenu','touchstart','touchmove','touchend'])host.addEventListener(type,normalize,{capture:true,passive:true,signal:controller.signal});
 bindings.set(chart,()=>controller.abort());
}
export function releaseSvgChartPointer(chart:EChartsType):void {bindings.get(chart)?.();bindings.delete(chart);}
