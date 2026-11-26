/** Filled companion to the existing camera toolbar silhouettes. Custom desktop
 * vector requested by the user; never represented as an original APK asset. */
export function cameraFillLightIcon():SVGSVGElement{
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');svg.dataset.iconSource='desktop-custom';svg.dataset.iconName='camera-fill-light';
 path.setAttribute('fill','currentColor');
 path.setAttribute('d','M12 4a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.2 1.1 2.2h5c0-1 .3-1.6 1.1-2.2A6 6 0 0 0 12 4Zm-2.5 14h5v1.3c0 .4-.3.7-.7.7h-3.6a.7.7 0 0 1-.7-.7V18Zm1 3h3a1.5 1.5 0 0 1-3 0ZM11 0h2v2h-2V0ZM2 9h2v2H2V9Zm18 0h2v2h-2V9ZM3.5 2.9l1.4-1.4 1.7 1.7-1.4 1.4-1.7-1.7Zm13.9.3 1.7-1.7 1.4 1.4-1.7 1.7-1.4-1.4Z');
 svg.append(path);return svg;
}
