// Desktop vectors based on the user's state-icon references. These are not
// represented as original vendor artwork or as an audio-level measurement.
export function cameraStatusIcon(kind:'talk'|'light'|'alarm'):SVGSVGElement{
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class',`icon camera-status-icon status-${kind}`);svg.setAttribute('aria-hidden','true');svg.dataset.iconSource='desktop-custom';svg.dataset.iconName=`camera-status-${kind}`;
 const path=(d:string,fill='currentColor')=>{const p=document.createElementNS(ns,'path');p.setAttribute('d',d);p.setAttribute('fill',fill);svg.append(p);return p;};
 if(kind==='talk'){
  // Match the normal microphone's alpha height (63/65 of its 20px box).
  // The previous 24-unit viewport left this circle visibly smaller.
  svg.setAttribute('viewBox','1.68 1.68 20.64 20.64');
  const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','10');circle.setAttribute('fill','currentColor');svg.append(circle);
  path('M7 9h2v6H7V9Zm4-2h2v10h-2V7Zm4 3h2v4h-2v-4Z','#fff');
 }else if(kind==='light'){
  // Match the toolbar's ~19.4px painted height without stretching the bulb.
  // Its bounds are y=2..23, centered at 12.5, inside the unchanged 20px box.
  svg.setAttribute('viewBox','1.16 1.66 21.68 21.68');
  path('M12 2a7 7 0 0 0-4.4 12.4c1 .8 1.4 1.5 1.4 2.6h6c0-1.1.4-1.8 1.4-2.6A7 7 0 0 0 12 2ZM9 18h6v2H9v-2Zm1 3h4a2 2 0 0 1-4 0Z');
  const arc=path('M7.7 9.5A4.4 4.4 0 0 1 12 5.2','none');arc.setAttribute('stroke','#fff');arc.setAttribute('stroke-width','1.5');arc.setAttribute('stroke-linecap','round');
 }else{
  path('M10.6 3a1.4 1.4 0 0 1 2.8 0v.8A6.2 6.2 0 0 1 18 10v6l1.5 1.5V19h-15v-1.5L6 16v-6a6.2 6.2 0 0 1 4.6-6.2V3ZM3 21h18v2H3v-2Z');
  const waves=path('M3.4 4.5A10 10 0 0 0 2 10m18.6-5.5A10 10 0 0 1 22 10M5 6a7 7 0 0 0-.8 3m14.8-3a7 7 0 0 1 .8 3','none');waves.setAttribute('stroke','currentColor');waves.setAttribute('stroke-width','1.3');waves.setAttribute('stroke-linecap','round');waves.setAttribute('opacity','.45');
 }
 return svg;
}
