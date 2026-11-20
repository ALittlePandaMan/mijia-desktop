// Camera event queries use UTC+8 in the native backend, independently of the PC.
const offsetSeconds = 8 * 3600;
export function cameraDate(seconds:number):string{return new Date((seconds+offsetSeconds)*1000).toISOString().slice(0,10);}
export function cameraHour(seconds:number):number{return new Date((seconds+offsetSeconds)*1000).getUTCHours();}
export function cameraDayStart(date:string):number{return Date.parse(date+'T00:00:00+08:00')/1000;}
