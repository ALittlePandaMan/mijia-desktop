import {dismissOnBackdrop} from './ui/dialog-dismiss';
import {DeviceEventsState} from './device-events';
import {ScaleState,isScale} from './scale';
import {ScalePage} from './ui/scale-page';
import {renderDeviceEvents} from './ui/device-events';
import {deviceSurfaces} from './ui/device-surfaces';
import {CameraPlayer,cameraPageEligible} from './camera-player';
import {loginPage} from './ui/login-page';
import {RouterSceneState} from './router-scene';
import {IrRemoteState,isIrRemote} from './ir-remote';
import {irRemotePage} from './ui/ir-remote-page';
import {televisionPage} from './ui/television-page';
import {televisionPageEligible,type TelevisionRole} from './television';
import {VacuumState,vacuumModel} from './vacuum';
import {vacuumPage} from './ui/vacuum-page';
import {CurtainMotion} from './curtain-motion';
import {operationFeedback} from './ui/operation-feedback';
import {RouterDailyState} from './router-daily';
import {dailyActionLabel,dailyPanel,dailyRouterView} from './daily-scope';
import { capabilityCategory,resolveDeviceCapabilities,hasCapabilityCategory } from './device-capabilities';
import { renderCategoryPage } from './ui/category-page';
import {speakerPage} from './ui/speaker-page';
import {lightWhitePresets} from './ui/light-white';
import {speakerMetadataSupported,SpeakerState} from './speaker';
import {BathHeaterState,bathHeaterModel} from './bath-heater';
import {bathHeaterPage} from './ui/bath-heater-page';
import {CeilingFanState,ceilingFanModel} from './ceiling-fan';
import {FryerState,fryerModel,type FryerView} from './fryer';
import {fryerPage} from './ui/fryer-page';
import {ceilingFanPage} from './ui/ceiling-fan-page';
import {DoorbellState,isCloudDoorbell,doorbellBattery} from './doorbell';
import {doorbellPage} from './ui/doorbell-page';
import {DoorbellPlayer} from './doorbell-player';
import {DevicePresentationRoute,dedicatedPage,presentationReady,PRESENTATION_VERSION} from './device-presentation-route';
import {deviceChoiceLabel,devicePropertyLabel,deviceServiceLabel} from './device-labels';
import './style.css';
import {setupDesktopFrame} from './ui/desktop-frame';
import './login.css';
import './theme.css';
import './ui/quiet-feedback.css';
import { api } from './api';
import { PropertyOperations,type PropertyReply } from './property-operations';
import {cardActive,cardCaption,cardDisplay,cardReportedIntent} from './home-cards';
import {RouterState,routerModel,type RouterView} from './router';
import {RouterIndicatorState} from './router-indicator';
import {RouterWifiState} from './router-wifi';
import {RouterAdvancedState} from './router-advanced';
import {RouterInternetState} from './router-internet';
import {RouterPasswordState} from './router-password';
import {RouterClientNameState} from './router-client-name';
import {RouterClassificationState} from './router-classification';
import {RouterQosState} from './router-qos';
import {RouterAccessState} from './router-access';
import {RouterUrlState} from './router-url';
import {RouterFamilyState} from './router-family';
import {RouterBlockRecordsState} from './router-block-records';
import {canonicalClientMac,COMMON_LIMIT,RouterCommonState} from './router-common';
import {RouterNetworkState} from './router-network';
import {routerPage} from './ui/router-page';
import {homeShortcut,updateHomeShortcut} from './ui/home-shortcut';
import type {HomeCardEntry,HomeCardIntent,HomeCardReport} from './types';
import { CountdownOperation } from './countdown-operation';
import { deviceIcon, icon, officialIcon, type IconName } from './icons';
import { orderedRooms, visibleHomeDevices } from './home-order';
import { localDevices, mergeVisibleOrder, PreferenceOperations, type PreferenceChange } from './local-preferences';
import {settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView} from './ui/settings-page';
import {MonitorWall} from './ui/monitor-wall';
import { washerPage, type WasherView } from './ui/washer-page';
import { WasherRecords } from './washer-records';
import {WasherCommands} from './washer-commands';
import {WasherRuntimeCommands,type WasherRuntimeControl} from './washer-runtime';
import {washerRuntimePage} from './ui/washer-runtime-page';
import { washerRecordsPage } from './ui/washer-records-page';
import { changeWasherDraft, newWasherDraft, washerPrograms, type WasherConfigReport, type WasherDraft } from './washer';
import { DeviceDrag } from './ui/device-drag';
import {DeviceOpening} from './device-opening';
import { CardPress } from './ui/card-press';
import { deviceColumnCount } from './home-grid';
import { bindScrollStrip } from './ui/scroll-strip';
import {PurifierCommands,cupDraft,newPurifierView,type PurifierView} from './purifier';
import {purifierPage} from './ui/purifier-page';
import {purifierSettingsPage} from './ui/purifier-settings-page';
import {PurifierDnd} from './purifier-dnd';
import {PurifierOptions} from './purifier-options';
import {purifierGuidePage} from './ui/purifier-guide';
import {purifierDndPage} from './ui/purifier-dnd-page';
import {AirerCommands,airerModel,airerProfile,airerStatus,airerNight,type AirerView} from './airer';
import {airerPage} from './ui/airer-page';
import {FridgeCommands,fridgeModel,fridgeProfile,fridgeProperty,fridgeCurrent,type FridgeView} from './fridge';
import {fridgePage} from './ui/fridge-page';
import {dispenserPage} from './ui/dispenser-page';
import {DispenserCommands,dispenserModel,dispenserProfile,type DispenserView} from './dispenser';
import {DispenserDnd} from './dispenser-dnd';
import {dispenserDndPage} from './ui/dispenser-dnd-page';
import {DispenserHistory} from './dispenser-history';
import {DispenserReminders,type ReminderView} from './dispenser-reminders';
import {dispenserRemindersPage} from './ui/dispenser-reminders-page';
import {DispenserSelfCheck} from './dispenser-selfcheck';
import {dispenserSelfCheckPage} from './ui/dispenser-selfcheck-page';
import {DispenserSterilization,sterilizationState} from './dispenser-sterilization';
import {dispenserSterilizationPage} from './ui/dispenser-sterilization-page';
import {dispenserHistoryPage} from './ui/dispenser-history-page';
import {isPurifierSetting,purifierSetting} from './purifier-settings';
import {PurifierHistory,type WaterSelection} from './purifier-history';
import {purifierHistoryPage} from './ui/purifier-history-page';
import type {PurifierCalendar} from './ui/purifier-calendar';
import { dateKey, historyExtremes, sensorHistorySlots } from './history';
import { coercePropertyInput, displayValue, initialInput, inputUnsupportedReason, isSessionError, normalizeError, reportedValueText, sameContext, writeUnsupportedReason } from './logic';
import { booleanValue, climateChoiceLabel, controlReason, enumValue, fanModeLabel, fanSpeedProperty, findProperty, isReadableValue, lightGroupCounts, numericValue, hasObservedDeviceLayout, miotCategory, panelLayout, splitChildren, switchServices } from './panel-layout';
import type { Action, AppError, Device, DeviceContext, DevicePanel, Home, HomeSnapshot, Json, Property, QrView, Service, SessionView, SensorHistory, HistorySelection } from './types';

import { button, element } from './ui/dom';
import {enter,leave} from './ui/motion';
import { deviceLoading,deviceWait } from './ui/device-loading';
import { productHeader } from './ui/product-header';
import { preserveDeviceArtwork } from './ui/preserve-device-artwork';
import { renderLightColor } from './ui/light-color';
import { renderLightModes } from './ui/light-modes';
import { renderLightSettings } from './ui/light-settings';
import { renderLightFavorite } from './ui/light-favorite';
import { favoriteDraft,favoriteChange,favoriteWrites,LightFavoriteOperation,type LightFavoriteDraft } from './light-favorites';
import type { LightFavorite,LightFavoriteChange,LightFavoritesReport } from './types';
import { LightSettingsOperation,settingsDraft,settingsChange,type LightSettingsDraft,type LightSettingsKind } from './light-settings';
import type { LightSettingsReport } from './types';
import type { LightModeReport } from './types';
import { lightColorTab, lightTint, rgbPropertyReason, rgbValue, type LightColorTab } from './light-color';
import type {AccountProfile} from './types';
import { renderControl, type ControlNode } from './ui/controls';
import { compilePanelDocument as compileFullPanelDocument, type ComponentNode, type DeviceUiResources, type PanelDocument } from './ui-schema';
import { renderPanelDocument } from './ui/schema-renderer';
import type { PanelLayout } from './panel-layout';
import { disposeHistoryCharts, historyChart } from './ui/history-chart';
import { renderHistoryDetail } from './ui/history-detail';
import { energySupported } from './energy';
import { energyEntrance,renderEnergyPage } from './ui/energy-page';
import {switchPolicy} from './switch-mode';
import type { EnergyReport,EnergySelection } from './types';
import type { TimerReport,TimerDraft,TimerEntry,TimerMode,TimerChange,CountdownChange } from './types';
import { timerDraft,timerDraftProblem } from './timers';
import { renderTimerPage,type TimerModal } from './ui/timer-page';
import { durationDialog } from './ui/countdown';
import { countdownUpdate,type CountdownDraft } from './countdown';
type LoginState = 'idle' | 'loading' | 'ready' | 'expired' | 'error';
interface Notice { tone: 'success' | 'warning' | 'error'; title: string; message?: string }
interface PendingAction { action: Action; service: Service; inputs: Json[] }
interface CardArrangement { homeId: string; generation: number; roomId: string; original: string[]; order: string[]; all: string[]; selected: Set<string> }

function loading(label: string): HTMLElement {
  return deviceLoading(element('span','device-artwork',icon('device')),label,true);
}

function notice(info: Notice): HTMLElement {
  const box = element('div', `notice notice-${info.tone}`, icon(info.tone === 'success' ? 'check' : info.tone === 'warning' ? 'info' : 'warning'), element('div', '', element('strong', '', info.title), info.message ? element('p', '', info.message) : null));
  box.setAttribute('role', info.tone === 'error' ? 'alert' : 'status');
  return box;
}

function emptyState(title: string, message: string, iconName: IconName = 'device'): HTMLElement {
  return element('div', 'empty-state', element('div', 'empty-icon', icon(iconName)), element('h3', '', title), element('p', '', message));
}

const regions: [string, string][] = [
  ['cn', '中国大陆'], ['de', '欧洲'], ['us', '美国'], ['ru', '俄罗斯'],
  ['tw', '中国台湾'], ['sg', '新加坡'], ['in', '印度'], ['i2', '印度（i2）'],
];

const compilePanelDocument=(options:Parameters<typeof compileFullPanelDocument>[0])=>compileFullPanelDocument({...options,panel:dailyPanel(options.panel)});

export class App {
  private disposed=false;
  private lifetime=new AbortController();
  private deviceOpening=new DeviceOpening(()=>{if(this.context)this.render(true);});
  private devicePreviewCache=new Map<string,{panel:DevicePanel;cachedAt:number;hasCachedState:boolean;washerConfig?:WasherConfigReport;at:number}>();
  private washerConfig:WasherConfigReport|undefined;
  private washerLoading=false;
  private washerProgramsOpen=false;
  private washerError:string|undefined;
  private washerView:WasherView='home';
  private washerDraft:WasherDraft|undefined;
  private washerOrderAt:number|undefined;
  private washerRuntimeConfirmation:WasherRuntimeControl|undefined;
  private washerRuntimeExitTimer:ReturnType<typeof setTimeout>|undefined;
  private washerRuntimeCommands=new WasherRuntimeCommands({action:api.runAction,write:api.setProperty,read:api.readProperties},()=>{if(this.context)this.render(true);},(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;}},error=>this.handleSessionError(error));
  private washerCommands=new WasherCommands({preview:api.washerProgramPreview,start:api.startWasherProgram,confirm:api.confirmWasherProgram},()=>{if(this.washerCommands.result?.status==='confirmed'){this.washerOrderAt=undefined;if(this.panel?.washerRuntime?.active){this.washerView='runtime';this.washerDraft=undefined;}}if(this.context&&['program','runtime'].includes(this.washerView))this.render(true);},panel=>{if(this.context?.did===panel.did){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;}},error=>this.handleSessionError(error));
  private washerRecords=new WasherRecords({records:api.washerRecords,detail:api.washerRecordDetail},()=>{if(this.context&&this.washerView==='records')this.render(true);},error=>this.handleSessionError(error));
  private root = document.querySelector<HTMLDivElement>('#app')!;
  private session: SessionView | undefined;
  private accountProfile:AccountProfile|undefined;
  private profileError=false;
  private starting = true;
  private region = 'cn';
  private loginState: LoginState = 'idle';
  private loginError: AppError | undefined;
  private qr: QrView | undefined;
  private loginEpoch = 0;
  private loginTimer: ReturnType<typeof setTimeout> | undefined;
  private homes: Home[] = [];
  private homesLoading = false;
  private homeError: AppError | undefined;
  private selectedHomeId = '';
  private snapshot: HomeSnapshot | undefined;
  private homeEpoch = 0;
  private homeCards:HomeCardReport|undefined;
  private routerPassword=new RouterPasswordState(api.routerPassword,()=>{if(this.context&&this.routerView.page==='home')this.render(true);},e=>this.handleSessionError(e));
  private routerView:RouterView={page:'home',tab:'online'};
  private router=new RouterState(api.routerOverview,()=>{if(this.context&&!this.routerFamily.draft&&!this.routerFamily.modalOpen&&!this.routerUrl.input&&!this.routerUrl.editing&&!this.routerPassword.modalOpen&&!this.routerClientName.modalOpen&&!this.routerClassification.picker&&!this.routerQos.modalOpen&&!this.routerQos.dragging&&!this.routerAccess.modalOpen&&!this.routerAccess.editing&&!this.routerAccess.batching&&!this.routerCommon.limitMac&&!['wifi','advanced','internet','ports','ipv6'].includes(this.routerView.page)&&!this.routerIndicator.picker&&!this.routerIndicator.confirmOff)this.render(true);},error=>this.handleSessionError(error));
  private routerClientName=new RouterClientNameState({save:api.changeRouterClientName,confirm:api.confirmRouterClientName},()=>{if(this.context&&this.routerView.page==='client')this.render(true);},error=>this.handleSessionError(error),(context,client)=>this.router.applyClient(context,client));
  private routerFamily=new RouterFamilyState({read:api.routerFamily,save:api.changeRouterFamily,confirm:api.confirmRouterFamily},()=>{if(this.context&&['client','family'].includes(this.routerView.page)&&!this.routerClientName.modalOpen&&!this.routerQos.modalOpen)this.render(true);},e=>this.handleSessionError(e),()=>{if(this.context){this.navigateRouter({...this.routerView,page:'client'});void this.routerFamily.read({...this.context});}});
  private routerUrl=new RouterUrlState({read:api.routerUrl,save:api.changeRouterUrl,confirm:api.confirmRouterUrl},()=>{if(this.context&&['client','website','urlBlack','urlWhite'].includes(this.routerView.page)&&!this.routerClientName.modalOpen&&!this.routerClassification.picker&&!this.routerQos.modalOpen)this.render(true);},e=>this.handleSessionError(e),(op,r)=>{if(this.context&&this.routerView.page==='website'&&op.kind==='mode'&&op.value!=='none'&&r[op.value].length===0)this.navigateRouter({...this.routerView,page:op.value==='black'?'urlBlack':'urlWhite'});});
  private routerRecords=new RouterBlockRecordsState(api.routerBlockRecords,()=>{if(this.context&&this.routerView.page==='blockRecords')this.render(true);},e=>this.handleSessionError(e));
  private routerAccess=new RouterAccessState({readiness:api.routerWhitelistReady,finish:api.finishRouterWhitelist,read:api.routerAccess,save:api.changeRouterAccess,confirm:api.confirmRouterAccess},()=>{if(this.context&&['client','access','filterList'].includes(this.routerView.page)&&!this.routerClientName.modalOpen)this.render(true);},e=>this.handleSessionError(e),()=>{if(this.context)void this.router.load({...this.context});});
  private routerQos=new RouterQosState({read:api.routerQos,save:api.changeRouterQos,confirm:api.confirmRouterQos},()=>{if(this.context&&['client','qos'].includes(this.routerView.page)&&!this.routerClientName.modalOpen)this.render(true);},e=>this.handleSessionError(e));
  private routerClassification=new RouterClassificationState({read:api.routerClassification,save:api.changeRouterClassification,confirm:api.confirmRouterClassification},()=>{if(this.context&&['client','classify'].includes(this.routerView.page)&&!this.routerClientName.modalOpen)this.render(true);},e=>this.handleSessionError(e),()=>{if(this.context)void this.router.load({...this.context});});
  private routerCommon=new RouterCommonState(()=>{if(this.context&&['client','common'].includes(this.routerView.page))this.render(true);});
  private routerNetwork=new RouterNetworkState({read:api.routerNetwork,save:api.changeRouterNetwork,confirm:api.confirmRouterNetwork,ack:api.acknowledgeRouterNetwork},()=>{if(this.context&&['ports','ipv6'].includes(this.routerView.page))this.render(true);},e=>this.handleSessionError(e));
  private routerInternet=new RouterInternetState({read:api.routerInternet,save:api.changeRouterInternet,confirm:api.confirmRouterInternet},()=>{if(this.context&&this.routerView.page==='internet')this.render(true);},e=>this.handleSessionError(e));
  private routerIndicator=new RouterIndicatorState({read:api.routerIndicator,save:api.changeRouterIndicator,confirm:api.confirmRouterIndicator},()=>{if(this.context)this.render(true);},error=>this.handleSessionError(error));
  private routerWifi=new RouterWifiState({read:api.routerWifi,save:api.changeRouterWifi,confirm:api.confirmRouterWifi},()=>{if(this.context&&this.routerView.page==='wifi')this.render(true);},error=>this.handleSessionError(error));
  private routerAdvanced=new RouterAdvancedState({read:api.routerAdvanced,save:api.changeRouterAdvanced,confirm:api.confirmRouterAdvanced,dfs:api.respondRouterDfs},()=>{if(this.context&&this.routerView.page==='advanced')this.render(true);},error=>this.handleSessionError(error),(c,r,confirmed)=>this.routerWifi.adoptAdvanced(c,r,confirmed));
  private homeCardsReadVersion=0;
  private homeCardNoticeRevision=0;
  private homeCardsRequest:{homeId:string;generation:number;promise:Promise<void>}|undefined;
  private homeCardOps=new PropertyOperations((key,value)=>this.homeCardRequest(key,value,false),(key,value)=>this.homeCardRequest(key,value,true),()=>this.homeCardChanged());
  private homeBusy = false;
  private roomId = '*';
  private context: DeviceContext | undefined;
  private panel: DevicePanel | undefined;
  private speaker=new SpeakerState({read:api.speakerPlayer,change:api.changeSpeaker},()=>{if(speakerMetadataSupported(this.currentDevice()?.model??''))this.render(true);},e=>this.handleSessionError(e));
  private bathHeater=new BathHeaterState({read:api.bathHeater,change:api.changeBathHeater},()=>{if(this.currentDevice()?.model===bathHeaterModel)this.render(true)},e=>this.handleSessionError(e));
  private fryerView:FryerView={};
  private fryer=new FryerState({read:api.fryer,change:api.changeFryer},()=>{if(this.currentDevice()?.model===fryerModel&&!this.fryerView.picker&&!this.fryerView.confirmation)this.render(true);},e=>this.handleSessionError(e));
  private ceilingFan=new CeilingFanState({read:api.ceilingFan,change:api.changeCeilingFan},()=>{if(this.currentDevice()?.model===ceilingFanModel)this.render(true)},e=>this.handleSessionError(e));
  private curtainMotion=new CurtainMotion();
  private curtainMotions=new Map<string,CurtainMotion>();
  private vacuum=new VacuumState({read:api.vacuum,change:api.changeVacuum},()=>{if(!this.vacuum.loading)this.deviceOpening.ready();if(this.currentDevice()?.model===vacuumModel)this.render(true);},e=>this.handleSessionError(e));
  private doorbell=new DoorbellState(api.doorbellCloud,()=>{if(isCloudDoorbell(this.currentDevice()?.model??''))this.render(true)},e=>this.handleSessionError(e),api.cameraCareThumbnail);
  private doorbellPlayer=new DoorbellPlayer(()=>{this.doorbell.view='events';this.render(true);});
  private uiResources: DeviceUiResources | undefined;
  private uiResourcesRequest: { epoch: number; promise: Promise<void> } | undefined;
  private uiResourcesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private uiResourcesRefreshAttempts = 0;
  private uiResourcesError: string | undefined;
  private panelLoading = false;
  private deviceEvents=new DeviceEventsState(api.deviceEvents,()=>this.render(true));
  private deviceDataPresented = false;
  private panelError: AppError | undefined;
  private purifierView:PurifierView=newPurifierView();
  private purifierDnd=new PurifierDnd({read:api.purifierDnd,save:api.changePurifierDnd},()=>this.render(true),error=>{this.handleSessionError(error);});
  private purifierOptions=new PurifierOptions({read:api.purifierOptions,save:api.changePurifierPush},()=>this.render(true),error=>{this.handleSessionError(error);});
  private purifierGuide:ReturnType<typeof purifierGuidePage>|undefined;
  private airerView:AirerView={page:'home'};
  private fridgeView:FridgeView={page:'home'};
  private dispenserView:DispenserView={page:'home'};
  private dispenserHistory=new DispenserHistory({records:api.dispenserRecords,statistics:api.dispenserStatistics},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
  private dispenserHistoryPicker:PurifierCalendar|undefined;
  private dispenserReminderView:ReminderView={page:'settings'};
  private dispenserReminders=new DispenserReminders({read:api.dispenserReminders,save:api.changeDispenserReminder},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
  private dispenserSelfCheck=new DispenserSelfCheck({run:api.dispenserSelfCheck,confirm:api.confirmDispenserSelfCheck,history:api.dispenserSelfCheckRecords},()=>{if(this.dispenserView.page==='selfcheck'&&this.dispenserSelfCheck.selected?.time===0)this.dispenserView={page:'selfcheck-report'};this.render(true);},(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
  private dispenserSterilization=new DispenserSterilization({run:api.dispenserSterilization,read:api.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
  private dispenserDnd=new DispenserDnd({read:api.dispenserDnd,save:api.changeDispenserDnd},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
  private dispenserCommands=new DispenserCommands({change:api.changeDispenser,read:api.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
  private fridgeCommands=new FridgeCommands({change:api.changeFridge,reset:api.resetFridge,read:api.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
  private airerCommands=new AirerCommands({lift:api.airerLift,night:api.saveAirerNight,read:api.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
  private purifierHistory=new PurifierHistory({records:api.purifierRecords,statistics:api.purifierStatistics},()=>this.render(true),error=>{this.handleSessionError(error);});
  private purifierHistoryPicker:PurifierCalendar|undefined;
  private purifierCommands=new PurifierCommands({save:api.savePurifierCups,read:api.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
  private sensorHistory: SensorHistory | undefined;
  private historyLoading = false;
  private historyError: AppError | undefined;
  private historyReadAt = 0;
  private historyDetailOpen = false;
  private detailSelection: HistorySelection = { period: 'day', date: dateKey(new Date()) };
  private detailData: SensorHistory | undefined;
  private detailLoading = false;
  private detailError: AppError | undefined;
  private detailEpoch = 0;
  private detailPicker: {month: Date; panel: 'day'|'month'} | undefined;
  private renderedHistoryKey = '';
  private energyOpen=false;
  private energySelection:EnergySelection={period:'week',date:dateKey(new Date())};
  private energyData:EnergyReport|undefined;
  private energyLoading=false;
  private energyError:AppError|undefined;
  private energyEpoch=0;
  private energyReadAt=0;
  private energyPicker:typeof this.detailPicker;
  private timersOpen=false;
  private timerData:TimerReport|undefined;
  private timerLoading=false;
  private timerError:AppError|undefined;
  private timerEpoch=0;
  private timerDraft:TimerDraft|undefined;
  private timerDraftBaseline='';
  private timerModal:TimerModal|undefined;
  private timerSelection:string[]|undefined;
  private timerBusy=false;
  private countdownDraft:CountdownDraft|undefined;
  private countdownOperation:CountdownOperation|undefined;
  private timerMessage:string|undefined;
  private timerPendingChanges:TimerChange[]=[];
  private renderedContext: DeviceContext | undefined;
  private renderedHomeId='';
  private panelNotice: Notice | undefined;
  private panelEpoch = 0;
  private presentationRoute=new DevicePresentationRoute();
  private cameraPlayer=new CameraPlayer(()=>{if(isCloudDoorbell(this.currentDevice()?.model??'')&&this.doorbell.view==='live'){this.cameraPlayer.dispose();this.doorbell.view='events';this.render(true);}else this.closePanel();});
  private controlBusy = false;
  private panelIsCached=false;
  private panelCachedAt:number|null=null;
  private panelHasCachedState=false;
  private lightTab: LightColorTab | undefined;
  private lightModes: LightModeReport | undefined;
  private lightModesLoading=false;
  private lightModesError:string|undefined;
  private lightModesReadAt=0;
  private lightModesRequest:{epoch:number;promise:Promise<void>}|undefined;
  private lightScenesExpanded=false;
  private lightSceneTab:'standard'|'custom'='standard';
  private lightFavorites:LightFavoritesReport|undefined;
  private lightFavoritesLoading=false;
  private lightFavoritesError:string|undefined;
  private lightFavoritesVersion=0;
  private lightFavoritesRequest:{epoch:number;version:number;promise:Promise<void>}|undefined;
  private lightFavoriteDraft:LightFavoriteDraft|undefined;
  private lightFavoriteEpoch=0;
  private lightFavoriteOperation:LightFavoriteOperation|undefined;
  private lightSettingsOpen:LightSettingsKind|undefined;
  private lightSettingsReport:LightSettingsReport|undefined;
  private lightSettingsError:string|undefined;
  private lightSettingsLoading=false;
  private lightSettingsRequest:{epoch:number;promise:Promise<void>}|undefined;
  private lightSettingsDraft:LightSettingsDraft|undefined;
  private lightSettingsDraftEpoch=0;
  private lightSettingsOperation:LightSettingsOperation|undefined;
  private lightDependencyTimer: ReturnType<typeof setTimeout> | undefined;
  private operationNoticeRevision=0;
  private propertyOps=new PropertyOperations((key,value)=>this.propertyRequest(key,value,false),(key,value)=>this.propertyRequest(key,value,true),()=>this.propertyOperationChanged());
  private confirmedPanels=new Map<string,DevicePanel>();
  private confirmedPanelVersions=new Map<string,number>();
  private homeCardsPropertyReadVersion=0;
  private propertyContexts=new Map<string,{context:DeviceContext;homeEpoch:number;homePower?:boolean;homeCurtain?:boolean}>();
  private deviceSends=new Map<string,Promise<void>>();
  private controlIntent:string|undefined;
  private actionConfirm: PendingAction | undefined;
  private sessionNotice: AppError | undefined;
  private logoutBusy = false;
  private homeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private panelRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private panelDrafts = new Map<string, string>();
  private linkedPanels = new Map<string, DevicePanel>();
  private linkedErrors = new Map<string, string>();
  private accountOpen = false;
  private accountMenuOpen = false;
  private settingsOpen = false;
  private settingsView=createSettingsViewState();
  private monitorExitLatch=false;
  private monitorMinimized=false;
  private monitorWall=new MonitorWall(()=>this.exitMonitor(),error=>{const issue=normalizeError(error);this.handleSessionError(issue);});
  private preferencesLoading = false;
  private preferencesError: AppError | undefined;
  private preferences = new PreferenceOperations(change => {
    const snapshot = this.snapshot;
    if (!snapshot) return Promise.reject({kind:'staleContext',message:'家庭已切换。'});
    return api.changeHomePreferences(snapshot.homeId, snapshot.generation, change);
  }, () => this.preferenceChanged());
  private homeScrollTop = 0;
  private navigationKey='';
  private popupKey='';
  private motionFromInteraction=false;
  private homeCardBindings=new WeakMap<HTMLElement,string>();
  private roomsScrollLeft = 0;
  private deviceMenu: { did: string; x: number; y: number } | undefined;
  private deferredRender = false;
  private arrangement: CardArrangement | undefined;
  private cardPress = new CardPress();
  private drag = new DeviceDrag({begin:id=>this.beginArrangement(id),preview:ids=>{if(this.arrangement)this.arrangement.order=ids;},ended:()=>{if(this.deferredRender&&!this.arrangement)this.render();},arranging:()=>!!this.arrangement});
  private homeMenuOpen = false;
  private uiNotice: Notice | undefined;
  // Model/category routing and visual implementation are separate. These local
  // adapters preserve previously compared device layouts; the schema compiler
  // supplies the generic page and verified standard custom-property additions.
  private readonly deviceVisualAdapters: Partial<Record<PanelLayout, (device: Device) => HTMLElement>> = {
    switch: device => this.renderSwitchPage(device),
    light: device => this.renderLightPage(device, false),
    'light-group': device => this.renderLightPage(device, true),
    curtain: device => this.renderCurtainPage(device),
    fan: device => this.renderFanPage(device),
    'fan-p69': device => this.renderP69FanPage(device),
    'fan-standard': device => this.renderStandardFanPage(device),
    'air-conditioner': device => this.renderAirConditionerPage(device),
    outlet: device => this.renderOutletPage(device),
    'temperature-humidity-sensor': device => this.renderSensorPage(device),
  };

  async start(): Promise<void> {
    window.addEventListener('pagehide',()=>{
      this.disposed=true;this.lifetime.abort();++this.loginEpoch;++this.homeEpoch;
      clearTimeout(this.loginTimer);clearTimeout(this.homeRefreshTimer);
      this.clearPanel();this.resetLocalView();this.devicePreviewCache.clear();disposeHistoryCharts();
    },{once:true});
    document.addEventListener('click',()=>{this.motionFromInteraction=true;queueMicrotask(()=>{this.motionFromInteraction=false;});},{capture:true,signal:this.lifetime.signal});
    window.addEventListener('monitor-exit',()=>{if(this.monitorWall.active)this.exitMonitor();},{signal:this.lifetime.signal});
    window.addEventListener('desktop-window-state',event=>{this.monitorMinimized=!!(event as CustomEvent<{minimized:boolean}>).detail?.minimized;this.monitorWall.setPaused(this.monitorMinimized||document.hidden);},{signal:this.lifetime.signal});
    document.addEventListener('visibilitychange',()=>{this.monitorWall.setPaused(this.monitorMinimized||document.hidden);},{signal:this.lifetime.signal});
    document.addEventListener('keydown',event=>{if(this.monitorWall.active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.monitorWall.handleEscape();}},{capture:true,signal:this.lifetime.signal});
    window.addEventListener('resize',()=>{this.closeDeviceMenu();this.cardPress.clear();this.drag.cancel();for(const grid of this.root.querySelectorAll<HTMLElement>('.device-grid'))grid.style.setProperty('--grid-columns',String(deviceColumnCount(innerWidth)));},{signal:this.lifetime.signal});
    document.addEventListener('click',event=>{
      const target=event.target;if(!(target instanceof Element))return;
      if(this.deviceMenu&&!target.closest('.device-context-menu')){this.closeDeviceMenu();return;}
      if(this.accountMenuOpen&&!target.closest('.account-menu,.home-account')){this.accountMenuOpen=false;this.render();return;}
      if(this.homeMenuOpen&&!target.closest('.home-menu,.home-title')){this.homeMenuOpen=false;this.render();return;}
      if(this.accountOpen&&target.classList.contains('modal-backdrop')&&!this.logoutBusy){this.accountOpen=false;this.render();return;}
      if(this.context&&target.classList.contains('device-stage')&&!this.controlBusy&&(!this.timerBusy||this.countdownOperation?.pending)&&!this.actionConfirm)this.closePanel();
    },{signal:this.lifetime.signal});
    document.addEventListener('keydown', event => {
      if(event.key==='Tab'&&(this.routerScene.modal||this.routerDaily.confirmation||this.routerFamily.modalOpen||!!this.routerUrl.input||this.routerPassword.modalOpen||this.routerClientName.modalOpen||this.routerClassification.picker||this.routerQos.modalOpen||this.routerAccess.modalOpen||this.routerCommon.limitMac||this.routerIndicator.picker||this.routerIndicator.confirmOff||this.routerWifi.confirming||this.routerWifi.success||this.routerAdvanced.modalOpen||this.routerInternet.modalOpen||this.routerNetwork.modalOpen))return;
      if(event.key==='Tab'&&(this.fryerView.picker||this.fryerView.confirmation))return;
      if(event.key==='Tab'&&(this.fridgeView.help||this.fridgeView.info||this.fridgeView.reset))return;
      if(event.key==='Tab'&&(this.dispenserView.picker||this.dispenserView.discard||this.dispenserDnd.picker||this.dispenserHistoryPicker||this.dispenserSterilization.confirming||this.dispenserSelfCheck.confirming||this.dispenserReminderView.picker||this.dispenserReminderView.confirmation))return;
      if(event.key==='Tab'&&(this.washerRuntimeConfirmation||this.purifierView.picker||this.purifierView.confirm||this.purifierView.settingDialog||this.purifierHistoryPicker||this.purifierDnd.picker||this.airerView.picker))return;
      if(event.key==='Tab'&&this.context&&!this.accountOpen&&!this.actionConfirm&&!this.countdownDraft&&!this.timerModal&&!this.energyPicker&&!this.detailPicker&&!this.lightSettingsDraft){
        const page=this.root.querySelector('.device-page'),scope=this.televisionSettings?page?.querySelector('.television-settings'):page?.classList.contains('page-washer')?(page.querySelector('.history-date-picker,.washer-choice-dialog,.washer-order-dialog')??page):page,items=scope?[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length):[];
        if(items.length&&(!items.includes(document.activeElement as HTMLElement)||(event.shiftKey?document.activeElement===items[0]:document.activeElement===items.at(-1)))){event.preventDefault();(event.shiftKey?items.at(-1)!:items[0]).focus();}
      }
      if (event.key === 'Escape') {
        if(this.currentDevice()?.model===routerModel){
          if(this.routerPassword.modalOpen){event.preventDefault();this.routerPassword.dismiss();return;}
          if(this.routerScene.modal){event.preventDefault();this.routerScene.dismiss();return;}
          if(this.routerDaily.confirmation){event.preventDefault();this.routerDaily.dismiss();return;}
          if(this.routerView.page==='advanced'){event.preventDefault();if(this.routerAdvanced.dfs)return;if(this.routerAdvanced.frequencyPicker){this.routerAdvanced.frequencyPicker=false;this.render(true);}else if(this.routerAdvanced.radioPicker){this.routerAdvanced.radioPicker=undefined;this.render(true);}else if(this.routerAdvanced.localNotice){this.routerAdvanced.localNotice='';this.render(true);}else if(this.routerAdvanced.confirmation||this.routerAdvanced.wpa3)this.routerAdvanced.cancel();else this.navigateRouter({...this.routerView,page:this.routerAdvanced.success?'home':'wifi'});return;}
          if(this.routerView.page==='ports'||this.routerView.page==='ipv6'){event.preventDefault();if(this.routerNetwork.modalOpen)this.routerNetwork.cancel();else this.navigateRouter({...this.routerView,page:'internet'});return;}
          if(this.routerView.page==='internet'){event.preventDefault();if(!this.routerInternet.back())this.navigateRouter({...this.routerView,page:'home'});return;}
          if(this.routerView.page==='wifi'){event.preventDefault();if(this.routerWifi.confirming){this.routerWifi.confirming=false;this.render(true);}else this.navigateRouter({...this.routerView,page:'home'});return;}
          if(this.routerIndicator.picker){event.preventDefault();this.routerIndicator.picker=undefined;this.render(true);return;}
          if(this.routerIndicator.confirmOff){event.preventDefault();this.routerIndicator.confirmOff=false;this.render(true);return;}
          if(this.routerAccess.modalOpen){event.preventDefault();this.routerAccess.dismiss();return;}
          if(this.routerView.page==='family'){event.preventDefault();if(!this.routerFamily.back()){this.routerFamily.leave();this.navigateRouter({...this.routerView,page:'client'});}return;}
          if(this.routerUrl.input){event.preventDefault();this.routerUrl.dismiss();return;}
          if(['urlBlack','urlWhite'].includes(this.routerView.page)){event.preventDefault();if(this.routerUrl.editing)this.routerUrl.edit(false);else this.navigateRouter({...this.routerView,page:'website'});return;}
          if(this.routerView.page==='website'){event.preventDefault();this.navigateRouter({...this.routerView,page:'client'});return;}
          if(this.routerView.page==='blockRecords'){event.preventDefault();this.navigateRouter({...this.routerView,page:'access'});return;}
          if(this.routerView.page==='filterList'){event.preventDefault();if(this.routerAccess.editing)this.routerAccess.edit(false);else this.navigateRouter({...this.routerView,page:'access'});return;}
          if(this.routerView.page==='access'){event.preventDefault();this.navigateRouter({...this.routerView,page:this.routerView.accessBack??'safety'});return;}
          if(this.routerQos.modalOpen){event.preventDefault();this.routerQos.dismiss();return;}
          if(this.routerView.page==='qos'){event.preventDefault();this.navigateRouter({...this.routerView,page:this.routerView.mac?'client':'networkTools'});return;}
          if(this.routerClassification.picker){event.preventDefault();this.routerClassification.cancel();return;}
          if(this.routerCommon.limitMac){event.preventDefault();this.routerCommon.dismiss();return;}
          if(this.routerView.page!=='home'){event.preventDefault();this.navigateRouter({...this.routerView,page:this.routerView.page==='indicator'?'settings':this.routerView.page==='client'?'clients':this.routerView.page==='common'||this.routerView.page==='classify'?'client':'home'});return;}
        }
        if(this.currentDevice()?.model===dispenserModel){
          if(this.dispenserReminderView.picker||this.dispenserReminderView.confirmation){this.dispenserReminderView.picker=undefined;this.dispenserReminderView.confirmation=undefined;this.render(true);return;}if(this.dispenserSelfCheck.confirming){this.dispenserSelfCheck.confirming=false;this.render(true);return;}if(this.dispenserSterilization.confirming){this.dispenserSterilization.confirming=false;this.render(true);return;}if(this.dispenserHistoryPicker){this.dispenserHistoryPicker=undefined;this.render(true);return;}
          if(this.dispenserDnd.picker){this.dispenserDnd.picker=undefined;this.render(true);return;}
          if(this.dispenserView.page==='dnd'){this.dispenserView={page:'settings'};this.render(true);return;}
          if(this.dispenserView.picker||this.dispenserView.discard){this.dispenserView.picker=undefined;this.dispenserView.discard=false;this.render(true);return;}
          if(this.dispenserView.page!=='home'){this.root.querySelector<HTMLButtonElement>('.device-page .device-page-header button')?.click();return;}
        }
        if(this.fridgeView.reset){this.fridgeView.reset=undefined;this.render(true);return;}
        if(this.fridgeView.info){this.fridgeView.info=false;this.render(true);return;}
        if(this.fridgeView.help){this.fridgeView.help=false;this.render(true);return;}
        if(this.fridgeView.page!=='home'){this.fridgeView={page:'home'};this.render(true);return;}
        if(this.arrangement){this.finishArrangement(false);}
        else if(this.drag.active){this.drag.cancel();this.render();}
        else if(this.deviceMenu){this.closeDeviceMenu();}
        else if(this.accountMenuOpen){this.accountMenuOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-account')?.focus();}
        else if(this.homeMenuOpen){this.homeMenuOpen=false;this.render();}
        else if(this.accountOpen&&!this.logoutBusy){this.accountOpen=false;this.render();}
        else if(this.settingsOpen){this.settingsOpen=false;this.render();}
        else if(this.televisionSettings){this.televisionSettings=false;this.render(true);}
        else if(this.countdownDraft)this.closeCountdown();
        else if(this.lightFavoriteDraft)this.closeLightFavorite();
        else if(this.lightSettingsDraft)this.closeLightSettingsDraft();
        else if(this.lightSettingsOpen)this.closeLightSettings();
        else if(this.timersOpen)this.backTimers();
        else if (this.energyPicker) {this.energyPicker=undefined;this.render();}
        else if(this.energyOpen)this.closeEnergy();
        else if (this.detailPicker) { this.detailPicker = undefined; this.render(); }
        else if (this.historyDetailOpen) this.closeHistoryDetail();
        else if(this.purifierHistoryPicker){this.purifierHistoryPicker=undefined;this.render(true);}
        else if(this.fryerView.picker){this.fryerView.picker=undefined;this.render(true);}
        else if(this.fryerView.confirmation){this.fryerView.confirmation=undefined;this.render(true);}
        else if(this.fryerView.draft){this.fryerView.draft=undefined;this.render(true);}
        else if(this.airerView.picker){this.airerView.picker=undefined;this.render(true);}
        else if(this.airerView.page!=='home'){this.airerView={page:'home'};this.render(true);}
        else if(this.purifierDnd.picker){this.purifierDnd.picker=undefined;this.render(true);}
        else if(this.purifierView.settingDialog){this.purifierView.settingDialog=undefined;this.render(true);}
        else if(this.purifierView.picker){this.purifierView.picker=undefined;this.render(true);}
        else if(this.purifierView.confirm){this.purifierView.confirm=undefined;this.render(true);}
        else if(this.purifierView.page!=='home'){if(this.purifierView.draft){this.purifierView.confirm='leave';this.render(true);}else{this.purifierView={page:['pipeline','water-mode','compatibility','dnd','guide'].includes(this.purifierView.page)?'functions':'home',filter:0};this.render(true);}}
        else if(this.washerRuntimeConfirmation&&!this.washerRuntimeCommands.pending){this.washerRuntimeConfirmation=undefined;this.render(true);}
        else if (this.actionConfirm && !this.controlBusy) { this.actionConfirm = undefined; this.render(); }
        else if(this.washerOrderAt!==undefined){if(!this.washerCommands.pending)this.closeWasherOrder();}
        else if(this.washerRecords.picker){this.washerRecords.picker=undefined;this.render(true);}
        else if(this.washerDraft?.selector){this.washerDraft={...this.washerDraft,selector:undefined};this.render(true);}
        else if(this.washerView==='records'&&this.washerRecords.selected)this.washerRecords.closeDetail();
        else if(this.washerView!=='home'){this.washerView='home';this.washerDraft=undefined;this.washerCommands.reset();this.render(true);}
        else if (this.context && !this.actionConfirm) this.closePanel();
      }
    },{signal:this.lifetime.signal});
    document.addEventListener('scroll',()=>this.closeDeviceMenu(),{capture:true,signal:this.lifetime.signal});
    this.render();
    try {
      this.session = await api.session();
      if(this.disposed)return;
      this.region = this.session.region;
    } catch (error) { this.loginError = normalizeError(error); }
    this.starting = false;
    this.render();
    if (this.session?.loggedIn) {void this.loadAccountProfile();await this.loadHomes();}
  }

  private async loadAccountProfile():Promise<void>{
    const session=this.session;if(!session?.loggedIn)return;
    try{const profile=await api.accountProfile();if(this.session!==session)return;this.accountProfile=profile;this.profileError=false;this.render();}
    catch{if(this.session!==session)return;this.profileError=true;this.render();}
  }

  private accountAvatar(className:string):HTMLElement{
    const avatar=element('span',className,this.accountProfile?.displayName?.slice(0,1)||'Mi');
    if(this.accountProfile?.avatarUrl){
      const image=element('img');image.src=this.accountProfile.avatarUrl;image.alt='';image.referrerPolicy='no-referrer';
      image.addEventListener('load',()=>{avatar.dataset.avatarLoaded='true';});
      image.addEventListener('error',()=>{image.remove();avatar.textContent=this.accountProfile?.displayName?.slice(0,1)||'Mi';avatar.dataset.avatarLoaded='false';});
      avatar.replaceChildren(image);
    }
    return avatar;
  }

  private currentHome(): Home | undefined { return this.homes.find(home => home.id === this.selectedHomeId); }
  private currentDevice(): Device | undefined { return this.snapshot?.devices.find(device => device.did === this.context?.did); }

  private handleSessionError(error: AppError): void {
    if (!isSessionError(error)) return;
    this.region = this.session?.region ?? this.region;
    ++this.loginEpoch; ++this.homeEpoch;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    this.loginTimer = undefined; this.homeRefreshTimer = undefined;
    this.clearPanel(); this.routerClientName.reset(); this.panelRefreshTimer = undefined;
    this.session = undefined; this.accountProfile=undefined;this.profileError=false;this.homes = []; this.snapshot = undefined; this.selectedHomeId = '';
    this.homesLoading = false; this.homeBusy = false; this.homeError = undefined;
    this.roomId = '*'; this.homeMenuOpen = false; this.resetLocalView();
    this.accountOpen = false; this.logoutBusy = false; this.uiNotice = undefined; this.sessionNotice = undefined;
    this.qr = undefined; this.loginError = error; this.loginState = 'error'; this.starting = false;
    // The backend has already invalidated this session. Rendering immediately
    // is necessary because old async operations must now fail their epoch
    // guards and therefore cannot be relied on to render from their finally.
    // Do not call logout here: an obsolete failure must not delete a new login.
    this.render();
  }

  private render(deviceOnly=false): void {
    if(this.disposed)return;
    captureSettingsView(this.root,this.settingsView);
    const monitor=this.preferences.view?.monitor;
    if(this.session?.loggedIn&&this.snapshot&&monitor?.enabled&&!this.monitorExitLatch&&!this.context){
      if(!this.root.contains(this.monitorWall.root))this.root.replaceChildren(this.monitorWall.root);
      this.monitorWall.update(this.snapshot,monitor.excludedDeviceIds);return;
    }
    if(this.monitorWall.active)this.monitorWall.close();
    // Keep the native pointer owner mounted while reads or metadata resolve.
    // A close, account/home change or action dialog must still replace it.
    if(this.context&&sameContext(this.renderedContext,this.context)&&!this.settingsOpen&&!this.accountOpen&&!this.actionConfirm&&this.root.querySelector('.device-page [data-interacting="true"]'))return;
    if(this.arrangement&&this.snapshot?.homeId===this.arrangement.homeId&&this.snapshot.generation===this.arrangement.generation&&!this.context&&!this.settingsOpen&&!this.accountOpen){this.deferredRender=true;this.updateArrangementChrome();return;}
    if(this.drag.active&&this.renderedHomeId===this.selectedHomeId&&!this.settingsOpen&&!this.accountOpen&&!this.actionConfirm){this.deferredRender=true;return;}
    this.drag.cancel(); this.deferredRender=false;
    const active=(document.activeElement instanceof HTMLElement||document.activeElement instanceof SVGElement)&&this.root.contains(document.activeElement)?document.activeElement:undefined;
    const localFocusKey = active?.dataset.focusKey;
    const focusedControl=active?.closest<HTMLElement>('[data-control]');
    const focusKey=focusedControl?{kind:focusedControl.dataset.control,siid:focusedControl.dataset.siid,piid:focusedControl.dataset.piid,index:[...this.root.querySelectorAll<HTMLElement>('[data-control]')].filter(node=>node.dataset.control===focusedControl.dataset.control&&node.dataset.siid===focusedControl.dataset.siid&&node.dataset.piid===focusedControl.dataset.piid).indexOf(focusedControl),child:active===focusedControl?-1:[...focusedControl.querySelectorAll('button,input,select,[tabindex]')].indexOf(active!)}:undefined;
    const keepFocus=sameContext(this.renderedContext,this.context);
    const historyKey = this.currentDevice()?.model===dispenserModel?`dispenser/${this.dispenserView.page}/${this.dispenserView.modeId??""}/${this.dispenserView.page==='reminders'?this.dispenserReminderView.page:""}${this.dispenserView.page==='statistics'?`/${this.dispenserHistory.selection.period}/${this.dispenserHistory.selection.date}`:''}`:this.currentDevice()?.model===fridgeModel?`fridge/${this.fridgeView.page}`:this.currentDevice()?.model===airerModel?`airer/${this.airerView.page}`:this.currentDevice()?.model==='xiaomi.waterpuri.lx32'?`purifier/${this.purifierView.page}/${this.purifierView.filter}/${this.purifierView.draft?.index??''}${this.purifierView.page==='statistics'?`/${this.purifierHistory.selection.period}/${this.purifierHistory.selection.date}`:''}`:this.currentDevice()?.model==='midjd8.washer.42'?`washer/${this.washerView}/${this.washerDraft?.program??''}/${this.washerRecords.selection.period}/${this.washerRecords.selection.date}/${this.washerRecords.selectedBucket??''}/${this.washerRecords.selected?.entry.id??''}`:this.lightFavoriteDraft?`light-favorite/${this.lightFavoriteEpoch}`:this.lightSettingsOpen?`light-settings/${this.lightSettingsOpen}`:this.timersOpen?'timers':this.energyOpen?`energy/${this.energySelection.period}/${this.energySelection.date}`:this.historyDetailOpen ? `${this.detailSelection.period}/${this.detailSelection.date}` : '';
    const scrollTop = sameContext(this.renderedContext, this.context) && this.renderedHistoryKey === historyKey ? this.root.querySelector('.device-page-scroll')?.scrollTop ?? 0 : 0;
    const homeScroll=this.renderedHomeId===this.selectedHomeId?this.root.querySelector('.home-screen')?.scrollTop??this.homeScrollTop:0;
    const roomsScroll=this.renderedHomeId===this.selectedHomeId?this.root.querySelector('.room-tabs')?.scrollLeft??this.roomsScrollLeft:0;
    this.homeScrollTop=homeScroll;
    this.roomsScrollLeft=roomsScroll;
    if(this.renderedHomeId!==this.selectedHomeId)this.cardPress.clear();
    this.renderedHomeId=this.selectedHomeId;
    this.renderedHistoryKey = historyKey;
    this.renderedContext = this.context ? { ...this.context } : undefined;
    disposeHistoryCharts();
    const previousStage=this.root.querySelector('.app-shell > .device-stage');
    const createDeviceStage=()=>{const next=this.renderDrawer();if(keepFocus&&previousStage&&next!==previousStage)preserveDeviceArtwork(previousStage,next);return next;};
    if((deviceOnly||!!this.currentDevice()&&(cameraPageEligible(this.currentDevice()!)||isScale(this.currentDevice()!.model)))&&previousStage&&this.context&&this.session?.loggedIn&&!this.accountOpen&&!this.actionConfirm){
      const nextStage=createDeviceStage();if(nextStage!==previousStage)previousStage.replaceWith(nextStage);
    }else{
    this.root.replaceChildren();
    if (this.starting) { return; }
    if (!this.session?.loggedIn) { this.root.append(this.renderLogin()); return; }
    const showDevice=!!this.context&&!this.deviceOpening.hidden;
    const shell = element('div', `app-shell${showDevice ? ' has-device-page' : ''}`, this.renderWorkspace());
    if (showDevice) shell.append(createDeviceStage());
    this.root.append(shell);
    }
    const scroll = this.root.querySelector('.device-page-scroll'); if (scroll) scroll.scrollTop = scrollTop;
    const homeScrollView=this.root.querySelector('.home-screen');if(homeScrollView)homeScrollView.scrollTop=homeScroll;
    const roomStrip=this.root.querySelector('.room-tabs');if(roomStrip)roomStrip.scrollLeft=roomsScroll;
    const devicePage=this.root.querySelector<HTMLElement>('.device-page');
    if(devicePage){devicePage.setAttribute('role','dialog');devicePage.setAttribute('aria-modal','true');devicePage.tabIndex=-1;}
    if (this.actionConfirm) this.root.append(this.renderActionConfirmation());
    if (this.accountOpen) this.root.append(this.renderAccount());
    if (this.deviceMenu&&!this.context&&!this.settingsOpen) this.root.append(this.renderDeviceMenu());
    if(localFocusKey&&!this.context&&!this.settingsOpen){const target=[...this.root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node=>node.dataset.focusKey===localFocusKey)??this.root.querySelector<HTMLElement>('.hidden-devices button,.settings-header button');target?.focus({preventScroll:true});}
    if(keepFocus&&localFocusKey&&this.context)this.root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(localFocusKey)}"]`)?.focus({preventScroll:true});
    if(keepFocus&&focusKey){const control=[...this.root.querySelectorAll<HTMLElement>('[data-control]')].filter(node=>node.dataset.control===focusKey.kind&&node.dataset.siid===focusKey.siid&&node.dataset.piid===focusKey.piid)[focusKey.index];const target=focusKey.child<0?control:control?.querySelectorAll<HTMLElement>('button,input,select,[tabindex]')[focusKey.child];if(target&&!target.matches(':disabled'))target.focus({preventScroll:true});}
    if(devicePage&&!devicePage.contains(document.activeElement)&&!this.actionConfirm&&!this.countdownDraft&&!this.timerModal)devicePage.focus({preventScroll:true});
    if(this.settingsOpen&&!this.context&&!this.accountOpen&&!this.actionConfirm)restoreSettingsView(this.root,this.settingsView);
    const navigationKey=JSON.stringify([this.session?.loggedIn,this.selectedHomeId,this.roomId,this.settingsOpen,this.context?.did,historyKey,devicePage?.className.replace(/\bmotion-\S+/g,'').trim()]);
    if(navigationKey!==this.navigationKey){
      if(this.motionFromInteraction&&!devicePage?.querySelector('video')){
        const target=devicePage??this.root.querySelector<HTMLElement>('.settings-page,.home-content,.login-screen');
        if(target)enter(target,'page');
      }
      this.navigationKey=navigationKey;
    }
    const popups=[...this.root.querySelectorAll<HTMLElement>('.account-dialog,.account-menu,.home-menu,.device-context-menu,[role="dialog"]')].filter(node=>node!==devicePage&&!node.querySelector('video'));
    const popupKey=popups.map(node=>node.className).join('|');
    if(this.motionFromInteraction&&popupKey!==this.popupKey)for(const popup of popups)enter(popup,'popup');
    this.popupKey=popupKey;
  }

  private renderLogin(): HTMLElement {
    return loginPage({qrState:this.loginState,qr:this.qr,error:this.loginError,
      startQr:()=>{void this.startLogin();},cancelQr:()=>{void this.cancelLogin();}});
  }

  private async startLogin(): Promise<void> {
    const epoch = ++this.loginEpoch;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.qr = undefined; this.loginError = undefined; this.loginState = 'loading'; this.render();
    try {
      const qr = await api.startLogin(this.region);
      if (epoch !== this.loginEpoch) { void api.cancelLogin(qr.attemptId).catch(() => undefined); return; }
      this.qr = qr; this.loginState = 'ready'; this.render();
      this.scheduleLoginPoll(epoch, qr.attemptId);
    } catch (error) {
      if (epoch !== this.loginEpoch) return;
      this.loginState = 'error'; this.loginError = normalizeError(error); this.render();
    }
  }

  private scheduleLoginPoll(epoch: number, attemptId: string): void {
    if(this.disposed)return;
    this.loginTimer = setTimeout(() => { void this.pollLogin(epoch, attemptId); }, 1300);
  }

  private async pollLogin(epoch: number, attemptId: string): Promise<void> {
    if (epoch !== this.loginEpoch || this.loginState !== 'ready') return;
    const expiresAt = this.qr?.expiresAt;
    if (expiresAt && (expiresAt < 1e12 ? expiresAt * 1000 : expiresAt) <= Date.now()) {
      this.loginState = 'expired'; this.render(); void api.cancelLogin(attemptId).catch(() => undefined); return;
    }
    try {
      const result = await api.pollLogin(attemptId);
      if (epoch !== this.loginEpoch) return;
      if (result.status === 'success') {
        const session = result.session ?? await api.session();
        if (epoch !== this.loginEpoch) return;
        if (!session.loggedIn) throw new Error('登录确认尚未完成，请重新获取二维码。');
        this.session = session; this.sessionNotice = undefined; this.qr = undefined; this.loginState = 'idle';
        this.accountProfile=undefined;this.profileError=false;void this.loadAccountProfile();
        ++this.loginEpoch; this.render(); await this.loadHomes();
      } else if (result.status === 'expired') { this.loginState = 'expired'; this.render(); }
      else this.scheduleLoginPoll(epoch, attemptId);
    } catch (error) {
      if (epoch !== this.loginEpoch) return;
      this.loginState = 'error'; this.loginError = normalizeError(error); this.render();
      void api.cancelLogin(attemptId).catch(() => undefined);
    }
  }

  private async cancelLogin(): Promise<void> {
    ++this.loginEpoch; if (this.loginTimer) clearTimeout(this.loginTimer);
    const attemptId = this.qr?.attemptId;
    this.qr = undefined; this.loginState = 'idle'; this.loginError = undefined; this.render();
    if (attemptId) {
      try { await api.cancelLogin(attemptId); }
      catch (error) { this.loginError = normalizeError(error); this.render(); }
    }
  }

  private async loadHomes(): Promise<void> {
    const epoch = ++this.homeEpoch;
    this.homesLoading = true; this.homeError = undefined; this.render();
    try {
      const homes = await api.listHomes();
      if (epoch !== this.homeEpoch || !this.session?.loggedIn) return;
      this.homes = homes; this.homesLoading = false; this.render();
      const homeId = homes.some(home => home.id === this.selectedHomeId) ? this.selectedHomeId : homes[0]?.id;
      if (homeId) await this.selectHome(homeId);
      else { this.selectedHomeId = ''; this.snapshot = undefined; this.render(); }
    } catch (error) {
      if (epoch !== this.homeEpoch) return;
      this.homesLoading = false; this.homeError = normalizeError(error); this.handleSessionError(this.homeError); this.render();
    }
  }

  private async selectHome(homeId: string): Promise<void> {
    const epoch = ++this.homeEpoch;
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    this.selectedHomeId = homeId; this.snapshot = undefined; this.homeBusy = true;
    this.resetLocalView(); this.homeScrollTop=0;
    this.homeError = undefined; this.roomId = '*'; this.clearPanel(); this.render();
    try {
      const snapshot = await api.selectHome(homeId);
      if (epoch !== this.homeEpoch || this.selectedHomeId !== homeId || !this.session?.loggedIn) return;
      if (snapshot.homeId !== homeId) throw new Error('家庭返回数据不匹配，请重新选择家庭。');
      this.snapshot = snapshot;
      void this.loadHomeCards();
      await this.loadPreferences();
      if(epoch!==this.homeEpoch||this.selectedHomeId!==homeId)return;
      this.homeBusy = false; this.render(); this.scheduleHomeRefresh();
    } catch (error) {
      if (epoch !== this.homeEpoch) return;
      this.homeBusy = false; this.homeError = normalizeError(error); this.handleSessionError(this.homeError); this.render();
    }
  }

  private editing(): boolean {
    if(this.accountOpen||this.accountMenuOpen||this.homeMenuOpen||this.deviceMenu)return true;
    if(this.routerPassword.modalOpen||this.routerPassword.revealed||this.routerView.page!=='home'||this.routerIndicator.pending)return true;
    if(this.dispenserView.page!=='home'||this.dispenserView.picker||this.dispenserView.discard||this.dispenserSterilization.pending||this.dispenserSelfCheck.pending)return true;
    if(this.fridgeView.page!=='home'||this.fridgeView.help||this.fridgeCommands.pending)return true;
    if(this.airerView.page!=='home'||this.airerCommands.pending)return true;
    if(this.fryerView.draft||this.fryerView.picker||this.fryer.pending)return true;
    if(this.purifierView.page!=='home'||this.purifierCommands.pending||this.purifierDnd.pending||this.purifierOptions.pending)return true;
    if(this.purifierView.draft||this.purifierCommands.pending)return true;
    if(this.washerRuntimeCommands.pending||this.washerRuntimeConfirmation)return true;
    return !!this.arrangement || this.drag.active || this.settingsOpen || !!this.washerDraft || this.washerView==='records' || this.washerCommands.pending || this.preferences.pendingCount>0 || this.timersOpen || this.timerBusy || !!this.countdownDraft || !!this.lightFavoriteDraft || !!this.lightFavoriteOperation?.pending || !!this.lightSettingsOpen || !!this.lightSettingsOperation?.pending || this.energyOpen || this.historyDetailOpen || this.controlBusy || !!this.actionConfirm || this.panelDrafts.size > 0 || !!this.root.querySelector('.device-page [data-interacting="true"]') || document.activeElement instanceof HTMLInputElement&&document.activeElement.type!=='range' || document.activeElement instanceof HTMLSelectElement;
  }

  private scheduleHomeRefresh(): void {
    if(this.disposed)return;
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    if (!this.session?.loggedIn || !this.snapshot || this.sessionNotice) return;
    this.homeRefreshTimer = setTimeout(() => {
      if (this.editing() || this.homeBusy) this.scheduleHomeRefresh();
      else void this.refreshDevices(true);
    }, 30_000);
  }

  private observingSterilization():boolean {
    return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='sterilization'&&!this.dispenserSterilization.blocked&&!this.dispenserSterilization.confirming&&!this.dispenserCommands.pending&&!this.dispenserDnd.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;
  }
  private observingSelfCheck():boolean{return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='selfcheck'&&!this.dispenserSelfCheck.blocked&&!this.dispenserSelfCheck.confirming&&!this.dispenserCommands.pending&&!this.dispenserDnd.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;}
  private schedulePanelRefresh(): void {
    if(this.disposed)return;
    if (this.panelRefreshTimer) clearTimeout(this.panelRefreshTimer);
    if (!this.context || !this.panel || this.sessionNotice) return;
    this.panelRefreshTimer = setTimeout(() => {
      if(this.timersOpen){
        if(this.currentDevice()?.online&&!this.timerDraft&&!this.timerModal&&this.timerSelection===undefined&&!this.timerLoading&&!this.timerBusy&&!this.countdownOperation?.pending)this.loadTimers();
        this.schedulePanelRefresh();return;
      }
      if (this.editing()&&!this.observingSterilization()&&!this.observingSelfCheck() || this.washerRuntimeCommands.pending || this.washerRuntimeConfirmation || this.panelLoading || !this.currentDevice()?.online) this.schedulePanelRefresh();
      else void this.readProperties(true);
    }, this.curtainMotion.moving||this.observingSelfCheck()||this.observingSterilization()&&this.panel?.dispenser?.status===4?2_000:10_000);
  }

  private async refreshDevices(automatic = false): Promise<void> {
    if (!this.snapshot || this.homeBusy) return;
    const { homeId, generation } = this.snapshot;
    const epoch = this.homeEpoch;
    this.homeBusy = true; this.homeError = undefined; if (!automatic) this.render();
    try {
      const snapshot = await api.refreshDevices(homeId, generation);
      if (epoch !== this.homeEpoch || this.snapshot?.homeId !== homeId || this.snapshot.generation !== generation) return;
      if (snapshot.homeId !== homeId || snapshot.generation !== generation) throw new Error('家庭数据已变化，请重新选择家庭。');
      const previous=this.snapshot;this.snapshot = snapshot; this.homeBusy = false;void this.loadHomeCards();
      if (this.context && !snapshot.devices.some(device => device.did === this.context?.did)) this.clearPanel();
      if (!automatic || !this.editing()) {
        if(!automatic||!this.refreshHomeInventory(previous))this.render();
      }
    } catch (error) {
      if (epoch !== this.homeEpoch) return;
      this.homeBusy = false; this.homeError = normalizeError(error); this.handleSessionError(this.homeError); if (!automatic || !this.editing()) this.render();
    } finally {
      if (epoch === this.homeEpoch) this.scheduleHomeRefresh();
    }
  }

  /** Background inventory reads keep unchanged cards, images and pointer owners mounted.
   * Changed device metadata rebinds that card so permissions/callbacks cannot go stale. */
  private refreshHomeInventory(previous:HomeSnapshot|undefined):boolean {
    if(!previous||!this.snapshot||this.context||this.settingsOpen||this.accountOpen||this.accountMenuOpen||this.homeMenuOpen||this.deviceMenu||this.arrangement||this.drag.active||this.homeError||this.uiNotice||this.preferencesError||this.preferences.error||previous.orderNotice!==this.snapshot.orderNotice)return false;
    const grid=this.root.querySelector<HTMLElement>('.home-screen .device-grid');
    const devices=this.filteredDevices();if(!grid||!devices.length)return false;
    const unassigned=(snapshot:HomeSnapshot)=>snapshot.devices.some(d=>!d.roomId||!this.currentHome()?.rooms.some(r=>r.id===d.roomId));
    if(unassigned(previous)!==unassigned(this.snapshot))return false;
    const home=grid.closest<HTMLElement>('.home-screen'),scrollTop=home?.scrollTop??0;
    const active=document.activeElement instanceof HTMLElement&&grid.contains(document.activeElement)?document.activeElement:undefined;
    const focusedDid=active?.closest<HTMLElement>('.device-card')?.dataset.deviceId,focusedShortcut=active?.classList.contains('device-shortcut');
    const old=new Map([...grid.children].map(node=>[(node as HTMLElement).dataset.deviceId,node as HTMLElement]));
    const retained=new Set<HTMLElement>();
    devices.forEach((device,index)=>{
      const previous=old.get(device.did),signature=JSON.stringify(device);
      const node=previous&&this.homeCardBindings.get(previous)===signature?previous:this.renderDeviceCard(device);
      if(previous&&node!==previous)preserveDeviceArtwork(previous,node);
      retained.add(node);const current=grid.children[index];if(current!==node)grid.insertBefore(node,current??null);
    });
    for(const node of [...grid.children])if(!retained.has(node as HTMLElement))node.remove();
    if(home)home.scrollTop=scrollTop;
    if(active){
      const card=focusedDid?[...grid.children].find(node=>(node as HTMLElement).dataset.deviceId===focusedDid):undefined;
      const replacement=(focusedShortcut?card?.querySelector<HTMLElement>('.device-shortcut:not(:disabled)'):undefined)??card?.querySelector<HTMLElement>('.device-card-open');
      const target=active.isConnected?active:replacement??grid.parentElement;
      if(target&&document.activeElement!==target)target.focus({preventScroll:true});
    }
    this.homeCardChanged();return true;
  }

  private renderWorkspace(): HTMLElement {
    if(this.settingsOpen)return settingsPage({view:this.settingsView,homeName:this.currentHome()?.name??'',devices:this.snapshot?.devices??[],preferences:this.monitorExitLatch&&this.preferences.view?{...this.preferences.view,monitor:{enabled:false,excludedDeviceIds:this.preferences.view.monitor?.excludedDeviceIds??[]}}:this.preferences.view,loading:this.preferencesLoading,pending:this.preferences.pendingCount>0,error:this.preferencesError??this.preferences.error,
      back:()=>leave(this.root.querySelector('.settings-page'),()=>{this.settingsOpen=false;this.render();}),retry:()=>{void this.loadPreferences();},change:change=>this.changePreferences(change),artwork:device=>this.deviceArtwork(device)});
    const devices = visibleHomeDevices(this.snapshot?.devices ?? [], !!this.preferences.view?.splitSwitches);
    const main = element('main', 'home-screen');
    main.dataset.homeCardsReady=String(!!this.homeCards);main.dataset.quickPending=String(this.homeCardOps.pendingCount+this.propertyOps.pendingCount);
    main.inert=!!this.context;
    main.dataset.localPending=String(this.preferences.pendingCount);main.dataset.localPreferencesReady=String(!!this.preferences.view);
    const top = element('div', 'home-topbar');
    const account = button('', 'home-account', () => { this.accountMenuOpen = !this.accountMenuOpen; this.homeMenuOpen=false;this.deviceMenu=undefined;this.render();if(this.accountMenuOpen)this.root.querySelector<HTMLButtonElement>('.account-menu button')?.focus({preventScroll:true}); });
    account.setAttribute('aria-label', '小米账号');
    account.setAttribute('aria-haspopup','menu');account.setAttribute('aria-expanded',String(this.accountMenuOpen));
    if(this.profileError)account.setAttribute('aria-description','账号资料暂时不可用');
    account.append(this.accountAvatar('home-account-avatar'));
    const picker = button(this.currentHome()?.name ?? (this.homesLoading ? '正在加载家庭' : '我的家庭'), 'home-title', () => { this.homeMenuOpen = !this.homeMenuOpen; this.render(); });
    picker.append(officialIcon('home:dropdown')); picker.setAttribute('aria-expanded', String(this.homeMenuOpen));
    top.append(picker,account);main.append(top);
    if(this.accountMenuOpen){
      const menu=element('div','account-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','账号菜单');
      const settings=button('设置','account-menu-item',()=>{this.accountMenuOpen=false;this.settingsView=createSettingsViewState();this.settingsOpen=true;this.render();});
      const profile=button('个人信息','account-menu-item',()=>{this.accountMenuOpen=false;this.accountOpen=true;this.render();});
      settings.dataset.focusKey='account-menu-settings';profile.dataset.focusKey='account-menu-profile';
      settings.setAttribute('role','menuitem');profile.setAttribute('role','menuitem');menu.append(settings,profile);main.append(menu);
      menu.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const choices=[settings,profile],index=choices.indexOf(document.activeElement as HTMLButtonElement);choices[event.key==='Home'?0:event.key==='End'?1:(index+(event.key==='ArrowDown'?1:-1)+2)%2].focus();});
    }
    if (this.homeMenuOpen) {
      const homes = element('div', 'home-menu'); homes.setAttribute('role', 'menu');
      for (const home of this.homes) {
        const choice = button(`${home.name}${home.shared ? ' · 共享' : ''}`, `home-choice${home.id === this.selectedHomeId ? ' chosen' : ''}`, () => { this.homeMenuOpen = false; void this.selectHome(home.id); });
        choice.dataset.focusKey=`home-choice-${home.id}`;
        choice.setAttribute('role', 'menuitem'); if (home.id === this.selectedHomeId) choice.append(icon('check')); homes.append(choice);
      }
      main.append(homes);
    }
    const rooms = element('nav', 'room-tabs'); rooms.setAttribute('aria-label', '房间');
    rooms.append(button('全屋', `room-tab${this.roomId === '*' ? ' active' : ''}`, () => { this.roomId = '*'; this.render(); }));
    for (const room of orderedRooms(this.currentHome()?.rooms ?? [], this.snapshot?.order)) rooms.append(button(room.name, `room-tab${this.roomId === room.id ? ' active' : ''}`, () => { this.roomId = room.id; this.render(); }));
    if (devices.some(device => !device.roomId || !this.currentHome()?.rooms.some(room => room.id === device.roomId))) rooms.append(button('未分配', `room-tab${this.roomId === '?' ? ' active' : ''}`, () => { this.roomId = '?'; this.render(); }));
    bindScrollStrip(rooms);main.append(rooms);
    const content = element('div', 'home-content');
    content.tabIndex=0;content.setAttribute('aria-label','设备列表');
    if (this.sessionNotice) {
      const box = notice({ tone: 'error', title: '登录已失效', message: this.sessionNotice.message }); box.append(button('重新登录', 'button button-small button-secondary', () => { void this.logout(); })); content.append(box);
    }
    if (this.homeError && !this.sessionNotice) {
      const box = notice({ tone: 'error', title: this.homeError.message });
      if (this.homeError.retryable) box.append(button('重试', 'button button-small button-secondary', () => { if (this.selectedHomeId) void this.selectHome(this.selectedHomeId); else void this.loadHomes(); })); content.append(box);
    }
    if (this.uiNotice) content.append(notice(this.uiNotice));
    content.append(this.homeOperationFeedback());
    const preferenceError=this.preferencesError??this.preferences.error;
    if(preferenceError){const box=notice({tone:'error',title:preferenceError.message});box.append(button('重试','button button-small button-secondary',()=>{void this.loadPreferences();}));content.append(box);}
    if (this.snapshot?.orderNotice) content.append(notice({ tone: 'warning', title: this.snapshot.orderNotice }));
    if (this.homesLoading || (this.homeBusy && !this.snapshot) || this.preferencesLoading) content.append(loading(this.preferencesLoading?'正在读取本地设置…':this.homesLoading ? '正在获取家庭…' : '正在获取设备…'));
    else if (!this.homes.length && !this.homeError) {
      const empty = emptyState('暂无可访问的家庭', '请确认米家 App 中同一账号的家庭和共享权限。', 'home'); empty.append(button('重新获取', 'button button-secondary', () => { void this.loadHomes(); }, 'refresh')); content.append(empty);
    } else if (!this.snapshot && this.homeError) content.append(emptyState('暂时无法获取设备', '请重试或切换家庭。'));
    else if (!this.preferences.view && this.snapshot) content.append(emptyState('本地设置未读取','读取设置后显示设备。'));
    else if (!this.filteredDevices().length) content.append(emptyState('暂无设备','可切换房间，或在设置中查看隐藏的设备。'));
    else {
      const grid = element('div', 'device-grid');
      grid.style.setProperty('--grid-columns',String(deviceColumnCount(innerWidth)));
      for (const device of this.filteredDevices()) grid.append(this.renderDeviceCard(device)); content.append(grid);
    }
    main.append(content);
    return main;
  }

  private renderAccount(): HTMLElement {
    const box = element('section', 'account-dialog'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '小米账号');
    const close = button('', 'icon-button', () => leave(box,()=>{this.accountOpen = false; this.render();}), 'close');
    close.dataset.focusKey='account-close';
    const logout = button(this.logoutBusy ? '正在退出…' : '退出登录', 'button button-primary', () => { this.accountOpen = false; void this.logout(); }, 'logout'); logout.disabled = this.logoutBusy;
    logout.dataset.focusKey='account-logout';
    box.append(element('div', 'account-heading', element('h2', '', '小米账号'), close), this.accountAvatar('account-avatar'), element('p','',this.accountProfile?.displayName??'小米用户'),element('p', '', this.session?.userId ? `ID ${this.session.userId}` : '已登录'), element('p', 'field-help', `地区：${regions.find(([value]) => value === this.session?.region)?.[1] ?? this.session?.region}`), logout);
    return element('div', 'modal-backdrop', box);
  }
  private resetLocalView():void{
    this.devicePreviewCache.clear();
    this.monitorWall.close();this.monitorExitLatch=false;
    this.propertyOps.reset();this.propertyContexts.clear();this.deviceSends.clear();this.confirmedPanels.clear();this.confirmedPanelVersions.clear();for(const motion of this.curtainMotions.values())motion.reset();this.curtainMotions.clear();this.curtainMotion.reset();this.homeCardsPropertyReadVersion=0;this.operationNoticeRevision=0;
    this.homeCards=undefined;this.homeCardsRequest=undefined;this.homeCardOps.reset();this.homeCardsReadVersion=0;
    this.arrangement=undefined;document.body.classList.remove('home-is-arranging');
    this.drag.cancel();this.deferredRender=false;this.preferences.reset();this.preferencesLoading=false;this.preferencesError=undefined;
    this.settingsOpen=false;this.settingsView=createSettingsViewState();this.accountMenuOpen=false;this.deviceMenu=undefined;
  }
  private async loadPreferences():Promise<void>{
    const snapshot=this.snapshot,epoch=this.homeEpoch;
    if(!snapshot||this.preferences.pendingCount)return;
    this.preferences.reset();this.preferencesLoading=true;this.preferencesError=undefined;this.render();
    try{
      const view=await api.homePreferences(snapshot.homeId,snapshot.generation);
      if(epoch!==this.homeEpoch||snapshot.homeId!==this.snapshot?.homeId||snapshot.generation!==this.snapshot?.generation)return;
      this.preferences.reset(view);
    }catch(error){
      if(epoch!==this.homeEpoch||snapshot.homeId!==this.snapshot?.homeId||snapshot.generation!==this.snapshot?.generation)return;
      this.preferencesError=normalizeError(error);this.handleSessionError(this.preferencesError);
    }finally{if(epoch===this.homeEpoch&&snapshot.homeId===this.snapshot?.homeId&&snapshot.generation===this.snapshot?.generation){this.preferencesLoading=false;this.render();}}
  }
  private preferenceChanged():void{
    const conflict=this.preferences.error?.kind==='conflict'&&this.preferences.pendingCount===0;
    if(conflict&&this.currentDevice()?.model===routerModel&&this.context){this.routerCommon.message='常用设备列表已变化，正在重新读取本地设置，请再次操作。';this.render();void this.loadPreferences();return;}
    this.render();
  }
  private changePreferences(change:PreferenceChange):void{
    if(change.operation==='setMonitorEnabled'){this.monitorExitLatch=!change.value;if(change.value){this.settingsOpen=false;this.clearPanel();}else this.monitorWall.close();}
    this.preferencesError=undefined;this.deviceMenu=undefined;this.preferences.change(change);
  }
  private exitMonitor():void {this.monitorExitLatch=true;this.monitorWall.close();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});this.settingsOpen=true;this.changePreferences({operation:'setMonitorEnabled',value:false});this.render();}
  private beginArrangement(id:string):boolean{
    const view=this.preferences.view,snapshot=this.snapshot;
    if(!view||!snapshot||view.dragLocked||this.preferences.pendingCount||this.context||this.settingsOpen)return false;
    if(!this.arrangement){
      const visible=this.filteredDevices().map(d=>d.did);if(!visible.includes(id))return false;
      const all=localDevices(snapshot.devices,snapshot.order,this.currentHome()?.rooms??[],this.roomId,view,true).map(d=>d.did);
      this.arrangement={homeId:snapshot.homeId,generation:snapshot.generation,roomId:this.roomId,original:visible,order:[...visible],all,selected:new Set()};
    }
    if(!this.arrangement.order.includes(id))return false;
    this.arrangement.selected.add(id);this.homeMenuOpen=false;this.accountMenuOpen=false;this.deviceMenu=undefined;this.updateArrangementChrome();return true;
  }
  private updateArrangementChrome():void{
    const state=this.arrangement;if(!state)return;
    document.body.classList.add('home-is-arranging');
    const home=this.root.querySelector('.home-screen');home?.classList.add('is-arranging');
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('.home-topbar button,.room-tabs button'))button.disabled=true;
    for(const card of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
      const selected=state.selected.has(card.dataset.deviceId??'');card.classList.toggle('arrange-selected',selected);card.setAttribute('aria-pressed',String(selected));
      card.setAttribute('aria-label',`${card.querySelector('h3')?.textContent??'设备'}，${selected?'已选中':'未选中'}`);
    }
    let toolbar=this.root.querySelector<HTMLElement>('.home-arrange-toolbar');
    if(!toolbar){
      const cancel=button('','arrange-toolbar-button',()=>this.finishArrangement(false),'close');cancel.setAttribute('aria-label','取消排列');
      const done=button('','arrange-toolbar-button',()=>this.finishArrangement(true),'check');done.setAttribute('aria-label','完成排列');
      const count=element('span','arrange-selection-count');count.setAttribute('aria-live','polite');
      toolbar=element('div','home-arrange-toolbar',cancel,count,done);toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','设备排列');this.root.append(toolbar);
    }
    toolbar.querySelector('.arrange-selection-count')!.textContent=`已选择${state.selected.size}`;
  }
  private finishArrangement(save:boolean):void{
    const state=this.arrangement;if(!state)return;
    const current=this.snapshot?.homeId===state.homeId&&this.snapshot.generation===state.generation&&this.roomId===state.roomId;
    const ids=save&&current?mergeVisibleOrder(state.all,state.original,state.order):undefined;
    this.arrangement=undefined;document.body.classList.remove('home-is-arranging');this.drag.cancel();this.root.querySelector('.home-arrange-toolbar')?.remove();
    if(ids&&state.order.some((id,index)=>id!==state.original[index]))this.changePreferences({operation:'setOrder',roomId:state.roomId,deviceIds:ids});else this.render();
  }
  private openDeviceMenu(did:string,x:number,y:number):void{
    if(this.arrangement)return;
    if(!this.preferences.view||!this.filteredDevices().some(d=>d.did===did))return;
    this.drag.cancel();this.closeDeviceMenu();this.accountMenuOpen=false;this.homeMenuOpen=false;
    this.root.querySelector('.account-menu')?.remove();this.root.querySelector('.home-menu')?.remove();
    for(const toggle of this.root.querySelectorAll('.home-account,.home-title'))toggle.setAttribute('aria-expanded','false');
    this.deviceMenu={did,x:Math.max(8,Math.min(x,innerWidth-188)),y:Math.max(8,Math.min(y,innerHeight-116))};
    this.root.append(this.renderDeviceMenu());
    this.root.querySelector<HTMLButtonElement>('.device-context-menu button')?.focus({preventScroll:true});
  }
  private closeDeviceMenu():void{
    this.deviceMenu=undefined;this.root.querySelector('.device-context-menu')?.remove();
  }
  private renderDeviceMenu():HTMLElement{
    const current=this.deviceMenu!,menu=element('div','device-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','设备选项');
    menu.style.left=`${current.x}px`;menu.style.top=`${current.y}px`;
    const homeHidden=this.preferences.view?.homeHiddenDeviceIds?.includes(current.did)??false;
    const home=button(homeHidden?'在全屋中显示':'仅在全屋隐藏','account-menu-item',()=>this.changePreferences({operation:'setHomeHidden',did:current.did,hidden:!homeHidden}));home.setAttribute('role','menuitem');
    const hide=button('隐藏设备','account-menu-item',()=>this.changePreferences({operation:'setHidden',did:current.did,hidden:true}));hide.setAttribute('role','menuitem');menu.append(home,hide);return menu;
  }
  private filteredDevices(): Device[] {
    const preferences=this.preferences.view;
    return preferences?localDevices(this.snapshot?.devices??[],this.snapshot?.order,this.currentHome()?.rooms??[],this.roomId,preferences,false,this.homeCards?.cards):[];
  }

  private async loadHomeCards():Promise<void>{
    const snapshot=this.snapshot;if(!snapshot)return;
    if(this.homeCardsRequest?.homeId===snapshot.homeId&&this.homeCardsRequest.generation===snapshot.generation)return this.homeCardsRequest.promise;
    const epoch=this.homeEpoch,version=this.homeCardOps.version,propertyVersion=this.propertyOps.version;
    const current=()=>epoch===this.homeEpoch&&this.snapshot?.homeId===snapshot.homeId&&this.snapshot.generation===snapshot.generation;
    const request={homeId:snapshot.homeId,generation:snapshot.generation,promise:Promise.resolve()};
    this.homeCardsRequest=request;
    request.promise=(async()=>{
      try{
        const report=await api.homeCards(snapshot.homeId,snapshot.generation);
        if(!current())return;
        if(report.homeId!==snapshot.homeId||report.generation!==snapshot.generation)throw Error('快捷状态与当前家庭不匹配。');
        const ids=new Set(snapshot.devices.map(device=>device.did));
        const superseded=(did:string)=>{const op=this.homeCardOps.get(did);return !!op&&(op.pending||op.settledRevision>version);};
        const statuses=[...(report.statuses??[]).filter(status=>ids.has(status.did)&&!superseded(status.did)),...(this.homeCards?.statuses??[]).filter(status=>ids.has(status.did)&&superseded(status.did))];
        this.homeCards={...report,cards:report.cards.filter(card=>ids.has(card.did)),statuses};this.homeCardsReadVersion=version;this.homeCardsPropertyReadVersion=propertyVersion;
        this.homeCardChanged();
      }catch(error){if(current())this.handleSessionError(normalizeError(error));}
      finally{if(this.homeCardsRequest===request)this.homeCardsRequest=undefined;}
    })();
    return request.promise;
  }
  private cameraHomePower=new Set<string>();
  private displayedHomeCard(device:Device):HomeCardEntry|undefined{
    const card=this.homeCards?.cards.find(card=>card.did===device.did);if(!card)return;
    if(this.cameraHomePower.has(device.did))return {...card,enabled:false};
    if(card.kind==='power'){const key=this.operationKey(device.did,card.binding.siid,card.binding.piid),op=this.propertyOps.get(key);if(op){const state=this.propertyOps.display(key,card.selected,this.homeCardsPropertyReadVersion);return cardDisplay(card,device,state.value===true?'on':state.value===false?'off':undefined,!!state.phase);}}
    if(card.kind==='curtain'&&device.model==='xiaomi.curtain.acn009'){const op=this.propertyOps.get(this.operationKey(device.did,2,5));if(op?.pending)return {...card,action:'pause'};}
    const state=this.homeCardOps.display(card.did,cardReportedIntent(card),this.homeCardsReadVersion);
    return cardDisplay(card,device,state.value,!!state.phase);
  }
  private activateHomeCard(device:Device,intent:HomeCardIntent):void{
    const card=this.displayedHomeCard(device);
    if(!card?.enabled||this.arrangement||this.context||!this.snapshot)return;
    this.uiNotice=undefined;
    if(card.kind==='power'&&cameraPageEligible(device)&&!isCloudDoorbell(device.model)){
      if(card.selected===null||this.cameraHomePower.has(device.did)||!['on','off'].includes(intent))return;
      const context={homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},homeEpoch=this.homeEpoch;
      this.cameraHomePower.add(device.did);this.render(true);
      void api.changeCameraPower(context,intent==='on',card.selected).catch(error=>{if(homeEpoch===this.homeEpoch)this.handleSessionError(normalizeError(error));}).finally(()=>{this.cameraHomePower.delete(device.did);if(homeEpoch===this.homeEpoch){void this.loadHomeCards();this.render(true);}});return;
    }
    if(card.kind==='power'){const key=this.operationKey(device.did,card.binding.siid,card.binding.piid);if(!this.propertyContexts.has(key))this.propertyContexts.set(key,{context:{homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},homeEpoch:this.homeEpoch,homePower:true});this.propertyOps.setActive(true);this.propertyOps.write(key,intent==='on',this.homeCards?.cards.find(c=>c.did===device.did)?.selected??false);return;}
    if(card.kind==='curtain'&&device.model==='xiaomi.curtain.acn009'){const key=this.operationKey(device.did,2,5);if(intent==='pause'){this.curtainMotions.get(JSON.stringify({homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did}))?.pause();this.propertyOps.cancel(key);}else{this.propertyContexts.set(key,{context:{homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},homeEpoch:this.homeEpoch,homeCurtain:true});const actual=numericValue(findProperty(this.confirmedPanels.get(device.did),['curtain'],['current-position']));this.propertyOps.write(key,intent==='open'?100:0,actual??(card.selected?100:0));const c={homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},motionKey=JSON.stringify(c),motion=this.curtainMotions.get(motionKey)??new CurtainMotion();this.curtainMotions.set(motionKey,motion);motion.update(motionKey,{position:actual??(card.selected?100:0),target:intent==='open'?100:0,journey:numericValue(findProperty(this.confirmedPanels.get(device.did),['curtain'],['whole-journey-time'])),pending:true,revision:this.propertyOps.get(key)?.revision});return;}}
    this.homeCardOps.write(device.did,intent,cardReportedIntent(card));
  }
  private homeOperationFeedback():HTMLElement{const box=element('div','home-operation-feedback');const count=this.propertyOps.uncertainCount+this.homeCardOps.uncertainCount;if(count)box.append(operationFeedback(`${count} 项操作待确认，后台正在核验`,()=>{for(const[key,op]of this.propertyOps.entries())if(op.pending&&op.phase==='uncertain')this.propertyOps.adopt(key);for(const[key,op]of this.homeCardOps.entries())if(op.pending&&op.phase==='uncertain')this.homeCardOps.adopt(key);}));return box;}
  private homeCardChanged():void{
    this.root.querySelector('.home-operation-feedback')?.replaceWith(this.homeOperationFeedback());
    if(this.preferences.view?.splitSwitches&&!this.context&&!this.settingsOpen&&!this.arrangement){
      const grid=this.root.querySelector('.device-grid');
      if(grid){
        const current=[...grid.querySelectorAll<HTMLElement>(':scope > .device-card')].map(card=>card.dataset.deviceId);
        const next=this.filteredDevices().map(device=>device.did);
        if(current.length!==next.length||current.some((id,index)=>id!==next[index])){this.render();return;}
      }else if(this.filteredDevices().length&&this.root.querySelector('.home-screen')){this.render();return;}
    }
    const settled=this.homeCardOps.lastSettled;
    if(settled&&settled.settledRevision>this.homeCardNoticeRevision){
      this.homeCardNoticeRevision=settled.settledRevision;
      if(settled.outcome==='rejected'){this.uiNotice=undefined;this.render();}
    }
    for(const card of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
      const device=this.snapshot?.devices.find(device=>device.did===card.dataset.deviceId);if(!device)continue;
      const state=this.displayedHomeCard(device),operation=this.homeCardOps.get(device.did);
      const caption=card.querySelector('.device-room');if(caption)caption.textContent=this.deviceCardCaption(device);
      card.classList.toggle('is-active',cardActive(state,device));
      card.dataset.shortcutPending=String(!!operation?.pending);
      const old=card.querySelector('.device-status');
      if(old)updateHomeShortcut(old,device,state,!!operation?.pending||!!(state?.kind==='power'&&this.propertyOps.get(this.operationKey(device.did,state.binding.siid,state.binding.piid))?.pending),intent=>this.activateHomeCard(device,intent));
    }
    const home=this.root.querySelector<HTMLElement>('.home-screen');
    if(home){home.dataset.homeCardsReady=String(!!this.homeCards);home.dataset.quickPending=String(this.homeCardOps.pendingCount+this.propertyOps.pendingCount);}
  }
  private async homeCardRequest(did:string,value:Json,read:boolean):Promise<PropertyReply>{
    const snapshot=this.snapshot,epoch=this.homeEpoch;
    if(!snapshot)throw {kind:'staleContext',message:'家庭已经切换。'};
    const context={homeId:snapshot.homeId,generation:snapshot.generation,did};
    const current=()=>epoch===this.homeEpoch&&this.snapshot?.homeId===context.homeId&&this.snapshot.generation===context.generation;
    try{
      const result=await(read?api.confirmHomeCard(context,value as HomeCardIntent):api.changeHomeCard(context,value as HomeCardIntent));
      if(!current())throw {kind:'staleContext',message:'家庭已经切换。'};
      if(result.card&&result.card.did!==did)throw {kind:'protocol',message:'快捷控制返回的设备不匹配。'};
      if(result.status&&result.status.did!==did)throw {kind:'protocol',message:'设备状态返回的设备不匹配。'};
      if(result.card&&this.homeCards)this.homeCards={...this.homeCards,cards:this.homeCards.cards.map(card=>card.did===did?result.card!:card)};
      if(this.homeCards&&result.status!==undefined)this.homeCards={...this.homeCards,statuses:[...(this.homeCards.statuses??[]).filter(status=>status.did!==did),...(result.status?[result.status]:[])]};
      return {outcome:result.verified?'confirmed':'pending',actual:result.actual??undefined,message:result.message};
    }catch(error){
      const failure=normalizeError(error);if(current())this.handleSessionError(failure);
      if(['unavailable','busy'].includes(failure.kind))return {outcome:'rejected',message:failure.message};
      throw failure;
    }
  }

  private deviceCardCaption(device:Device):string {
    return cardCaption(device,device.roomName||this.currentHome()?.rooms.find(room=>room.id===device.roomId)?.name||'未分配房间',this.homeCards?.statuses);
  }
  private renderDeviceCard(device: Device): HTMLElement {
    const shortcut=this.displayedHomeCard(device);
    const card = element('article', `device-card${!device.online ? ' offline' : ''}${cardActive(shortcut,device)?' is-active':''}`);
    this.homeCardBindings.set(card,JSON.stringify(device));card.dataset.deviceId=device.did;
    const open=()=>{
      if(this.arrangement){const selected=this.arrangement.selected;selected.has(device.did)?selected.delete(device.did):selected.add(device.did);this.updateArrangementChrome();return;}
      void this.openPanel(device);
    };
    card.tabIndex=-1;
    this.cardPress.bind(card,device.did);
    card.addEventListener('click',open);
    const entrance=button('','device-card-open',()=>{});entrance.setAttribute('aria-label',`${device.name}，${device.online?'在线':'离线'}，查看设备功能`);
    card.append(entrance);
    card.dataset.focusKey=`device-${device.did}`;
    card.setAttribute('aria-label', `${device.name}，${device.online ? '在线' : '离线'}，查看设备功能`);
    card.setAttribute('aria-pressed', String(this.context?.did === device.did));
    card.setAttribute('aria-description',device.unsupportedReason ? `${device.name}：${device.unsupportedReason}` : device.name);
    card.append(element('div', 'device-card-content',
      element('div', 'device-card-top', this.deviceArtwork(device), homeShortcut(device,shortcut,!!this.homeCardOps.get(device.did)?.pending,intent=>this.activateHomeCard(device,intent))),
      element('div', 'device-card-label', element('h3', '', device.name), element('p', 'device-room', this.deviceCardCaption(device)))));
    const selected=element('span','device-select-indicator',icon('check'));selected.setAttribute('aria-hidden','true');card.append(selected);
    const locked=this.preferences.view?.dragLocked!==false;
    this.drag.bind(card,device.did,locked);
    card.addEventListener('contextmenu',event=>{event.preventDefault();this.openDeviceMenu(device.did,event.clientX,event.clientY);});
    card.addEventListener('keydown',event=>{
      if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();open();return;}
      if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const rect=card.getBoundingClientRect();this.openDeviceMenu(device.did,rect.x+rect.width/2,rect.y+rect.height/2);}
      else if(!locked&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const ids=this.arrangement?.order??this.filteredDevices().map(d=>d.did),index=ids.indexOf(device.did),target=ids[index+(event.key==='ArrowLeft'?-1:1)];if(target)this.drag.moveByKeyboard(card,target);}
    });
    return card;
  }

  private deviceArtwork(device: Device, className = '', switchCount = 3,product=false): HTMLElement {
    const art = element('span', `device-artwork ${className}`);
    const url=product?(device.productIcon??device.icon):device.icon;
    art.dataset.artworkKey=JSON.stringify([device.did,device.model,url??'',product,switchCount]);
    if (url && (/^https:\/\//i.test(url) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url))) {
      art.dataset.artworkSource=product&&device.productIcon?'product-config':'device-list';
      const image = element('img', 'device-product-image'); image.src = url; image.alt = ''; image.loading = product||className==='switch-key-artwork'?'eager':'lazy'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        if(art.dataset.artworkSource==='product-config'&&device.icon&&device.icon!==url&&/^https:\/\//i.test(device.icon)){
          art.dataset.artworkSource='device-list';image.src=device.icon;return;
        }
        image.remove(); art.dataset.artworkSource='official-category'; art.setAttribute('aria-description','产品图暂不可用，显示设备示意图'); art.append(icon(deviceIcon(device.model)));
      }); art.append(image);
    } else {
      art.dataset.artworkSource='official-category'; art.setAttribute('aria-description','设备示意图');
      art.append(miotCategory(device.specType)==='switch'?this.switchArtwork(switchCount):icon(deviceIcon(device.model)));
    }
    return art;
  }

  private switchArtwork(_count = 3): HTMLElement {return element('span','device-original-fallback switch-original-art',officialIcon('switch:device'));}

  private clearPanel(): void {
    this.scale.close();this.scalePage.dispose();
    this.deviceEvents.close();
    this.bathHeater.close();
    this.ceilingFan.close();
    this.fryer.close();this.fryerView={};
    this.vacuum.close();
    this.doorbell.close();
    this.doorbellPlayer.dispose();
    this.irRemote.close();
    this.televisionSettings=false;this.televisionPendingRole=undefined;
    this.fridgeCommands.close();this.fridgeView={page:'home'};
    this.dispenserCommands.close();this.dispenserView={page:'home'};
    this.dispenserDnd.close();
    this.dispenserHistory.close();this.dispenserHistoryPicker=undefined;
    this.dispenserSelfCheck.close();this.dispenserSterilization.close();
    this.dispenserReminders.close();this.dispenserReminderView={page:'settings'};
    this.airerCommands.close();this.airerView={page:'home'};
    this.routerScene.close();this.routerDaily.close();this.routerPassword.close();this.routerClientName.close();this.routerClassification.close();this.routerQos.close();this.routerAccess.close();this.routerFamily.close();this.routerUrl.close();this.routerRecords.close();this.routerCommon.close();this.router.close();this.routerView={page:'home',tab:'online'};
    this.routerIndicator.close();
    this.routerWifi.close();
    this.routerAdvanced.close();
    this.routerInternet.close();
    this.routerNetwork.close();
    this.purifierGuide?.dispose();this.purifierGuide=undefined;
    this.purifierOptions.close();
    this.purifierDnd.close();
    this.purifierHistory.close();this.purifierHistoryPicker=undefined;
    this.purifierView=newPurifierView();
    this.deviceOpening.cancel();
    this.washerCommands.reset();this.washerOrderAt=undefined;
    this.washerRuntimeConfirmation=undefined;clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;
    this.washerRecords.reset();
    this.washerConfig=undefined;this.washerLoading=false;this.washerProgramsOpen=false;this.washerError=undefined;this.washerView='home';this.washerDraft=undefined;
    this.deviceMenu=undefined;
    this.lightTab=undefined;
    this.lightModes=undefined;this.lightModesLoading=false;this.lightModesError=undefined;this.lightModesReadAt=0;this.lightModesRequest=undefined;this.lightScenesExpanded=false;
    this.lightFavoriteOperation?.cancel();this.lightFavoriteOperation=undefined;this.lightFavoriteDraft=undefined;++this.lightFavoriteEpoch;++this.lightFavoritesVersion;this.lightSceneTab='standard';this.lightFavorites=undefined;this.lightFavoritesLoading=false;this.lightFavoritesError=undefined;this.lightFavoritesRequest=undefined;
    this.lightSettingsOperation?.cancel();this.lightSettingsOperation=undefined;this.lightSettingsOpen=undefined;this.lightSettingsReport=undefined;this.lightSettingsError=undefined;this.lightSettingsLoading=false;this.lightSettingsRequest=undefined;this.lightSettingsDraft=undefined;++this.lightSettingsDraftEpoch;
    if(this.lightDependencyTimer)clearTimeout(this.lightDependencyTimer);
    this.lightDependencyTimer=undefined;
    if (this.panelRefreshTimer) clearTimeout(this.panelRefreshTimer);
    if (this.uiResourcesRefreshTimer) clearTimeout(this.uiResourcesRefreshTimer);
    this.uiResourcesRefreshTimer = undefined; this.uiResourcesRequest = undefined;
    this.uiResources = undefined; this.uiResourcesError = undefined; this.uiResourcesRefreshAttempts = 0;
    this.panelDrafts.clear();
    this.linkedPanels.clear(); this.linkedErrors.clear();
    this.sensorHistory = undefined; this.historyLoading = false; this.historyError = undefined; this.historyReadAt = 0;
    this.historyDetailOpen = false; this.detailPicker = undefined; this.detailData = undefined; this.detailLoading = false; this.detailError = undefined; ++this.detailEpoch;
    this.energyOpen=false;this.energyData=undefined;this.energyLoading=false;this.energyError=undefined;this.energyPicker=undefined;this.energyReadAt=0;++this.energyEpoch;
    this.timersOpen=false;this.timerData=undefined;this.timerLoading=false;this.timerError=undefined;++this.timerEpoch;
    this.timerDraft=undefined;this.timerModal=undefined;this.timerSelection=undefined;this.timerBusy=false;this.timerMessage=undefined;
    this.countdownDraft=undefined;this.countdownOperation?.cancel();this.countdownOperation=undefined;this.timerPendingChanges=[];
    this.presentationRoute.reset();
    this.deviceDataPresented=false;
    this.cameraPlayer.dispose();
    ++this.panelEpoch; this.context = undefined; this.panel = undefined; this.panelError = undefined;
    this.panelNotice = undefined; this.panelLoading = false; this.controlBusy = false; this.controlIntent=undefined;this.actionConfirm = undefined;
    this.panelIsCached=false;this.panelCachedAt=null;this.panelHasCachedState=false;
    this.speaker.close();
    this.curtainMotion.detach();
  }

  private closePanel(): void { if(this.purifierView.draft&&!this.purifierCommands.pending){this.purifierView.confirm='leave';this.render(true);return;}const did=this.context?.did;this.clearPanel(); this.render();void this.loadHomeCards();[...this.root.querySelectorAll<HTMLElement>('.device-card')].find(card=>card.dataset.deviceId===did)?.querySelector<HTMLButtonElement>('.device-card-open')?.focus({preventScroll:true}); }

  private deviceCacheKey(device:Device,context:DeviceContext):string{return JSON.stringify([PRESENTATION_VERSION,this.session?.region,this.session?.userId,context.homeId,context.generation,context.did,device.model,device.specType,device.controlGroup,device.controlServiceId,device.unsupportedReason]);}
  private rememberDevice(panel:DevicePanel):void{
    const device=this.snapshot?.devices.find(d=>d.did===panel.did);if(!device||!this.context)return;
    const key=this.deviceCacheKey(device,{...this.context,did:panel.did}),previous=this.devicePreviewCache.get(key);
    this.devicePreviewCache.delete(key);this.devicePreviewCache.set(key,{panel,cachedAt:Date.now()/1000,hasCachedState:panel.services.some(s=>s.properties.some(p=>p.code===0||!!p.lastReported)),washerConfig:panel.did===this.context.did?this.washerConfig:previous?.washerConfig,at:Date.now()});
    if(this.devicePreviewCache.size>64)this.devicePreviewCache.delete(this.devicePreviewCache.keys().next().value!);
  }
  private deviceContentReady():void{
    if(this.panelError||this.panel&&(presentationReady(this.currentDevice(),this.panel)||!this.panelLoading)&&(this.currentDevice()?.model!=='midjd8.washer.42'||this.washerConfig||this.washerError))this.deviceOpening.ready();
  }

  private async openPanel(device: Device): Promise<void> {
    if (!this.snapshot) return;
    this.clearPanel();
    const context = { homeId: this.snapshot.homeId, generation: this.snapshot.generation, did: device.did };
    const epoch = this.panelEpoch;
    const readVersion=this.propertyOps.version;
    this.context = context; this.panelLoading = true;
    this.propertyOps.setActive(true);
    if(isIrRemote(device.model)){this.panelLoading=false;this.deviceOpening.begin();this.irRemote.bind(context,device.model,JSON.stringify([this.session?.region,this.session?.userId]));void this.irRemote.read();this.render();return;}
    if(device.model===vacuumModel){this.panelLoading=false;this.deviceOpening.begin();this.vacuum.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.vacuum.read();this.render();return;}
    if(isScale(device.model)){this.panelLoading=false;this.deviceOpening.begin();this.scale.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.scale.read();this.render();return;}
    const cached=this.devicePreviewCache.get(this.deviceCacheKey(device,context));
    if(cached&&Date.now()-cached.at<300000){this.panel=this.projectPanel(cached.panel,-1);this.linkedPanels.set(context.did,this.panel);this.panelIsCached=true;this.panelCachedAt=cached.cachedAt;this.panelHasCachedState=cached.hasCachedState;this.washerConfig=cached.washerConfig;}
    if(!presentationReady(device,this.panel)||device.model==='midjd8.washer.42'&&!this.washerConfig)this.deviceOpening.begin();this.render();
    const freshRequest=api.devicePanel(context);
    if(speakerMetadataSupported(device.model)&&device.online){this.speaker.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.speaker.read();}
    if(device.model===bathHeaterModel){this.bathHeater.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.bathHeater.read();}
    if(device.model===fryerModel){this.fryer.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.fryer.read();}
    if(device.model===ceilingFanModel){this.ceilingFan.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.ceilingFan.read();}
    if(isCloudDoorbell(device.model)){this.doorbell.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.doorbell.read();}
    if(device.model===routerModel){const scope=JSON.stringify([this.session?.region,this.session?.userId]);this.router.bind(context,scope);this.routerPassword.bind(context,scope);void this.routerPassword.load(context);this.routerIndicator.bind(context,scope);this.routerWifi.bind(context,scope);void this.router.load(context);}
    // Resource acquisition must never serialize or gate device state/preview.
    void this.loadDeviceUiResources(context, epoch);
    if(device.model==='yeelink.light.wyra01'){void this.loadLightModes(context,epoch);void this.loadLightFavorites();}
    if(device.model==='midjd8.washer.42')void this.loadWasherConfig(context,epoch);
    void api.devicePreview(context).then(preview=>{
      if(epoch!==this.panelEpoch||!sameContext(context,this.context)||!this.panelLoading)return;
      if(preview.panel.did!==context.did||preview.panel.model!==device.model)return;
      if(presentationReady(device,this.panel)&&!presentationReady(device,preview.panel))return;
      this.panel=this.projectPanel(preview.panel,-1);this.linkedPanels.set(context.did,this.panel);
      this.panelIsCached=true;this.panelCachedAt=preview.cachedAt;this.panelHasCachedState=preview.hasCachedState;this.rememberDevice(preview.panel);this.deviceContentReady();this.render(true);
    }).catch(()=>{/* The authoritative state request reports any failure. */});
    try {
      const panel = await freshRequest;
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (panel.did !== context.did) throw new Error('设备返回数据不匹配，请重新打开设备。');
      this.acceptPanel(panel,readVersion); this.panelLoading = false;
      if(device.model!=='midjd8.washer.42'&&capabilityCategory(panel.specType)==='washer')void this.loadWasherConfig(context,epoch);
      this.panelIsCached=false;this.panelHasCachedState=false;this.deviceContentReady();this.render(true);
      if (panelLayout(device, panel) === 'temperature-humidity-sensor') void this.loadSensorHistory(context, epoch);
      if(energySupported(device,panel))this.loadEnergy({period:'week',date:dateKey(new Date())},false);

      await this.loadLinkedPanels(context, epoch); this.schedulePanelRefresh();
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      this.panelLoading = false; this.panelError = normalizeError(error); this.handleSessionError(this.panelError); this.deviceContentReady();this.render();
    }
  }

  private loadDeviceUiResources(context: DeviceContext, epoch: number): Promise<void> {
    if (this.uiResourcesRequest?.epoch === epoch) return this.uiResourcesRequest.promise;
    const current = (): boolean => epoch === this.panelEpoch && sameContext(context, this.context);
    if (!current()) return Promise.resolve();
    if (this.uiResourcesRefreshTimer) clearTimeout(this.uiResourcesRefreshTimer);
    this.uiResourcesRefreshTimer = undefined;
    let retry = false;
    const promise = api.deviceUiResources(context).then(resources => {
      if (!current()) return;
      if (resources.did !== context.did || resources.model !== this.currentDevice()?.model) {
        this.uiResourcesError = '页面资源与当前设备不匹配，已忽略。'; return;
      }
      this.uiResources = resources; this.uiResourcesError = undefined;
      retry = resources.cacheState === 'stale';
      if (!this.editing()) this.render(true);
    }).catch(error => {
      if (!current()) return;
      const failure = normalizeError(error);
      if (failure.kind === 'authExpired') { this.handleSessionError(failure); return; }
      this.uiResourcesError = `页面配置暂未更新：${failure.message}`;
      retry = failure.retryable;
      // A layout failure does not remove a working device panel or show a new
      // blocking dialog. The existing capability/visual adapter remains usable.
      if (!this.editing()) this.render(true);
    }).finally(() => {
      if (!current()) return;
      this.uiResourcesRequest = undefined;
      if (retry && this.uiResourcesRefreshAttempts < 3) {
        const delay = [750, 2000, 5000][this.uiResourcesRefreshAttempts++];
        this.uiResourcesRefreshTimer = setTimeout(() => {
          this.uiResourcesRefreshTimer = undefined;
          if (current()) void this.loadDeviceUiResources(context, epoch);
        }, delay);
      }
    });
    this.uiResourcesRequest = { epoch, promise };
    return promise;
  }

  private async loadWasherConfig(context:DeviceContext,epoch:number):Promise<void>{
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!!this.currentDevice()?.model.includes('.washer.');
    if(!current()||this.washerLoading)return;this.washerLoading=true;this.washerError=undefined;
    try{
      const report=await api.washerConfig(context);if(!current())return;
      if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw Error('洗涤程序与设备不匹配。');this.washerConfig=report;if(this.panel)this.rememberDevice(this.panel);
    }catch(error){if(current()){const failure=normalizeError(error);this.washerError=failure.message;this.handleSessionError(failure);}}
    finally{if(current()){this.washerLoading=false;this.deviceContentReady();if(!this.editing())this.render(true);}}
  }
  private closeWasherOrder():void{
    this.washerOrderAt=undefined;this.washerCommands.reservationAt=null;
    if(this.context&&this.washerDraft&&!this.washerCommands.locked)this.washerCommands.edit(this.context,this.washerDraft);this.render(true);
  }

  private loadLightModes(context:DeviceContext,epoch:number):Promise<void>{
    if(this.lightModesRequest?.epoch===epoch)return this.lightModesRequest.promise;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&this.currentDevice()?.model==='yeelink.light.wyra01';
    if(!current())return Promise.resolve();
    this.lightModesLoading=true;
    if(this.panel&&!this.editing())this.render(true);
    const promise=api.lightModes(context).then(report=>{
      if(!current())return;
      if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw new Error('模式槽位与当前设备不匹配，已忽略。');
      this.lightModes=report;this.lightModesError=undefined;this.lightModesReadAt=Date.now();
    }).catch(error=>{
      if(!current())return;
      const failure=normalizeError(error);this.lightModesError=failure.message;this.handleSessionError(failure);
    }).finally(()=>{
      if(!current())return;
      this.lightModesLoading=false;this.lightModesRequest=undefined;
      if(!this.editing())this.render(true);
    });
    this.lightModesRequest={epoch,promise};return promise;
  }

  private openLightSettings(kind:LightSettingsKind):void{
    if(!this.context||this.currentDevice()?.model!=='yeelink.light.wyra01')return;
    this.lightSettingsOpen=kind;this.lightSettingsDraft=undefined;++this.lightSettingsDraftEpoch;
    this.lightSettingsError=undefined;this.render(true);void this.loadLightSettings();
  }
  private closeLightSettingsDraft():void{
    this.lightSettingsDraft=undefined;++this.lightSettingsDraftEpoch;
    for(const node of this.root.querySelectorAll<HTMLElement>('.light-settings-dialog[data-interacting]'))delete node.dataset.interacting;
    this.render(true);
  }
  private closeLightSettings():void{
    this.lightSettingsDraft=undefined;this.lightSettingsOpen=undefined;++this.lightSettingsDraftEpoch;
    for(const node of this.root.querySelectorAll<HTMLElement>('.light-settings-dialog[data-interacting]'))delete node.dataset.interacting;
    this.render(true);this.schedulePanelRefresh();
  }
  private loadLightSettings():Promise<void>{
    if(this.lightSettingsOperation?.pending)return this.lightSettingsOperation.refresh();
    if(this.lightSettingsRequest?.epoch===this.panelEpoch)return this.lightSettingsRequest.promise;
    if(!this.context||this.currentDevice()?.model!=='yeelink.light.wyra01')return Promise.resolve();
    const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    this.lightSettingsLoading=true;this.lightSettingsError=undefined;this.render(true);
    const promise=api.lightSettings(context).then(report=>{
      if(!current())return;
      if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw Error('模式设置与当前设备不匹配，已忽略。');
      this.lightSettingsReport=report;
    }).catch(error=>{
      if(!current())return;const failure=normalizeError(error);this.lightSettingsError=failure.message;this.handleSessionError(failure);
    }).finally(()=>{
      if(!current())return;this.lightSettingsLoading=false;this.lightSettingsRequest=undefined;this.render(true);
    });
    this.lightSettingsRequest={epoch,promise};return promise;
  }
  private editLightSetting(index:number|'speed'):void{
    if(!this.context||!this.lightSettingsOpen||!this.currentDevice()?.online||this.lightSettingsLoading||this.lightSettingsError||this.lightSettingsReport?.writeReason||this.lightSettingsOperation?.pending)return;
    try{this.lightSettingsDraft=settingsDraft(this.lightSettingsReport,this.lightSettingsOpen,index);++this.lightSettingsDraftEpoch;this.render(true);}
    catch(error){this.lightSettingsError=normalizeError(error).message;this.render(true);}
  }
  private saveLightSetting():void{
    if(!this.context||!this.lightSettingsOpen||!this.lightSettingsDraft||!this.lightSettingsReport||!this.currentDevice()?.online||this.lightSettingsLoading||this.lightSettingsError||this.lightSettingsReport.writeReason||this.lightSettingsOperation?.pending)return;
    const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    try{
      const change=settingsChange(this.lightSettingsOpen,this.lightSettingsDraft);
      this.lightSettingsDraft=undefined;++this.lightSettingsDraftEpoch;this.lightSettingsError=undefined;
      const request=async(query:boolean)=>{
        if(!current())throw{kind:'staleContext',message:'设备已切换。'};
        try{const result=await(query?api.confirmLightSettings(context,change):api.changeLightSettings(context,change));
          if(!current())throw{kind:'staleContext',message:'设备已切换。'};return result;
        }catch(error){if(current())this.handleSessionError(normalizeError(error));throw error;}
      };
      const operation=new LightSettingsOperation(change,this.lightSettingsReport,()=>request(false),()=>request(true),()=>{
        if(!current()||this.lightSettingsOperation!==operation)return;
        this.lightSettingsReport=operation.report;
        this.lightSettingsError=operation.phase==='rejected'?operation.error?.message:undefined;
        this.render(true);
        if(!operation.pending){void this.loadLightModes(context,epoch);this.refreshLightDependencies();}
      });
      this.lightSettingsOperation=operation;void operation.start();
    }catch(error){this.lightSettingsError=normalizeError(error).message;this.render(true);}
  }

  private loadLightFavorites():Promise<void>{
    if(!this.context||this.currentDevice()?.model!=='yeelink.light.wyra01')return Promise.resolve();
    if(this.lightFavoriteOperation?.pending)return this.lightFavoriteOperation.refresh();
    if(this.lightFavoritesRequest?.epoch===this.panelEpoch)return this.lightFavoritesRequest.promise;
    const context={...this.context},epoch=this.panelEpoch,version=this.lightFavoritesVersion,current=()=>epoch===this.panelEpoch&&version===this.lightFavoritesVersion&&sameContext(context,this.context);
    this.lightFavoritesLoading=true;
    const promise=api.lightFavorites(context).then(report=>{if(!current())return;if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw Error('收藏列表与当前设备不匹配。');this.lightFavorites=report;this.lightFavoritesError=undefined;}).catch(error=>{if(current()){const e=normalizeError(error);this.lightFavoritesError=e.message;this.handleSessionError(e);}}).finally(()=>{if(current()){this.lightFavoritesLoading=false;this.lightFavoritesRequest=undefined;this.render(true);}});
    this.lightFavoritesRequest={epoch,version,promise};return promise;
  }
  private openLightFavorite(item?:LightFavorite):void{
    if(!this.context||!this.lightFavorites||this.lightFavoriteOperation?.pending)return;
    try{this.lightFavoriteDraft=favoriteDraft(item);this.lightFavoritesError=undefined;++this.lightFavoriteEpoch;this.render(true);}catch(e){this.lightFavoritesError=normalizeError(e).message;this.render(true);}
  }
  private closeLightFavorite():void{
    for(const node of this.root.querySelectorAll<HTMLElement>('.page-light-favorite [data-interacting]'))delete node.dataset.interacting;
    this.lightFavoriteDraft=undefined;++this.lightFavoriteEpoch;this.lightSceneTab='custom';this.render(true);
  }
  private mutateLightFavorite(remove=false):void{
    if(!this.context||!this.lightFavoriteDraft||!this.lightFavorites||this.lightFavoriteOperation?.pending)return;
    const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    try{
      const draft=this.lightFavoriteDraft,change:LightFavoriteChange=remove&&draft.id&&draft.baseline?{operation:'delete',id:draft.id,baseline:draft.baseline}:favoriteChange(draft,this.lightFavorites);
      if(remove&&change.operation!=='delete')return;this.lightFavoritesError=undefined;
      // A pre-save list request may complete after reconciliation. Its stale
      // snapshot must not replace the newly confirmed cloud collection.
      ++this.lightFavoritesVersion;this.lightFavoritesRequest=undefined;this.lightFavoritesLoading=false;
      const request=async(query:boolean)=>{if(!current())throw{kind:'staleContext',message:'设备已切换。'};try{const result=await(query?api.confirmLightFavorite(context,change):api.changeLightFavorite(context,change));if(!current())throw{kind:'staleContext',message:'设备已切换。'};return result;}catch(e){if(current())this.handleSessionError(normalizeError(e));throw e;}};
      const op=new LightFavoriteOperation(change,this.lightFavorites,()=>request(false),()=>request(true),()=>{
        if(!current()||this.lightFavoriteOperation!==op)return;this.lightFavorites=op.report;this.lightFavoritesError=op.error?.message;
        if(op.phase==='confirmed'){this.lightFavoriteDraft=undefined;++this.lightFavoriteEpoch;this.lightSceneTab='custom';}this.render(true);
      });this.lightFavoriteOperation=op;void op.start();
    }catch(e){this.lightFavoritesError=normalizeError(e).message;this.render(true);}
  }
  private applyLightFavorite(item:LightFavorite):void{
    const device=this.currentDevice();if(!device||this.lightFavoriteOperation?.pending)return;
    try{const writes=favoriteWrites(item,this.panel?.services.flatMap(s=>s.properties)??[],device.online,this.panelIsCached||this.controlBusy);this.lightTab=item.tab;for(const {property,value}of writes)void this.setBoundProperty(property,value,device.did);}catch(e){this.lightFavoritesError=normalizeError(e).message;this.render(true);}
  }
  private async readProperties(automatic = false): Promise<void> {
    if (!this.context || this.panelLoading || this.controlBusy) return;
    const context = { ...this.context }; const epoch = this.panelEpoch;
    const fridgeReadVersion=this.fridgeCommands.version,airerReadVersion=this.airerCommands.version;
    const dispenserReadVersion=this.dispenserCommands.version;
    const dispenserDndReadVersion=this.dispenserDnd.operationVersion;
    const sterilizationReadVersion=this.dispenserSterilization.version;
    const selfCheckReadVersion=this.dispenserSelfCheck.version;
    const reminderReadVersion=this.dispenserReminders.version;
    if(this.currentDevice()?.model==='yeelink.light.wyra01'&&(!automatic||Date.now()-this.lightModesReadAt>=30000))void this.loadLightModes(context,epoch);
    if(this.currentDevice()?.model==='yeelink.light.wyra01'&&!automatic)void this.loadLightFavorites();
    if (!automatic && (!this.uiResources || this.uiResources.cacheState === 'stale')) void this.loadDeviceUiResources(context, epoch);
    const readVersion=this.propertyOps.version;
    this.panelLoading = true; this.panelError = undefined;
    if (!automatic) { this.panelNotice = undefined; this.render(); }
    try {
      const panel = await api.readProperties(context);
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (panel.did !== context.did) throw new Error('设备返回数据不匹配，请重新打开设备。');
      this.panelLoading = false;
      if(this.currentDevice()?.model===airerModel&&airerReadVersion!==this.airerCommands.version||this.currentDevice()?.model===fridgeModel&&fridgeReadVersion!==this.fridgeCommands.version){this.render(true);return;}
      if(this.currentDevice()?.model===dispenserModel&&(dispenserReadVersion!==this.dispenserCommands.version||dispenserDndReadVersion!==this.dispenserDnd.operationVersion||sterilizationReadVersion!==this.dispenserSterilization.version||selfCheckReadVersion!==this.dispenserSelfCheck.version||reminderReadVersion!==this.dispenserReminders.version)){this.render(true);return;}
      if (!automatic || !this.editing() || this.observingSterilization() || this.observingSelfCheck()) {
        this.acceptPanel(panel,readVersion);this.panelIsCached=false;this.panelHasCachedState=false;this.propertyOps.resume();this.render(true); await this.loadLinkedPanels(context, epoch);
        const device = this.currentDevice();
        if (device && panelLayout(device, panel) === 'temperature-humidity-sensor' && this.historyError?.retryable !== false && Date.now() - this.historyReadAt >= 300000) void this.loadSensorHistory(context, epoch);
        if(device&&energySupported(device,panel)&&!this.energyLoading&&!this.energyOpen&&Date.now()-this.energyReadAt>=300000)this.loadEnergy({period:'week',date:dateKey(new Date())},false);
      }
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      this.panelLoading = false; this.panelError = normalizeError(error); this.handleSessionError(this.panelError); if (!automatic || !this.editing()) this.render();
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) this.schedulePanelRefresh();
    }
  }

  private async loadSensorHistory(context: DeviceContext, epoch: number): Promise<void> {
    if (this.historyLoading || epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
    this.historyLoading = true; this.historyReadAt = Date.now(); this.historyError = undefined; this.render();
    try {
      const data = await api.sensorHistory(context);
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (data.did !== context.did || data.model !== this.currentDevice()?.model) throw new Error('历史记录与当前设备不匹配，请重新打开设备。');
      this.sensorHistory = data;
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      this.historyError = normalizeError(error); this.handleSessionError(this.historyError);
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.historyLoading = false; if (!this.historyDetailOpen) this.render(); }
    }
  }

  private selectHistoryDetail(selection: HistorySelection): void {
    if (!this.context) return;
    this.historyDetailOpen = true; this.detailSelection = selection; this.detailPicker = undefined;
    this.detailData = undefined; this.detailError = undefined; this.detailLoading = true;
    const request = ++this.detailEpoch, epoch = this.panelEpoch, context = { ...this.context };
    const current = () => this.historyDetailOpen && request === this.detailEpoch && epoch === this.panelEpoch && sameContext(context, this.context);
    this.render();
    void (async () => {
      try {
        const data = await api.historyDetail(context, selection);
        if (!current()) return;
        if (data.did !== context.did || data.model !== this.currentDevice()?.model || data.selection?.period !== selection.period || data.selection.date !== selection.date) throw Error('历史记录与当前周期不匹配，请重试。');
        this.detailData = data;
      } catch (error) {
        if (!current()) return;
        this.detailError = normalizeError(error); this.handleSessionError(this.detailError);
      } finally { if (current()) { this.detailLoading = false; this.render(); } }
    })();
  }

  private closeHistoryDetail(): void {
    this.historyDetailOpen = false; this.detailPicker = undefined; this.detailData = undefined; this.detailLoading = false; this.detailError = undefined; ++this.detailEpoch;
    this.render(); this.schedulePanelRefresh();
  }

  private loadEnergy(selection:EnergySelection,open=true):void {
    if(!this.context)return;
    this.energyOpen=open;this.energySelection=selection;this.energyPicker=undefined;this.energyData=undefined;this.energyLoading=true;this.energyError=undefined;this.energyReadAt=Date.now();
    const request=++this.energyEpoch,epoch=this.panelEpoch,context={...this.context};
    const current=()=>request===this.energyEpoch&&epoch===this.panelEpoch&&sameContext(context,this.context);
    this.render();void(async()=>{
      try{const data=await api.outletEnergy(context,selection);if(!current())return;
        if(data.did!==context.did||data.model!==this.currentDevice()?.model||data.selection.period!==selection.period||data.selection.date!==selection.date)throw Error('统计记录与当前设备或周期不匹配，请重试。');this.energyData=data;
      }catch(error){if(!current())return;this.energyError=normalizeError(error);this.handleSessionError(this.energyError);}
      finally{if(current()){this.energyLoading=false;this.render();}}
    })();
  }
  private closeEnergy():void {this.energyOpen=false;this.energyPicker=undefined;++this.energyEpoch;this.energyLoading=false;this.render();this.schedulePanelRefresh();}

  private loadTimers(open=false):void {
    if(!this.context||this.countdownDraft)return;
    if(this.countdownOperation?.pending){if(open){this.timersOpen=true;this.render();}void this.countdownOperation.refresh();return;}
    if(this.timerBusy)return;
    if(open)this.timersOpen=true;
    this.timerDraft=undefined;this.timerModal=undefined;this.timerSelection=undefined;this.timerMessage=undefined;
    if(open)this.timerData=undefined;
    this.timerLoading=true;this.timerError=undefined;
    const request=++this.timerEpoch,epoch=this.panelEpoch,context={...this.context};
    const current=()=>request===this.timerEpoch&&epoch===this.panelEpoch&&sameContext(context,this.context);
    this.render();void(async()=>{
      try{const data=await api.outletTimers(context);if(!current())return;
        if(data.did!==context.did||data.model!==this.currentDevice()?.model)throw Error('定时记录与当前设备不匹配，请重试。');this.timerData=data;
      }catch(error){if(!current())return;this.timerError=normalizeError(error);this.handleSessionError(this.timerError);}
      finally{if(current()){this.timerLoading=false;this.render();if(this.timersOpen)this.schedulePanelRefresh();}}
    })();
  }
  private closeTimers():void {if(this.timerBusy&&!this.countdownOperation?.pending)return;this.timersOpen=false;this.timerDraft=undefined;this.timerModal=undefined;this.timerSelection=undefined;++this.timerEpoch;this.timerLoading=false;this.render();this.schedulePanelRefresh();}
  private closeCountdown():void {
    const on=this.countdownDraft?.on;this.countdownDraft=undefined;this.render(true);
    document.querySelector<HTMLButtonElement>(`button[aria-label="设置延时${on?'开启':'关闭'}时间"]`)?.focus({preventScroll:true});
    this.schedulePanelRefresh();
  }
  private mutateCountdown(intent:()=>CountdownChange):void {
    if(!this.context||this.timerBusy||this.timerLoading||this.countdownOperation?.pending)return;
    let change:CountdownChange;
    try{change=intent();}catch(error){this.timerError=normalizeError(error);this.render(true);return;}
    const context={...this.context},epoch=this.panelEpoch; ++this.timerEpoch;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    if(!this.timerData)return;
    this.countdownOperation?.cancel();
    this.timerError=undefined;this.timerMessage=undefined;this.countdownDraft=undefined;
    const operation=new CountdownOperation(change,this.timerData,
      next=>api.changeOutletCountdown(context,next),()=>api.outletTimers(context),()=>{
        if(!current()||this.countdownOperation!==operation)return;
        this.timerData=operation.report;this.timerBusy=operation.phase==='sending';this.timerError=operation.error;
        if(operation.error)this.handleSessionError(operation.error);
        if(!current()||this.countdownOperation!==operation)return;
        this.render(true);this.schedulePanelRefresh();
      });
    this.countdownOperation=operation;void operation.start();
  }
  private backTimers():void {
    if(this.timerBusy&&!this.countdownOperation?.pending)return;
    if(this.timerModal){this.timerModal=undefined;this.render();return;}
    if(this.timerDraft){
      if(JSON.stringify(this.timerDraft)!==this.timerDraftBaseline)this.timerModal={kind:'discard'};
      else this.timerDraft=undefined;
      this.render();return;
    }
    if(this.timerSelection){this.timerSelection=undefined;this.render();return;}
    this.closeTimers();
  }
  private editTimer(entry?:TimerEntry,mode?:TimerMode):void {
    if(this.timerBusy||!this.timerData||entry?.editReason)return;
    this.timerDraft=timerDraft(entry,mode);this.timerDraftBaseline=JSON.stringify(this.timerDraft);this.timerModal=undefined;this.timerMessage=undefined;this.timerError=undefined;this.render();
  }
  private mutateTimers(changes:TimerChange[]):void {
    if(!this.context||this.timerBusy||this.countdownOperation?.pending||!this.timerData||this.timerData.writeReason||!changes.length)return;
    const context={...this.context},epoch=this.panelEpoch,request=++this.timerEpoch;
    const current=()=>request===this.timerEpoch&&epoch===this.panelEpoch&&sameContext(context,this.context);
    this.timerBusy=true;this.timerPendingChanges=changes;this.timerError=undefined;this.timerMessage=undefined;this.timerModal=undefined;this.render();
    void(async()=>{
      let completed=0;
      try{
        for(const change of changes){
          const result=await api.changeOutletTimer(context,change);if(!current())return;
          if(!result.verified)throw {kind:'timerWriteUncertain',message:result.message,retryable:true} satisfies AppError;
          if(!result.report||result.report.did!==context.did||result.report.model!==this.currentDevice()?.model)throw {kind:'timerWriteUncertain',message:'云端记录与当前设备不匹配，请先重新读取。',retryable:true} satisfies AppError;
          this.timerData=result.report;this.timerMessage=result.message;++completed;
        }
        this.timerDraft=undefined;this.timerSelection=undefined;
      }catch(error){
        if(!current())return;const failure=normalizeError(error);this.timerError=failure;this.handleSessionError(failure);
        if(!current())return;
        if(failure.kind==='timerWriteUncertain'||failure.kind==='timerConflict'){
          this.timerData=undefined;this.timerDraft=undefined;this.timerSelection=undefined;
        }
        if(completed)this.timerMessage=`已完成 ${completed} 项，其余未执行。`;
      }finally{if(current()){this.timerBusy=false;this.timerPendingChanges=[];this.render();}}
    })();
  }

  private async loadLinkedPanels(context: DeviceContext, epoch: number): Promise<void> {
    const readVersion=this.propertyOps.version;
    const device = this.currentDevice();
    if (!device) return;
    const layout = panelLayout(device, this.panel);
    if (layout !== 'switch' && layout !== 'light-group') return;
    const devices = this.snapshot?.devices ?? [];
    const children = layout === 'switch' ? splitChildren(devices, device) : layout === 'light-group' ? [...new Set(device.groupMembers ?? [])].flatMap(did => {
      const member = devices.find(item => item.did === did);
      return member ? [member] : [];
    }) : [];
    const targets = children.filter(item => item.did !== context.did);
    const results: { child: Device; panel?: DevicePanel; error?: AppError }[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (next < targets.length) {
        if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
        const index = next++; const child = targets[index];
        try { results[index] = { child, panel: await api.devicePanel({ ...context, did: child.did }) }; }
        catch (error) {
          const appError = normalizeError(error); results[index] = { child, error: appError };
          if (isSessionError(appError) && epoch === this.panelEpoch && sameContext(context, this.context)) { this.handleSessionError(appError); return; }
        }
      }
    }));
    if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
    for (const result of results) {
      if (result.error && isSessionError(result.error)) { this.handleSessionError(result.error); return; }
      if (result.panel?.did === result.child.did) { this.acceptPanel(result.panel,readVersion); this.linkedErrors.delete(result.child.did); }
      else { this.linkedPanels.delete(result.child.did); this.linkedErrors.set(result.child.did, result.error?.message ?? '返回的设备标识不匹配。'); }
    }
    if (!this.editing()) this.render();
  }

  private navigateRouter(view:RouterView):void {
    view=dailyRouterView(view);
    const previous=this.routerView.page,context=this.context?{...this.context}:undefined,scope=JSON.stringify([this.session?.region,this.session?.userId]);
    if(previous!==view.page||this.routerView.mac!==view.mac||this.routerView.tab!==view.tab){const scroll=this.root.querySelector<HTMLElement>('.device-page-scroll');if(scroll)scroll.scrollTop=0;}
    if(previous==='home'&&view.page!=='home')this.routerPassword.close();
    if(context&&view.page==='home'&&previous!=='home'){this.routerPassword.bind(context,scope);void this.routerPassword.load(context);}
    this.routerClassification.close();this.routerQos.close();this.routerAccess.close();this.routerFamily.close();this.routerUrl.close();this.routerRecords.close();this.routerAdvanced.close();this.routerInternet.close();this.routerNetwork.close();this.routerIndicator.close();this.routerCommon.close();
    if(previous==='client'&&(view.page!=='client'||this.routerView.mac!==view.mac))this.routerClientName.close();
    if(previous==='wifi'&&view.page!=='wifi')this.routerWifi.close();
    if(view.page!=='optimize')this.routerDaily.close();
    if(view.page!=='speed')this.routerScene.close();
    this.routerView=view;
    if(context&&view.page==='optimize'&&previous!==view.page){this.routerDaily.bind(context,scope);void this.routerDaily.read();}
    if(context&&view.page==='speed'&&previous!==view.page){this.routerScene.bind(context,scope);void this.routerScene.read();}
    if(context&&view.page==='client'){const client=this.router.report?.clients?.find(item=>item.mac===view.mac);if(client)this.routerClientName.bind(context,scope,client);}
    if(context&&view.page==='wifi'&&previous!=='wifi'){this.routerWifi.bind(context,scope);void this.routerWifi.read(context);}
    this.render(true);
  }

  private routerScene=new RouterSceneState({read:api.routerScene,history:api.routerSceneHistory,detail:api.routerSceneDetail,start:api.startRouterScene,stop:api.stopRouterScene},()=>this.render(true),e=>this.handleSessionError(e));
  private routerDaily=new RouterDailyState({read:c=>api.routerDaily(c),scan:c=>api.scanRouterDaily(c),optimize:(c,b)=>api.optimizeRouterDaily(c,b)},()=>this.render(true),e=>this.handleSessionError(e));
  private savedRouterCommon():string[]{return this.context?this.preferences.view?.routerCommonDevices?.[this.context.did]??[]:[];}
  private toggleRouterCommon(mac:string):void{
    const id=canonicalClientMac(mac),context=this.context;if(!id||!context||!this.preferences.view||this.preferences.pendingCount)return;
    const saved=this.savedRouterCommon(),on=saved.includes(id);if(!on&&saved.length>=COMMON_LIMIT){this.routerCommon.limit(id);return;}
    const macs=on?saved.filter(item=>item!==id):[...saved,id];this.routerCommon.message='';this.changePreferences({operation:'setRouterCommon',did:context.did,expected:[...saved],macs});
  }
  private saveRouterCommon():void{
    const context=this.context;if(!context||!this.preferences.view||this.preferences.pendingCount)return;
    const result=this.routerCommon.prepare(this.savedRouterCommon());if(!result)return;
    this.changePreferences({operation:'setRouterCommon',did:context.did,...result});this.navigateRouter({...this.routerView,page:'client'});
  }

  private irRemote=new IrRemoteState({read:api.irRemote,send:api.sendIrKey},()=>{if(!this.irRemote.loading)this.deviceOpening.ready();this.render(true);},e=>this.handleSessionError(e));
  private televisionSettings=false;
  private scalePage=new ScalePage();
  private scale=new ScaleState({history:api.scaleHistory,change:api.changeScale},()=>{if(!this.scale.loading)this.deviceOpening.ready();this.render(true);},e=>this.handleSessionError(e));
  private televisionPendingRole:TelevisionRole|undefined;
  private renderDrawer(): HTMLElement {
    const washer=this.currentDevice();
    if(this.doorbell.view!=='cloud'||!isCloudDoorbell(washer?.model??''))this.doorbellPlayer.dispose();
    if(this.purifierGuide&&(washer?.model!=='xiaomi.waterpuri.lx32'||this.purifierView.page!=='guide')){this.purifierGuide.dispose();this.purifierGuide=undefined;}
    const artwork=()=>washer?this.deviceArtwork(washer):element('span','device-artwork',icon('device'));
    if(washer&&isScale(washer.model)&&!this.deviceOpening.waiting)return this.scalePage.update({device:washer,state:this.scale,back:()=>this.closePanel(),profile:this.accountProfile});
    if(washer&&isIrRemote(washer.model)&&!this.deviceOpening.waiting)return irRemotePage({device:washer,state:this.irRemote,back:()=>this.closePanel(),artwork});
    if(washer&&this.panel&&this.context&&!this.deviceOpening.waiting&&televisionPageEligible(washer,this.panel)){
      const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      return this.withUiResourceMetadata(televisionPage({device:washer,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,settings:this.televisionSettings,pendingRole:this.televisionPendingRole,back:()=>this.closePanel(),showSettings:open=>{if(current()){this.televisionSettings=open;this.render(true);}},press:(role,command)=>{if(!current())return;this.televisionPendingRole=role;if(command.kind==='action')void this.runAction({action:command.action,service:command.service,inputs:[]});else void this.setProperty(command.property,command.value);},write:(p,v)=>{if(current())void this.setProperty(p,v);},error:e=>{if(current()){this.panelError=normalizeError(e);this.render(true);}}}));
    }
    if(washer?.model===vacuumModel&&!this.deviceOpening.waiting)return vacuumPage({device:washer,state:this.vacuum,back:()=>this.closePanel()});
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='cloud'&&this.doorbell.selectedEvent)return this.withUiResourceMetadata(this.doorbellPlayer.update({...this.context},washer,this.doorbell.date,this.doorbell.selectedEvent,this.doorbell.report?.events,id=>this.doorbell.thumbnail(id),id=>this.doorbell.play(id)));
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='events')return this.withUiResourceMetadata(doorbellPage({device:washer,state:this.doorbell,battery:doorbellBattery(this.panel),back:()=>this.closePanel(),live:()=>{this.doorbell.view='live';this.render(true);}}));
    if(washer&&this.context&&cameraPageEligible(washer)&&!this.deviceOpening.waiting){
      return this.withUiResourceMetadata(this.cameraPlayer.update({...this.context},washer,{panel:this.panel,loading:this.panelLoading&&!presentationReady(washer,this.panel),cached:this.panelIsCached,busy:this.controlBusy,error:this.panelNotice?.tone==='error'?this.panelNotice.title:this.panelError?.message}));
    }
    const dedicated=washer?dedicatedPage(washer.model):undefined;
    const pinnedLayout=this.presentationRoute.choose(washer,this.panel);
    if(this.presentationRoute.changed){
      const stage=element('div','device-stage'),page=element('section',`device-page page-${dedicated??pinnedLayout}`);
      page.dataset.presentationTemplate=dedicated??pinnedLayout;
      page.append(element('header','device-page-header',button('','page-icon-button',()=>this.closePanel(),'back'),element('div','device-page-title',element('h2','',washer?.name??'设备'))),element('div','device-page-scroll',notice({tone:'warning',title:'设备能力描述已更新',message:'请返回后重新打开设备，以加载新的控制绑定。'})));
      stage.append(page);return this.withUiResourceMetadata(stage);
    }
    const dataReady=presentationReady(washer,this.panel)||(washer?.model===routerModel&&!!this.router.report);
    if(dataReady)this.deviceDataPresented=true;
    if(this.deviceOpening.waiting||!this.deviceDataPresented){
      const stage=element('div','device-stage'),page=element('section',`device-page page-${dedicated??pinnedLayout} device-page-loading`),body=element('div','device-page-scroll');
      page.dataset.presentationVersion=String(PRESENTATION_VERSION);page.dataset.presentationTemplate=dedicated??pinnedLayout;
      page.append(element('header','device-page-header',button('','page-icon-button',()=>this.closePanel(),'back'),element('div','device-page-title',element('h2','',washer?.name??'设备'))),body);
      const pending=this.panelLoading||(washer?.model===routerModel&&this.router.loading)||(washer?.model==='midjd8.washer.42'&&this.washerLoading);
      if(!pending&&!this.deviceOpening.waiting)body.append(notice({tone:'warning',title:!washer?.online?'设备离线':this.panelError?.message??this.panel?.unsupportedReason??this.router.error?.message??'暂未取得设备状态',message:!washer?.online?'设备恢复在线后会自动更新。':'本次读取未返回可用状态，恢复后将自动显示。'}));
      else body.append(deviceLoading(washer?this.deviceArtwork(washer):element('span','device-artwork',icon('device')),washer?.name??'设备'));
      page.querySelector('button')?.setAttribute('aria-label','返回家庭');stage.append(page);return this.withUiResourceMetadata(stage);
    }
    if(washer?.model===bathHeaterModel&&this.panel)return this.withUiResourceMetadata(bathHeaterPage({device:washer,state:this.bathHeater,back:()=>this.closePanel()}));
    if(washer?.model===fryerModel&&this.panel)return this.withUiResourceMetadata(fryerPage({device:washer,state:this.fryer,view:this.fryerView,changed:()=>this.render(true),back:()=>this.closePanel()}));
    if(washer?.model===ceilingFanModel&&this.panel)return this.withUiResourceMetadata(ceilingFanPage({device:washer,state:this.ceilingFan,back:()=>this.closePanel()}));
    if(washer?.model===routerModel&&this.panel){return this.withUiResourceMetadata(routerPage({device:washer,scene:this.routerScene,daily:this.routerDaily,family:this.routerFamily,url:this.routerUrl,records:this.routerRecords,access:this.routerAccess,qos:this.routerQos,classification:this.routerClassification,common:this.routerCommon,savedCommon:this.preferences.view?this.savedRouterCommon():undefined,commonPending:this.preferences.pendingCount>0,commonError:this.preferencesError?.message??this.preferences.error?.message??this.routerCommon.message,toggleCommon:mac=>this.toggleRouterCommon(mac),manageCommon:()=>{this.routerCommon.manage(this.savedRouterCommon());this.navigateRouter({...this.routerView,page:'common'});},saveCommon:()=>this.saveRouterCommon(),clientName:this.routerClientName,password:this.routerPassword,network:this.routerNetwork,saveNetwork:confirmed=>{if(this.context)void this.routerNetwork.save({...this.context},confirmed).then(done=>{if(done&&['ports','ipv6'].includes(this.routerView.page))this.navigateRouter({...this.routerView,page:'internet'});});},ackNetwork:()=>{if(this.context)void this.routerNetwork.acknowledge({...this.context}).then(done=>{if(done&&['ports','ipv6'].includes(this.routerView.page))this.navigateRouter({...this.routerView,page:'internet'});});},internet:this.routerInternet,saveInternet:confirmed=>{if(this.context)void this.routerInternet.save({...this.context},confirmed);},state:this.router,indicator:this.routerIndicator,wifi:this.routerWifi,advanced:this.routerAdvanced,view:this.routerView,busy:this.controlBusy,artwork,back:()=>this.closePanel(),navigate:view=>this.navigateRouter(view),saveIndicator:confirmedOff=>{if(this.context)void this.routerIndicator.save({...this.context},confirmedOff);},saveWifi:confirmed=>{if(this.context)void this.routerWifi.save({...this.context},confirmed);},requestAdvanced:field=>{if(this.context)void this.routerAdvanced.request({...this.context},field,this.routerWifi);},confirmAdvanced:()=>{if(this.context)void this.routerAdvanced.confirm({...this.context});},saveAdvanced:()=>{if(this.context&&this.routerAdvanced.prepareSave({...this.context},this.routerWifi))this.navigateRouter({...this.routerView,page:'home'});},respondDfs:proceed=>{if(this.context)void this.routerAdvanced.respondDfs({...this.context},proceed);}}));}
    if(washer?.model===dispenserModel&&this.panel&&dispenserProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);this.dispenserCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserDnd.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserHistory.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSterilization.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSelfCheck.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-history'||this.dispenserView.page==='selfcheck-report'){return this.withUiResourceMetadata(dispenserSelfCheckPage({device:washer,panel:this.panel,commands:this.dispenserSelfCheck,view:this.dispenserView.page,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy||this.dispenserCommands.pending||this.dispenserDnd.pending||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserSelfCheck.confirming=false;if(this.dispenserView.page==='selfcheck')this.dispenserSelfCheck.checked=false;this.dispenserView={page:this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-report'&&this.dispenserSelfCheck.selected?.time===0?'settings':this.dispenserView.page==='selfcheck-history'?'selfcheck':'selfcheck-history'};this.dispenserSelfCheck.selected=undefined;this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},history:()=>{if(current()){this.dispenserView={page:'selfcheck-history'};this.render(true);void this.dispenserSelfCheck.loadHistory(context);}},report:()=>{if(current()){this.dispenserView={page:'selfcheck-report'};this.render(true);}},run:(operation,expected)=>{if(current())void this.dispenserSelfCheck.run(context,operation,expected).finally(()=>{if(current())this.schedulePanelRefresh();});}}));}
      this.dispenserReminders.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='reminders')return this.withUiResourceMetadata(dispenserRemindersPage({state:this.dispenserReminders,view:this.dispenserReminderView,busy:this.controlBusy||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserReminderView={page:'settings'};this.dispenserView={page:'settings'};this.render(true);}},changed:()=>{if(current())this.render(true);},navigate:view=>{if(current()){this.dispenserReminderView=view;this.render(true);}},save:(update,revision)=>current()?this.dispenserReminders.save(context,update,revision):Promise.resolve(false),read:()=>{if(current())void this.dispenserReminders.read(context).then(()=>{if(current()&&!this.dispenserReminders.error&&this.dispenserReminderView.page==='edit'){this.dispenserReminderView={page:'list'};this.render(true);}});}}));
      if(this.dispenserView.page==='sterilization'){
        const run=(operation:'start'|'stop')=>{if(!current()||!this.panel)return;const status=sterilizationState(this.panel).status;if(status===null)return;void this.dispenserSterilization.run(context,{operation,expectedStatus:status}).finally(()=>{if(current())this.schedulePanelRefresh();});};
        return this.withUiResourceMetadata(dispenserSterilizationPage({device:washer,panel:this.panel,commands:this.dispenserSterilization,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy||this.dispenserCommands.pending||this.dispenserDnd.pending,artwork,back:()=>{if(current()){this.dispenserSterilization.confirming=false;this.dispenserView={page:'settings'};this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},start:()=>run('start'),stop:()=>run('stop'),refresh:()=>{if(current())void this.dispenserSterilization.refresh(context).finally(()=>{if(current())this.schedulePanelRefresh();});},error:this.panelError?.message}));
      }
      if(this.dispenserView.page==='statistics'||this.dispenserView.page==='records'){
        const records=this.dispenserView.page==='records',select=(selection:import('./dispenser-history').DrinkSelection)=>{if(current()){this.dispenserHistoryPicker=undefined;void this.dispenserHistory.loadStatistics(context,selection);}};
        return this.withUiResourceMetadata(dispenserHistoryPage({view:records?'records':'statistics',state:this.dispenserHistory,artwork,back:()=>{if(current()){this.dispenserView={page:records?'statistics':'home'};this.dispenserHistoryPicker=undefined;this.render(true);}},records:()=>{if(current()){this.dispenserView={page:'records'};this.render(true);void this.dispenserHistory.loadRecords(context);}},more:()=>{if(current())this.dispenserHistory.more(context);},select,retry:()=>{if(current()){if(records)void this.dispenserHistory.loadRecords(context,null,true);else void this.dispenserHistory.loadStatistics(context,this.dispenserHistory.selection,true);}},changed:()=>{if(current())this.render(true);},picker:this.dispenserHistoryPicker,showPicker:picker=>{if(current()){this.dispenserHistoryPicker=picker;this.render(true);}}}));
      }
      if(this.dispenserView.page==='dnd')return this.withUiResourceMetadata(dispenserDndPage({state:this.dispenserDnd,artwork,busy:this.controlBusy,online:washer.online,back:()=>{if(current()){this.dispenserView={page:'settings'};this.render(true);}},changed:()=>{if(current())this.render(true);},save:change=>{if(current())void this.dispenserDnd.save(context,change).then(()=>{if(current())void this.readProperties();});},read:()=>{if(current())void this.dispenserDnd.read(context);}}));
      if(this.dispenserView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.siid===2?s.actions.filter(a=>![2,3,4].includes(a.aiid)):s.siid===7?s.actions.filter(a=>![1,2].includes(a.aiid)):s.actions,properties:s.properties.map(p=>[[2,7],[2,6],[3,1],[4,1],[5,1],[2,9],[2,10],[2,11],[2,12]].some(([siid,piid])=>p.siid===siid&&p.piid===piid)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',()=>{this.dispenserView={page:'settings'};this.render(true);},'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(dispenserPage({device:washer,panel:this.panel,view:this.dispenserView,dndEnabled:this.dispenserDnd.report?.enabled,commands:this.dispenserCommands,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy||this.dispenserDnd.pending||this.dispenserSterilization.pending||this.dispenserReminders.pending,artwork,back:()=>this.closePanel(),navigate:view=>{if(current()){this.dispenserView=view;this.render(true);if(view.page==='settings'||view.page==='dnd')void this.dispenserDnd.read(context);if(view.page==='statistics')void this.dispenserHistory.loadStatistics(context,this.dispenserHistory.selection);if(view.page==='sterilization'||view.page==='selfcheck')void this.readProperties();if(view.page==='reminders'){this.dispenserReminderView={page:'settings'};void this.dispenserReminders.read(context);}}},changed:()=>{if(current())this.render(true);},change:change=>current()?this.dispenserCommands.change(context,change):Promise.resolve(false),refresh:()=>{if(current())void this.dispenserCommands.refresh(context);},compatibility:()=>{if(current()){this.dispenserView={page:'compatibility'};this.render(true);}},error:this.panelError?.message}));
    }
    if(washer?.model===fridgeModel&&this.panel&&fridgeProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context),home=()=>{if(current()){this.fridgeView={page:'home'};this.render(true);}};this.fridgeCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.fridgeView.page==='compatibility'){
        const controlled=(['mode','refrigerating','freezing','maternal']as const).map(f=>fridgeProperty(this.panel!,f)).filter(Boolean),panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.name==='fridge-reset'?[]:s.actions,properties:s.properties.map(p=>controlled.some(q=>q!.siid===p.siid&&q!.piid===p.piid)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))},document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});
        const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',home,'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(fridgePage({device:washer,panel:this.panel,view:this.fridgeView,commands:this.fridgeCommands,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy,artwork,back:()=>this.closePanel(),home,settings:()=>{if(current()){this.fridgeView={page:'settings'};this.render(true);}},compatibility:()=>{if(current()){this.fridgeView={page:'compatibility'};this.render(true);}},changed:()=>{if(current())this.render(true);},write:(field,value)=>{const expected=fridgeCurrent(this.panel!,field);if(current()&&expected!==undefined)void this.fridgeCommands.change(context,{field,expected,value});},reset:expected=>{if(current())void this.fridgeCommands.reset(context,expected);},refresh:()=>{if(current())void this.fridgeCommands.refresh(context);},error:this.panelError?.message}));
    }
    if(washer?.model===airerModel&&this.panel&&airerProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context),home=()=>{if(current()){this.airerView={page:'home'};this.render(true);}};this.airerCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.airerView.page==='compatibility'){const panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.siid===4?s.actions.filter(a=>a.aiid>5):s.actions,properties:s.properties.map(p=>(p.siid===2&&[2,6].includes(p.piid)||p.siid===4&&([1,2,3,4,5,6,9].includes(p.piid)))?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',home,'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',element('p','purifier-settings-help','限位校准与定位专页仍在适配。'),this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);}
      return this.withUiResourceMetadata(airerPage({device:washer,panel:this.panel,view:this.airerView,commands:this.airerCommands,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy,artwork,back:()=>this.closePanel(),home,changed:()=>{if(current())this.render(true);},lift:intent=>{const status=airerStatus(this.panel!);if(current()&&status!==undefined)void this.airerCommands.lift(context,{intent,expectedStatus:status});},write:(p,v)=>{if(current())void this.setProperty(p,v);},night:()=>{const night=airerNight(this.panel!);if(current()&&night){this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}},save:()=>{const draft=this.airerView.draft;if(current()&&draft)void this.airerCommands.night(context,draft).then(saved=>{if(saved&&current())home();});},compatibility:()=>{if(current()){this.airerView={page:'compatibility'};this.render(true);}},refresh:()=>{if(current())void this.airerCommands.refresh(context).then(read=>{if(read&&current()&&this.airerView.page==='night'){const night=airerNight(this.panel!);if(night)this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}});},error:this.panelError?.message}));
    }
    if(washer?.model==='xiaomi.waterpuri.lx32'&&this.panel?.purifier&&!this.panel.unsupportedReason){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      if(this.purifierView.page==='guide'){this.purifierGuide??=purifierGuidePage(()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},artwork);return this.withUiResourceMetadata(this.purifierGuide.node);}
      this.purifierCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.purifierDnd.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.purifierOptions.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.purifierView.page==='functions'&&!this.purifierOptions.loading&&!this.purifierOptions.error&&!this.purifierOptions.pending&&!this.purifierOptions.blocked&&(!this.purifierOptions.report||this.purifierOptions.report.filterFlushingSupported===true&&typeof purifierSetting(this.panel,'flushing')?.value==='boolean'&&this.purifierOptions.report.flushing!==purifierSetting(this.panel,'flushing')?.value))queueMicrotask(()=>{if(current())void this.purifierOptions.read(context);});
      if(['functions','dnd'].includes(this.purifierView.page)&&!this.purifierDnd.report&&!this.purifierDnd.loading&&!this.purifierDnd.error&&!this.purifierDnd.pending)queueMicrotask(()=>{if(current())void this.purifierDnd.read(context);});
      if(this.purifierView.page==='dnd')return this.withUiResourceMetadata(purifierDndPage({state:this.purifierDnd,artwork,busy:this.controlBusy||this.panelIsCached,online:washer.online,changed:()=>{if(current())this.render(true);},back:()=>{if(current()){this.purifierDnd.picker=undefined;this.purifierView={page:'functions',filter:0};this.render(true);}},save:change=>{if(current())void this.purifierDnd.save(context,change);},read:()=>{if(current())void this.purifierDnd.read(context);}}));
      this.purifierHistory.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      const home=()=>{if(current()){this.purifierHistoryPicker=undefined;this.purifierView=newPurifierView();this.render(true);}};
      const water=this.purifierHistory,week:WaterSelection={period:'week',date:dateKey(new Date())};
      const statistics=(selection:WaterSelection)=>{if(current()){this.purifierHistoryPicker=undefined;this.purifierView={page:'statistics',filter:0};void water.loadStatistics(context,selection).then(()=>{if(current()&&this.purifierView.page==='statistics'&&water.selection.period===selection.period&&water.selection.date===selection.date&&water.selectedTime!==undefined)water.chooseBucket(context,water.selectedTime);});this.render(true);}};
      if(this.purifierView.page==='tds'||this.purifierView.page==='statistics')return this.withUiResourceMetadata(purifierHistoryPage({mode:this.purifierView.page,state:water,artwork,back:home,
        record:id=>{if(current())water.chooseRecord(id);},more:()=>{if(current())water.showMore(context);},select:statistics,bucket:time=>{if(current())water.chooseBucket(context,time);},
        retry:()=>{if(current()){if(this.purifierView.page==='tds')void water.loadRecords(context,{scope:'latest',before:null},true);else if(water.recordError&&!water.statisticsError)void water.loadRecords(context,{...water.query,before:null},true);else {const selection={...water.selection};void water.loadStatistics(context,selection,true).then(()=>{if(current()&&this.purifierView.page==='statistics'&&water.selection.period===selection.period&&water.selection.date===selection.date&&water.selectedTime!==undefined)water.chooseBucket(context,water.selectedTime);});}}},
        picker:this.purifierHistoryPicker,showPicker:picker=>{if(current()){this.purifierHistoryPicker=picker;this.render(true);}}}));
      if(this.purifierView.page==='home'&&(!water.statistics||water.selection.period!=='week'||water.selection.date!==week.date)&&!water.statisticsLoading&&!water.statisticsError)queueMicrotask(()=>{if(current()&&this.purifierView.page==='home')void water.loadStatistics(context,week);});
      if(['functions','pipeline','water-mode'].includes(this.purifierView.page))return this.withUiResourceMetadata(purifierSettingsPage({device:washer,panel:this.panel,view:this.purifierView,cached:this.panelIsCached||this.panelLoading,busy:this.controlBusy||this.purifierDnd.pending||this.purifierOptions.pending,error:this.panelNotice?.title??this.panelError?.message,dnd:{enabled:this.purifierDnd.report?.enabled??null,visible:!this.currentHome()?.shared&&this.currentHome()?.ownerId===this.session?.userId},options:this.purifierOptions,push:enabled=>{if(current())void this.purifierOptions.save(context,enabled);},
        back:()=>{if(current()){if(this.purifierView.page==='functions')home();else{this.purifierView={page:'functions',filter:0};this.render(true);}}},
        open:page=>{if(current()){this.purifierView={page,filter:0};this.render(true);}},changed:()=>{if(current())this.render(true);},write:(p,value)=>{if(current())void this.setProperty(p,value);},refresh:()=>{if(current()){void this.readProperties(true);void this.purifierOptions.read(context);}}}));
      if(this.purifierView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.map(s=>({...s,properties:s.properties.map(p=>p.siid===7&&p.piid===1||p.siid===6&&p.piid===1||isPurifierSetting(p)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};
        const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});
        const stage=element('div','device-stage'),page=element('section','device-page page-generic');
        const back=button('','page-icon-button',()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},'back');back.setAttribute('aria-label','返回设备设置');
        page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','','设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(purifierPage({device:washer,panel:this.panel,view:this.purifierView,commands:this.purifierCommands,cached:this.panelIsCached||this.panelLoading,artwork,error:this.panelError?.message,
        back:()=>this.closePanel(),home,weekTotal:water.selection.period==='week'&&water.selection.date===week.date?water.statistics?.weekTotalMl:undefined,
        tds:()=>{if(current()){this.purifierView={page:'tds',filter:0};void water.loadRecords(context,{scope:'latest',before:null});this.render(true);}},statistics:()=>statistics(week),
        functions:()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},changed:()=>{if(current())this.render(true);},
        edit:(index,sort=false)=>{if(!current()||this.purifierCommands.blocked||this.panelIsCached)return;const draft=cupDraft(this.panel!.purifier!,index,sort);if(draft){this.purifierView={page:sort?'sort':'cup',filter:0,draft};this.render(true);}},
        filter:index=>{if(current()){this.purifierView={page:'filter',filter:index};this.render(true);}},
        save:()=>{const draft=this.purifierView.draft;if(current()&&draft)void this.purifierCommands.save(context,draft).then(saved=>{if(current()&&saved)home();});},
        refresh:()=>{if(current()){void water.loadStatistics(context,week,true);void this.purifierCommands.refresh(context).then(read=>{if(current()&&read)home();});}}}));
    }
    if((washer?.model==='midjd8.washer.42'||this.washerProgramsOpen)&&washer&&this.panel&&!this.panel.unsupportedReason){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const programs=washerPrograms(this.washerConfig,this.panel);
      this.washerRuntimeCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.washerView==='home'&&this.panel.washerRuntime?.active)this.washerView='runtime';
      if(this.washerView==='runtime'&&this.panel.washerRuntime?.stage==='blowing and shaking'&&!this.panel.washerRuntime.cleaning)this.washerView='home';
      if(this.washerView==='runtime'){
        const runtime=this.panel.washerRuntime;
        if(runtime?.active){clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;}
        else if(runtime&&['off','idle'].includes(runtime.state)&&!this.washerRuntimeCommands.pending&&!this.washerRuntimeExitTimer){this.washerRuntimeExitTimer=setTimeout(()=>{this.washerRuntimeExitTimer=undefined;if(current()&&this.washerView==='runtime'){this.washerView='home';this.washerRuntimeConfirmation=undefined;this.render(true);}},1000);}
        return this.withUiResourceMetadata(washerRuntimePage({device:washer,panel:this.panel,programs,commands:this.washerRuntimeCommands,cached:this.panelIsCached||this.controlBusy||this.washerCommands.pending,confirmation:this.washerRuntimeConfirmation,
          back:()=>this.closePanel(),refresh:()=>{if(current())void this.washerRuntimeCommands.refresh(context);},
          choose:control=>{if(!current()||this.panelIsCached||this.washerRuntimeCommands.blocked||!control.enabled)return;if(control.confirmation){this.washerRuntimeConfirmation=control;this.render(true);}else void this.washerRuntimeCommands.execute(context,control);},
          cancel:()=>{if(current()&&!this.washerRuntimeCommands.pending){this.washerRuntimeConfirmation=undefined;this.render(true);}},
          submit:()=>{const control=this.washerRuntimeConfirmation;if(current()&&control){this.washerRuntimeConfirmation=undefined;void this.washerRuntimeCommands.execute(context,control);}}}));
      }
      if(this.washerView==='records')return this.withUiResourceMetadata(washerRecordsPage({state:this.washerRecords,programs,config:this.washerConfig,panel:this.panel,artwork,
        back:()=>{if(!current())return;if(this.washerRecords.selected)this.washerRecords.closeDetail();else{this.washerView='home';this.render(true);}},
        select:selection=>{if(current())void this.washerRecords.load(context,selection);},more:()=>{if(current())void this.washerRecords.load(context,this.washerRecords.selection,true);},retry:()=>{if(current())void this.washerRecords.retry(context);},bucket:index=>{if(current())void this.washerRecords.selectBucket(context,index);},
        open:row=>{if(current())void this.washerRecords.openDetail(context,row);},retryDetail:()=>{if(current()&&this.washerRecords.selected)void this.washerRecords.openDetail(context,this.washerRecords.selected);},changed:()=>{if(current())this.render(true);}}));
      return this.withUiResourceMetadata(washerPage({device:washer,panel:this.panel,report:this.washerConfig,programs,draft:this.washerDraft,view:this.washerView,loading:this.washerLoading,error:this.washerError,commands:this.washerCommands,orderAt:this.washerOrderAt,artwork,
        back:()=>{if(washer.model!=='midjd8.washer.42'){this.washerProgramsOpen=false;this.washerView='home';this.render(true);}else this.closePanel();},home:()=>{if(current()){this.washerView='home';this.washerDraft=undefined;this.washerCommands.reset();this.washerOrderAt=undefined;this.render(true);}},more:()=>{if(current()){this.washerView='more';this.render(true);}},records:washer.model==='midjd8.washer.42'?()=>{if(current()){this.washerView='records';void this.washerRecords.load(context);}}:undefined,
        select:program=>{if(current()&&this.washerConfig){this.washerCommands.reset();this.washerDraft=newWasherDraft(this.washerConfig,program);this.washerView='program';this.washerCommands.edit(context,this.washerDraft);this.render(true);}},
        change:draft=>{if(!current()||!this.washerConfig||!this.washerDraft||!this.panel||this.washerCommands.locked)return;const program=programs.find(p=>p.name===draft.program);if(!program)return;
          const changed=Object.keys(draft.values).find(key=>draft.values[key]!==this.washerDraft!.values[key]);
          this.washerDraft=changed?changeWasherDraft(this.washerConfig,program,this.panel,this.washerDraft,changed,draft.values[changed]):{...this.washerDraft,selector:draft.selector};if(changed)this.washerCommands.edit(context,this.washerDraft);this.render(true);
        },refresh:()=>{if(!current())return;if(this.washerDraft)void this.washerCommands.refresh(context,this.washerDraft);else void this.loadWasherConfig(context,epoch);},
        order:()=>{if(!current()||!this.washerDraft||!this.washerCommands.canStart)return;const at=Math.ceil((Date.now()+((this.washerCommands.preview?.estimatedMinutes??0)+6)*60000)/60000)*60000;this.washerOrderAt=at;this.washerCommands.reservationAt=at;this.washerCommands.edit(context,this.washerDraft);},
        changeOrder:at=>{if(current()&&this.washerDraft&&!this.washerCommands.locked){this.washerOrderAt=at;this.washerCommands.reservationAt=at;this.washerCommands.edit(context,this.washerDraft);}},cancelOrder:()=>{if(current())this.closeWasherOrder();},
        start:()=>{if(current()&&this.washerDraft)void this.washerCommands.start(context,this.washerDraft);},confirm:()=>{if(current()&&this.washerDraft)void this.washerCommands.confirm(context,this.washerDraft);}}));
    }
    if(this.lightFavoriteDraft&&this.lightFavorites&&this.currentDevice()){
      const context={...this.context!},epoch=this.panelEpoch,draftEpoch=this.lightFavoriteEpoch,current=()=>epoch===this.panelEpoch&&draftEpoch===this.lightFavoriteEpoch&&sameContext(context,this.context);
      return this.withUiResourceMetadata(renderLightFavorite({draft:this.lightFavoriteDraft,report:this.lightFavorites,operation:this.lightFavoriteOperation,error:this.lightFavoritesError??this.panelNotice?.title,
        device:this.currentDevice()!,properties:this.panel?.services.flatMap(s=>s.properties)??[],cached:this.panelIsCached,
        back:()=>{if(current())this.closeLightFavorite();},save:()=>{if(current())this.mutateLightFavorite();},remove:()=>{if(current())this.mutateLightFavorite(true);},refresh:()=>{if(current())void this.loadLightFavorites();},
        change:draft=>{if(current()&&this.lightFavoriteDraft)this.lightFavoriteDraft=draft;},write:(p,value)=>{if(current())void this.setBoundProperty(p,value,context.did);},failure:e=>{if(current()){this.lightFavoritesError=normalizeError(e).message;this.render(true);}},interactionEnded:()=>{if(current())this.render(true);}}));
    }
    if(this.lightSettingsOpen){
      const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch,draftEpoch=this.lightSettingsDraftEpoch;
      const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      return this.withUiResourceMetadata(renderLightSettings({kind:this.lightSettingsOpen,report:this.lightSettingsReport,loading:this.lightSettingsLoading,error:this.lightSettingsError,draft:this.lightSettingsDraft,operation:this.lightSettingsOperation,online:!!this.currentDevice()?.online,artwork,
        back:()=>{if(current())this.closeLightSettings();},refresh:()=>{if(current())void this.loadLightSettings();},edit:index=>{if(current())this.editLightSetting(index);},
        change:draft=>{if(current()&&draftEpoch===this.lightSettingsDraftEpoch&&this.lightSettingsDraft)this.lightSettingsDraft=draft;},
        cancel:()=>{if(current()&&draftEpoch===this.lightSettingsDraftEpoch)this.closeLightSettingsDraft();},save:()=>{if(current()&&draftEpoch===this.lightSettingsDraftEpoch)this.saveLightSetting();}}));
    }
    if(this.timersOpen)return this.withUiResourceMetadata(renderTimerPage({data:this.timerData,loading:this.timerLoading,error:this.timerError,busy:this.timerBusy&&!this.countdownOperation?.pending,writePending:this.timerBusy||!!this.countdownOperation?.pending,pendingChanges:this.timerPendingChanges,message:this.timerMessage,draft:this.timerDraft,modal:this.timerModal,selection:this.timerSelection,artwork,
      back:()=>this.backTimers(),retry:()=>this.loadTimers(true),edit:(entry,mode)=>this.editTimer(entry,mode),update:draft=>{this.timerDraft=draft;this.render();},show:modal=>{this.timerModal=modal;this.render();},
      select:keys=>{this.timerSelection=keys;this.render();},discard:()=>{this.timerDraft=undefined;this.timerModal=undefined;this.render();},
      toggle:entry=>this.mutateTimers([{operation:'setEnabled',key:entry.key,enabled:!entry.enabled}]),
      save:()=>{if(this.timerDraft&&!timerDraftProblem(this.timerDraft))this.mutateTimers([{operation:'save',draft:this.timerDraft}]);},
      remove:()=>this.mutateTimers((this.timerSelection??[]).map(key=>({operation:'delete',key}))) }));
    if(this.energyOpen)return this.withUiResourceMetadata(renderEnergyPage({selection:this.energySelection,data:this.energyData,loading:this.energyLoading,error:this.energyError,panel:this.panel,picker:this.energyPicker,artwork,showPicker:picker=>{this.energyPicker=picker;this.render();},select:selection=>this.loadEnergy(selection),back:()=>this.closeEnergy()}));
    if (this.historyDetailOpen) return this.withUiResourceMetadata(renderHistoryDetail({ selection: this.detailSelection, data: this.detailData, loading: this.detailLoading, error: this.detailError, picker: this.detailPicker,artwork,
      select: selection => this.selectHistoryDetail(selection), showPicker: date => { this.detailPicker = date; this.render(); }, back: () => this.closeHistoryDetail(), retry: () => this.selectHistoryDetail({ ...this.detailSelection }) }));
    const device = this.currentDevice();
    const layout = this.presentationRoute.choose(device, this.panel);
    const document = this.panel && device ? compilePanelDocument({ device, panel: this.panel, resources: this.uiResources, includeModelFallback: layout === 'generic' }) : undefined;
    const stage = element('div', 'device-stage');
    const page = element('section', `device-page page-${layout}`);
    page.dataset.presentationVersion=String(PRESENTATION_VERSION);page.dataset.presentationTemplate=layout;
    if(layout==='light'&&device?.model==='yeelink.light.wyra01')page.classList.add('page-yeelight-strip');
    const initialLoading=this.panelLoading&&!this.panel;
    page.classList.toggle('device-page-loading',initialLoading);
    page.dataset.pendingOperations=String(this.propertyOps.pendingCount+(this.countdownOperation?.pending?1:0));
    page.dataset.uncertainOperations=String(this.propertyOps.uncertainCount+(this.countdownOperation?.phase==='uncertain'?1:0));
    page.setAttribute('aria-busy',String(!!(this.panelLoading||this.controlBusy||this.propertyOps.pendingCount>0||this.countdownOperation?.pending)));
    page.setAttribute('aria-label', `${device?.name ?? '设备'}控制`);
    this.deviceEvents.bind(this.context,JSON.stringify([this.session?.region,this.session?.userId]));
    const back = button('', 'page-icon-button', () => {if(this.deviceEvents.open){this.deviceEvents.close();this.render(true);}else this.closePanel();}, 'back'); back.setAttribute('aria-label',this.deviceEvents.open?'返回设备':'返回家庭');
    if(this.panelIsCached&&this.panel)page.setAttribute('aria-description',`上次状态${this.panelCachedAt?` · ${new Date(this.panelCachedAt*1000).toLocaleString()}`:''}${this.panelLoading?' · 更新中':''}`);
    const title = layout === 'outlet' ? '' : device?.name ?? '设备';
    page.append(element('header', 'device-page-header', back, element('div', 'device-page-title', element('h2', '', title), layout === 'light-group' ? element('p', '', device?.online ? '已连接' : '设备离线') : null)));
    const body = element('div', 'device-page-scroll');
    if (!device?.online) body.append(notice({ tone: 'warning', title: '设备离线', message: '设备恢复在线后可读取和控制。' }));
    if (this.panelError) body.append(notice({ tone: 'error', title: this.panelError.message }));
    if(this.panelNotice)page.setAttribute('aria-description',[page.getAttribute('aria-description'),this.panelNotice.title,this.panelNotice.message].filter(Boolean).join(' · '));
    if (initialLoading) body.append(deviceLoading(device?this.deviceArtwork(device):element('span','device-artwork',icon('device')),device?.name??'设备'));
    else if(this.deviceEvents.open)body.append(renderDeviceEvents(this.deviceEvents));
    else if (this.panel && device) {
      if (this.panel.unsupportedReason) body.append(notice({ tone: 'warning', title: '此设备功能受限', message: this.panel.unsupportedReason }));
      const adapter = this.deviceVisualAdapters[layout];
      if (adapter && document) {
        const content = adapter(device);
        if(content.dataset.lightTint)page.style.setProperty('--light-tint',content.dataset.lightTint);
        if(content.dataset.headerStatus){const title=page.querySelector('.device-page-title');title?.querySelector('p')?.remove();title?.append(element('p','device-header-status',content.dataset.headerStatus));}
        this.applyOfficialCustomItems(content, document, device);
        const omitted=new Set([...content.querySelectorAll<HTMLElement>('[data-siid][data-piid]')].map(n=>`${n.dataset.siid}.${n.dataset.piid}`));
        for(const node of content.querySelectorAll<HTMLElement>('[data-bound-properties]'))for(const key of node.dataset.boundProperties!.split(' '))if(key)omitted.add(key);
        for(const b of resolveDeviceCapabilities(this.panel).properties)if(b.kind==='reading')omitted.add(`${b.siid}.${b.piid}`);
        const extraContext=this.context?{...this.context}:undefined,extraEpoch=this.panelEpoch;
        const extraCurrent=()=>extraEpoch===this.panelEpoch&&sameContext(extraContext,this.context);
        const extras=renderCategoryPage({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,omit:omitted,write:(p,v)=>{if(extraCurrent())void this.setBoundProperty(p,v,device.did);},error:e=>{if(extraCurrent()){this.panelError=normalizeError(e);this.render(true);}}});
        if(extras.querySelector('.device-control-unit'))content.append(extras);
        body.append(content);
        page.dataset.visualAdapter = layout;
      } else if (hasCapabilityCategory(capabilityCategory(this.panel.specType))||resolveDeviceCapabilities(this.panel).privateFeatures.length>0) {
        const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch;
        const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
        const renderPage=capabilityCategory(this.panel.specType)==='speaker'?speakerPage:renderCategoryPage;
        body.append(renderPage({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,
          state:this.speaker,player:this.speaker.report,playerError:this.speaker.error?.message,
          retry:speakerMetadataSupported(device.model)&&device.online?()=>void this.speaker.read():undefined,
          artwork:()=>this.deviceArtwork(device),
          write:(property,value)=>{if(current())void this.setBoundProperty(property,value,device.did);},
          error:error=>{if(current()){this.panelNotice={tone:'error',title:normalizeError(error).message};this.render();}},
          action:(action,service,inputs=[])=>{if(current()){this.actionConfirm={action:{...action,description:(resolveDeviceCapabilities(this.panel!).actions.find(a=>a.siid===action.siid&&a.aiid===action.aiid)?.label??action.description)},service,inputs};this.render();}},
          interactionEnded:()=>{if(current())this.render(true);}}));
        page.dataset.visualAdapter='standard-capability';
        page.dataset.capabilityCategory=resolveDeviceCapabilities(this.panel).category??'unknown';
      } else if (document) body.append(this.renderGenericFunctions(device, true, document));
      if(device.model!=='midjd8.washer.42'&&capabilityCategory(this.panel.specType)==='washer'&&washerPrograms(this.washerConfig,this.panel).length)body.append(button('洗涤程序','native-card category-action',()=>{this.washerProgramsOpen=true;this.washerView='home';this.render(true);},'menu'));
      if(resolveDeviceCapabilities(this.panel).events.length)body.append(button('设备记录','native-card category-action',()=>void this.deviceEvents.load(),'clock'));
      page.dataset.layoutCompared=String(hasObservedDeviceLayout(device.model));
    }
    if(layout!=='curtain'){
      if(this.controlBusy&&this.controlIntent)body.append(operationFeedback(this.controlIntent));
      if(device){const uncertain=this.propertyOps.entries().filter(([key,c])=>JSON.parse(key)[0]===device.did&&c.pending&&c.phase==='uncertain');if(uncertain.length)body.append(operationFeedback('待确认，后台正在核验',()=>{for(const[key]of uncertain)this.propertyOps.adopt(key);}));}
    }
    page.append(body);
    if(this.countdownDraft)page.append(durationDialog({draft:this.countdownDraft,close:()=>this.closeCountdown(),update:draft=>{this.countdownDraft=draft;this.render(true);},save:()=>{if(this.countdownDraft)this.mutateCountdown(()=>countdownUpdate(this.timerData,this.countdownDraft!));}}));
    stage.append(page); return this.withUiResourceMetadata(stage, document);
  }

  private withUiResourceMetadata(stage: HTMLElement, document?: PanelDocument): HTMLElement {
    const page = stage.querySelector<HTMLElement>('.device-page');
    if (!page) return stage;
    page.dataset.panelRefreshing = String(this.panelLoading);
    page.dataset.deviceCategory=capabilityCategory(this.panel?.specType)??'';
    page.dataset.stateSource = this.panelIsCached ? (this.panelHasCachedState ? 'previous' : 'definition') : this.panel ? 'current' : 'definition';
    const readable = this.panel?.services.flatMap(service => service.properties).filter(property => property.access.includes('read')) ?? [];
    page.dataset.readableProperties = String(readable.length);
    page.dataset.successfulProperties = String(readable.filter(property => property.code === 0 && property.value !== undefined && property.value !== null).length);
    page.dataset.uiResourcesRoute = this.uiResources?.route.kind ?? 'unknown';
    page.dataset.uiResourcesSource = page.dataset.visualAdapter ? (document?.source === 'official-standard' ? 'local-adapter+official-standard' : 'local-adapter') : document?.source ?? 'local-adapter';
    page.dataset.uiResourcesCache = this.uiResources?.cacheState ?? 'missing';
    const diagnostics = [...new Set([...(this.uiResources?.diagnostics ?? []), ...(document?.diagnostics ?? []), this.uiResourcesError].filter((value): value is string => !!value))];
    page.dataset.uiDiagnostics = String(diagnostics.length);
    if (diagnostics.length) page.setAttribute('aria-description', [page.getAttribute('aria-description'), ...diagnostics].filter(Boolean).join(' · '));
    return deviceSurfaces(stage);
  }

  private renderUiDocument(document: PanelDocument, device: Device): HTMLElement {
    return renderPanelDocument(document, {
      device, panel: this.panel!, busy: this.controlBusy||this.panelIsCached,
      write: (property, value) => { void this.setBoundProperty(property, value, device.did); },
      error: error => { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); },
      propertyEditor: (property, service, label) => this.renderPropertyEditor(property, service, device, label),
      action: (action, service) => this.renderAction(action, service, device.online),
    });
  }

  private applyOfficialCustomItems(content: HTMLElement, document: PanelDocument, device: Device): void {
    const additions: ComponentNode[] = [];
    const siblingOrders = new Map<HTMLElement, HTMLElement[]>();
    for (const item of document.items) {
      if (!('binding' in item.props)) continue;
      const binding = item.props.binding;
      const matches = [...content.querySelectorAll<HTMLElement>('[data-control]')].filter(control => control.dataset.siid === String(binding.siid) && control.dataset.piid === String(binding.piid) && (control.closest<HTMLElement>('[data-bound-device-id]')?.dataset.boundDeviceId ?? device.did) === device.did);
      if (!matches.length) {
        const key=`${binding.siid}.${binding.piid}`;
        const compound=[...content.querySelectorAll<HTMLElement>('[data-bound-properties]')].some(control=>control.dataset.boundProperties!.split(' ').includes(key)&&(control.closest<HTMLElement>('[data-bound-device-id]')?.dataset.boundDeviceId??device.did)===device.did);
        if(!compound)additions.push(item);
        continue;
      }
      if (matches.length !== 1 || matches[0].dataset.control !== item.name) {
        document.diagnostics.push(`${binding.siid}.${binding.piid} 保留已验证专属控件的复合操作语义，不重复生成控件。`); continue;
      }
      const control = matches[0], label = item.props.label;
      // Reuse the compared visual node. Only its known title slot changes;
      // callbacks, dependency rules and surrounding cards remain the adapter's.
      const title = control.querySelector<HTMLElement>('.p69-setting-title,.native-slider-heading strong,.air-temperature-heading strong,h3 strong,h3')
        ?? (control.classList.contains('native-wide-power') ? control.querySelector<HTMLElement>(':scope > span:not(.p69-toggle)') : null)
        ?? (control.classList.contains('native-power') ? control.closest('.switch-key-row')?.querySelector<HTMLElement>('.switch-key-label strong') : null);
      if (title) title.textContent = label;
      const named = [control, ...control.querySelectorAll<HTMLElement>('[aria-label]')].filter(node => node.hasAttribute('aria-label'));
      for (const node of named) { const previous = node.getAttribute('aria-label')!; const colon = previous.indexOf('：'); node.setAttribute('aria-label', `${label}${colon < 0 ? '' : previous.slice(colon)}`); }
      control.dataset.uiConfigTitle = label;
      const wrapper = control.closest<HTMLElement>('.switch-key-row') ?? (control.classList.contains('p69-setting-row') ? control : control.closest<HTMLElement>('.native-card')) ?? control;
      const parent = wrapper.parentElement;
      if (parent && (parent === content || content.contains(parent))) {
        const ordered = siblingOrders.get(parent) ?? [];
        if (!ordered.includes(wrapper)) ordered.push(wrapper);
        siblingOrders.set(parent, ordered);
      }
    }
    // Official order takes precedence within one existing card/container.
    // Cross-container rearrangement would dismantle compared visual layouts,
    // so independent adapter sections retain their own category structure.
    for (const [parent, order] of siblingOrders) {
      if (order.length < 2) continue;
      const targets = [...parent.children].filter((node): node is HTMLElement => node instanceof HTMLElement && order.includes(node));
      const markers = targets.map(node => { const marker = window.document.createComment('ui-config-order'); node.replaceWith(marker); return marker; });
      markers.forEach((marker, index) => marker.replaceWith(order[index]));
    }
    if (siblingOrders.size > 1) document.diagnostics.push('官方自定义顺序在同一容器内生效；跨卡片保持已验证的品类布局。');
    if (additions.length) content.append(this.renderUiDocument({ ...document, items: additions }, device));
  }

  private renderGenericFunctions(device: Device, unverifiedLayout: boolean, document: PanelDocument): HTMLElement {
    const view = element('div', 'generic-functions');
    view.dataset.referenceKind=unverifiedLayout?'capability':'observed';
    view.append(element('div', 'generic-heading', element('span', '', '设备功能')));
    const draftStatus = element('div', 'draft-status', element('span', '', '自动刷新已暂停，保留未提交输入。'), button('放弃编辑', 'button button-small button-quiet', () => { this.panelDrafts.clear(); this.render(); this.schedulePanelRefresh(); })); draftStatus.id = 'draft-status'; draftStatus.hidden = this.panelDrafts.size === 0; view.append(draftStatus);
    if (!document.items.length) view.append(emptyState('暂无可用功能', this.panel?.unsupportedReason ?? (document.category==='scale'?'该体脂秤未提供可供桌面读取的云端属性，称重与同步请使用手机米家。':'此型号未提供可用的日常控制或云端读取权限。')));
    else view.append(this.renderUiDocument(document, device));
    return view;
  }

  private renderSwitchPage(device: Device): HTMLElement {
    const view = element('div', 'switch-page-content');
    const title = device.controlServiceId != null ? device.name : device.controlGroupName || device.name;
    const channelCount = splitChildren(this.snapshot?.devices ?? [], device).length || switchServices(this.panel).length || 1;
    view.append(productHeader(this.deviceArtwork(device,'',channelCount,true),title,'switch-hero'));
    const keys = element('section', 'native-card switch-keys', element('div', 'native-card-heading', '按键'));
    const children = splitChildren(this.snapshot?.devices ?? [], device);
    if (children.length) {
      for (const child of children) {
        const linked = child.did === this.context?.did ? this.panel : this.linkedPanels.get(child.did);
        // The parent already reads these exact service IIDs. Use that current
        // channel data while its independent child request is still pending.
        const parent=this.panel?.model===child.model?this.panel:undefined;
        const panel=linked??parent;
        const property = linked?findProperty(linked,['switch'],['on']):parent?.services.find(s=>s.name==='switch'&&s.siid===child.controlServiceId)?.properties.find(p=>p.name==='on');
        keys.append(this.renderSwitchKey(child, child.name, property, this.linkedErrors.get(child.did),panel));
      }
    } else {
      const services = switchServices(this.panel);
      for (const service of services) keys.append(this.renderSwitchKey(device, services.length === 1 ? device.name : deviceServiceLabel(service), service.properties.find(item => item.name === 'on')));
      if (!services.length) keys.append(element('p', 'native-unavailable', '设备未提供可用的按键描述。'));
    }
    view.append(keys);
    return view;
  }

  private renderSwitchKey(device: Device, name: string, property: Property | undefined, error?: string,panel:DevicePanel|undefined=this.panel): HTMLElement {
    const policy=switchPolicy(panel,property);
    const room=device.roomName || '未分配房间';
    const subtitle=policy.label?`${room} | 已转${policy.label}`:room;
    const row = element('div', 'switch-key-row', this.deviceArtwork(device,'switch-key-artwork',device.controlServiceId == null && device.model === 'linp.switch.e2db3' ? 3 : 1,true), element('div', 'switch-key-label', element('strong', '', name), element('span', '', subtitle)));
    if(policy.label)row.dataset.switchMode=policy.label;
    const toggle = this.control({ name: 'Power', props: { property, label: name, style: 'round', disabledReason: error??policy.reason } }, device);
    if(policy.label){
      toggle.classList.add('is-on');
      toggle.setAttribute('aria-pressed','true');
      toggle.setAttribute('aria-label',`${name}：已转${policy.label}，保持供电`);
    }
    row.append(toggle); return row;
  }

  private nativeUnavailableFeature(title: string, glyph: IconName, reason: string, subtitle?: string): HTMLElement {
    const item = element('div', 'native-card native-feature', element('span', 'native-feature-icon', icon(glyph)), element('div', '', element('strong', '', title), subtitle ? element('span', '', subtitle) : null));
    item.setAttribute('aria-description',reason);item.setAttribute('aria-disabled','true');
    // Unsupported optional features do not occupy cards on another model's UI.
    item.hidden=true;return item;
  }

  private renderLightPage(device: Device, group: boolean): HTMLElement {
    if(!group&&device.model==='yeelink.light.wyra01')return this.renderYeelightStrip(device);
    const on = findProperty(this.panel, ['light'], ['on']); const state = booleanValue(on);
    const view = element('div', `light-page-content${state === false ? ' device-is-off' : ''}`);
    const hero = element('div', 'light-hero');
    let status = state === undefined ? '状态未读取' : state ? '已开启' : '已关闭';
    if (group) {
      const counts = lightGroupCounts(device, this.snapshot?.devices ?? [], this.linkedPanels);
      status = !counts ? '灯组成员未读取' : counts.unread ? `${counts.on}个灯开启 · ${counts.off}个灯关闭 · ${counts.unread}个未读取` : counts.on === counts.total ? `${counts.total}个灯开启` : counts.off === counts.total ? `${counts.total}个灯关闭` : `${counts.on}个灯开启 · ${counts.off}个灯关闭`;
    }
    view.dataset.headerStatus=status;view.append(hero);
    const items: ControlNode[] = group ? [true, false].map(value => ({ name: 'Power', props: { property: on, label: value ? '全开' : '全关', style: 'wide', value, className: value ? 'power-open' : 'power-close', glyph: value ? 'light-all-on' : 'light-all-off' } })) : [{ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开启', closeLabel: '关闭' } }];
    view.append(this.control({ name: 'Container', props: { className: 'light-power-row' }, items }, device));
    if (group && !on) view.append(notice({ tone: 'warning', title: '灯组控制暂不可用', message: '云端灯组未提供可用 MIoT 开关；尚未核实灯组成员的控制协议，不能用任意同房间灯具代替。' }));
    for (const [name, label, unit, theme] of [['brightness', '亮度', '%', 'brightness'], ['color-temperature', '色温', 'K', 'temperature']] as const) {
      const property = findProperty(this.panel, ['light'], [name]);
      if (property) view.append(this.nativeSlider(property, label, unit, device, state !== true, theme));
    }
    const color=findProperty(this.panel,['light'],['color']);
    if(color){
      const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const env={device,busy:this.controlBusy||this.panelIsCached,write:(property:Property,value:Json)=>{if(current())void this.setBoundProperty(property,value,device.did);},error:(error:unknown)=>{if(current()){this.panelNotice={tone:'error' as const,title:normalizeError(error).message};this.render(true);}},interactionEnded:()=>{if(current())this.render(true);}};
      const disabledReason=state!==true?'设备开启后可调节。':undefined;
      if(!findProperty(this.panel,['light'],['color-temperature']))view.append(lightWhitePresets(color,env,disabledReason));
      view.append(renderLightColor({property:color,tab:'color',disabledReason},env));
    }
    return view;
  }

  private renderYeelightStrip(device:Device):HTMLElement{
    const on=findProperty(this.panel,['light'],['on']),brightness=findProperty(this.panel,['light'],['brightness']);
    const temperature=findProperty(this.panel,['light'],['color-temperature']),color=findProperty(this.panel,['light'],['color']),mode=findProperty(this.panel,['light'],['mode']);
    const state=booleanValue(on),tab=this.lightTab??lightColorTab(mode,!!temperature,!!color);
    const view=element('div','yeelight-page-content',element('div','yeelight-hero'));
    view.dataset.headerStatus=state===undefined?'状态未读取':state?'已开启':'已关闭';
    const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch;
    const current=()=>!!context&&epoch===this.panelEpoch&&sameContext(context,this.context);
    const tint=(property?:Property,value?:number)=>{
      if(!current())return;
      const active=property?.name==='color'?'color':property?.name==='color-temperature'?'temperature':this.lightTab??tab;
      const background=lightTint(state,property===brightness?value:numericValue(brightness),property===color?value:rgbValue(color),property===temperature?{...temperature!,value}:temperature,active);
      const page=view.closest<HTMLElement>('.device-page');
      if(page){if(background)page.style.setProperty('--light-tint',background);else page.style.removeProperty('--light-tint');}
    };
    const initialTint=lightTint(state,numericValue(brightness),rgbValue(color),temperature,tab);
    if(initialTint)view.dataset.lightTint=initialTint;
    const power=this.control({name:'Power',props:{property:on,label:'电源',style:'wide',openLabel:'开灯',closeLabel:'关灯',className:'yeelight-power'}},device);
    view.append(power);
    if(brightness){
      const card=this.nativeSlider(brightness,'亮度','%',device,state!==true,'brightness');card.classList.add('yeelight-brightness');
      const input=card.querySelector<HTMLInputElement>('input');input?.addEventListener('input',()=>tint(brightness,Number(input.value)));
      view.append(card);
    }
    if(color||temperature){
      const control=renderLightColor({property:color,temperature,mode,tab,heading:'temperature-only',
        disabledReason:this.panelIsCached?'正在更新设备状态。':state!==true?'设备开启后可调节。':undefined,
        selectTab:next=>{if(current()){this.lightTab=next;tint();}},preview:(property,value)=>tint(property,value)},
        {device,busy:this.controlBusy||this.panelIsCached,write:(property,value)=>{if(current())void this.setBoundProperty(property,value,device.did);},
         error:error=>{if(current()){this.panelNotice={tone:'error',title:normalizeError(error).message};this.render(true);}},
         interactionEnded:()=>{if(current())this.render(true);}});
      control.dataset.boundDeviceId=device.did;view.append(control);
    }
    const modes=renderLightModes({property:mode,report:this.lightModes,
      slotsReason:this.lightModesLoading?'正在读取模式槽位。':this.lightModesError,artwork:()=>this.deviceArtwork(device),
      expanded:this.lightScenesExpanded,expand:expanded=>{if(current()){this.lightScenesExpanded=expanded;this.render(true);}},
      selectSlot:slot=>{if(current())this.lightTab=slot.temperature!=null?'temperature':'color';},
      sceneTab:this.lightSceneTab,selectSceneTab:tab=>{if(current()){this.lightSceneTab=tab;this.render(true);if(tab==='custom')void this.loadLightFavorites();}},
      favorites:this.lightFavorites,favoritesLoading:this.lightFavoritesLoading,favoritesError:this.lightFavoritesError,favoritesBusy:this.lightFavoriteOperation?.pending,
      addFavorite:()=>{if(current())this.openLightFavorite();},editFavorite:item=>{if(current())this.openLightFavorite(item);},applyFavorite:item=>{if(current())this.applyLightFavorite(item);},favoriteReason:item=>{try{favoriteWrites(item,this.panel?.services.flatMap(s=>s.properties)??[],device.online,this.controlBusy||this.panelIsCached);return undefined;}catch(e){return normalizeError(e).message;}},
      editModes:()=>{if(current())this.openLightSettings('modes');},editFlow:()=>{if(current())this.openLightSettings('flow');}},
      {device,busy:this.controlBusy||this.panelIsCached,
       write:(property,value)=>{if(current())void this.setBoundProperty(property,value,device.did);},
       error:error=>{if(current()){this.panelNotice={tone:'error',title:normalizeError(error).message};this.render(true);}}});
    modes.dataset.slotsLoading=String(this.lightModesLoading);view.append(modes);
    return view;
  }

  private nativeSlider(property: Property | undefined, label: string, unit: string, device: Device, disabledByPower = false, theme = '', valueProperty?: Property): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label, unit, theme, valueProperty, disabledReason: disabledByPower ? '设备开启后可调节。' : undefined } }, device);
  }

  private renderCurtainPage(device: Device): HTMLElement {
    const motionKey=JSON.stringify(this.context);this.curtainMotion=this.curtainMotions.get(motionKey)??new CurtainMotion();this.curtainMotions.set(motionKey,this.curtainMotion);
    const motor = findProperty(this.panel, ['curtain'], ['motor-control']);
    const position = findProperty(this.panel, ['curtain'], ['current-position']);
    const target = findProperty(this.panel, ['curtain'], ['target-position']);
    const value = numericValue(position);
    const view = element('div', 'curtain-page-content');
    const backdrop = element('div', 'curtain-drawing', element('div', 'curtain-fabric curtain-left'), element('div', 'curtain-fabric curtain-right'));
    view.append(backdrop);
    const controls = element('section', 'native-card curtain-transport');
    for (const [label, meaning, glyph] of [['打开', 'open', 'curtain-open'], ['暂停', 'pause', 'pause'], ['关闭', 'close', 'curtain-close']] as const) {
      // acn009 original module 10148 uses target-position 100/0 for its
      // open/close buttons; motor-control 0 is reserved for pause.
      const endpoint=device.model==='xiaomi.curtain.acn009'&&meaning!=='pause'?target:motor;
      const desired=endpoint===target?(meaning==='open'?100:0):enumValue(motor,meaning);
      const reason = (device.sharedReadOnly?'此共享设备仅有读取权限。':undefined)??controlReason(endpoint, device.online, this.controlBusy||this.panelIsCached) ?? (desired === undefined ? '设备描述未提供对应的窗帘控制枚举。' : undefined);
      const control = button(label, 'curtain-command', () => { if (!control.disabled&&endpoint && desired !== undefined){if(meaning==='pause'){this.curtainMotion.pause();if(target)this.propertyOps.cancel(this.operationKey(device.did,target.siid,target.piid));}void this.setProperty(endpoint, desired as Json);this.schedulePanelRefresh();} }, glyph); control.disabled = !!reason; if (reason) control.setAttribute('aria-description',reason); controls.append(control);
    }
    view.append(controls);
    const operation=target?this.propertyOps.get(this.operationKey(device.did,target.siid,target.piid)):undefined;
    const raw=this.confirmedPanels.get(device.did)??this.panel,rawPosition=numericValue(findProperty(raw,['curtain'],['current-position']));
    const slider = this.nativeSlider(target, '窗帘开合', '%', device, false, 'curtain', operation?.pending?target:position);
    view.append(slider);
    this.curtainMotion.attach(backdrop,JSON.stringify(this.context),{position:rawPosition??value,target:operation?.pending?Number(operation.target):numericValue(target),status:numericValue(findProperty(raw,['curtain'],['status'])),journey:numericValue(findProperty(raw,['curtain'],['whole-journey-time'])),pending:operation?.pending,revision:operation?.revision,outcome:operation?.outcome},(current,goal)=>{
      const output=slider.querySelector('.native-slider-value'),input=slider.querySelector<HTMLInputElement>('input');if(output)output.textContent=`${Math.round(current)}%`;
      slider.dataset.displayPosition=current.toFixed(2);if(!slider.dataset.interacting)slider.style.setProperty('--curtain-progress',`${current}%`);
      if(input&&!slider.dataset.interacting){input.value=String(operation?.pending?Number(operation.target):this.curtainMotion.moving?goal:current);input.setAttribute('aria-valuetext',`目标 ${input.value}%，当前 ${Math.round(current)}%`);}
    });
    return view;
  }

  private renderFanPage(device: Device): HTMLElement {
    const on = findProperty(this.panel, ['fan'], ['on']); const state = booleanValue(on);
    const humidity = findProperty(this.panel, ['environment'], ['relative-humidity']);
    const temperature = findProperty(this.panel, ['environment'], ['temperature']);
    const view = element('div', `fan-page-content${state === false ? ' device-is-off' : ''}`);
    const climate = element('div', 'fan-climate');
    for (const [property, label] of [[humidity, '湿度(%)'], [temperature, '室温(℃)']] as const) climate.append(element('div', '', element('strong', '', numericValue(property) === undefined ? '--' : String(numericValue(property))), element('span', '', label)));
    view.append(element('div', 'fan-hero', element('div', 'fan-big-status', state === undefined ? '未读取' : state ? '运行中' : '关机'), climate));
    view.append(this.control({ name: 'Power', props: { property: on, label: '电源', openLabel: '开启', closeLabel: '关闭', style: 'wide' } }, device));
    const mode = findProperty(this.panel, ['fan'], ['mode']);
    if (mode) view.append(this.control({ name: 'Selector', props: { property: mode, label: '模式', style: 'fan', choiceLabel: fanModeLabel, choiceIcon: description => /natural|自然/i.test(description) ? 'leaf' : /sleep|睡眠/i.test(description) ? 'moon' : /smart|智能|auto|自动/i.test(description) ? 'climate' : 'wind', disabledReason: state !== true ? '风扇开启后可调节模式。' : undefined } }, device));
    const speed = fanSpeedProperty(this.panel, 'gear')??findProperty(this.panel, ['fan'], ['fan-level', 'stepless-fan-level', 'speed-level']);
    if (speed) view.append(speed.valueList?.length ? this.nativeFanSpeed(speed, device, state !== true) : this.nativeSlider(speed, '风速档位', '', device, state !== true, 'fan'));
    for (const [name, label] of [['horizontal-swing', '左右摆风'], ['vertical-swing', '上下摆风']] as const) {
      const property = findProperty(this.panel, ['fan'], [name]); if (!property) continue;
      view.append(this.control({ name: 'Power', props: { property, label, style: 'wide', showToggle:true, glyph: name==='horizontal-swing'?'swing-horizontal':'swing-vertical', className: `fan-swing${booleanValue(property) === true ? ' is-on' : ''}`, disabledReason: state !== true ? '风扇开启后可调节摆风。' : undefined } }, device));
    }
    return view;
  }

  private nativeFanSpeed(property: Property, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '风速档位', theme: 'fan', discrete: true, choiceLabel: description => description.replace(/^Level\s*(\d+)$/i, '$1档'), disabledReason: disabledByPower ? '风扇开启后可调节风速。' : undefined } }, device);
  }

  private renderP69FanPage(device: Device): HTMLElement {
    const on = findProperty(this.panel, ['fan'], ['on']);
    const mode = findProperty(this.panel, ['fan'], ['mode']);
    const state = booleanValue(on);
    const choice = isReadableValue(mode) ? mode.valueList?.find(item => JSON.stringify(item.value) === JSON.stringify(mode.value)) : undefined;
    const view = element('div', `p69-fan-content${state !== true ? ' device-is-off' : ''}`);
    view.append(element('div', 'p69-fan-hero', element('h1', '', choice ? fanModeLabel(choice.description) : '模式未读取')));
    const power = this.control({ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开启', closeLabel: '关闭', className: 'p69-power' } }, device);
    view.append(power, this.nativeP69Choices(mode, '模式', 'mode', device, state !== true), this.nativeP69Choices(fanSpeedProperty(this.panel, 'gear'), '挡位调速', 'gear', device, state !== true));
    view.append(this.nativeP69Swing(findProperty(this.panel, ['fan'], ['horizontal-swing']), findProperty(this.panel, ['fan'], ['horizontal-swing-included-angle']), '左右摆风', 'horizontal', device, state !== true));
    view.append(this.nativeP69Swing(findProperty(this.panel, ['fan'], ['vertical-swing']), findProperty(this.panel, ['fan'], ['vertical-swing-included-angle']), '上下摆风', 'vertical', device, state !== true));
    view.append(this.nativeP69DirectionPad(device, state !== true), this.nativeUnavailableFeature('循环扫风', 'fan', '此型号未提供可核实的循环扫风属性，暂不支持此项控制。'));
    return view;
  }

  private nativeP69Choices(property: Property | undefined, title: string, kind: 'mode' | 'gear', device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Selector', props: { property, label: title, style: 'p69', showValue: kind === 'gear', choiceLabel: description => kind === 'gear' ? description.replace(/^Level\s*(\d+)$/i, '$1挡') : fanModeLabel(description), choiceIcon: description => kind === 'mode' ? /natural|自然/i.test(description) ? 'leaf' : 'wind' : undefined, choiceSymbol: description => kind === 'gear' ? description.replace(/^Level\s*(\d+)$/i, '$1') : undefined, disabledReason: disabledByPower ? '风扇开启后可调节。' : undefined } }, device);
  }

  private nativeP69Swing(property: Property | undefined, angle: Property | undefined, title: string, direction: 'horizontal' | 'vertical', device: Device, disabledByPower: boolean): HTMLElement {
    const state = booleanValue(property);
    const reason = controlReason(property, device.online, this.controlBusy) ?? (state === undefined ? '摆风状态未读取，请先读取状态。' : undefined);
    const card = element('section', 'native-card p69-swing-card');
    const row = this.control({ name: 'Power', props: { property, label: title, style: 'setting', glyph: direction === 'horizontal' ? 'swing-horizontal' : 'swing-vertical', disabledReason: disabledByPower ? '风扇开启后可调节摆风。' : undefined } }, device);
    card.append(row);
    if (state === true && angle) {
      const label = element('label', 'p69-angle-label', `${title}夹角`); const select = element('select', 'p69-angle-select');
      select.id = `p69-angle-${angle.siid}-${angle.piid}`; label.htmlFor = select.id;
      const placeholder = element('option', '', '未读取'); placeholder.value = ''; placeholder.disabled = true; select.append(placeholder);
      for (const [index, option] of (angle.valueList ?? []).entries()) {
        const description = typeof option.value === 'number' && angle.unit === 'arcdegrees' ? `${option.value}°` : deviceChoiceLabel(option.description,`选项${index+1}`);
        const item = element('option', '', description); item.value = String(index); select.append(item);
      }
      select.value = initialInput(angle); const angleReason = controlReason(angle, device.online, this.controlBusy);
      select.disabled = !!angleReason || disabledByPower || !angle.valueList?.length || !isReadableValue(angle);
      if (angleReason) select.setAttribute('aria-description',angleReason); else if (disabledByPower) select.setAttribute('aria-description','风扇开启后可调节摆风夹角。');
      select.addEventListener('change', () => { try { void this.setProperty(angle, coercePropertyInput(angle, select.value)); } catch (error) { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); } });
      card.append(element('div', `p69-angle-row${disabledByPower ? ' control-off' : ''}`, label, select, icon('chevron')));
    }
    if (reason && !this.controlBusy) card.append(element('p', 'native-unavailable', reason)); return card;
  }

  private nativeP69DirectionPad(device: Device, disabledByPower: boolean): HTMLElement {
    const card = element('section', 'native-card p69-manual-card', element('h3', '', '手动调节'));
    const disc = element('div', 'p69-direction-disc');
    const service = this.panel?.services.find(item => item.name === 'fan');
    for (const [name, direction, label] of [['turn-upward', 'up', '向上'], ['turn-left', 'left', '向左'], ['turn-right', 'right', '向右'], ['turn-downward', 'down', '向下']] as const) {
      const action = service?.actions.find(item => item.name === name);
      const reason = !device.online ? '设备离线。' : !action ? '设备描述未提供此方向的动作。' : action.unsupportedReason ?? (action.in.length ? '该动作需要参数，暂不开放此快捷操作。' : undefined);
      const control = button('', `p69-direction p69-direction-${direction}`, () => { if (action && service) { this.actionConfirm = { action, service, inputs: [] }; this.render(); } }, 'chevron');
      control.setAttribute('aria-label', label); control.disabled = !!reason || disabledByPower || this.controlBusy;
      if (reason) control.setAttribute('aria-description',reason); else if (disabledByPower) control.setAttribute('aria-description','风扇开启后可手动调节。');
      disc.append(control);
    }
    card.append(disc); return card;
  }

  private renderAirConditionerPage(device: Device): HTMLElement {
    const on = findProperty(this.panel, ['air-conditioner'], ['on']);
    const mode = findProperty(this.panel, ['air-conditioner'], ['mode']);
    const target = findProperty(this.panel, ['air-conditioner'], ['target-temperature']);
    const fan = findProperty(this.panel, ['fan-control','air-conditioner'], ['fan-level','speed-level']);
    const indoor = findProperty(this.panel, ['environment'], ['temperature']);
    const state = booleanValue(on);
    const value = numericValue(target);
    const currentChoice = (property: Property | undefined): string => {
      if (!isReadableValue(property)) return '未读取';
      const choice = property.valueList?.find(item => JSON.stringify(item.value) === JSON.stringify(property.value));
      return choice ? climateChoiceLabel(choice.description) : '未知选项';
    };
    const view = element('div', `air-conditioner-content${state !== true ? ' device-is-off' : ''}`);
    const status = `${state === undefined ? '状态未读取' : state ? '开机' : '关机'} | ${currentChoice(mode)} | ${currentChoice(fan)}`;
    const hero = element('div', 'air-conditioner-hero', element('div', 'air-conditioner-temperature', element('strong', '', value === undefined ? '--' : String(value)), element('span', '', '℃')), element('p', '', status), indoor?element('p', '', numericValue(indoor) === undefined ? '室内温度: 未读取' : `室内温度: ${numericValue(indoor)}℃`):null);
    view.append(hero);
    if(findProperty(this.panel,['power-consumption'],['electric-power']))view.append(energyEntrance(this.energyData,this.panel,energySupported(device,this.panel)?()=>this.loadEnergy({period:'week',date:dateKey(new Date())}):undefined,this.energyLoading));
    const power = this.control({ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开机', closeLabel: '关机', className: 'air-conditioner-power' } }, device);
    if(on)view.append(power);
    if(target)view.append(this.nativeTemperatureControl(target, device, on?state !== true:false));
    if(mode)view.append(this.nativeClimateChoices(mode, '模式', device, on?state !== true:false));
    if(fan)view.append(this.nativeClimateChoices(fan, '风速', device, on?state !== true:false));
    return view;
  }

  private nativeTemperatureControl(property: Property | undefined, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '温度调节', unit: '℃', style: 'temperature', disabledReason: disabledByPower ? '空调开启后可调节温度。' : undefined } }, device);
  }

  private nativeClimateChoices(property: Property | undefined, title: string, device: Device, disabledByPower: boolean): HTMLElement {
    const glyphs: Record<string, IconName> = { cool: 'snowflake', heat: 'sun', fan: 'fan', dry: 'droplet', low:'fan-low',medium:'fan-medium',high:'fan-high' };
    return this.control({ name: 'Selector', props: { property, label: title, style: 'climate', choiceLabel: climateChoiceLabel, choiceIcon: description => glyphs[description.toLowerCase().trim()], choiceSymbol: description => description.toLowerCase().trim()==='auto'?'A':undefined, disabledReason: disabledByPower ? `空调开启后可调节${title}。` : undefined } }, device);
  }

  private renderPropertyEditor(property: Property, service: Service, device: Device, title = property.description || property.name): HTMLElement {
      title=devicePropertyLabel(property,title);
      // The schema's explicit-input slot retains the previous advanced form,
      // including write-only/string values and unbounded numeric properties.
      const row = element('div', 'property-row');
      row.dataset.control = 'PropertyEditor'; row.dataset.siid = String(property.siid); row.dataset.piid = String(property.piid); row.dataset.boundDeviceId = device.did;
      const label = element('label', 'property-label', title);
      const value = element('span', `property-value${property.code != null && property.code !== 0 ? ' value-error' : ''}`, displayValue(property));
      row.append(element('div', 'property-heading', label, value));
      const reported = reportedValueText(property);
      if (reported) {row.setAttribute('aria-description',reported);row.dataset.readingSource='reported';}
      if (property.access.includes('write')) {
        const reason = writeUnsupportedReason(property);
        if (reason) row.append(element('p', 'unsupported-hint', icon('info'), reason));
        else {
          const input = this.propertyInput(property, `property-${service.siid}-${property.piid}`);
          label.htmlFor = input.id;
          input.disabled = !device.online || this.controlBusy;
          const save = button('应用', 'button button-small button-primary', () => {
            try { const value = coercePropertyInput(property, input.value); void this.setBoundProperty(property, value, device.did); }
            catch (error) { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); }
          });
          save.disabled = !device.online || this.controlBusy;
          row.append(element('div', 'property-editor', input, save));
          if (!property.access.includes('read')) row.append(element('p', 'field-help', '此属性仅支持写入，无法回读确认；请观察设备实际反馈。'));
          if (property.valueRange) row.append(element('p', 'field-help', `范围 ${property.valueRange[0]}–${property.valueRange[1]} · 步长 ${property.valueRange[2]}`));
        }
      } else row.append(element('span', 'read-only-label', '只读'));
      return row;
  }

  private propertyInput(property: Property, id: string): HTMLInputElement | HTMLSelectElement {
    let input: HTMLInputElement | HTMLSelectElement;
    if (property.valueList || property.format === 'bool') {
      const select = element('select', 'control-field');
      const placeholder = element('option', '', '请选择'); placeholder.value = ''; placeholder.disabled = true; select.append(placeholder);
      const options = property.valueList?.map((choice, index) => [String(index), deviceChoiceLabel(choice.description,`选项${index+1}`)]) ?? [['false', '关闭'], ['true', '开启']];
      for (const [value, name] of options) { const option = element('option', '', name); option.value = value; select.append(option); }
      input = select;
    } else {
      const field = element('input', 'control-field');
      field.type = property.format === 'string' ? 'text' : 'number';
      if (field.type === 'number') {
        field.step = property.valueRange ? String(property.valueRange[2]) : ['float', 'double'].includes(property.format) ? 'any' : '1';
        if (property.valueRange) { field.min = String(property.valueRange[0]); field.max = String(property.valueRange[1]); }
      }
      field.placeholder = property.format === 'string' ? '输入文本' : '输入数值';
      input = field;
    }
    input.id = id; input.value = this.panelDrafts.get(id) ?? initialInput(property);
    const rememberDraft = () => {
      this.panelDrafts.set(id, input.value);
      const draftStatus = document.getElementById('draft-status');
      if (draftStatus) draftStatus.hidden = false;
    };
    input.addEventListener('input', rememberDraft);
    input.addEventListener('change', rememberDraft);
    return input;
  }

  private renderAction(action: Action, service: Service, online: boolean): HTMLElement {
    const form = element('form', 'action-row');
    const dailyLabel=dailyActionLabel(miotCategory(this.panel?.specType),service,action);
    if(dailyLabel&&!action.unsupportedReason){
      form.classList.add('daily-action-row');
      const execute=button(dailyLabel,'button daily-action-button',()=>{this.actionConfirm={action:{...action,description:dailyLabel},service,inputs:[]};this.render();},['turn-on','turn-off'].includes(action.name)?'power':action.name.includes('pause')?'pause':undefined);
      execute.disabled=!online||this.controlBusy||this.propertyOps.pendingCount>0;
      form.append(execute);form.addEventListener('submit',event=>event.preventDefault());return form;
    }
    const title = element('div', 'action-title', element('strong', '', action.description || action.name), element('span', 'action-tag', '动作'));
    form.append(title);
    const inputs: { property: Property; input: HTMLInputElement | HTMLSelectElement }[] = [];
    let unsupported = this.currentDevice()?.model===dispenserModel&&service.siid===2&&[2,3,4].includes(action.aiid)?'此动作需要专用的杀菌或提醒状态校验，暂不提供通用执行。':action.unsupportedReason;
    for (const piid of action.in) {
      const property = service.properties.find(item => item.piid === piid);
      if (!property) { unsupported ??= `动作输入属性 ${piid} 缺少描述，暂不能安全执行。`; continue; }
      const reason = inputUnsupportedReason(property);
      if (reason) { unsupported ??= reason; continue; }
      const input = this.propertyInput(property, `action-${service.siid}-${action.aiid}-${piid}`);
      input.disabled = !online || this.controlBusy;
      const label = element('label', 'field-label', property.description || property.name); label.htmlFor = input.id;
      form.append(element('div', 'action-input', label, input)); inputs.push({ property, input });
    }
    if (unsupported) form.append(element('p', 'unsupported-hint', icon('info'), unsupported));
    else {
      const execute = button('执行动作', 'button button-small button-secondary', () => {
        try { this.actionConfirm = { action, service, inputs: inputs.map(({ property, input }) => coercePropertyInput(property, input.value)) }; this.render(); }
        catch (error) { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); }
      }, 'arrow');
      execute.disabled = !online || this.controlBusy;
      form.append(execute);
      if (!action.out.length) form.append(element('p', 'field-help', '此动作没有输出值，执行后需观察设备实际反馈。'));
    }
    form.addEventListener('submit', event => event.preventDefault());
    return form;
  }

  private renderActionConfirmation(): HTMLElement {
    const pending = this.actionConfirm!;
    const modal = element('section', 'confirm-dialog'); modal.tabIndex = -1; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'confirm-title');
    const title = element('h2', '', '确认执行设备动作'); title.id = 'confirm-title';
    modal.append(element('div', 'confirm-icon', icon('warning')), title, element('p', '', `即将在「${this.currentDevice()?.name ?? '设备'}」上执行「${pending.action.description || pending.action.name}」。此操作会影响真实设备。`));
    if (pending.inputs.length) modal.append(element('div', 'confirm-values', ...pending.inputs.map((value, index) => {
      const property = pending.service.properties.find(item => item.piid === pending.action.in[index]);
      return element('div', '', element('span', '', property?.description ?? `参数 ${index + 1}`), element('strong', '', typeof value === 'string' ? value : JSON.stringify(value)));
    })));
    modal.append(element('p', 'confirm-note', '请确认设备周围环境安全，并在执行后观察设备反馈。接口接受请求不代表动作已实际完成。'));
    const cancel = button('取消', 'button button-secondary', () => { this.actionConfirm = undefined; this.render(); }); cancel.disabled = this.controlBusy;
    const confirm = button('确认执行', 'button button-primary', () => { void this.runAction(pending); }); confirm.disabled = this.controlBusy||this.propertyOps.pendingCount>0;
    modal.append(element('div', 'confirm-actions', cancel, confirm));
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!focusable.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === focusable[0] || document.activeElement === modal)) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    });
    queueMicrotask(() => { if (modal.isConnected) cancel.disabled ? modal.focus() : cancel.focus(); });
    const overlay=element('div','modal-backdrop',modal);dismissOnBackdrop(overlay,()=>{if(!cancel.disabled){this.actionConfirm=undefined;this.render();}});return overlay;
  }

  private operationKey(did:string,siid:number,piid:number):string{return JSON.stringify([did,siid,piid]);}
  private startOptimisticProperty(property:Property,value:Json,did:string):boolean{
    if(!this.context||this.controlBusy)return false;
    const panel=did===this.context.did?this.panel:this.linkedPanels.get(did);
    const device=this.snapshot?.devices.find(device=>device.did===did),category=panel?.specType?.split(':')[3];
    if(property.name==='color'&&(category!=='light'||rgbPropertyReason(property)))return false;
    const actual=(this.confirmedPanels.get(did)??panel)?.services.flatMap(s=>s.properties).find(p=>p.siid===property.siid&&p.piid===property.piid)??property;
    if(!panel||!device?.online||device.sharedReadOnly||!actual.access.includes('read')||!actual.access.includes('write')||!isReadableValue(actual)||writeUnsupportedReason(actual))return false;
    const key=this.operationKey(did,property.siid,property.piid);this.propertyContexts.set(key,{context:{...this.context,did},homeEpoch:this.homeEpoch});
    this.panelNotice=undefined;this.propertyOps.write(key,value,actual.value!);return true;
  }
  private acceptPanel(panel:DevicePanel,readVersion:number):void{
    const previous=this.confirmedPanels.get(panel.did);const curtainTarget=panel.services.flatMap(s=>s.properties).find(p=>p.name==='target-position'),curtainOp=curtainTarget?this.propertyOps.get(this.operationKey(panel.did,curtainTarget.siid,curtainTarget.piid)):undefined;
    panel={...panel,services:panel.services.map(s=>({...s,properties:s.properties.map(p=>{const op=this.propertyOps.get(this.operationKey(panel.did,p.siid,p.piid));if((op&&op.revision>readVersion||p.name==='current-position'&&curtainOp&&curtainOp.revision>readVersion)&&previous){return previous.services.flatMap(s=>s.properties).find(q=>q.siid===p.siid&&q.piid===p.piid)??p;}return p;})}))};
    this.confirmedPanels.set(panel.did,panel);
    this.confirmedPanelVersions.set(panel.did,readVersion);
    this.rememberDevice(panel);
    const merged=this.projectPanel(panel,readVersion);
    this.linkedPanels.set(panel.did,merged);if(panel.did===this.context?.did)this.panel=merged;
  }
  private projectPanel(panel:DevicePanel,readVersion:number):DevicePanel{return {...panel,services:panel.services.map(service=>({...service,properties:service.properties.map(property=>{
      const key=this.operationKey(panel.did,property.siid,property.piid),view=this.propertyOps.display(key,property.value,readVersion);
      if(view.phase)return{...property,value:view.value,code:0,pending:view.phase};
      if(this.propertyOps.get(key)?.settledRevision&&this.propertyOps.get(key)!.settledRevision>readVersion)return{...property,value:view.value,code:0,pending:undefined};
      return property;
    })}))};}
  private propertyOperationChanged():void{
    const update=(panel:DevicePanel)=>({...panel,services:panel.services.map(service=>({...service,properties:service.properties.map(property=>{
      const key=this.operationKey(panel.did,property.siid,property.piid),cell=this.propertyOps.get(key);if(!cell)return property;
      if(cell.pending)return{...property,value:cell.target,code:0,pending:cell.phase};
      return property.pending||cell.settledRevision>(this.confirmedPanelVersions.get(panel.did)??0)?{...property,value:cell.confirmed,pending:undefined}:property;
    })}))});
    if(this.panel)this.panel=update(this.confirmedPanels.get(this.panel.did)??this.panel);for(const[did,panel]of this.linkedPanels)this.linkedPanels.set(did,update(this.confirmedPanels.get(did)??panel));
    const settled=this.propertyOps.lastSettled;if(settled&&settled.settledRevision>this.operationNoticeRevision){this.operationNoticeRevision=settled.settledRevision;if(settled.outcome==='rejected'){this.panelNotice={tone:'warning',title:'操作未生效，已恢复已确认状态',message:settled.message};if(!this.context){this.uiNotice=undefined;this.render();}}if(this.currentDevice()?.model==='yeelink.light.wyra01')this.refreshLightDependencies();}
    if(this.context)this.render(true);else this.homeCardChanged();
  }
  private refreshLightDependencies(attempt=0):void{
    if(this.lightDependencyTimer)clearTimeout(this.lightDependencyTimer);
    if(!this.context)return;
    const context={...this.context},epoch=this.panelEpoch;
    this.lightDependencyTimer=setTimeout(()=>{
      this.lightDependencyTimer=undefined;if(epoch!==this.panelEpoch||!sameContext(context,this.context))return;
      if(this.panelLoading||this.propertyOps.pendingCount){if(attempt<4)this.refreshLightDependencies(attempt+1);return;}
      // A targeted color acknowledgement cannot confirm the dependent mode.
      void this.readProperties(true);
    },attempt?500:50);
  }
  private async propertyRequest(key:string,value:Json,read:boolean):Promise<PropertyReply>{
    if(read)return this.propertyTransport(key,value,true);const revision=this.propertyOps.get(key)?.revision,did=(JSON.parse(key)as[string])[0];
    return this.serializeDevice(did,()=>this.propertyOps.get(key)?.revision!==revision?Promise.resolve({outcome:'pending' as const,message:'已由最新操作替代'}):this.propertyTransport(key,value,false));
  }
  private serializeDevice<T>(did:string,send:()=>Promise<T>):Promise<T>{const task=(this.deviceSends.get(did)??Promise.resolve()).then(send);this.deviceSends.set(did,task.then(()=>{},()=>{}));return task;}
  private async propertyTransport(key:string,value:Json,read:boolean):Promise<PropertyReply>{
    const binding=this.propertyContexts.get(key);if(!binding)throw {kind:'staleContext',message:'设备已经关闭。'};
    const[did,siid,piid]=JSON.parse(key) as [string,number,number],context={...binding.context},version=this.propertyOps.version;
    const current=()=>binding.homeEpoch===this.homeEpoch&&this.snapshot?.homeId===context.homeId&&this.snapshot.generation===context.generation;
    try{
      if(!current())throw {kind:'staleContext',message:'家庭已经切换，未发送排队操作。'};
      if(binding.homePower){const intent=value?'on':'off';const r=await(read?api.confirmHomeCard(context,intent):api.changeHomeCard(context,intent));if(!current())throw {kind:'staleContext',message:'家庭已经切换。'};if(r.card&&this.homeCards)this.homeCards={...this.homeCards,cards:this.homeCards.cards.map(c=>c.did===did?r.card!:c)};return{outcome:r.verified?'confirmed':'pending',actual:r.actual==='on'?true:r.actual==='off'?false:undefined,message:r.message};}
      const p=this.confirmedPanels.get(did)?.services.flatMap(s=>s.properties).find(p=>p.siid===siid&&p.piid===piid),position=binding.homeCurtain?{siid:2,piid:4}:p?.name==='target-position'?findProperty(this.confirmedPanels.get(did),['curtain'],['current-position']):undefined;
      const result=await(read?api.confirmProperty({...context,did},position?.siid??siid,position?.piid??piid,value):api.setProperty({...context,did},siid,piid,value));
      if(!current())throw {kind:'staleContext',message:'家庭已经切换。'};
      if(result.panel.did!==did)throw {kind:'protocol',message:'设备回读标识不匹配，仍待确认。'};
      const actual=result.panel.services.flatMap(service=>service.properties).find(property=>property.siid===(position?.siid??siid)&&property.piid===(position?.piid??piid));
      this.acceptPanel(result.panel,version);
      return{outcome:(position?actual&&isReadableValue(actual)&&actual.value===value:result.verified)?'confirmed':'pending',actual:actual&&isReadableValue(actual)?actual.value:undefined,message:result.message};
    }catch(error){const failure=normalizeError(error);if(current())this.handleSessionError(failure);throw failure;}
  }
  private async setBoundProperty(property: Property, value: Json, did: string): Promise<void> {
    if (did === this.context?.did) { await this.setProperty(property, value); return; }
    if(this.startOptimisticProperty(property,value,did))return;
    if (!this.context || this.controlBusy) return;
    const device = this.currentDevice();
    const target = device && splitChildren(this.snapshot?.devices ?? [], device).find(item => item.did === did);
    const reason = controlReason(property, !!target?.online, false);
    if (!target || reason) { this.panelNotice = { tone: 'warning', title: reason ?? '设备分组已变化，请重新打开设备。' }; this.render(); return; }
    const context = { ...this.context }; const epoch = this.panelEpoch;
    this.controlBusy = true; this.panelNotice = undefined; this.render();
    try {
      const result = await api.setProperty({ ...context, did }, property.siid, property.piid, value);
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (result.panel.did !== did) throw new Error('控制回读的按键不匹配，请重新读取状态。');
      this.linkedPanels.set(did, result.panel);
      this.panelNotice = result.verified?undefined:{tone:'warning',title:'设备状态尚未确认',message:result.message};
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      const appError = normalizeError(error); this.panelNotice = { tone: 'error', title: appError.message }; this.handleSessionError(appError);
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.controlBusy = false; this.render(); this.schedulePanelRefresh(); }
    }
  }

  private async setProperty(property: Property, value: Json): Promise<void> {
    if(this.presentationRoute.changed)return;
    if(this.context&&this.startOptimisticProperty(property,value,this.context.did))return;
    if (!this.context || this.controlBusy) return;
    const unsupportedReason = writeUnsupportedReason(property);
    if (unsupportedReason) { this.panelNotice = { tone: 'warning', title: unsupportedReason }; this.render(); return; }
    const context = { ...this.context }; const epoch = this.panelEpoch;
    this.controlBusy = true; this.controlIntent='正在提交操作…';this.panelNotice = undefined; this.render();
    try {
      const result = await this.serializeDevice(context.did,()=>api.setProperty(context, property.siid, property.piid, value));
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (result.panel.did !== context.did) throw new Error('控制返回的设备不匹配，请重新读取状态。');
      this.acceptPanel(result.panel,this.propertyOps.version);
      this.panelDrafts.delete(`property-${property.siid}-${property.piid}`);
      this.panelNotice = result.verified?undefined:{tone:'warning',title:'设备状态尚未确认',message:result.message};
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      const appError = normalizeError(error); this.panelNotice = { tone: 'error', title: appError.message }; this.handleSessionError(appError);
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.controlBusy = false; this.controlIntent=undefined;this.render(); }
    }
  }

  private async runAction(pending: PendingAction): Promise<void> {
    if(this.presentationRoute.changed)return;
    if (!this.context || this.controlBusy) return;
    const context = { ...this.context }; const epoch = this.panelEpoch;
    this.controlBusy = true; this.controlIntent='正在提交操作…';this.panelNotice = undefined; this.render();
    try {
      const result = await this.serializeDevice(context.did,()=>api.runAction(context, pending.action.siid, pending.action.aiid, pending.inputs));
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (result.panel.did !== context.did) throw new Error('动作返回的设备不匹配，请重新读取状态。');
      this.acceptPanel(result.panel,this.propertyOps.version);
      for (const piid of pending.action.in) this.panelDrafts.delete(`action-${pending.service.siid}-${pending.action.aiid}-${piid}`);
      this.panelNotice = {
        tone: 'warning', title: result.verified && pending.action.out.length ? '已完成云端状态回读' : '请确认设备实际反馈',
        message: `${result.message} ${pending.action.out.length ? '回读结果不能单独证明动作在设备上实际完成。' : '此动作没有输出值，无法据此确认设备实际反馈。'}`,
      };
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      const appError = normalizeError(error); this.panelNotice = { tone: 'error', title: appError.message }; this.handleSessionError(appError);
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.controlBusy = false; this.controlIntent=undefined;this.actionConfirm = undefined; this.render(); }
    }
  }

  private async logout(): Promise<void> {
    if (this.logoutBusy) return;
    this.logoutBusy = true; this.render();
    try {
      await api.logout();
      ++this.loginEpoch; ++this.homeEpoch;
      if (this.loginTimer) clearTimeout(this.loginTimer);
      if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
      this.session = undefined;this.accountProfile=undefined;this.profileError=false;this.homes = []; this.selectedHomeId = ''; this.snapshot = undefined;
      this.clearPanel(); this.routerClientName.reset(); this.resetLocalView(); this.homeError = undefined; this.sessionNotice = undefined; this.loginError = undefined; this.loginState = 'idle'; this.homeBusy = false;
    } catch (error) { this.homeError = normalizeError(error); }
    this.logoutBusy = false; this.render();
  }
  private control(node: ControlNode, device: Device): HTMLElement {
    const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    const control = renderControl(node, { device, busy: this.controlBusy||this.panelIsCached, write: (property, value) => { if(current())void this.setBoundProperty(property, value, device.did); }, error: error => { if(current()){this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render();} },interactionEnded:()=>{if(current())this.render(true);} });
    control.dataset.boundDeviceId = device.did;
    return control;
  }

  private renderSensorPage(device: Device): HTMLElement {
    const view = element('div', 'sensor-page-content');
    const temperature = findProperty(this.panel, ['temperature-humidity-sensor'], ['temperature']);
    const humidity = findProperty(this.panel, ['temperature-humidity-sensor'], ['relative-humidity']);
    const tempUnit = temperature?.unit === 'celsius' ? '℃' : temperature?.unit ?? '单位未提供';
    const metrics: ControlNode[] = [
      { name: 'Status', props: { property: temperature, label: `温度(${tempUnit})`, precision: 1, style: 'metric', showSource: false } },
      { name: 'Status', props: { property: humidity, label: `湿度(${humidity?.unit === 'percentage' ? '%' : humidity?.unit ?? '单位未提供'})`, precision: 0, style: 'metric', showSource: false } },
    ];
    const hero = element('div', 'sensor-hero', this.control({ name: 'Container', props: { className: 'sensor-metrics' }, items: metrics }, device));
    const card = element('section', 'sensor-history-card');
    card.dataset.historyState = this.historyLoading ? 'loading' : this.historyError ? 'error' : 'loaded';
    if (this.sensorHistory) card.dataset.fetchedAt = String(this.sensorHistory.fetchedAt);
    const displayedHistory = sensorHistorySlots(this.sensorHistory);
    for (const [name, title, unit, precision] of [['temperature', '温度', '℃', 1], ['humidity', '湿度', '%', 0]] as const) {
      const entry = element('section', 'sensor-history-entry');
      const heading = element('header', 'sensor-history-heading', element('h3', '', title));
      heading.setAttribute('aria-description','云端历史');
      const channel = this.sensorHistory?.channels.find(channel => channel.name === name);
      const slots = displayedHistory[name];
      const message = this.historyError?.message ?? channel?.error ?? (!historyExtremes(slots) ? '暂无云端记录' : undefined);
      entry.append(heading,this.historyLoading&&!this.sensorHistory?deviceWait(()=>this.deviceArtwork(device),'历史数据'):message ? element('div', 'sensor-history-placeholder', message) : historyChart(slots, unit, precision));
      card.append(entry);
    }
    const more = button('查看更多', 'sensor-history-more', () => this.selectHistoryDetail({ period: 'day', date: dateKey(new Date()) }));
    more.disabled = this.historyError?.retryable === false;
    card.setAttribute('aria-description','显示最近24小时的云端记录；暂不含蓝牙设备内历史。');
    card.setAttribute('aria-description',(card.getAttribute('aria-description')??''));card.append(more);
    view.append(hero, card);
    for (const message of this.sensorHistory?.warnings ?? []) view.append(element('p', 'sensor-history-warning', message));
    return view;
  }

  private renderOutletPage(device: Device): HTMLElement {
    const view = element('div', 'outlet-page-content');
    view.append(productHeader(this.deviceArtwork(device,'',1,true),device.name,'outlet-hero'));
    const channels = switchServices(this.panel);
    const card = element('section', 'native-card outlet-channels', element('div', 'native-card-heading', '电源'));
    for (const service of channels) {
      const property = service.properties.find(p => p.name === 'on' && p.format === 'bool');
      const row = element('div', 'outlet-channel', this.deviceArtwork(device), element('strong', '', channels.length === 1 ? '开关' : deviceServiceLabel(service)));
      row.append(this.control({ name: 'Power', props: { property, label: channels.length === 1 ? device.name : service.description, style: 'round' } }, device));
      if (property?.lastReported) {const description=reportedValueText(property);if(description){row.setAttribute('aria-description',description);row.setAttribute('aria-description',description);row.dataset.readingSource='reported';}}
      card.append(row);
    }
    view.append(card);
    if(energySupported(device,this.panel)){
      view.append(energyEntrance(this.energyData,this.panel,()=>this.loadEnergy({period:'week',date:dateKey(new Date())}),this.energyLoading));
      if(this.energyError)view.append(notice({tone:'warning',title:this.energyError.message}));
      return view;
    }
    const power = findProperty(this.panel, ['power-consumption'], ['electric-power']);
    const consumption = findProperty(this.panel, ['power-consumption'], ['power-consumption']);
    if(power||consumption)view.append(energyEntrance(undefined,this.panel,undefined,false));
    view.append(this.nativeUnavailableFeature('用电统计', 'device', '暂不支持查看用电历史统计。'));
    return view;
  }

  private renderStandardFanPage(device: Device): HTMLElement {
    const on = findProperty(this.panel, ['fan'], ['on']); const state = booleanValue(on);
    const mode = findProperty(this.panel, ['fan'], ['mode']);
    const current = isReadableValue(mode) ? mode.valueList?.find(choice => JSON.stringify(choice.value) === JSON.stringify(mode.value)) : undefined;
    const view = element('div', `p69-fan-content${state !== true ? ' device-is-off' : ''}`);
    view.append(element('div', 'p69-fan-hero', element('h1', '', current ? fanModeLabel(current.description) : state === undefined ? '未读取' : state ? '运行中' : '关机')));
    const disabledReason = state !== true ? '风扇开启后可调节。' : undefined;
    const items: ControlNode[] = [{ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开启', closeLabel: '关闭' } }];
    if (mode) items.push({ name: 'Selector', props: { property: mode, label: '模式', style: 'standard', choiceLabel: fanModeLabel, choiceIcon: description => /natural|自然/i.test(description) ? 'leaf' : /sleep|睡眠/i.test(description) ? 'moon' : 'wind', disabledReason } });
    const gear = fanSpeedProperty(this.panel, 'gear');
    const stepless = fanSpeedProperty(this.panel, 'stepless');
    if (gear) items.push(gear.valueList!.length <= 4 ? { name: 'Selector', props: { property: gear, label: '风速档位', style: 'standard', showValue: true, choiceLabel: description => description.replace(/^Level\s*(\d+)$/i, '$1档'), choiceSymbol: description => description.replace(/^Level\s*(\d+)$/i, '$1'), disabledReason } } : { name: 'Slider', props: { property: gear, label: '风速档位', theme: 'fan', discrete: true, disabledReason } });
    if (!gear&&stepless) items.push({ name: 'Slider', props: { property: stepless, label: '无级调速', theme: 'fan', disabledReason } });
    const controls = this.control({ name: 'Container', props: {}, items }, device);
    for (const [name, label, direction] of [['horizontal-swing', '左右摆风', 'horizontal'], ['vertical-swing', '上下摆风', 'vertical']] as const) {
      const property = findProperty(this.panel, ['fan'], [name]);
      if (property) controls.append(this.nativeP69Swing(property, findProperty(this.panel, ['fan'], [name + '-included-angle']), label, direction, device, state !== true));
    }
    view.append(controls);
    return view;
  }

}

setupDesktopFrame();
void new App().start();
