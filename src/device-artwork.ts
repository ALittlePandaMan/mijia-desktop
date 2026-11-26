import type {Device} from './types';

export interface DeviceArtworkSource {url:string;source:'device-custom'|'device-list'|'product-config'}

function usableArtwork(url:string|null|undefined):url is string {
  if(!url)return false;
  if(/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url))return true;
  try {
    const parsed=new URL(url);
    if(parsed.username||parsed.password)return false;
    if(parsed.protocol==='https:')return true;
    // Older Mi Home cover URLs use HTTP on Xiaomi's image CDNs. Preserve
    // their original paths and signatures; never upgrade a signed URL.
    return parsed.protocol==='http:'&&(!parsed.port||parsed.port==='80')&&['fds.api.mi-img.com','fds.api.xiaomi.com'].some(host=>parsed.hostname.endsWith(`.${host}`));
  } catch {return false;}
}

export function deviceArtworkSources(device:Pick<Device,'customIcon'|'icon'|'productIcon'>,product=false):DeviceArtworkSource[] {
  const custom:DeviceArtworkSource={url:device.customIcon??'',source:'device-custom'};
  const card:DeviceArtworkSource={url:device.icon??'',source:'device-list'};
  const model:DeviceArtworkSource={url:device.productIcon??'',source:'product-config'};
  const seen=new Set<string>();
  return [custom,...(product?[model,card]:[card,model])].filter(({url})=>{
    if(!usableArtwork(url)||seen.has(url))return false;
    seen.add(url);return true;
  });
}
