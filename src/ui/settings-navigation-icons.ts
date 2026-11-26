import {icon} from '../icons';

/** Keep the established settings-navigation glyphs and their original weight. */
export function settingsNavigationIcon(name:'application'|'display'|'desktop'|'monitor'|'mcp'|'hidden'|'about'|'back'):SVGSVGElement{
 if(name==='application')return icon('power');
 const ns='http://www.w3.org/2000/svg',node=document.createElementNS(ns,'svg');
 node.setAttribute('class','icon');node.setAttribute('viewBox','0 0 24 24');node.setAttribute('aria-hidden','true');
 node.setAttribute('fill','none');node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width','2.3');node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');
 const paths={
  desktop:['M3 4h18v13H3V4Z','M8 21h8m-4-4v4'],
  about:['M12 8h.01M12 11v6','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  back:['M20 12H4m7-7-7 7 7 7'],
  display:['M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9','M7 3v6m10 0v6M7 15v6'],
  monitor:['M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z','m17 10 5-3v10l-5-3'],
  mcp:['M8 3v4m8-4v4M6 7h12v4a6 6 0 0 1-12 0V7Z','M12 17v4'],
  hidden:['M3 3 21 21','M9.9 5.3A12 12 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3 3.7M6.2 6.2A21 21 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.8-1.8','M9.9 9.9a3 3 0 0 0 4.2 4.2'],
 }[name];
 for(const d of paths){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);node.append(path);}
 return node;
}
