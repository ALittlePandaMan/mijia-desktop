/** Page scope only: protocol capabilities and raw readings remain intact. */
export function isSensorCategory(category:string|null|undefined):boolean{
 return !!category&&(/-sensor$/.test(category)||['air-monitor','air-quality-monitor'].includes(category));
}
export function sensorReadingVisible(category:string|null|undefined,service:string,name:string):boolean{
 if(!isSensorCategory(category))return true;
 if(service==='battery')return name==='battery-level';
 const current=new Set(['temperature','relative-humidity','illumination','battery-level','ble-battery-level','occupancy-status','contact-state','gas-concentration','smoke-concentration','pm2.5-density','pm10-density','co2-density','air-quality','status','submersion-state','motion-state','motion-detection-state','pressure-present-state','wind-speed','rainfall','atmospheric-pressure']);
 return current.has(name)&&['temperature-humidity-sensor','environment','occupancy-sensor','magnet-sensor','gas-sensor','smoke-sensor','air-monitor','air-quality-monitor','motion-sensor','submersion-sensor','illumination-sensor','vibration-sensor','pressure-sensor','battery-service','ble-battery'].includes(service);
}
