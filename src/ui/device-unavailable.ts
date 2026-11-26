import './device-unavailable.css';
import type {Device} from '../types';
import {deviceArtwork} from './device-artwork';
import {deviceSurfaces} from './device-surfaces';
import {button,element} from './dom';

export function deviceUnavailableContent(device:Device,artwork=()=>deviceArtwork(device,'',3,true)):HTMLElement{
  const product=element('div','category-product',artwork(),element('h1','',device.name));
  const image=product.querySelector('img');
  if(image)image.loading='eager';
  const card=element('p','native-card device-control-unit device-unavailable-card','暂无可用的功能');
  return element('div','device-controls-region device-unavailable-content',product,
    element('div','device-card-stack',card));
}

export function deviceUnavailablePage(device:Device,back:()=>void,backLabel='返回家庭'):HTMLElement{
  const backButton=button('','page-icon-button',back,'back');
  backButton.setAttribute('aria-label',backLabel);
  const header=element('header','device-page-header',backButton,
    element('div','device-page-title',element('h2','',device.name)));
  const page=element('section','device-page page-unavailable',header,
    element('div','device-page-scroll',deviceUnavailableContent(device)));
  page.dataset.presentationTemplate='unavailable';
  page.tabIndex=-1;
  return deviceSurfaces(element('div','device-stage',page));
}
