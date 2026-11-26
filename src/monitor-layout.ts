export const monitorPresets=[1,4,6,8,9,13,16] as const;
export type MonitorPreset=typeof monitorPresets[number];

export function monitorPresetLimit(count:number):MonitorPreset {
 return monitorPresets.find(preset=>preset>=count)??16;
}

export function monitorPresetGrid(preset:MonitorPreset):{columns:number;rows:number} {
 const side=Math.ceil(Math.sqrt(preset));
 return {columns:side,rows:side};
}

export function monitorPresetKey(account:string|undefined,homeId:string|null):string|undefined {
 if(account)return `mijia.monitor-preset.v1:${JSON.stringify([account,homeId])}`;
}

export function readMonitorPreset(key:string|undefined):MonitorPreset|undefined {
 if(!key)return;
 try{const value=localStorage.getItem(key);return monitorPresets.find(preset=>String(preset)===value);}catch{/* The wall still works without storage. */}
}

export function writeMonitorPreset(key:string|undefined,preset:MonitorPreset):void {
 if(key)try{localStorage.setItem(key,String(preset));}catch{/* Keep the selection for the current wall. */}
}
