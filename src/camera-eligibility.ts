import type {Device} from './types';

export function cameraPageEligible(device:Device):boolean{
 return ['camera','video-doorbell','doorbell'].includes(device.specType?.split(':')[3]??'')||/\.(?:camera|cateye)\./.test(device.model);
}
