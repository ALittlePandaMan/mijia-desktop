import profiles from './camera-profiles.json';
/** Shared with Rust; only models whose original storage adapters were inspected. */
export function cloudDoorbellProfile(model:string){return profiles.cloudDoorbells.find(p=>p.models.includes(model));}
export function cameraCardProfile(model:string){return profiles.sd.find(p=>p.models.includes(model));}
export function cameraMediaProfile(model:string){return profiles.media.find(p=>p.family==='miss'&&!p.minimumFirmware&&p.models.includes(model));}
export function cameraCareSupported(model:string){return profiles.media.some(p=>p.family==='miss'&&p.care&&p.models.includes(model));}
