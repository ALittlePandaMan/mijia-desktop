import type {VacuumMap} from '../vacuum';
import {VacuumMapViewport} from '../vacuum-map-view';
import {vacuumIcon} from '../vacuum-icons';
import {element} from './dom';
const pixelsByView=new WeakMap<VacuumMapViewport,{width:number;height:number;cells:string;url:string}>();
/** The native frame supplies all cells and path points; gestures change only the view. */
export function vacuumMap(m:VacuumMap,view:VacuumMapViewport,settled:()=>void):HTMLElement{
 const region=element('div','vacuum-map');region.setAttribute('role','region');region.setAttribute('aria-label','扫地机器人当前地图');region.setAttribute('aria-description','按住鼠标左键拖动，滚轮缩放，双击复位。也可使用方向键、加减号和 Home 键。');region.tabIndex=0;region.dataset.vacuumMap='actual';
 let raster=pixelsByView.get(view);
 if(!raster||raster.width!==m.width||raster.height!==m.height||raster.cells!==m.cells){
  const canvas=document.createElement('canvas');canvas.width=m.width;canvas.height=m.height;const ctx=canvas.getContext('2d');if(!ctx)return region;
  const cells=atob(m.cells);if(cells.length!==m.width*m.height)return region;
  const image=ctx.createImageData(m.width,m.height),colors=[[101,157,248],[138,180,255],[171,201,255],[205,224,255]],wall=[118,150,201];
  for(let i=0;i<cells.length;i++){const cell=cells.charCodeAt(i);if(!cell)continue;const row=Math.floor(i/m.width),col=i%m.width,p=((m.height-1-row)*m.width+col)*4,c=cell===255?wall:colors[(cell-1)%4];image.data[p]=c[0];image.data[p+1]=c[1];image.data[p+2]=c[2];image.data[p+3]=255;}
  ctx.putImageData(image,0,0);raster={width:m.width,height:m.height,cells:m.cells,url:canvas.toDataURL('image/png')};pixelsByView.set(view,raster);
 }
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),padding=Math.max(m.width,m.height)*.1,quarterTurn=m.rotation===90||m.rotation===270,w=quarterTurn?m.height:m.width,h=quarterTurn?m.width:m.height;
 svg.setAttribute('viewBox',`${(m.width-w)/2-padding} ${(m.height-h)/2-padding} ${w+padding*2} ${h+padding*2}`);svg.classList.add('vacuum-map-canvas');svg.setAttribute('aria-hidden','true');
 const layer=document.createElementNS(ns,'g');if(m.rotation)layer.setAttribute('transform',`rotate(${m.rotation} ${m.width/2} ${m.height/2})`);svg.append(layer);
 const pixels=document.createElementNS(ns,'image');pixels.setAttribute('href',raster.url);pixels.setAttribute('width',String(m.width));pixels.setAttribute('height',String(m.height));pixels.setAttribute('class','vacuum-map-pixels');layer.append(pixels);
 if(m.path?.length){const path=document.createElementNS(ns,'path');path.setAttribute('d',m.path.map((p,i)=>`${i&&p.isLine?'L':'M'}${p.x} ${m.height-p.y}`).join(' '));path.setAttribute('class','vacuum-cleaning-path');path.setAttribute('vector-effect','non-scaling-stroke');path.dataset.vacuumPathPoints=String(m.path.length);layer.append(path);}
 const font=Math.max(m.width,m.height)/29;
 for(const room of m.rooms){const text=document.createElementNS(ns,'text');text.textContent=room.name;text.setAttribute('x',String(room.x));text.setAttribute('y',String(m.height-room.y));text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','central');text.setAttribute('font-size',String(font));text.setAttribute('stroke-width',String(font*.08));text.classList.add('vacuum-room-name');layer.append(text);}
 for(const[kind,point,key]of [['dock',m.dock,'dock_log'],['robot',m.robot,'robot']]as const){if(!point)continue;const marker=document.createElementNS(ns,'image'),size=font*1.7;marker.setAttribute('href',vacuumIcon(key).src);marker.setAttribute('x',String(point.x-size/2));marker.setAttribute('y',String(m.height-point.y-size/2));marker.setAttribute('width',String(size));marker.setAttribute('height',String(size));marker.dataset.vacuumMarker=kind;layer.append(marker);}
 const paint=()=>{svg.style.transform=`translate(${view.x*100}%,${view.y*100}%) scale(${view.scale})`;region.dataset.mapScale=String(view.scale);region.dataset.mapPan=`${view.x},${view.y}`;};
 let drag:{id:number;x:number;y:number}|undefined;
 const end=()=>{if(!drag)return;const id=drag.id;drag=undefined;delete region.dataset.interacting;region.classList.remove('dragging');if(region.hasPointerCapture(id))region.releasePointerCapture(id);settled();};
 region.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;e.preventDefault();region.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY};region.setPointerCapture(e.pointerId);region.dataset.interacting='true';region.classList.add('dragging');});
 region.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(!(e.buttons&1)){end();return;}const r=region.getBoundingClientRect();if(r.width&&r.height)view.pan((e.clientX-drag.x)/r.width,(e.clientY-drag.y)/r.height);drag.x=e.clientX;drag.y=e.clientY;paint();});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])region.addEventListener(name,end);
 region.addEventListener('wheel',e=>{e.preventDefault();const r=region.getBoundingClientRect();if(!r.width||!r.height)return;const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);view.zoom(Math.exp(-Math.max(-300,Math.min(300,delta))*.0015),(e.clientX-r.left)/r.width-.5,(e.clientY-r.top)/r.height-.5);paint();},{passive:false});
 region.addEventListener('dblclick',e=>{if(e.button===0){e.preventDefault();view.reset();paint();}});
 region.addEventListener('keydown',e=>{const r=region.getBoundingClientRect();if(['+','=','-','_','Home','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='Home')view.reset();else if(['+','='].includes(e.key))view.zoom(1.2);else if(['-','_'].includes(e.key))view.zoom(1/1.2);else view.pan(e.key==='ArrowLeft'?-.06:e.key==='ArrowRight'?.06:0,e.key==='ArrowUp'?-.06:e.key==='ArrowDown'?.06:0);if(r.width)paint();}});
 region.append(svg);paint();return region;
}
