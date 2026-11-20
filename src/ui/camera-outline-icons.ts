/** Desktop vectors traced to the user's thin live-toolbar reference. */
export type CameraOutlineIcon='power'|'snapshot'|'record'|'stop'|'fullscreen'|'sound'|'muted'|'microphone';
export function cameraOutlineIcon(kind:CameraOutlineIcon):SVGSVGElement{
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');svg.dataset.iconSource='desktop-custom';svg.dataset.iconName=`camera-outline-${kind}`;
 const p=document.createElementNS(ns,'path');p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','1.6');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');
 p.setAttribute('d',{
  power:'M12 2v9M6.2 5.4a9 9 0 1 0 11.6 0',
  snapshot:'M4 6.5h3l1.5-3h7l1.5 3h3a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V8A1.5 1.5 0 0 1 4 6.5ZM16.2 13.5a4.2 4.2 0 1 1-8.4 0 4.2 4.2 0 0 1 8.4 0Z',
  record:'M4 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm13 5 5-3v12l-5-3',
  fullscreen:'M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7',
  stop:'M6 6h12v12H6Z',
  sound:'M10.5 4 5.5 8h-3v8h3l5 4V4ZM14 8.5c2 2 2 5 0 7M17 5.5c4 3.5 4 9.5 0 13',
  muted:'M10.5 4 5.5 8h-3v8h3l5 4V4ZM2.5 2.5l19 19M17 5.5c2.5 2.2 3.4 5.3 2.6 8.3',
  microphone:'M8.5 6a3.5 3.5 0 0 1 7 0v5a3.5 3.5 0 0 1-7 0V6ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v3.5M8.5 21.5h7',
 }[kind]);svg.append(p);return svg;
}
