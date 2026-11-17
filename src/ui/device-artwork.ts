import type {Device} from '../types';
import {deviceArtworkSources} from '../device-artwork';
import {deviceIcon,icon,officialIcon} from '../icons';
import {miotCategory} from '../panel-layout';
import {element} from './dom';

/** Device images are shared by the home cards, details and settings lists. */
export function deviceArtworkKey(device:Device,switchCount=3,product=false):string{return JSON.stringify([device.did,device.model,deviceArtworkSources(device,product),product,switchCount]);}
export function deviceArtwork(device:Device,className='',switchCount=3,product=false):HTMLElement{
 const art=element('span',`device-artwork ${className}`),sources=deviceArtworkSources(device,product);
 art.dataset.artworkKey=deviceArtworkKey(device,switchCount,product);
 const fallback=()=>{
  art.dataset.artworkSource='official-category';art.setAttribute('aria-description','设备示意图');
  art.append(miotCategory(device.specType)==='switch'?element('span','device-original-fallback switch-original-art',officialIcon('switch:device')):icon(deviceIcon(device.model)));
 };
 if(sources.length){
  const image=element('img','device-product-image');image.alt='';image.loading=product||className==='switch-key-artwork'?'eager':'lazy';image.referrerPolicy='no-referrer';
  let index=0;
  const next=()=>{const source=sources[index++];if(source){art.dataset.artworkSource=source.source;image.src=source.url;}else{image.remove();fallback();}};
  image.addEventListener('error',next);next();art.append(image);
 }else fallback();
 return art;
}
