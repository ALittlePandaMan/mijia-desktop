export interface HomeTarget{scope:string;homeId:string}
export function mcpHomeSelected(settings:ApplicationSettings['mcp'],scope:string|null,homeId:string):boolean{return !!scope&&!settings.excludedHomes.some(h=>h.scope===scope&&h.homeId===homeId);}
export function selectMcpHome(settings:ApplicationSettings['mcp'],scope:string,homeId:string,selected:boolean):void{
 settings.excludedHomes=settings.excludedHomes.filter(h=>h.scope!==scope||h.homeId!==homeId);
 if(!selected)settings.excludedHomes.push({scope,homeId});
}
export type StartupMonitorTarget=HomeTarget|{scope:string;allHomes:true};
export interface ApplicationSettings{
 version:1;startupMonitor:boolean;startupHome:StartupMonitorTarget|null;closeToTray:boolean;keepAwake:boolean;
 mcp:{enabled:boolean;localPort:number;excludedHomes:HomeTarget[]};
}
export interface ApplicationSettingsView{
 settings:ApplicationSettings;autostart:boolean;scope:string|null;
  mcpStatus:{state:'running'|'stopped'|'error';localUrl?:string;error?:{message:string}};
  update:AppUpdateStatus;
}
export interface AppUpdateStatus{
 revision:number;state:'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing'|'error';
 currentVersion:string;latestVersion:string|null;notes:string|null;checkedAt:string|null;
 downloadedBytes:number;totalBytes:number|null;message:string;packageKind:'installer'|'portable';supported:boolean;canInstall:boolean;canDownload:boolean;
}
export interface AppUpdateResult{id:string;previousVersion:string;version:string;notes:string}
