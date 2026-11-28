import {element} from './dom';
import avatar1 from '../assets/mijia/library/33b23f20d3f1901427be4de6c52701e089faf552680a9351178f23549ab72226.png?url&no-inline';
import avatar2 from '../assets/mijia/library/bb4cf03eefeadae8ba5992ddac17bd3436f5ac7bb591de3ad1831c26ce7198f5.png?url&no-inline';
import avatar3 from '../assets/mijia/library/07912a0ac34734571774813b277453c1d440c8bd6ad5a31bb8f004912cd976c1.png?url&no-inline';
import avatar4 from '../assets/mijia/library/fcaf80dae160fb3375c18a55c7a07992b1679617cbc59bcfe2d27cb3c07a1567.png?url&no-inline';
import avatar5 from '../assets/mijia/library/6ea870df69d952adfb062586801516647fc85d4001c27a7396f1f906d43d99bd.png?url&no-inline';
import avatar6 from '../assets/mijia/library/11fb1718e24c1c64efee3bd3d0a046d74fde933d2e370a2f67d806bb0f00c3b3.png?url&no-inline';

const avatars=[avatar1,avatar2,avatar3,avatar4,avatar5,avatar6];
export function scaleAvatar(iconId?:string,accountPhoto?:string|null):HTMLImageElement {
  const image=element('img','scale-avatar');
  const fallback=avatars[Number(iconId)-1]??avatar2;
  image.alt='';
  image.decoding='async';
  image.referrerPolicy='no-referrer';
  const photo=accountPhoto??(iconId?.startsWith('https://')?iconId:undefined);
  if(photo)image.addEventListener('error',()=>{image.src=fallback;},{once:true});
  image.src=photo??fallback;
  return image;
}
