import {element} from './dom';

/** Shared switch/outlet header. Geometry follows APK BigTitleBar (16121)
 * at the supported 405px panel width; artwork is supplied by the device layer.
 */
export function productHeader(artwork:HTMLElement,title:string,className:string):HTMLElement {
  const image=artwork.querySelector('img');if(image)image.loading='eager';
  return element('div',`product-header ${className}`,artwork,element('h1','',title));
}
