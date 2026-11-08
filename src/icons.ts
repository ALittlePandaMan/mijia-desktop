export type IconName = 'speaker:play' | 'speaker:pause' | 'speaker:previous' | 'speaker:next' | 'swing-horizontal' | 'swing-vertical' | 'fan-low' | 'fan-medium' | 'fan-high' | 'music' | 'previous' | 'next' | 'microphone' | 'video' | 'volume' | 'volume-off' | 'fullscreen' | 'ptz' | 'play' | 'eye' | 'records' | 'edit' | 'menu' | 'home' | 'grid' | 'room' | 'refresh' | 'search' | 'chevron' | 'close' | 'logout' | 'link' | 'device' | 'light' | 'plug' | 'climate' | 'camera' | 'curtain' | 'info' | 'check' | 'arrow' | 'shield' | 'phone' | 'warning' | 'power' | 'back' | 'more' | 'clock' | 'wind' | 'leaf' | 'moon' | 'pause' | 'curtain-open' | 'curtain-close' | 'snowflake' | 'sun' | 'fan' | 'droplet' | 'plus' | 'minus' | 'light-all-on' | 'light-all-off' | 'trash' | 'select-all';
import {officialIconAssets} from './mijia-icon-assets';
let maskSerial=0;
/** Display original static vendor imagery; never run vendor plugin JavaScript. */
export function officialIcon(name:string,className=''):SVGSVGElement {
 const asset=officialIconAssets[name];if(!asset)throw new Error('Unmapped official icon: '+name);
 const ns='http://www.w3.org/2000/svg',node=document.createElementNS(ns,'svg'),[w,h]=asset.size??[24,24];
 node.setAttribute('viewBox',asset.viewBox?.join(' ')??`0 0 ${w} ${h}`);node.setAttribute('aria-hidden','true');node.setAttribute('class',`icon ${className}`);node.dataset.iconSource=asset.captureDerived?'mijia-original-capture':'mijia-original';node.dataset.iconAsset=asset.sha256;node.dataset.iconName=name;
 const image=document.createElementNS(ns,'image');image.setAttribute('href',asset.url);image.setAttribute('width',String(w));image.setAttribute('height',String(h));image.setAttribute('preserveAspectRatio','xMidYMid meet');
 if(asset.literal)node.append(image);else {const defs=document.createElementNS(ns,'defs'),mask=document.createElementNS(ns,'mask'),id=`mijia-icon-${++maskSerial}`;mask.id=id;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');mask.setAttribute('width',String(w));mask.setAttribute('height',String(h));mask.style.maskType='alpha';mask.append(image);defs.append(mask);const color=document.createElementNS(ns,'rect');color.setAttribute('width',String(w));color.setAttribute('height',String(h));color.setAttribute('fill','currentColor');color.setAttribute('mask',`url(#${id})`);node.append(defs,color);}
 if(asset.rotate){const g=document.createElementNS(ns,'g');g.setAttribute('transform',`rotate(${asset.rotate} ${w/2} ${h/2})`);while(node.firstChild)g.append(node.firstChild);node.append(g);}
 return node;
}
export function icon(name:IconName,className=''):SVGSVGElement{return officialIcon(name,className);}

export function deviceIcon(model: string): IconName {
  if (/light|lamp|bulb/.test(model)) return 'light';
  if (/plug|outlet|switch/.test(model)) return 'plug';
  if (/air|humid|heater|fan|thermostat/.test(model)) return 'climate';
  if (/camera|chuangmi\.camera/.test(model)) return 'camera';
  if (/curtain/.test(model)) return 'curtain';
  return 'device';
}
