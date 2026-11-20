/// <reference types="vite/client" />
import { invoke, isTauri } from '@tauri-apps/api/core';
import {ReadScheduler} from './read-scheduler';
import {desktopWidgets} from './desktop-widgets';
import type { LocalPreferences, PreferenceChange } from './local-preferences';
import type { DeviceUiResources } from './ui-schema';
import type {
  AccountProfile, AppError, ControlResult, DeviceContext, DevicePanel, Home, HomeSnapshot,
  Json, LoginPoll, QrView, SessionView, SensorHistory, HistorySelection, EnergySelection, EnergyReport, TimerReport, TimerChange, TimerChangeResult, CountdownChange, CountdownChangeResult, LightModeReport, LightSettingsReport, LightSettingsChange, LightSettingsResult,
} from './types';

const reads=new ReadScheduler(4);
const accountReads=new ReadScheduler(2,8);
const accountReadCommands=new Set(['list_homes','account_profile']);
const deduplicatedReads=new Set(['list_homes','account_profile','device_panel','device_preview','device_ui_resources','home_cards','home_card_presentations','home_card_large_available','home_scenes','home_preferences','camera_features','scale_history']);
let lifecycleBound=false;
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw { kind: 'desktop_required', message: '请在 Windows 桌面客户端中使用。浏览器预览无法连接小米云。', retryable: false } satisfies AppError;
  }
  if(!lifecycleBound){lifecycleBound=true;window.addEventListener('pagehide',()=>{reads.reset();accountReads.reset();},{once:true});}
  // Debug-only global guard shared by every HMR module instance. UI tests must
  // remain unable to reach native writes even if an API hook targets an old URL.
  if(import.meta.env.DEV){
    const guard=(window as Window&{__MIJIA_UI_TEST_GUARD?:{blocked:number}}).__MIJIA_UI_TEST_GUARD;
    const reads=['device_events','camera_features','session','account_profile','list_homes','select_home','refresh_devices','home_cards','confirm_home_card','device_panel','device_preview','device_ui_resources','read_properties','confirm_property','sensor_history','light_modes','light_settings','confirm_light_settings','light_favorites','confirm_light_favorite','history_detail','outlet_energy','outlet_timers','home_preferences'];
    reads.push('dispenser_selfcheck_records','confirm_dispenser_selfcheck','washer_config','washer_records','washer_record_detail','washer_program_preview','confirm_washer_program','purifier_records','purifier_statistics','purifier_dnd','purifier_options','dispenser_dnd','dispenser_records','dispenser_statistics','dispenser_reminders');
    reads.push('camera_auxiliary','camera_power','fryer','ir_remote','speaker_player','camera_care','camera_care_thumbnail','camera_care_video','vacuum','bath_heater','ceiling_fan','doorbell_cloud');
    reads.push('router_overview');
    const localOnly=['change_home_preferences'];
    reads.push('scale_history');
    reads.push('home_scenes','application_settings','application_devices','application_mcp_channels');
    reads.push('home_card_presentations');
    const groupConfirmation=command==='switch_group_control'&&args?.confirmOnly===true;
    const cardConfirmation=command==='home_card_control'&&(args?.change as {confirmOnly?:boolean}|undefined)?.confirmOnly===true;
    if(guard&&!reads.includes(command)&&!localOnly.includes(command)&&!cardConfirmation&&!groupConfirmation){guard.blocked++;throw {kind:'uiTestWriteBlocked',message:'界面验证已阻止原生写入。',retryable:false} satisfies AppError;}
  }
  if(['logout','start_login'].includes(command)){reads.reset();accountReads.reset();}
  else if(command==='select_home')reads.reset();
  // Writes, confirmations, property read batches and the sole media event reader
  // retain their original protocol scheduling.
  return deduplicatedReads.has(command)
    ? (accountReadCommands.has(command)?accountReads:reads).read(JSON.stringify([command,args??null]),()=>invoke<T>(command,args))
    : invoke<T>(command, args);
}

export const api = {
  assistantStatus:(refresh=false)=>call<import('./assistant-authorization').AssistantStatus>('assistant_status',{refresh}),
  startAssistantAuthorization:()=>call<QrView>('start_assistant_authorization'),
  pollAssistantAuthorization:(attemptId:string)=>call<{status:string;authorization:import('./assistant-authorization').AssistantStatus}>('poll_assistant_authorization',{attemptId}),
  cancelAssistantAuthorization:(attemptId:string)=>call<void>('cancel_assistant_authorization',{attemptId}),
  revokeAssistantAuthorization:()=>call<void>('revoke_assistant_authorization'),
  appUpdateStatus:()=>call<import('./application-settings').AppUpdateStatus>('app_update_status'),
  checkAppUpdate:()=>call<import('./application-settings').AppUpdateStatus>('check_app_update'),
  startAppUpdate:()=>call<import('./application-settings').AppUpdateStatus>('start_app_update'),
  appUpdateResult:()=>call<import('./application-settings').AppUpdateResult|null>('app_update_result'),
  acknowledgeAppUpdate:(id:string)=>call<void>('acknowledge_app_update',{id}),
  openAppReleaseNotes:()=>call<void>('open_app_release_notes'),
  openAppProject:(page:'github'|'issues')=>call<void>('open_app_project',{page}),
  applicationSettings:()=>call<import('./application-settings').ApplicationSettingsView>('application_settings'),
  changeApplicationSettings:(value:import('./application-settings').ApplicationSettings,autostart?:boolean)=>call<import('./application-settings').ApplicationSettingsView>('change_application_settings',{value,autostart:autostart??null}),
  mcpConnectionConfig:()=>call<string>('mcp_connection_config'),
  mcpRotateKey:()=>call<import('./application-settings').ApplicationSettingsView>('mcp_rotate_key'),

  mediaStorage:()=>call<import('./ui/media-storage-settings').MediaStorageView>('media_storage'),
  chooseMediaStorage:()=>call<import('./ui/media-storage-settings').MediaStorageView|null>('choose_media_storage'),
  resetMediaStorage:()=>call<import('./ui/media-storage-settings').MediaStorageView>('reset_media_storage'),
  openMediaStorage:()=>call<void>('open_media_storage'),
  scaleHistory:(c:DeviceContext,q:import('./scale').ScaleQuery)=>call<import('./scale').ScaleReport>('scale_history',{...c,...q}),
  changeScale:(c:DeviceContext,change:import('./scale').ScaleChange)=>call<import('./scale').ScaleChanged>('change_scale',{...c,change,requestId:crypto.randomUUID()}),
  cameraAuxiliary:(c:DeviceContext)=>call<import('./camera-types').CameraAuxSnapshot>('camera_auxiliary',{...c}),
  changeCameraAuxiliary:(c:DeviceContext,kind:'alarm'|'light',active:boolean,expectedActive:boolean)=>call<{report:import('./camera-types').CameraAuxSnapshot;confirmed:boolean}>('change_camera_auxiliary',{...c,kind,active,expectedActive}),
  cameraPower:(c:DeviceContext)=>call<import('./camera-types').CameraPower>('camera_power',{...c}),
  changeCameraPower:(c:DeviceContext,awake:boolean,expectedAwake:boolean)=>call<import('./camera-types').CameraPowerChanged>('change_camera_power',{...c,awake,expectedAwake}),
  monitorDetailOpen:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number)=>call<import('./monitor').MonitorDetail>('monitor_detail_open',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision}}),
  monitorDetailCommand:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number,leaseId:string,operation:import('./camera-types').CameraOperation)=>call<import('./camera-types').CameraReply>('monitor_detail_command',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision},leaseId,operation}),
  monitorMicrophone:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number,leaseId:string|null,packet:string)=>call<void>('monitor_detail_microphone',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision},leaseId,packet}),
  monitorDetailClose:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number,leaseId:string)=>call<void>('monitor_detail_close',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision},leaseId}),
  monitorWindow:(enabled:boolean)=>call<void>('monitor_window',{enabled}),
  monitorCatalog:(force=false)=>call<import('./monitor-catalog').MonitorCatalog>('monitor_catalog',{force}),
  changeMonitorSelection:(scope:string,homeId:string,did:string,excluded:boolean)=>call<import('./monitor-catalog').MonitorCatalog>('change_monitor_selection',{scope,homeId,did,excluded}),
  createMonitor:(c:import('./monitor').MonitorContext,dids:string[])=>c.allHomes?call<string>('create_monitor_all',{generation:c.generation,dids}):call<string>('create_monitor',{homeId:c.homeId,generation:c.generation,dids}),
  readMonitor:(c:import('./monitor').MonitorContext,viewerId:string)=>call<import('./monitor').MonitorRow[]>(c.allHomes?'read_monitor_all':'read_monitor',{homeId:c.homeId,generation:c.generation,viewerId}),
  retryMonitor:(c:import('./monitor').MonitorContext,viewerId:string,did:string)=>call<void>(c.allHomes?'retry_monitor_all':'retry_monitor',{homeId:c.homeId,generation:c.generation,viewerId,did}),
  stopMonitor:(c:import('./monitor').MonitorContext,viewerId:string)=>call<void>(c.allHomes?'stop_monitor_all':'stop_monitor',{homeId:c.homeId,generation:c.generation,viewerId}),
  monitorCommand:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number,operation:import('./monitor').MonitorOperation)=>call<import('./camera-types').CameraReply>('monitor_command',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision},operation}),
  monitorScreenshot:(c:import('./monitor').MonitorContext,viewerId:string,did:string,revision:number,png:string)=>call<import('./camera-types').SavedCameraMedia|null>('monitor_screenshot',{target:{homeId:c.memberHomes?.[did]??c.homeId,generation:c.generation,viewerId,did,revision},png}),
  fryer:(c:DeviceContext)=>call<import('./fryer').FryerSnapshot>('fryer',{...c}),
  changeFryer:(c:DeviceContext,baseline:string,change:import('./fryer').FryerChange)=>call<{report:import('./fryer').FryerSnapshot;confirmed:boolean}>('change_fryer',{...c,baseline,change,requestId:crypto.randomUUID()}),
  deviceEvents:(c:DeviceContext,date:string,cursor:string|null=null)=>call<import('./device-events').DeviceEventPage>('device_events',{...c,date,cursor}),
  vacuum:(c:DeviceContext)=>call<import('./vacuum').VacuumReport>('vacuum',{...c}),
  vacuumMap:(c:DeviceContext)=>call<import('./vacuum').VacuumMap>('vacuum_map',{...c}),
  changeVacuum:(c:DeviceContext,baseline:string,change:import('./vacuum').VacuumChange)=>call<import('./vacuum').VacuumChanged>('change_vacuum',{...c,baseline,change}),
  doorbellCloud:(c:DeviceContext,date:string)=>call<import('./doorbell').DoorbellCloudReport>('doorbell_cloud',{...c,date}),
  ceilingFan:(c:DeviceContext)=>call<import('./ceiling-fan').CeilingFanReport>('ceiling_fan',{...c}),
  changeCeilingFan:(c:DeviceContext,baseline:string,change:import('./ceiling-fan').CeilingFanChange)=>call<{report:import('./ceiling-fan').CeilingFanReport;confirmed:boolean}>('change_ceiling_fan',{...c,baseline,change}),
  bathHeater:(c:DeviceContext)=>call<import('./bath-heater').BathHeaterReport>('bath_heater',{...c}),
  changeBathHeater:(c:DeviceContext,baseline:string,change:import('./bath-heater').BathHeaterChange)=>call<{report:import('./bath-heater').BathHeaterReport;confirmed:boolean}>('change_bath_heater',{...c,baseline,change}),
  cameraCare:(c:DeviceContext,date:string)=>call<import('./camera-care').CareReport>('camera_care',{...c,date}),
  cameraCareThumbnail:(c:DeviceContext,date:string,eventId:string)=>call<string>('camera_care_thumbnail',{...c,date,eventId}),
  saveCloudVideo:(c:DeviceContext,date:string,eventId:string)=>call<import('./camera-types').SavedCameraMedia|null>('camera_cloud_save',{...c,date,eventId}),
  cameraCareVideo:async(c:DeviceContext,date:string,eventId:string):Promise<import('./cloud-video-sequence').CloudVideoSession>=>{
   const {session,parts}=await call<{session:string;parts:number[]}>('camera_care_video',{...c,date,eventId});
   let sequence=0;
   return {parts,
    read:(index,prefetch)=>call<ArrayBuffer>('camera_care_video_part',{...c,session,index,prefetch,sequence:++sequence}),
    close:()=>{void call<void>('camera_care_video_close',{session}).catch(()=>{});},
   };
  },
  speakerPlayer:(c:DeviceContext)=>call<import('./speaker').SpeakerPlayer>('speaker_player',{...c}),
  changeSpeaker:(c:DeviceContext,change:import('./speaker').SpeakerChange)=>call<void>('change_speaker',{...c,change}),
  cameraFeatures:(c:DeviceContext)=>call<import('./camera-types').CameraFeatures>('camera_features',{...c}),
  cameraCommand:(c:DeviceContext,sessionId:string,operation:import('./camera-types').CameraOperation)=>call<import('./camera-types').CameraReply>('camera_command',{...c,sessionId,operation}),
  cameraMicrophone:(c:DeviceContext,sessionId:string,packet:string)=>call<void>('camera_microphone',{...c,sessionId,packet}),
  cameraScreenshot:(c:DeviceContext,sessionId:string,png:string)=>call<import('./camera-types').SavedCameraMedia|null>('camera_screenshot',{...c,sessionId,png}),
  cameraMediaFolder:(c:DeviceContext,exportId:string)=>call<void>('camera_media_folder',{...c,exportId}),
  startCamera:(c:DeviceContext,quality?:string)=>call<string>('start_camera',{...c,quality}),
  readCamera:(c:DeviceContext,sessionId:string)=>call<import('./camera-types').CameraEvent[]>('read_camera',{...c,sessionId}),
  stopCamera:(c:DeviceContext,sessionId:string)=>call<void>('stop_camera',{...c,sessionId}),
  irRemote:(c:DeviceContext)=>call<import('./ir-remote').IrReport>('ir_remote',{...c}),
  sendIrKey:(c:DeviceContext,baseline:string,name:string,nonce:string)=>call<string>('send_ir_key',{...c,baseline,name,nonce}),
  dispenserDnd:(context:DeviceContext)=>call<import('./dispenser-dnd').DispenserDndReport>('dispenser_dnd',{...context}),
  changeDispenserDnd:(context:DeviceContext,change:import('./dispenser-dnd').DispenserDndChange)=>call<{verified:boolean;message:string;report:import('./dispenser-dnd').DispenserDndReport|null}>('change_dispenser_dnd',{...context,change}),
  changeDispenser:(context:DeviceContext,change:import('./dispenser').DispenserChange)=>call<ControlResult>('change_dispenser',{...context,change}),
  resetFridge:(context:DeviceContext,expected:import('./fridge').FridgeSnapshot)=>call<ControlResult>('reset_fridge',{...context,expected}),
  changeFridge:(context:DeviceContext,change:import('./fridge').FridgeChange)=>call<ControlResult>('change_fridge',{...context,change}),
  airerLift:(context:DeviceContext,change:import('./airer').AirerLiftChange)=>call<ControlResult>('airer_lift',{...context,change}),
  saveAirerNight:(context:DeviceContext,change:import('./airer').AirerNightChange)=>call<ControlResult>('save_airer_night',{...context,change}),
  purifierOptions:(context:DeviceContext)=>call<import('./purifier-options').PurifierOptionsReport>('purifier_options',{...context}),
  changePurifierPush:(context:DeviceContext,change:import('./purifier-options').PurifierPushChange)=>call<import('./purifier-options').PurifierPushResult>('change_purifier_push',{...context,change}),
  purifierDnd:(context:DeviceContext)=>call<import('./purifier-dnd').PurifierDndReport>('purifier_dnd',{...context}),
  changePurifierDnd:(context:DeviceContext,change:import('./purifier-dnd').PurifierDndChange)=>call<import('./purifier-dnd').PurifierDndResult>('change_purifier_dnd',{...context,change}),
  purifierRecords:(context:DeviceContext,query:import('./purifier-history').WaterQuery)=>call<import('./purifier-history').WaterRecordPage>('purifier_records',{...context,query}),
  dispenserRecords:(context:DeviceContext,before:number|null)=>call<import('./dispenser-history').DrinkRecords>('dispenser_records',{...context,before}),
  dispenserSelfCheck:(context:DeviceContext,change:import('./dispenser-selfcheck').CheckChange)=>call<ControlResult>('dispenser_selfcheck',{...context,change}),
  confirmDispenserSelfCheck:(context:DeviceContext,change:import('./dispenser-selfcheck').CheckChange)=>call<ControlResult>('confirm_dispenser_selfcheck',{...context,change}),
  dispenserSelfCheckRecords:(context:DeviceContext)=>call<import('./dispenser-selfcheck').CheckRecords>('dispenser_selfcheck_records',{...context}),
  dispenserSterilization:(context:DeviceContext,change:import('./dispenser-sterilization').SterilizationChange)=>call<ControlResult>('dispenser_sterilization',{...context,change}),
  dispenserReminders:(context:DeviceContext)=>call<import('./dispenser-reminders').ReminderReport>('dispenser_reminders',{...context}),
  changeDispenserReminder:(context:DeviceContext,change:import('./dispenser-reminders').ReminderChange)=>call<import('./dispenser-reminders').ReminderResult>('change_dispenser_reminder',{...context,change}),
  dispenserStatistics:(context:DeviceContext,selection:import('./dispenser-history').DrinkSelection)=>call<import('./dispenser-history').DrinkStatistics>('dispenser_statistics',{...context,selection}),
  purifierStatistics:(context:DeviceContext,selection:import('./purifier-history').WaterSelection)=>call<import('./purifier-history').WaterStatistics>('purifier_statistics',{...context,selection}),
  savePurifierCups:(context:DeviceContext,expected:string,cups:import('./purifier').PurifierCup[])=>call<ControlResult>('save_purifier_cups',{...context,expected,cups}),
  washerProgramPreview:(context:DeviceContext,draft:import('./washer-commands').WasherProgramInput)=>call<import('./washer-commands').WasherProgramPreview>('washer_program_preview',{...context,draft}),
  startWasherProgram:(context:DeviceContext,requestId:string,draft:import('./washer-commands').WasherProgramInput)=>call<import('./washer-commands').WasherCommandResult>('start_washer_program',{...context,requestId,draft}),
  confirmWasherProgram:(context:DeviceContext,requestId:string)=>call<import('./washer-commands').WasherCommandResult>('confirm_washer_program',{...context,requestId}),
  washerRecords:(context:DeviceContext,range:import('./washer-records').WasherLogRange,cursor:string|null)=>call<import('./washer-records').WasherRecordReport>('washer_records',{...context,range,cursor}),
  washerRecordDetail:(context:DeviceContext,range:import('./washer-records').WasherLogRange,cursor:string|null,recordId:string)=>call<import('./washer-records').WasherRecordDetail>('washer_record_detail',{...context,range,cursor,recordId}),
  washerConfig:(context:DeviceContext)=>call<import('./washer').WasherConfigReport>('washer_config',{...context}),
  session: () => call<SessionView>('session'),
  accountProfile:()=>call<AccountProfile>('account_profile'),
  homePreferences: (homeId: string, generation: number) => call<LocalPreferences>('home_preferences', { homeId, generation }),
  changeHomePreferences: (homeId: string, generation: number, change: PreferenceChange) => call<LocalPreferences>('change_home_preferences', { homeId, generation, change }),
  startLogin: (region: string) => call<QrView>('start_login', { region }),
  pollLogin: (attemptId: string) => call<LoginPoll>('poll_login', { attemptId }),
  cancelLogin: (attemptId: string) => call<void>('cancel_login', { attemptId }),
  logout: () => call<void>('logout'),
  listHomes: () => call<Home[]>('list_homes'),
  selectHome: (homeId: string) => call<HomeSnapshot>('select_home', { homeId }),
  refreshDevices: (homeId: string, generation: number) => call<HomeSnapshot>('refresh_devices', { homeId, generation }),
  devicePanel: (context: DeviceContext) => call<DevicePanel>('device_panel', { ...context }),
  homeCards:(homeId:string,generation:number,ids?:string[])=>call<import('./types').HomeCardReport>('home_cards',{homeId,generation,ids}),
  homeCardPresentations:(homeId:string,generation:number,ids:string[])=>call<import('./types').PresentationUpdate[]>('home_card_presentations',{homeId,generation,ids}),
  homeCardLargeAvailable:(homeId:string,generation:number,did:string)=>call<boolean>('home_card_large_available',{homeId,generation,did}),
  homeCardControl:(context:DeviceContext,change:import('./types').CardControlChange)=>call<import('./types').CardControlResult>('home_card_control',{...context,change}),
  changeSwitchGroup:(context:DeviceContext,groupId:string,on:boolean,requestId:string,confirmOnly=false)=>call<import('./types').SwitchGroupResult>('switch_group_control',{...context,groupId,on,requestId,confirmOnly}),
  homeScenes:(homeId:string,generation:number)=>call<import('./home-scenes').HomeSceneReport>('home_scenes',{homeId,generation}),
  runHomeScene:(homeId:string,generation:number,sceneId:string,requestId:string)=>call<void>('run_home_scene',{homeId,generation,sceneId,requestId}),
  routerOverview:(context:DeviceContext)=>call<import('./types').RouterReport>('router_overview',{...context}),
  changeHomeCard:(context:DeviceContext,intent:import('./types').HomeCardIntent)=>desktopWidgets.control(intent,false,context),
  confirmHomeCard:(context:DeviceContext,intent:import('./types').HomeCardIntent)=>desktopWidgets.control(intent,true,context),
  deviceUiResources: (context: DeviceContext) => call<DeviceUiResources>('device_ui_resources', { ...context }),
  devicePreview:(context:DeviceContext)=>call<{panel:DevicePanel;cachedAt:number|null;hasCachedState:boolean}>('device_preview',{...context}),
  readProperties: (context: DeviceContext) => call<DevicePanel>('read_properties', { ...context }),
  observeProperties: (context: DeviceContext) => call<DevicePanel>('read_properties', { ...context, observed:true }),
  sensorHistory: (context: DeviceContext) => call<SensorHistory>('sensor_history', { ...context }),
  lightModes: (context: DeviceContext) => call<LightModeReport>('light_modes', { ...context }),
  lightSettings:(context:DeviceContext)=>call<LightSettingsReport>('light_settings',{...context}),
  changeLightSettings:(context:DeviceContext,change:LightSettingsChange)=>call<LightSettingsResult>('change_light_settings',{...context,change}),
  confirmLightSettings:(context:DeviceContext,change:LightSettingsChange)=>call<LightSettingsResult>('confirm_light_settings',{...context,change}),
  lightFavorites:(context:DeviceContext)=>call<import('./types').LightFavoritesReport>('light_favorites',{...context}),
  changeLightFavorite:(context:DeviceContext,change:import('./types').LightFavoriteChange)=>call<import('./types').LightFavoriteResult>('change_light_favorite',{...context,change}),
  confirmLightFavorite:(context:DeviceContext,change:import('./types').LightFavoriteChange)=>call<import('./types').LightFavoriteResult>('confirm_light_favorite',{...context,change}),
  historyDetail: (context: DeviceContext, selection: HistorySelection) => call<SensorHistory>('history_detail', { ...context, selection }),
  outletEnergy:(context:DeviceContext,selection:EnergySelection)=>call<EnergyReport>('outlet_energy',{...context,selection}),
  outletTimers:(context:DeviceContext)=>call<TimerReport>('outlet_timers',{...context}),
  changeOutletTimer:(context:DeviceContext,change:TimerChange)=>call<TimerChangeResult>('change_outlet_timer',{...context,change}),
  changeOutletCountdown:(context:DeviceContext,change:CountdownChange)=>call<CountdownChangeResult>('change_outlet_countdown',{...context,change}),
  setProperty: (context: DeviceContext, siid: number, piid: number, value: Json) =>
    call<ControlResult>('set_property', { ...context, siid, piid, value }),
  confirmProperty:(context:DeviceContext,siid:number,piid:number,value:Json)=>call<ControlResult>('confirm_property',{...context,siid,piid,value}),
  runAction: (context: DeviceContext, siid: number, aiid: number, inputs: Json[]) =>
    call<ControlResult>('run_action', { ...context, siid, aiid, inputs }),
};
