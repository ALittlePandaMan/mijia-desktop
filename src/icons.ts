export type IconName = 'speaker:play' | 'speaker:pause' | 'speaker:previous' | 'speaker:next' | 'swing-horizontal' | 'swing-vertical' | 'fan-low' | 'fan-medium' | 'fan-high' | 'music' | 'previous' | 'next' | 'microphone' | 'video' | 'volume' | 'volume-off' | 'fullscreen' | 'ptz' | 'play' | 'eye' | 'records' | 'edit' | 'menu' | 'home' | 'grid' | 'room' | 'refresh' | 'search' | 'chevron' | 'close' | 'logout' | 'link' | 'device' | 'light' | 'plug' | 'climate' | 'camera' | 'curtain' | 'info' | 'check' | 'arrow' | 'shield' | 'phone' | 'warning' | 'power' | 'back' | 'more' | 'clock' | 'wind' | 'leaf' | 'moon' | 'pause' | 'curtain-open' | 'curtain-close' | 'snowflake' | 'sun' | 'fan' | 'droplet' | 'plus' | 'minus' | 'light-all-on' | 'light-all-off' | 'trash' | 'select-all'
  | `bath:${'warm_wind_low_gear' | 'warm_wind_high_gear' | 'bhf_switch'}:${'on' | 'off'}`;
import {officialIconAssets} from './mijia-icon-assets';
import roundedCheck from './assets/rounded-check.svg?url';
type IconArtwork = Omit<(typeof officialIconAssets)[string], 'member' | 'size'> & {size?: number[]};
let maskSerial=0;
/** Display original static vendor imagery; never run vendor plugin JavaScript. */
export function officialIcon(name:string,className=''):SVGSVGElement {
 const asset=officialIconAssets[name];if(!asset)throw new Error('Unmapped official icon: '+name);
 return artworkIcon(asset,name,className);
}

function artworkIcon(asset:IconArtwork,name:string,className:string):SVGSVGElement {
 // Reuse the rounded tick from the existing home-selection artwork, without
 // its circle. Each caller keeps its own foreground, background and state.
 const check=name==='check'||name==='camera:selected';
 const ns='http://www.w3.org/2000/svg',node=document.createElementNS(ns,'svg'),[w,h]=check?[24,24]:asset.size??[24,24];
 node.setAttribute('viewBox',check?'0 0 24 24':asset.viewBox?.join(' ')??`0 0 ${w} ${h}`);node.setAttribute('aria-hidden','true');node.setAttribute('class',`icon ${className}`);node.dataset.iconSource=check?'shared-rounded-check':asset.captureDerived?'mijia-original-capture':'mijia-original';if(!check)node.dataset.iconAsset=asset.sha256;node.dataset.iconName=name;
 const image=document.createElementNS(ns,'image');image.setAttribute('href',check?roundedCheck:asset.url);image.setAttribute('width',String(w));image.setAttribute('height',String(h));image.setAttribute('preserveAspectRatio','xMidYMid meet');
 if(asset.literal&&!check)node.append(image);else {const defs=document.createElementNS(ns,'defs'),mask=document.createElementNS(ns,'mask'),id=`mijia-icon-${++maskSerial}`;mask.id=id;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');mask.setAttribute('width',String(w));mask.setAttribute('height',String(h));mask.style.maskType='alpha';mask.append(image);defs.append(mask);const color=document.createElementNS(ns,'rect');color.setAttribute('width',String(w));color.setAttribute('height',String(h));color.setAttribute('fill','currentColor');color.setAttribute('mask',`url(#${id})`);node.append(defs,color);}
 if(asset.rotate&&!check){const g=document.createElementNS(ns,'g');g.setAttribute('transform',`rotate(${asset.rotate} ${w/2} ${h/2})`);while(node.firstChild)g.append(node.firstChild);node.append(g);}
 return node;
}
export function icon(name:IconName,className=''):SVGSVGElement{return officialIcon(name,className);}

/** Extract the white symbol from a colored badge so the mode button owns both colors. */
export function badgeGlyphIcon(asset:IconArtwork,name:string,channel:'red'|'blue',background:number,className:string):SVGSVGElement {
  const svg=artworkIcon({...asset,literal:true},name,className);
  const source=svg.querySelector('image')!;
  const width=source.getAttribute('width')!, height=source.getAttribute('height')!;
  const ns='http://www.w3.org/2000/svg', id='badge-glyph-'+ ++maskSerial;
  const defs=document.createElementNS(ns,'defs'), filter=document.createElementNS(ns,'filter');
  const matrix=document.createElementNS(ns,'feColorMatrix'), clip=document.createElementNS(ns,'feComposite');
  filter.id=id+'-filter';
  filter.setAttribute('color-interpolation-filters','sRGB');
  // Map the badge channel to zero and white to full opacity, preserving antialiasing.
  const scale=255/(255-background);
  const channels=channel==='red'?`${scale} 0 0`:`0 0 ${scale}`;
  matrix.setAttribute('values',`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${channels} 0 ${-background/(255-background)}`);
  clip.setAttribute('in2','SourceAlpha');
  clip.setAttribute('operator','in');
  filter.append(matrix,clip);
  const mask=document.createElementNS(ns,'mask');
  mask.id=id;
  mask.setAttribute('maskUnits','userSpaceOnUse');
  mask.style.maskType='alpha';
  mask.setAttribute('x','0');
  mask.setAttribute('y','0');
  mask.setAttribute('width',width);
  mask.setAttribute('height',height);
  source.setAttribute('filter',`url(#${filter.id})`);
  mask.append(source);
  const glyph=document.createElementNS(ns,'rect');
  glyph.setAttribute('width',width);
  glyph.setAttribute('height',height);
  glyph.setAttribute('fill','currentColor');
  glyph.setAttribute('mask',`url(#${id})`);
  defs.append(filter,mask);
  svg.append(defs,glyph);
  return svg;
}

export function bathModeIcon(name:string,selected:boolean):SVGSVGElement {
  const active='bath:'+name+':on';
  const asset=officialIconAssets[active];
  if(!asset)throw new Error('Unmapped official icon: '+active);
  return badgeGlyphIcon(asset,selected?active:'bath:'+name+':off','blue',15,'bath-mode-icon');
}

export function deviceIcon(model: string): IconName {
  if (/light|lamp|bulb/.test(model)) return 'light';
  if (/plug|outlet|switch/.test(model)) return 'plug';
  if (/air|humid|heater|fan|thermostat/.test(model)) return 'climate';
  if (/camera|chuangmi\.camera/.test(model)) return 'camera';
  if (/curtain/.test(model)) return 'curtain';
  return 'device';
}
