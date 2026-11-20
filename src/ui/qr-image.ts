import {element} from './dom';
export function qrImage(dataUrl:string,alt='小米账号登录二维码'):HTMLImageElement{const img=element('img','qr-image');img.alt=alt;if(/^data:image\/(png|svg\+xml|jpeg|webp|gif);/.test(dataUrl))img.src=dataUrl;return img;}
