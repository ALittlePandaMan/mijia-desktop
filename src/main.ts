import {dropdownSelect,dropdownMenu,hasOpenDropdown} from './ui/dropdown';
import {backgroundWork,monitorInBackground,ResourceRevisions,setVisualWorkPaused,type ResourceState} from './background-work';
import {preferredHome,rememberHome} from './home-selection';
import {showToast} from './ui/toast';
import {listenResourceState} from './resource-events';
import {IdentityIndex} from './identity-index';
import {notice,type Notice} from './ui/notice';
import {curtainView} from './ui/curtain-view';
import {deviceCardView} from './ui/device-card-view';
import {updateCardControls} from './ui/card-controls';
import {CardControlSession} from './card-control-session';
import {SwitchGroupSession} from './switch-group-session';
import {confirmGroupCaption,projectCardStatus,retainConfirmedStatus} from './home-card-display';
import type {DisplayIntent} from './local-display-intent';
import type {UiSubmission,UiReadbackFailure} from './ui-control-events';
import type {CardControlResult} from './types';
import {desktopWidgets,WidgetRevisions,externalIntentSupersedes,type WidgetSupport,type WidgetView} from './desktop-widgets';
import {deviceArtwork as renderDeviceArtwork} from './ui/device-artwork';
import * as sharedDeviceViews from './ui/device-presenters';
import {monitorEligible} from './monitor';
import {MonitorCatalogController,selectedMonitorMembers} from './monitor-catalog';
import {ApplicationSettingsController} from './ui/application-settings';
import {showAppUpdateResult} from './ui/app-update-result';
import {isTauri,invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {nativeFullscreen,adoptFullscreen,setNativeFullscreen} from './desktop-fullscreen';
import {dismissOnBackdrop} from './ui/dialog-dismiss';
import {DeviceEventsState} from './device-events';
import {ScaleState,isScale} from './scale';
import {ScalePage} from './ui/scale-page';
import {renderDeviceEvents} from './ui/device-events';
import {deviceSurfaces} from './ui/device-surfaces';
import type {CameraPlayer} from './camera-player';
import {cameraPageEligible} from './camera-eligibility';
import {loginPage} from './ui/login-page';
import {IrRemoteState,isIrRemote} from './ir-remote';
import {irRemotePage} from './ui/ir-remote-page';
import {televisionPage} from './ui/television-page';
import {televisionPageEligible,type TelevisionRole} from './television';
import {VacuumState,vacuumModel} from './vacuum';
import {vacuumPage} from './ui/vacuum-page';
import {CurtainMotion} from './curtain-motion';
import {dailyActionLabel,dailyPanel} from './daily-scope';
import { capabilityCategory,resolveDeviceCapabilities,hasCapabilityCategory } from './device-capabilities';
import { renderCategoryPage } from './ui/category-page';
import {speakerPage} from './ui/speaker-page';
import {speakerMetadataSupported,SpeakerState} from './speaker';
import {BathHeaterState,bathHeaterModel} from './bath-heater';
import {bathHeaterPage} from './ui/bath-heater-page';
import {CeilingFanState,ceilingFanModel} from './ceiling-fan';
import {FryerState,fryerModel,type FryerView} from './fryer';
import {fryerPage} from './ui/fryer-page';
import {ceilingFanPage} from './ui/ceiling-fan-page';
import {DoorbellState,isCloudDoorbell,doorbellBattery} from './doorbell';
import {doorbellPage} from './ui/doorbell-page';
import type {DoorbellPlayer} from './doorbell-player';
import {DevicePresentationRoute,dedicatedPage,presentationReady,PRESENTATION_VERSION} from './device-presentation-route';
import {deviceChoiceLabel,devicePropertyLabel} from './device-labels';
import './style.css';
import './login.css';
import './theme.css';
import './ui/quiet-feedback.css';
import { api } from './api';
import { PropertyOperations,type PropertyReply } from './property-operations';
import {cardActive,cardCaption,cardDisplay,cardReportedIntent} from './home-cards';
import {RouterState,routerModel} from './router';
import {routerPage} from './ui/router-page';
import {updateHomeShortcut} from './ui/home-shortcut';
import type {HomeCardEntry,HomeCardIntent,HomeCardReport} from './types';
import { CountdownOperation } from './countdown-operation';
import { icon, officialIcon, type IconName } from './icons';
import { orderedRooms, visibleHomeDevices } from './home-order';
import { cardSizeForRoom, localDevices, mergeVisibleOrder, PreferenceOperations, type PreferenceChange } from './local-preferences';
import {settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView} from './ui/settings-page';
import type {MonitorWall} from './ui/monitor-wall';
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
import { sizeDeviceGrid } from './ui/device-grid';
import {cardSizeMenu,cardMenuKeys,showLargeCardChoice} from './ui/card-size-menu';
import type {CardSize} from './card-size';
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
import { dateKey } from './history';
import { coercePropertyInput, displayValue, initialInput, inputUnsupportedReason, isSessionError, normalizeError, reportedValueText, sameContext, writeUnsupportedReason } from './logic';
import { booleanValue, controlReason, fanModeLabel, fanSpeedProperty, findProperty, isReadableValue, numericValue, hasObservedDeviceLayout, miotCategory, panelLayout, propertyReading, splitChildren } from './panel-layout';
import {HomeScenesState} from './home-scenes';
import {HomeScenesView,sceneShortcuts,sizeSceneShortcuts} from './ui/home-scenes-page';
import {visibleSceneShortcuts,addSceneShortcuts,removeSceneShortcuts,type SceneShortcutLayout} from './scene-shortcut-preferences';
import {sceneShortcutPicker,updateSceneShortcutPicker} from './ui/scene-shortcut-picker';
import type { Action, AppError, Device, DeviceContext, DevicePanel, Home, HomeSnapshot, Json, Property, QrView, Service, SessionView, SensorHistory, HistorySelection } from './types';

import { button, element } from './ui/dom';
import {enter,leave} from './ui/motion';
import { deviceLoading } from './ui/device-loading';
import { preserveDeviceArtwork } from './ui/preserve-device-artwork';
import {lightControlBindings,rgbPropertyReason,type LightColorTab} from './light-color';
import type {AccountProfile} from './types';
import { renderControl, type ControlNode } from './ui/controls';
import { compilePanelDocument as compileFullPanelDocument, type ComponentNode, type DeviceUiResources, type PanelDocument } from './ui-schema';
import { renderPanelDocument } from './ui/schema-renderer';
import type { PanelLayout } from './panel-layout';
import { disposeHistoryCharts } from './ui/history-chart';
import {setCurveMotionScope} from './ui/curve-motion';
import { renderHistoryDetail } from './ui/history-detail';
import { energySupported } from './energy';
import { renderEnergyPage } from './ui/energy-page';
import type { EnergyReport,EnergySelection } from './types';
import type { TimerReport,TimerDraft,TimerEntry,TimerMode,TimerChange,CountdownChange } from './types';
import { timerDraft,timerDraftProblem } from './timers';
import { renderTimerPage,type TimerModal } from './ui/timer-page';
import { durationDialog } from './ui/countdown';
import { countdownUpdate,type CountdownDraft } from './countdown';
type LoginState = 'idle' | 'loading' | 'ready' | 'expired' | 'error';
interface PendingAction { action: Action; service: Service; inputs: Json[] }
interface CardArrangement { sizes:Record<string,CardSize>; homeId: string; generation: number; roomId: string; original: string[]; order: string[]; all: string[]; selected: Set<string>; sceneOriginal:string[];sceneOrder:string[];sceneHidden:string[];sceneSelected:Set<string> }

function loading(label: string): HTMLElement {
  return deviceLoading(element('span','device-artwork',icon('device')),label,true);
}


function emptyState(title: string, message: string, iconName: IconName | null = 'device'): HTMLElement {
  return element('div', 'empty-state', iconName ? element('div', 'empty-icon', icon(iconName)) : null, element('h3', '', title), element('p', '', message));
}

const regions: [string, string][] = [
  ['cn', '中国大陆'], ['de', '欧洲'], ['us', '美国'], ['ru', '俄罗斯'],
  ['tw', '中国台湾'], ['sg', '新加坡'], ['in', '印度'], ['i2', '印度（i2）'],
];

const compilePanelDocument=(options:Parameters<typeof compileFullPanelDocument>[0])=>compileFullPanelDocument({...options,panel:dailyPanel(options.panel)});

interface CardPresentationState {scope:string;sessions:Map<string,CardControlSession>;observed:Set<HTMLElement>;visible:Set<HTMLElement>;observer?:IntersectionObserver;timer?:ReturnType<typeof setTimeout>;requestKey:string;pending:boolean;again:boolean}
export class App {
  private readonly transport: typeof api;
  private readonly root: HTMLElement;
  private readonly preview?: { root: HTMLElement; transport: typeof api; close: () => void };

  constructor(preview?: App['preview']) {
    this.preview = preview;
    this.transport = preview?.transport ?? api;
    this.root = preview?.root ?? document.querySelector<HTMLDivElement>('#app')!;
    this.washerRuntimeCommands = new WasherRuntimeCommands({action:this.transport.runAction,write:this.transport.setProperty,read:this.transport.readProperties},()=>{if(this.context)this.render(true);},(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;}},error=>this.handleSessionError(error));
    this.washerCommands = new WasherCommands({preview:this.transport.washerProgramPreview,start:this.transport.startWasherProgram,confirm:this.transport.confirmWasherProgram},()=>{const program=this.washerView==='program';if(this.washerCommands.result?.status==='confirmed'){this.washerOrderAt=undefined;if(program&&this.panel?.washerRuntime?.active){this.washerView='home';this.washerDraft=undefined;}}if(this.context&&(program||this.washerView==='runtime'))this.render(true);},panel=>{if(this.context?.did===panel.did){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;}},error=>this.handleSessionError(error));
    this.washerRecords = new WasherRecords({records:this.transport.washerRecords,detail:this.transport.washerRecordDetail},()=>{if(this.context&&this.washerView==='records')this.render(true);},error=>this.handleSessionError(error));
    this.scenes = new HomeScenesState({list:this.transport.homeScenes,run:this.transport.runHomeScene,panel:this.transport.devicePanel,history:this.transport.sensorHistory,write:(device,intent)=>this.writeSceneDevice(device,intent),refresh:()=>this.refreshVisibleState()},()=>this.updateHomeScenes(),error=>this.handleSessionError(error));
    this.router = new RouterState(this.transport.routerOverview,()=>{if(this.context)this.render(true);},error=>this.handleSessionError(error));
    this.speaker = new SpeakerState({read:this.transport.speakerPlayer,change:this.transport.changeSpeaker},()=>{if(speakerMetadataSupported(this.currentDevice()?.model??''))this.render(true);},e=>this.handleSessionError(e));
    this.bathHeater = new BathHeaterState({read:this.transport.bathHeater,change:this.transport.changeBathHeater},()=>{if(this.currentDevice()?.model===bathHeaterModel)this.render(true)},e=>this.handleSessionError(e));
    this.fryer = new FryerState({read:this.transport.fryer,change:this.transport.changeFryer},()=>{if(this.currentDevice()?.model===fryerModel&&!this.fryerView.picker&&!this.fryerView.confirmation)this.render(true);},e=>this.handleSessionError(e));
    this.ceilingFan = new CeilingFanState({read:this.transport.ceilingFan,change:this.transport.changeCeilingFan},()=>{if(this.currentDevice()?.model===ceilingFanModel)this.render(true)},e=>this.handleSessionError(e));
    this.vacuum = new VacuumState({read:this.transport.vacuum,readMap:this.transport.vacuumMap,change:this.transport.changeVacuum},()=>{if(!this.vacuum.loading)this.deviceOpening.ready();if(this.currentDevice()?.model===vacuumModel)this.render(true);},e=>this.handleSessionError(e));
    this.doorbell = new DoorbellState(this.transport.doorbellCloud,()=>{if(isCloudDoorbell(this.currentDevice()?.model??''))this.render(true)},e=>this.handleSessionError(e),this.transport.cameraCareThumbnail);
    this.deviceEvents = new DeviceEventsState(this.transport.deviceEvents,()=>this.render(true));
    this.purifierDnd = new PurifierDnd({read:this.transport.purifierDnd,save:this.transport.changePurifierDnd},()=>this.render(true),error=>{this.handleSessionError(error);});
    this.purifierOptions = new PurifierOptions({read:this.transport.purifierOptions,save:this.transport.changePurifierPush},()=>this.render(true),error=>{this.handleSessionError(error);});
    this.dispenserHistory = new DispenserHistory({records:this.transport.dispenserRecords,statistics:this.transport.dispenserStatistics},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
    this.dispenserReminders = new DispenserReminders({read:this.transport.dispenserReminders,save:this.transport.changeDispenserReminder},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
    this.dispenserSelfCheck = new DispenserSelfCheck({run:this.transport.dispenserSelfCheck,confirm:this.transport.confirmDispenserSelfCheck,history:this.transport.dispenserSelfCheckRecords},()=>{if(this.dispenserView.page==='selfcheck'&&this.dispenserSelfCheck.selected?.time===0)this.dispenserView={page:'selfcheck-report'};this.render(true);},(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.dispenserSterilization = new DispenserSterilization({run:this.transport.dispenserSterilization,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.dispenserDnd = new DispenserDnd({read:this.transport.dispenserDnd,save:this.transport.changeDispenserDnd},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
    this.dispenserCommands = new DispenserCommands({change:this.transport.changeDispenser,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.fridgeCommands = new FridgeCommands({change:this.transport.changeFridge,reset:this.transport.resetFridge,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    this.airerCommands = new AirerCommands({lift:this.transport.airerLift,night:this.transport.saveAirerNight,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    this.purifierHistory = new PurifierHistory({records:this.transport.purifierRecords,statistics:this.transport.purifierStatistics},()=>this.render(true),error=>{this.handleSessionError(error);});
    this.purifierCommands = new PurifierCommands({save:this.transport.savePurifierCups,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    this.irRemote = new IrRemoteState({read:this.transport.irRemote,send:this.transport.sendIrKey},()=>{if(!this.irRemote.loading)this.deviceOpening.ready();this.render(true);},e=>this.handleSessionError(e));
    this.scale = new ScaleState({history:this.transport.scaleHistory,change:this.transport.changeScale},()=>{if(!this.scale.loading)this.deviceOpening.ready();this.render(true);},e=>this.handleSessionError(e));
  }

  private createDevicePreview(root: HTMLElement, transport: typeof api, device: Device, generation: number, close: () => void) {
    const app = new App({ root, transport, close });
    app.snapshot = { homeId: 'developer-preview', generation, devices: [device] };
    app.starting = false;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) app.cameraPlayer?.backgroundPause();
      else app.cameraPlayer?.backgroundResume();
    }, { signal: app.lifetime.signal });
    void app.openPanel(device);
    return () => {
      app.disposed = true;
      app.lifetime.abort();
      app.clearPanel();
      app.propertyOps.reset();
      root.replaceChildren();
    };
  }

  private developerMode?: import('./developer-mode').DeveloperMode;
  private developerOpening = false;
  private templateCards?:CardPresentationState;
  private cardPresentationState():CardPresentationState|undefined {
    const snapshot=this.snapshot;if(!snapshot)return;
    const scope=JSON.stringify([this.session?.userId,this.homeEpoch,snapshot.homeId,snapshot.generation]);
    if(this.templateCards?.scope!==scope){
      this.disposeCardPresentations();
      const state:CardPresentationState={scope,sessions:new Map(),observed:new Set(),visible:new Set(),requestKey:'',pending:false,again:false};
      if(typeof IntersectionObserver!=='undefined')state.observer=new IntersectionObserver(entries=>{for(const e of entries){const n=e.target as HTMLElement;if(e.isIntersecting)state.visible.add(n);else state.visible.delete(n);}this.scheduleCardPresentations();},{threshold:.01});
      this.templateCards=state;
    }
    return this.templateCards;
  }
  private disposeCardPresentations():void {
    for(const session of this.switchGroups?.values()??[])session.dispose();this.switchGroups?.clear();
    const state=this.templateCards;if(!state)return;clearTimeout(state.timer);state.observer?.disconnect();for(const session of state.sessions.values())session.dispose();this.templateCards=undefined;
  }
  private templateSession(device:Device):CardControlSession|undefined {
    const state=this.cardPresentationState(),snapshot=this.snapshot;if(!state||!snapshot)return;
    let session=state.sessions.get(device.did);
    if(!session){const context={homeId:snapshot.homeId,generation:snapshot.generation,did:device.did};
      session=new CardControlSession(async change=>{try{const result=await this.transport.homeCardControl(context,change);if(this.templateCards!==state)throw {kind:'staleContext',message:'家庭已经切换。'};this.acceptCardPresentationResult(result);return result;}catch(error){if(this.templateCards===state){const failure=normalizeError(error);this.handleSessionError(failure);if(['staleContext','stateSuperseded'].includes(failure.kind))this.scheduleCardPresentations(true);}throw error;}},()=>this.updateCardPresentationViews());
      session.setActive(false);state.sessions.set(device.did,session);
    }
    session.setAccess(device.online&&!device.sharedReadOnly,device.online);
    session.setExternalIntents(this.cardPropertyIntents(device.did));return session;
  }
  private trackCardPresentation(card:HTMLElement):void {
    const state=this.cardPresentationState();if(!state)return;state.observed.add(card);if(state.observer)state.observer.observe(card);else state.visible.add(card);this.scheduleCardPresentations();
  }
  private scheduleCardPresentations(force=false):void {
    const state=this.templateCards;if(!state)return;if(force)state.requestKey='';clearTimeout(state.timer);state.timer=setTimeout(()=>void this.refreshCardPresentations(state),50);
  }
  private async refreshCardPresentations(state:CardPresentationState):Promise<void>{
    if(this.templateCards!==state||this.disposed)return;
    for(const card of state.observed)if(!card.isConnected){state.observer?.unobserve(card);state.observed.delete(card);state.visible.delete(card);}
    const ids=this.context||this.settingsOpen||this.accountOpen||this.workPaused||!this.root.querySelector('.home-screen .device-grid')?[]:[...new Set([...state.visible].filter(c=>c.isConnected&&c.dataset.cardSize==='large').map(c=>c.dataset.deviceId!))].sort();
    for(const [did,session]of state.sessions){session.setActive(ids.includes(did)&&!this.arrangement&&!this.drag.active);if(![...state.observed].some(c=>c.dataset.deviceId===did)&&!session.pendingCount){session.dispose();state.sessions.delete(did);}}
    for(const[did,session]of this.switchGroups??[])session.setActive(!this.workPaused&&!this.context&&!this.settingsOpen&&[...state.visible].some(c=>c.isConnected&&c.dataset.deviceId===did));
    this.updateCardPresentationViews();
    const snapshot=this.snapshot,key=JSON.stringify(ids);if(!snapshot||!ids.length){state.requestKey=key;return;}if(state.requestKey===key)return;
    if(state.pending){state.again=true;return;}state.pending=true;state.requestKey=key;
    try{const values=await this.transport.homeCardPresentations(snapshot.homeId,snapshot.generation,ids);if(this.templateCards!==state)return;
      const updates=new Map(values.map(p=>[p.did,p]));
      for(const did of ids){const device=this.deviceIndex.find(this.snapshot?.devices,did);if(!device)continue;
        const session=this.templateSession(device),update=updates.get(did);if(update)session?.acceptUpdate(update);else session?.unavailable();
      }
      this.updateCardPresentationViews();
    }catch(error){if(this.templateCards===state){for(const id of ids)state.sessions.get(id)?.unavailable();this.handleSessionError(normalizeError(error));this.updateCardPresentationViews();}}
    finally{state.pending=false;if(state.again&&this.templateCards===state){state.again=false;this.scheduleCardPresentations();}}
  }
  private updateCardPresentationViews():void{
    const state=this.templateCards;if(!state||this.workPaused)return;
    if(this.drag.active||this.sceneDrag.active){this.deferredRender=true;return;}
    for(const card of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
      const device=this.deviceIndex.find(this.snapshot?.devices,card.dataset.deviceId);if(!device)continue;const session=state.sessions.get(device.did);
      session?.setAccess(device.online&&!device.sharedReadOnly,device.online);
      session?.setExternalIntents(this.cardPropertyIntents(device.did));
      updateCardControls(card,session?.presentation,(id,value)=>session?.write(id,value),!this.arrangement&&!this.drag.active);
      const caption=card.querySelector('.device-room'),text=this.deviceCardCaption(device);if(caption&&caption.textContent!==text)caption.textContent=text;
    }
  }
  private acceptCardPresentationResult(result:CardControlResult):void {
    if(this.snapshot?.homeId!==result.homeId||!this.snapshot.devices.some(d=>d.did===result.did))return;
    if(result.submitted){this.templateCards?.sessions.get(result.did)?.receive(result);return;}
    if(result.confirmation){this.templateCards?.sessions.get(result.did)?.receive(result);this.updateCardPresentationViews();return;}
    const session=this.templateCards?.sessions.get(result.did);if(session&&!session.accept(result.presentation??undefined))return;
    this.acceptDesktopCard(result.did,result.card,result.status);this.homeCardChanged();this.updateCardPresentationViews();
  }
  private switchGroups=new Map<string,SwitchGroupSession>();
  private switchGroupSession(card:HomeCardEntry):SwitchGroupSession|undefined{
    if(!card.group||!this.snapshot)return;this.switchGroups??=new Map();let session=this.switchGroups.get(card.did);
    if(!session){const context={homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:card.did},epoch=this.homeEpoch;session=new SwitchGroupSession(async(groupId,on,requestId,confirmOnly)=>{if(epoch!==this.homeEpoch)throw{kind:'staleContext'};return this.transport.changeSwitchGroup(context,groupId,on,requestId,confirmOnly);},()=>this.homeCardChanged(),card=>this.applyGroupCaption(card));this.switchGroups.set(card.did,session);}
    session.accept(card);return session;
  }
  private acceptSwitchGroupResult(result:import('./types').SwitchGroupResult):void{
    if(this.snapshot?.homeId!==result.homeId||!this.snapshot.devices.some(d=>d.did===result.card.did))return;
    if(result.readback)this.applyGroupCaption(result.card);
    this.switchGroupSession(result.card)?.receive(result);
  }
  private applyGroupCaption(card:HomeCardEntry):void{
    const previous=this.homeCards?.statuses?.find(status=>status.did===card.did),status=confirmGroupCaption(previous,card);
    if(status===previous||!status||!this.homeCards)return;
    this.homeCards={...this.homeCards,cards:[...this.homeCards.cards.filter(entry=>entry.did!==card.did),card],statuses:[...(this.homeCards.statuses??[]).filter(entry=>entry.did!==card.did),status]};
  }
  private acceptUiSubmission(event:UiSubmission):void{
    if(!this.snapshot||this.snapshot.homeId!==event.homeId||this.session?.userId!==event.userId||this.session.region!==event.region)return;
    for(const did of event.dids){const device=this.snapshot.devices.find(d=>d.did===did);if(!device)continue;this.templateCards?.sessions.get(did)?.reflect(event.controlIds,event.value,event.sequence);
      const raw=this.homeCards?.cards.find(c=>c.did===did);if(raw?.group)this.switchGroupSession(raw)?.reflect(`${event.siid}:${event.piid}`,event.value===true||event.value===1,event.sequence);
      const property=this.confirmedPanels.get(did)?.services.flatMap(s=>s.properties).find(p=>p.siid===event.siid&&p.piid===event.piid);
      if(property||raw&&!raw.group&&raw.binding.siid===event.siid&&raw.binding.piid===event.piid){const key=this.operationKey(did,event.siid,event.piid);this.propertyContexts.set(key,{context:{homeId:event.homeId,generation:this.snapshot.generation,did},homeEpoch:this.homeEpoch});this.propertyOps.reflect(key,property?event.value:event.value===true||event.value===1,property?.value??raw?.selected??null,event.sequence,property?this.propertyDependencies(did,property):[]);}
    }
  }
  private acceptUiReadbackFailure(event:UiReadbackFailure):void{if(this.snapshot?.homeId!==event.homeId||this.session?.userId!==event.userId||this.session.region!==event.region)return;for(const did of event.dids)for(const field of event.fields){const[siid,piid]=field.id.split(':').map(Number);this.propertyOps.rejectNative(this.operationKey(did,siid,piid),field.sequence);this.templateCards?.sessions.get(did)?.rejectNative(field.id,field.sequence);this.switchGroups?.get(did)?.rejectNative(field.id,field.sequence);}}
  private widgetSupport:WidgetSupport={supported:false,reason:null,pins:[]};
  private widgetRevisions=new WidgetRevisions();
  private widgetIntents=new Map<string,HomeCardIntent>();
  private async refreshWidgetSupport():Promise<void>{try{this.widgetSupport=await desktopWidgets.support();}catch{this.widgetSupport={supported:false,reason:null,pins:[]};}}
  private acceptWidget(view:WidgetView):void{
    if(view.homeId!==this.snapshot?.homeId||!view.device||!this.widgetRevisions.accept(view.homeId,view.device.did,view.revision))return;
    if(view.pending)this.acceptForeignCardIntent(view.device.did,view.pending,view.origin);
    if(view.pending)this.widgetIntents.set(view.device.did,view.pending);else this.widgetIntents.delete(view.device.did);
    this.acceptDesktopCard(view.device.did,view.card,view.status);this.homeCardChanged();
  }
  private acceptForeignCardIntent(did:string,intent:HomeCardIntent,origin?:string|null):void{
    if(externalIntentSupersedes('main',origin,intent,this.homeCardOps.get(did)?.target))this.homeCardOps.cancel(did,false);
    const card=this.homeCards?.cards.find(c=>c.did===did);if(!card)return;
    const key=this.operationKey(did,card.binding.siid,card.binding.piid);
    if(externalIntentSupersedes('main',origin,intent,this.propertyOps.get(key)?.target))this.propertyOps.cancel(key,false);
  }
  private acceptDesktopCard(did:string,card:HomeCardEntry|null|undefined,status:import('./types').HomeCardStatus|null|undefined):void{
    if(!this.homeCards)return;
    const previous=this.homeCards.statuses?.find(s=>s.did===did);
    if(status?.revision!=null&&previous?.revision!=null&&status.revision<previous.revision)return;
    if(card)this.homeCards={...this.homeCards,cards:[...this.homeCards.cards.filter(c=>c.did!==did),card]};
    if(status)this.homeCards={...this.homeCards,statuses:[...(this.homeCards.statuses??[]).filter(s=>s.did!==did),retainConfirmedStatus(previous,status)]};
  }
  private async openDesktopWidget(homeId:string,did:string):Promise<void>{
    this.startupIntent='cancelled';this.closeDeviceMenu();this.clearPanel();this.settingsOpen=false;this.accountOpen=false;
    if(this.selectedHomeId!==homeId||!this.snapshot){if(!this.homes.some(h=>h.id===homeId))await this.loadHomes();if(!this.homes.some(h=>h.id===homeId))return;await this.selectHome(homeId);}
    if(this.snapshot?.homeId!==homeId)return;const device=this.snapshot.devices.find(d=>d.did===did);if(device)await this.openPanel(device);
  }
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
  private washerRuntimeCommands:WasherRuntimeCommands;
  private washerCommands:WasherCommands;
  private washerRecords:WasherRecords;

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
  private homeContentLoading = false;
  private homeError: AppError | undefined;
  private selectedHomeId = '';
  private snapshot: HomeSnapshot | undefined;
  private homeEpoch = 0;
  private homeCards:HomeCardReport|undefined;
  private scenesView=new HomeScenesView();
  private scenes:HomeScenesState;
  private router:RouterState;
  
  
  
  
  
  
  
  
  
  
  
  
  private homeCardsReadVersion=0;
  private homeCardNoticeRevision=0;
  private homeCardsRequest:{homeId:string;generation:number;promise:Promise<void>}|undefined;
  private homeCardOps=new PropertyOperations((key,value)=>this.homeCardRequest(key,value,false),(key,value)=>this.homeCardRequest(key,value,true),()=>this.homeCardChanged());
  private homeBusy = false;
  private roomId = '*';
  private context: DeviceContext | undefined;
  private panel: DevicePanel | undefined;
  private speaker:SpeakerState;
  private bathHeater:BathHeaterState;
  private fryerView:FryerView={};
  private fryer:FryerState;
  private ceilingFan:CeilingFanState;
  private curtainMotion=new CurtainMotion();
  private curtainMotions=new Map<string,CurtainMotion>();
  private vacuum:VacuumState;
  private doorbell:DoorbellState;
  private doorbellPlayer?:DoorbellPlayer;
  private uiResources: DeviceUiResources | undefined;
  private uiResourcesRequest: { epoch: number; promise: Promise<void> } | undefined;
  private uiResourcesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private uiResourcesRefreshAttempts = 0;
  private uiResourcesError: string | undefined;
  private panelLoading = false;
  private deviceEvents:DeviceEventsState;
  private deviceDataPresented = false;
  private panelError: AppError | undefined;
  private purifierView:PurifierView=newPurifierView();
  private purifierDnd:PurifierDnd;
  private purifierOptions:PurifierOptions;
  private purifierGuide:ReturnType<typeof purifierGuidePage>|undefined;
  private airerView:AirerView={page:'home'};
  private fridgeView:FridgeView={page:'home'};
  private dispenserView:DispenserView={page:'home'};
  private dispenserHistory:DispenserHistory;
  private dispenserHistoryPicker:PurifierCalendar|undefined;
  private dispenserReminderView:ReminderView={page:'settings'};
  private dispenserReminders:DispenserReminders;
  private dispenserSelfCheck:DispenserSelfCheck;
  private dispenserSterilization:DispenserSterilization;
  private dispenserDnd:DispenserDnd;
  private dispenserCommands:DispenserCommands;
  private fridgeCommands:FridgeCommands;
  private airerCommands:AirerCommands;
  private purifierHistory:PurifierHistory;
  private purifierHistoryPicker:PurifierCalendar|undefined;
  private purifierCommands:PurifierCommands;
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
  private cameraPlayer?:CameraPlayer;
  private mediaPageLoad?:{kind:'camera'|'doorbell';epoch:number;failed:boolean};
  private loadMediaDrawer(kind:'camera'|'doorbell',device:Device):HTMLElement{
    const epoch=this.panelEpoch;
    let load=this.mediaPageLoad;
    const start=()=>{
      const pending={kind,epoch,failed:false};this.mediaPageLoad=pending;
      const current=()=>!this.disposed&&this.panelEpoch===epoch&&this.mediaPageLoad===pending;
      void (kind==='camera'?import('./camera-player').then(({CameraPlayer})=>{
        if(current())this.cameraPlayer=new CameraPlayer(()=>{if(isCloudDoorbell(this.currentDevice()?.model??'')&&this.doorbell.view==='live'){this.cameraPlayer?.dispose();this.doorbell.view='events';this.render(true);}else this.closePanel();}, this.transport);
      }):import('./doorbell-player').then(({DoorbellPlayer})=>{
        if(current())this.doorbellPlayer=new DoorbellPlayer(()=>{this.doorbell.view='events';this.render(true);}, this.transport);
      })).then(()=>{if(current()){this.mediaPageLoad=undefined;this.render(true);}},()=>{if(current()){pending.failed=true;this.render(true);}});
      return pending;
    };
    if(load?.kind!==kind||load.epoch!==epoch)load=start();
    const stage=element('div','device-stage'),page=element('section','device-page device-page-loading');
    page.append(button('返回','button',()=>this.closePanel()),element('h2','',device.name),
      load.failed?button('重新加载','button',()=>{start();this.render(true);}):loading('正在加载视频…'));
    stage.append(page);return stage;
  }
  private controlBusy = false;
  private panelIsCached=false;
  private panelCachedAt:number|null=null;
  private panelHasCachedState=false;
  private lightTab: LightColorTab | undefined;
  private operationNoticeRevision=0;
  private propertyOps=new PropertyOperations((key,value)=>this.propertyRequest(key,value,false),(key,value)=>this.propertyRequest(key,value,true),()=>this.propertyOperationChanged());
  private confirmedPanels=new Map<string,DevicePanel>();
  private confirmedPanelVersions=new Map<string,number>();
  private homeCardsPropertyReadVersion=0;
  private propertyContexts=new Map<string,{context:DeviceContext;homeEpoch:number;homePower?:boolean;homeCamera?:boolean;homeCurtain?:boolean}>();
  private deviceSends=new Map<string,Promise<void>>();
  
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
  private application=new ApplicationSettingsController(()=>{this.render();});
  private startupIntent:'pending'|'done'|'cancelled'='pending';private startupRetry?:ReturnType<typeof setTimeout>;private inBackground=false;private startupForced=false;
  private settingsOpen = false;
  private settingsView=createSettingsViewState();
  private monitorSettingsReturn?:typeof this.settingsView;
  private monitorRunning=false;private monitorAllActive=false;private monitorStartEpoch=0;
  private monitorCatalog=new MonitorCatalogController(()=>this.render());
  private monitorExitLatch=false;private suppressStartupMonitor=false;
  private monitorMinimized=false;
  private monitorWall?:MonitorWall;
  private monitorModule?:typeof import('./ui/monitor-wall');
  private preferencesLoading = false;
  private preferencesError: AppError | undefined;
  private preferences = new PreferenceOperations(change => {
    const snapshot = this.snapshot;
    if (!snapshot) return Promise.reject({kind:'staleContext',message:'家庭已切换。'});
    return this.transport.changeHomePreferences(snapshot.homeId, snapshot.generation, change);
  }, change => this.preferenceChanged(change));
  private homeScrollTop = 0;
  private navigationKey='';
  private popupKey='';
  private motionFromInteraction=false;
  private homeCardBindings=new WeakMap<HTMLElement,string>();
  private roomsScrollLeft = 0;
  private deviceMenu: { did: string; x: number; y: number;kind?:'scene'; large?:boolean } | undefined;
  private scenePicker:HTMLDialogElement|undefined;
  private deferredRender = false;
  private arrangement: CardArrangement | undefined;
  private cardPress = new CardPress();
  private drag = new DeviceDrag({begin:(id,pointerDrag)=>this.beginArrangement(id,undefined,pointerDrag),preview:ids=>{if(this.arrangement)this.arrangement.order=ids;},ended:()=>this.finishCardDrag(),arranging:()=>!!this.arrangement,order:()=>this.arrangement?.order??this.filteredDevices().map(d=>d.did)});
  private sceneDrag=new DeviceDrag({begin:id=>this.beginSceneArrangement(id),preview:ids=>{if(this.arrangement)this.arrangement.sceneOrder=ids;},ended:()=>this.finishCardDrag(),arranging:()=>!!this.arrangement},{grid:'.scene-shortcuts',card:'.scene-task',id:'sceneId'});
  private finishCardDrag():void{
    if(this.drag.active||this.sceneDrag.active)return;
    if(this.arrangement&&this.deferArrangeShortcuts)this.updateArrangementChrome();
    if(!this.deferredRender)return;
    if(this.arrangement)this.homeCardChanged();else this.render();
  }
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
    if (this.preview) return;
    this.render();
    // Start the two independent local reads while native event listeners bind.
    const sessionRead=this.transport.session().then(session=>({session}),error=>({error}));
    const applicationRead=isTauri()?this.application.load():undefined;
    window.addEventListener('pagehide',()=>{
      this.developerMode?.dispose();
      this.disposed=true;this.disposeCardPresentations();this.lifetime.abort();++this.loginEpoch;++this.homeEpoch;
      for(const timer of [this.loginTimer,this.homeRefreshTimer,this.panelRefreshTimer,this.stateTimer,this.idleHeartbeat,this.startupRetry,this.uiResourcesRefreshTimer])clearTimeout(timer);
      this.monitorWall?.close();this.clearPanel();this.resetLocalView();this.devicePreviewCache.clear();disposeHistoryCharts();
    },{once:true});
    if(isTauri()){
      const registered=await Promise.allSettled([
        listen<{fullscreen:boolean;visible:boolean;minimized:boolean}>('desktop-native-state',event=>{adoptFullscreen(event.payload.fullscreen);window.dispatchEvent(new CustomEvent('desktop-window-state',{detail:{minimized:event.payload.minimized||!event.payload.visible}}));}),
        listen<string>('desktop-action',event=>{void this.desktopAction(event.payload);}),
        listen('desktop-widgets-changed',()=>{void this.refreshWidgetSupport();}),
        listen<WidgetView>('desktop-widget-state',event=>this.acceptWidget(event.payload)),
        listen<{homeId:string;did:string}>('desktop-widget-open',event=>{void this.openDesktopWidget(event.payload.homeId,event.payload.did);}),
        listen<CardControlResult>('home-card-presentation',event=>this.acceptCardPresentationResult(event.payload)),
        listen<import('./types').SwitchGroupResult>('switch-group-result',event=>this.acceptSwitchGroupResult(event.payload)),
        listen<UiSubmission>('ui-control-submitted',event=>this.acceptUiSubmission(event.payload)),
        listen<UiReadbackFailure>('ui-control-readback-failed',event=>this.acceptUiReadbackFailure(event.payload)),
        listen<{homeId:string;did:string;intent:HomeCardIntent;revision:number;origin?:string}>('desktop-card-intent',event=>{const v=event.payload;if(v.homeId===this.snapshot?.homeId&&this.widgetRevisions.accept(v.homeId,v.did,v.revision)){this.acceptForeignCardIntent(v.did,v.intent,v.origin);this.widgetIntents.set(v.did,v.intent);this.homeCardChanged();}}),
        listen<{homeId:string;did:string;revision:number;result:import('./types').HomeCardResult|null}>('desktop-card-result',event=>{const v=event.payload;if(v.homeId===this.snapshot?.homeId&&this.widgetRevisions.accept(v.homeId,v.did,v.revision)){this.widgetIntents.delete(v.did);this.acceptDesktopCard(v.did,v.result?.card,v.result?.status);this.homeCardChanged();}}),
        listen('application-settings-changed',()=>{void this.application.load();}),
        listenResourceState('main',state=>this.acceptResourceState(state)),
        listen<import('./application-settings').AppUpdateStatus>('desktop-update-state',event=>{this.application.acceptUpdate(event.payload,this.settingsOpen);}),
      ]);
      const cleanup=()=>{for(const result of registered)if(result.status==='fulfilled')result.value();};
      if(this.disposed){cleanup();return;}
      this.lifetime.signal.addEventListener('abort',cleanup,{once:true});
      void this.refreshWidgetSupport();
      void invoke<ResourceState>('desktop_resource_snapshot').then(state=>this.acceptResourceState(state)).catch(()=>{});
      void showAppUpdateResult();
    }
    document.addEventListener('click',event=>{if(this.startupIntent==='pending'&&this.session?.loggedIn&&(event.target as Element)?.closest('.home-topbar,.room-tabs,.settings-page,.device-card'))this.startupIntent='cancelled';},{capture:true,signal:this.lifetime.signal});
    document.addEventListener('click',()=>{this.motionFromInteraction=true;queueMicrotask(()=>{this.motionFromInteraction=false;});},{capture:true,signal:this.lifetime.signal});
    window.addEventListener('monitor-exit',()=>{if(this.monitorWall?.active)this.exitMonitor();},{signal:this.lifetime.signal});
    window.addEventListener('desktop-window-state',event=>{this.monitorMinimized=!!(event as CustomEvent<{minimized:boolean}>).detail?.minimized;this.syncWindowPolling();},{signal:this.lifetime.signal});
    document.addEventListener('visibilitychange',()=>this.syncWindowPolling(),{signal:this.lifetime.signal});
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(this.monitorWall?.active){event.preventDefault();event.stopImmediatePropagation();if(this.monitorWall.dismissPopup()||this.monitorWall.leaveTileFullscreen())return;if(!document.fullscreenElement&&nativeFullscreen())void setNativeFullscreen(false);else this.monitorWall.handleEscape();}else if(this.cameraPlayer?.stage.isConnected&&this.cameraPlayer.dismissPopup()){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal:this.lifetime.signal});
    window.addEventListener('resize',()=>{this.closeDeviceMenu();this.cardPress.clear();this.drag.cancel();this.sceneDrag.cancel();for(const grid of this.root.querySelectorAll<HTMLElement>('.device-grid'))sizeDeviceGrid(grid);for(const host of this.root.querySelectorAll<HTMLElement>('.home-screen .scene-shortcuts'))sizeSceneShortcuts(host);},{signal:this.lifetime.signal});
    document.addEventListener('click',event=>{
      const target=event.target;if(!(target instanceof Element))return;
      if(this.deviceMenu&&!target.closest('.device-context-menu')){this.closeDeviceMenu();return;}
      if(this.accountMenuOpen&&!target.closest('.account-menu,.home-account')){this.accountMenuOpen=false;this.render();return;}
      if(this.homeMenuOpen&&!target.closest('.home-menu,.home-title')){this.homeMenuOpen=false;this.render();return;}
      if(this.context&&target.classList.contains('device-stage')&&!this.controlBusy&&(!this.timerBusy||this.countdownOperation?.pending)&&!this.actionConfirm)this.closePanel();
    },{signal:this.lifetime.signal});
    document.addEventListener('keydown', event => {
      if(this.scenePicker?.open)return;
      if(event.key==='Tab'&&(this.fryerView.picker||this.fryerView.confirmation))return;
      if(event.key==='Tab'&&(this.fridgeView.help||this.fridgeView.info||this.fridgeView.reset))return;
      if(event.key==='Tab'&&(this.dispenserView.picker||this.dispenserView.discard||this.dispenserDnd.picker||this.dispenserHistoryPicker||this.dispenserSterilization.confirming||this.dispenserSelfCheck.confirming||this.dispenserReminderView.picker||this.dispenserReminderView.confirmation))return;
      if(event.key==='Tab'&&(this.washerRuntimeConfirmation||this.purifierView.picker||this.purifierView.confirm||this.purifierView.settingDialog||this.purifierHistoryPicker||this.purifierDnd.picker||this.airerView.picker))return;
      if(event.key==='Tab'&&this.context&&!this.accountOpen&&!this.actionConfirm&&!this.countdownDraft&&!this.timerModal&&!this.energyPicker&&!this.detailPicker){
        const page=this.root.querySelector('.device-page'),scope=page?.classList.contains('page-washer')?(page.querySelector('.history-date-picker,.washer-choice-dialog,.washer-order-dialog')??page):page,items=scope?[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length):[];
        if(items.length&&(!items.includes(document.activeElement as HTMLElement)||(event.shiftKey?document.activeElement===items[0]:document.activeElement===items.at(-1)))){event.preventDefault();(event.shiftKey?items.at(-1)!:items[0]).focus();}
      }
      if (event.key === 'Escape') {
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
        else if(this.drag.active||this.sceneDrag.active){this.drag.cancel();this.sceneDrag.cancel();this.render();}
        else if(this.deviceMenu){this.closeDeviceMenu();}
        else if(this.accountMenuOpen){this.accountMenuOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-account')?.focus();}
        else if(this.homeMenuOpen){this.homeMenuOpen=false;this.render();}
        else if(this.accountOpen&&!this.logoutBusy){this.accountOpen=false;this.render();}
        else if(this.settingsOpen){this.settingsOpen=false;this.render();}
        else if(this.countdownDraft)this.closeCountdown();
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
        else if(this.washerRuntimeConfirmation){this.washerRuntimeConfirmation=undefined;this.render(true);}
        else if (this.actionConfirm && !this.controlBusy) { this.actionConfirm = undefined; this.render(); }
        else if(this.washerOrderAt!==undefined){if(!this.washerCommands.pending)this.closeWasherOrder();}
        else if(this.washerRecords.picker){this.washerRecords.picker=undefined;this.render(true);}
        else if(this.washerDraft?.selector){this.washerDraft={...this.washerDraft,selector:undefined};this.render(true);}
        else if(this.washerView==='records'&&this.washerRecords.selected)this.washerRecords.closeDetail();
        else if(this.washerView==='runtime')this.backFromWasherRuntime();
        else if(this.washerView!=='home'){this.washerView='home';this.washerDraft=undefined;this.washerCommands.reset();this.render(true);}
        else if (this.context && !this.actionConfirm) this.closePanel();
      }
    },{signal:this.lifetime.signal});
    document.addEventListener('scroll',()=>this.closeDeviceMenu(),{capture:true,signal:this.lifetime.signal});
    const sessionResult=await sessionRead;
    if(this.disposed)return;
    try {
      if('error' in sessionResult)throw sessionResult.error;
      this.session = sessionResult.session;
      this.region = this.session.region;
    } catch (error) { this.loginError = normalizeError(error); }
    this.starting = false;
    this.render();
    if (this.session?.loggedIn) {void this.loadAccountProfile();await applicationRead;if(!this.disposed&&this.session?.loggedIn)await this.loadHomes();}
  }

  private async loadAccountProfile():Promise<void>{
    const session=this.session;if(!session?.loggedIn)return;
    try{const profile=await this.transport.accountProfile();if(this.session!==session)return;this.accountProfile=profile;this.profileError=false;this.render();}
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
  private readonly deviceIndex=new IdentityIndex<Device>();
  private readonly cardIndex=new IdentityIndex<HomeCardEntry>();
  private currentDevice(): Device | undefined { return this.deviceIndex.find(this.snapshot?.devices,this.context?.did); }

  private handleSessionError(error: AppError): void {
    if (!isSessionError(error)) return;
    this.region = this.session?.region ?? this.region;
    ++this.loginEpoch; ++this.homeEpoch;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    this.loginTimer = undefined; this.homeRefreshTimer = undefined;
    this.clearPanel(); this.panelRefreshTimer = undefined;
    void this.application.load();this.session = undefined; this.accountProfile=undefined;this.profileError=false;this.homes = []; this.snapshot = undefined; this.selectedHomeId = '';
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
    if(this.disposed||this.developerMode)return;
    this.scheduleCardPresentations();
    if(this.disposed)return;
    if(this.workPaused){this.resourceRenderPending=true;return;}
    captureSettingsView(this.root,this.settingsView);
    this.monitorCatalog.setAccount(this.session?.loggedIn?this.application.data?.scope??null:null);
    const monitor=this.preferences.view?.monitor;
    if(this.settingsOpen&&this.settingsView.category==='monitor'&&this.preferences.view?.monitorAllHomes&&!this.monitorCatalog.data&&!this.monitorCatalog.loading&&!this.monitorCatalog.error)void this.monitorCatalog.load();
    if(!this.settingsOpen&&this.session?.loggedIn&&this.snapshot&&this.monitorWall&&this.monitorRunning&&!this.monitorExitLatch&&!this.suppressStartupMonitor&&!this.context){
      if(!this.root.contains(this.monitorWall.root))this.root.replaceChildren(this.monitorWall.root);
      if(this.monitorAllActive&&this.monitorCatalog.data)this.monitorWall.updateAll(this.monitorCatalog.data);
      else this.monitorWall.update(this.snapshot,monitor?.excludedDeviceIds??[],undefined,
        this.session.userId?JSON.stringify([this.session.region,this.session.userId]):undefined);
      return;
    }
    if(this.monitorWall?.active)this.monitorWall?.close();
    // Keep the native pointer owner mounted while reads or metadata resolve.
    // A close, account/home change or action dialog must still replace it.
    if(this.context&&sameContext(this.renderedContext,this.context)&&!this.settingsOpen&&!this.accountOpen&&!this.actionConfirm&&this.root.querySelector('.device-page [data-interacting="true"]'))return;
    if(this.scenePicker?.open){this.deferredRender=true;return;}
    if(this.arrangement&&this.snapshot?.homeId===this.arrangement.homeId&&this.snapshot.generation===this.arrangement.generation&&!this.context&&!this.settingsOpen&&!this.accountOpen){this.deferredRender=true;this.updateArrangementChrome();return;}
    if((this.drag.active||this.sceneDrag.active)&&this.renderedHomeId===this.selectedHomeId&&!this.settingsOpen&&!this.accountOpen&&!this.actionConfirm){this.deferredRender=true;return;}
    this.drag.cancel(); this.deferredRender=false;
    const active=(document.activeElement instanceof HTMLElement||document.activeElement instanceof SVGElement)&&this.root.contains(document.activeElement)?document.activeElement:undefined;
    const localFocusKey = active?.dataset.focusKey;
    const focusedControl=active?.closest<HTMLElement>('[data-control]');
    const focusKey=focusedControl?{kind:focusedControl.dataset.control,siid:focusedControl.dataset.siid,piid:focusedControl.dataset.piid,index:[...this.root.querySelectorAll<HTMLElement>('[data-control]')].filter(node=>node.dataset.control===focusedControl.dataset.control&&node.dataset.siid===focusedControl.dataset.siid&&node.dataset.piid===focusedControl.dataset.piid).indexOf(focusedControl),child:active===focusedControl?-1:[...focusedControl.querySelectorAll('button,input,select,[tabindex]')].indexOf(active!)}:undefined;
    const keepFocus=sameContext(this.renderedContext,this.context);
    const historyKey = this.currentDevice()?.model===dispenserModel?`dispenser/${this.dispenserView.page}/${this.dispenserView.modeId??""}/${this.dispenserView.page==='reminders'?this.dispenserReminderView.page:""}${this.dispenserView.page==='statistics'?`/${this.dispenserHistory.selection.period}/${this.dispenserHistory.selection.date}`:''}`:this.currentDevice()?.model===fridgeModel?`fridge/${this.fridgeView.page}`:this.currentDevice()?.model===airerModel?`airer/${this.airerView.page}`:this.currentDevice()?.model==='xiaomi.waterpuri.lx32'?`purifier/${this.purifierView.page}/${this.purifierView.filter}/${this.purifierView.draft?.index??''}${this.purifierView.page==='statistics'?`/${this.purifierHistory.selection.period}/${this.purifierHistory.selection.date}`:''}`:this.currentDevice()?.model==='midjd8.washer.42'?`washer/${this.washerView}/${this.washerDraft?.program??''}/${this.washerRecords.selection.period}/${this.washerRecords.selection.date}/${this.washerRecords.selectedBucket??''}/${this.washerRecords.selected?.entry.id??''}`:this.timersOpen?'timers':this.energyOpen?`energy/${this.energySelection.period}/${this.energySelection.date}`:this.historyDetailOpen ? `${this.detailSelection.period}/${this.detailSelection.date}` : '';
    const scrollTop = sameContext(this.renderedContext, this.context) && this.renderedHistoryKey === historyKey ? this.root.querySelector('.device-page-scroll')?.scrollTop ?? 0 : 0;
    const homeScroll=this.renderedHomeId===this.selectedHomeId?this.root.querySelector('.home-screen')?.scrollTop??this.homeScrollTop:0;
    const roomsScroll=this.renderedHomeId===this.selectedHomeId?this.root.querySelector('.room-tabs')?.scrollLeft??this.roomsScrollLeft:0;
    this.homeScrollTop=homeScroll;
    this.roomsScrollLeft=roomsScroll;
    if(this.renderedHomeId!==this.selectedHomeId)this.cardPress.clear();
    this.renderedHomeId=this.selectedHomeId;
    this.renderedHistoryKey = historyKey;
    setCurveMotionScope(`${this.context?.homeId??''}/${this.context?.did??''}/${historyKey}`);
    this.renderedContext = this.context ? { ...this.context } : undefined;
    disposeHistoryCharts();
    const previousStage=this.root.querySelector('.app-shell > .device-stage');
    const createDeviceStage=()=>{const next=this.renderDrawer(keepFocus&&deviceOnly?previousStage as HTMLElement|null:undefined);if(keepFocus&&previousStage&&next!==previousStage)preserveDeviceArtwork(previousStage,next);return next;};
    if((deviceOnly||!!this.currentDevice()&&(cameraPageEligible(this.currentDevice()!)||isScale(this.currentDevice()!.model)))&&previousStage&&this.context&&(this.preview||this.session?.loggedIn)&&!this.accountOpen&&!this.actionConfirm){
      const nextStage=createDeviceStage();if(nextStage!==previousStage)previousStage.replaceWith(nextStage);
    }else{
    this.root.replaceChildren();
    if (this.preview) {
      if (this.context) this.root.append(element('div', 'app-shell has-device-page', createDeviceStage()));
    } else {
    if (this.starting) { this.root.append(deviceLoading(undefined,'米家',true)); return; }
    if (!this.session?.loggedIn) {this.root.append(this.settingsOpen?this.renderWorkspace():this.renderLogin());if(this.settingsOpen)restoreSettingsView(this.root,this.settingsView); return; }
    const showDevice=!!this.context&&!this.deviceOpening.hidden;
    const shell = element('div', `app-shell${showDevice ? ' has-device-page' : ''}`, this.renderWorkspace());
    if (showDevice) shell.append(createDeviceStage());
    this.root.append(shell);
    // Resolve connected grid tracks before restoring scroll. A later change
    // from the initial single column makes browser scroll anchoring move home.
    for(const grid of shell.querySelectorAll<HTMLElement>('.home-screen .device-grid'))sizeDeviceGrid(grid);
    for(const host of shell.querySelectorAll<HTMLElement>('.home-screen .scene-shortcuts'))sizeSceneShortcuts(host);
    }
    }
    const scroll = this.root.querySelector('.device-page-scroll'); if (scroll) scroll.scrollTop = scrollTop;
    const homeScrollView=this.root.querySelector('.home-screen');if(homeScrollView)homeScrollView.scrollTop=homeScroll;
    const roomStrip=this.root.querySelector('.room-tabs');if(roomStrip)roomStrip.scrollLeft=roomsScroll;
    const devicePage=this.root.querySelector<HTMLElement>('.device-page');
    if(devicePage&&!this.preview){devicePage.setAttribute('role','dialog');devicePage.setAttribute('aria-modal','true');devicePage.tabIndex=-1;}
    if(devicePage&&this.preview)devicePage.tabIndex=-1;
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
      if (!this.preview) void this.refreshVisibleState();
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
      startQr:()=>{void this.startLogin();},cancelQr:()=>{void this.cancelLogin();},
      openDeveloperMode:()=>{void this.enterDeveloperMode();}});
  }

  private async enterDeveloperMode(): Promise<void> {
    if(this.developerMode||this.developerOpening||this.disposed)return;
    this.developerOpening=true;
    try{
      const {DeveloperMode}=await import('./developer-mode');
      if(this.disposed)return;
      if(!this.session?.loggedIn&&(this.qr||this.loginState==='loading'))void this.cancelLogin();
      this.settingsOpen=false;
      this.accountMenuOpen=this.homeMenuOpen=false;
      this.closeDeviceMenu();
      this.scenesView.dispose();
      this.clearPanel();
      this.disposeCardPresentations();
      clearTimeout(this.homeRefreshTimer);
      clearTimeout(this.stateTimer);
      this.stateTimer=undefined;
      this.stateViewport='';
      const mode=new DeveloperMode(()=>{
        mode.dispose();
        this.developerMode=undefined;
        this.render();
        this.syncWindowPolling();
      }, (root, transport, device, generation, close) => this.createDevicePreview(root, transport, device, generation, close));
      this.developerMode=mode;
      this.root.replaceChildren(mode.root);
      void mode.start();
    }catch(error){
      showToast(document.body,normalizeError(error).message,false);
    }finally{this.developerOpening=false;}
  }

  private async startLogin(): Promise<void> {
    const epoch = ++this.loginEpoch;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.qr = undefined; this.loginError = undefined; this.loginState = 'loading'; this.render();
    try {
      const qr = await this.transport.startLogin(this.region);
      if (epoch !== this.loginEpoch) { void this.transport.cancelLogin(qr.attemptId).catch(() => undefined); return; }
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
      this.loginState = 'expired'; this.render(); void this.transport.cancelLogin(attemptId).catch(() => undefined); return;
    }
    try {
      const result = await this.transport.pollLogin(attemptId);
      if (epoch !== this.loginEpoch) return;
      if (result.status === 'success') {
        const session = result.session ?? await this.transport.session();
        if (epoch !== this.loginEpoch) return;
        if (!session.loggedIn) throw new Error('登录确认尚未完成，请重新获取二维码。');
        this.session = session; this.sessionNotice = undefined; this.qr = undefined; this.loginState = 'idle';
        this.accountProfile=undefined;this.profileError=false;void this.loadAccountProfile();
        ++this.loginEpoch; this.render(); await this.application.load(); await this.loadHomes();
      } else if (result.status === 'expired') { this.loginState = 'expired'; this.render(); }
      else this.scheduleLoginPoll(epoch, attemptId);
    } catch (error) {
      if (epoch !== this.loginEpoch) return;
      this.loginState = 'error'; this.loginError = normalizeError(error); this.render();
      void this.transport.cancelLogin(attemptId).catch(() => undefined);
    }
  }

  private async cancelLogin(): Promise<void> {
    ++this.loginEpoch; if (this.loginTimer) clearTimeout(this.loginTimer);
    const attemptId = this.qr?.attemptId;
    this.qr = undefined; this.loginState = 'idle'; this.loginError = undefined; this.render();
    if (attemptId) {
      try { await this.transport.cancelLogin(attemptId); }
      catch (error) { this.loginError = normalizeError(error); this.render(); }
    }
  }

  private retryStartup():void{if(this.startupRetry)clearTimeout(this.startupRetry);if(this.startupIntent==='pending'&&this.application.data?.settings.startupMonitor)this.startupRetry=setTimeout(()=>{if(this.startupIntent==='pending'&&this.session?.loggedIn)void this.loadHomes();},20000);}
  private async maybeStartupMonitor(force=false):Promise<void>{
    if(this.developerMode||this.developerOpening)return;
    const data=this.application.data;if(!data||!this.session?.loggedIn)return;
    force=force||this.startupForced;if(force)this.startupForced=true;
    if(!force&&this.startupIntent!=='pending')return;
    if(!force&&!data.settings.startupMonitor){this.startupIntent='done';return;}
    const target=data.settings.startupHome??(force&&data.scope&&this.selectedHomeId?{scope:data.scope,homeId:this.selectedHomeId}:null);if(!target||target.scope!==data.scope){this.startupIntent='done';this.suppressStartupMonitor=true;this.monitorWall?.close();this.render();return;}
    if('allHomes' in target){
      this.startupIntent='done';this.startupForced=false;this.preferences.change({operation:'setMonitorAllHomes',value:true});
      await this.beginMonitor(true);if(this.monitorRunning){await this.monitorModule?.settleMonitorWindow();await setNativeFullscreen(true);}return;
    }
    if(this.snapshot?.homeId!==target.homeId){if(force&&this.homes.some(h=>h.id===target.homeId)){this.startupIntent='pending';await this.selectHome(target.homeId);}return;}
    const preferences=this.preferences.view;if(!preferences){this.retryStartup();return;}
    const selected=this.snapshot.devices.filter(d=>monitorEligible(d)&&!preferences.monitor?.excludedDeviceIds.includes(d.did));this.startupIntent='done';this.startupForced=false;if(!selected.length){this.suppressStartupMonitor=true;this.monitorWall?.close();this.render();return;}
    this.suppressStartupMonitor=false;this.settingsOpen=false;this.clearPanel();this.monitorExitLatch=false;this.preferences.change({operation:'setMonitorAllHomes',value:false});await this.beginMonitor(false);if(this.monitorRunning){await this.monitorModule?.settleMonitorWindow();await setNativeFullscreen(true);}
  }
  private async desktopAction(action:string):Promise<void>{
    if(action==='background'){this.inBackground=true;this.syncWindowPolling();return;}
    const wasBackground=this.inBackground;this.inBackground=false;
    if(wasBackground)this.syncWindowPolling();
    if(action==='settings'){this.startupIntent='cancelled';this.settingsView=createSettingsViewState();this.monitorSettingsReturn=undefined;this.settingsOpen=true;this.clearPanel();this.render();await this.application.load();return;}
    if(action==='monitor'){await this.application.load();await this.maybeStartupMonitor(true);return;}
  }
  private async loadHomes(): Promise<void> {
    const epoch = ++this.homeEpoch;
    this.homesLoading = true; this.homeError = undefined; this.render();
    try {
      const homes = await this.transport.listHomes();
      if (epoch !== this.homeEpoch || !this.session?.loggedIn) return;
      this.homes = homes; this.homesLoading = false; this.render();
      const target=this.application.data?.settings.startupHome;
      const startup=this.startupIntent==='pending'&&this.application.data?.settings.startupMonitor&&target?.scope===this.application.data.scope;
      if(startup&&target&&'homeId' in target&&!homes.some(h=>h.id===target.homeId)){this.startupIntent='done';this.suppressStartupMonitor=true;}
      const homeId=preferredHome(homes,this.session,this.selectedHomeId,startup&&target&&'homeId' in target?target.homeId:undefined);
      if (homeId) await this.selectHome(homeId);
      else { this.selectedHomeId = ''; this.snapshot = undefined; this.render(); }
    } catch (error) {
      if (epoch !== this.homeEpoch) return;
      this.homesLoading = false; this.homeError = normalizeError(error); this.handleSessionError(this.homeError); this.render();this.retryStartup();
    }
  }

  private pendingHomeChoice?:{session:SessionView;homeId:string};
  private async selectHome(homeId: string, userChoice=false): Promise<void> {
    const epoch = ++this.homeEpoch;
    const session=this.session;
    if(userChoice&&session?.loggedIn)this.pendingHomeChoice={session,homeId};
    else if(this.pendingHomeChoice?.session!==session||this.pendingHomeChoice?.homeId!==homeId)this.pendingHomeChoice=undefined;
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    this.widgetIntents.clear();this.selectedHomeId = homeId; this.snapshot = undefined; this.homeBusy = true;
    this.resetLocalView(); this.homeContentLoading = true; this.homeScrollTop=0;
    this.homeError = undefined; this.roomId = '*'; this.clearPanel(); this.render();
    try {
      const snapshot = await this.transport.selectHome(homeId);
      if (epoch !== this.homeEpoch || this.selectedHomeId !== homeId || !session?.loggedIn || this.session!==session) return;
      if (snapshot.homeId !== homeId) throw new Error('家庭返回数据不匹配，请重新选择家庭。');
      if(this.pendingHomeChoice?.session===session&&this.pendingHomeChoice.homeId===homeId){rememberHome(session,homeId);this.pendingHomeChoice=undefined;}
      this.snapshot = snapshot;
      this.scenes.connect(snapshot);
      // Only inventory, task membership and local layout gate the first paint.
      // Batched shortcut states update the mounted cards independently.
      await Promise.all([this.scenes.load(),this.loadPreferences()]);
      if(epoch!==this.homeEpoch||this.selectedHomeId!==homeId)return;
      // Split channels need working-mode eligibility to determine membership.
      if(this.preferences.view?.splitSwitches&&snapshot.devices.some(device=>device.controlServiceId!=null))await this.loadHomeCards();
      if(epoch!==this.homeEpoch||this.selectedHomeId!==homeId)return;
      this.homeContentLoading = false; this.homeBusy = false; this.render();
      void this.refreshVisibleState();
      this.scheduleHomeRefresh(); await this.maybeStartupMonitor();
    } catch (error) {
      if (epoch !== this.homeEpoch) return;
      this.homeContentLoading = false; this.homeBusy = false; this.homeError = normalizeError(error); this.handleSessionError(this.homeError); this.render();this.retryStartup();
    }
  }

  private editing(ignoreButtonFocus=false): boolean {
    if(hasOpenDropdown()||this.accountOpen||this.accountMenuOpen||this.homeMenuOpen||this.deviceMenu||this.scenes.pending||this.scenePicker?.open)return true;
    if(this.dispenserView.page!=='home'||this.dispenserView.picker||this.dispenserView.discard||this.dispenserSterilization.pending||this.dispenserSelfCheck.pending)return true;
    if(this.fridgeView.page!=='home'||this.fridgeView.help||this.fridgeCommands.pending)return true;
    if(this.airerView.page!=='home'||this.airerCommands.pending)return true;
    if(this.fryerView.draft||this.fryerView.picker||this.fryer.pending)return true;
    if(this.purifierView.page!=='home'||this.purifierCommands.pending||this.purifierDnd.pending||this.purifierOptions.pending)return true;
    if(this.purifierView.draft||this.purifierCommands.pending)return true;
    if(this.washerRuntimeCommands.pending||this.washerRuntimeConfirmation)return true;
    return !!this.arrangement || this.drag.active || this.settingsOpen || !!this.washerDraft || this.washerView==='records' || this.washerCommands.pending || this.preferences.pendingCount>0 || this.timersOpen || this.timerBusy || !!this.countdownDraft || this.energyOpen || this.historyDetailOpen || this.controlBusy || !!this.actionConfirm || this.panelDrafts.size > 0 || !!this.root.querySelector('.device-page [data-interacting="true"]') || document.activeElement instanceof HTMLInputElement&&document.activeElement.type!=='range' || !ignoreButtonFocus&&document.activeElement instanceof HTMLButtonElement;
  }

  private scheduleHomeRefresh(): void {
    if(this.disposed||this.developerMode)return;
    this.scheduleVisibleState();
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    if (this.backgroundPaused() || !this.session?.loggedIn || !this.snapshot || this.sessionNotice) return;
    this.homeRefreshTimer = setTimeout(() => {
      if (this.editing() || this.homeBusy || this.context || this.settingsOpen || this.monitorWall?.active) this.scheduleHomeRefresh();
      else void this.refreshDevices(true);
    }, 30_000);
  }
  private stateTimer?:ReturnType<typeof setTimeout>;
  private stateDelay=10_000;
  private stateCursor=0;
  private stateViewport='';
  private visibleStateIds():string[]{
    const viewport=this.root.querySelector('.home-screen')?.getBoundingClientRect();
    if(!viewport)return [];
    const ids=new Set<string>();
    for(const node of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card,.scene-dashboard [data-device-id]')){
      const id=node.dataset.deviceId,bounds=node.getBoundingClientRect();
      if(id&&bounds.bottom>viewport.top&&bounds.top<viewport.bottom&&bounds.right>viewport.left&&bounds.left<viewport.right)ids.add(id);
    }
    return [...ids];
  }
  private async refreshVisibleState(onlyNew=false):Promise<void>{
    const epoch=this.homeEpoch;
    await this.homeCardsRequest?.promise.catch(()=>{});
    if(epoch!==this.homeEpoch||this.disposed)return;
    if(onlyNew&&this.stateViewport===JSON.stringify(this.visibleStateIds()))return;
    clearTimeout(this.stateTimer);this.stateTimer=undefined;
    this.scheduleVisibleState(0);
  }
  private scheduleVisibleState(delay=this.stateDelay):void{
    if(this.stateTimer||this.disposed||this.developerMode||this.backgroundPaused()||!this.snapshot||!this.session?.loggedIn||this.sessionNotice||this.context||this.settingsOpen||this.accountOpen||this.monitorWall?.active)return;
    this.stateTimer=setTimeout(async()=>{
      this.stateTimer=undefined;
      if(this.backgroundPaused()||this.disposed||this.sessionNotice)return;
      try{
        if(!this.context&&!this.settingsOpen&&!this.accountOpen&&!this.monitorWall?.active&&!this.drag.active&&!this.sceneDrag.active&&!this.homeContentLoading&&!this.homeCardsRequest){
          const all=this.visibleStateIds(),count=Math.min(all.length,64);
          this.stateViewport=JSON.stringify(all);
          if(count){
            const start=this.stateCursor%all.length;
            const batch=Array.from({length:count},(_,index)=>all[(start+index)%all.length]);
            this.stateCursor=(start+count)%all.length;
            this.scheduleCardPresentations(true);
            await this.loadHomeCards(batch);
          }
        }
        this.stateDelay=10_000;
      }catch{this.stateDelay=Math.min(30000,this.stateDelay*2);}
      finally{this.scheduleVisibleState();}
    },delay);
  }

  private resourcePaused=false;private workPaused=false;private resourceRenderPending=false;private resourceRevisions=new ResourceRevisions();
  private nativeMonitorBackground?:boolean;
  private acceptResourceState(state:ResourceState):void{if(!this.resourceRevisions.accept(state))return;this.resourcePaused=!state.visible;this.nativeMonitorBackground=state.monitorBackground;this.syncWindowPolling();}
  private backgroundPaused():boolean{return this.resourcePaused||this.monitorMinimized||document.hidden||this.inBackground;}
  private monitorBackground():boolean{return monitorInBackground(this.nativeMonitorBackground,this.monitorMinimized,this.inBackground);}
  private idleReported:boolean|undefined;
  private idleHeartbeat?:ReturnType<typeof setTimeout>;
  private publishFrontendIdle():void{
    if(this.disposed)return;
    const monitorBackground=this.monitorBackground();
    this.monitorWall?.setPaused(monitorBackground,this.resourcePaused||document.hidden);
    if(!isTauri())return;
    if(this.workPaused)this.cameraPlayer?.backgroundPause();
    const background=this.monitorWall?.active?monitorBackground:this.backgroundPaused();
    const idle=background&&![...(this.templateCards?.sessions.values()??[])].some(session=>session.pendingCount)&&!this.homeBusy&&!this.panelLoading&&!this.controlBusy&&!this.pendingDeviceSends&&!this.propertyOps.pendingCount&&!this.homeCardOps.pendingCount&&!this.preferences.pendingCount&&!this.scenes.pending&&!this.timerBusy&&!this.countdownOperation?.pending&&!this.cameraPlayer?.blocksSuspension&&!this.monitorWall?.blocksSuspension&&!this.washerCommands.pending&&!this.washerRuntimeCommands.pending&&!this.fridgeCommands.pending&&!this.airerCommands.pending&&!this.dispenserCommands.pending&&!this.dispenserDnd.pending&&!this.dispenserSelfCheck.pending&&!this.dispenserSterilization.pending&&!this.purifierCommands.pending&&!this.purifierDnd.pending&&!this.purifierOptions.pending&&!this.fryer.pending;
    if(background||this.idleReported!==idle){this.idleReported=idle;void invoke('desktop_frontend_idle',{idle}).catch(()=>{if(this.idleReported===idle)this.idleReported=undefined;});}
    clearTimeout(this.idleHeartbeat);this.idleHeartbeat=undefined;
    if(background)this.idleHeartbeat=setTimeout(()=>this.publishFrontendIdle(),idle?2500:1000);
  }
  private syncWindowPolling():void{
    this.scheduleCardPresentations();
    const paused=this.backgroundPaused();
    const resumed=!paused&&this.workPaused;
    if(paused!==this.workPaused){
      this.workPaused=paused;setVisualWorkPaused(this.root,paused);backgroundWork.setPaused(paused);
      this.scenes.setResourcePaused(paused);this.fryer.setResourcePaused(paused);
      if(paused)this.cameraPlayer?.backgroundPause();else this.cameraPlayer?.backgroundResume();
      if(!paused&&this.resourceRenderPending){this.resourceRenderPending=false;this.render();}
    }
    this.publishFrontendIdle();
    if(this.backgroundPaused()){clearTimeout(this.homeRefreshTimer);clearTimeout(this.panelRefreshTimer);clearTimeout(this.stateTimer);this.stateTimer=undefined;}
    else{this.scheduleVisibleState(resumed?0:undefined);this.scheduleHomeRefresh();this.schedulePanelRefresh(resumed);}
  }

  private observingSterilization():boolean {
    return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='sterilization'&&!this.dispenserSterilization.blocked&&!this.dispenserSterilization.confirming&&!this.dispenserCommands.pending&&!this.dispenserDnd.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;
  }
  private observingSelfCheck():boolean{return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='selfcheck'&&!this.dispenserSelfCheck.blocked&&!this.dispenserSelfCheck.confirming&&!this.dispenserCommands.pending&&!this.dispenserDnd.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;}
  private schedulePanelRefresh(resumed=false): void {
    if(this.disposed||this.preview)return;
    if (this.panelRefreshTimer) clearTimeout(this.panelRefreshTimer);
    if (this.backgroundPaused() || !this.context || !this.panel || this.sessionNotice || this.settingsOpen || this.accountOpen || this.monitorWall?.active) return;
    const device=this.currentDevice();
    const ordinary=!!device&&!dedicatedPage(device.model)&&!cameraPageEligible(device)&&!isScale(device.model);
    this.panelRefreshTimer = setTimeout(() => {
      if(this.timersOpen){
        if(this.currentDevice()?.online&&!this.timerDraft&&!this.timerModal&&this.timerSelection===undefined&&!this.timerLoading&&!this.timerBusy&&!this.countdownOperation?.pending)this.loadTimers();
        this.schedulePanelRefresh();return;
      }
      if (this.settingsOpen||this.accountOpen||this.monitorWall?.active||this.editing()&&!this.observingSterilization()&&!this.observingSelfCheck() || this.washerRuntimeCommands.pending || this.washerRuntimeConfirmation || this.panelLoading || !this.currentDevice()?.online) this.schedulePanelRefresh();
      else void this.readProperties(true,ordinary);
    }, resumed?0:this.curtainMotion.moving||this.observingSelfCheck()||this.observingSterilization()&&this.panel?.dispenser?.status===4?2_000:ordinary&&!this.timersOpen?5_000:10_000);
  }

  private async refreshDevices(automatic = false): Promise<void> {
    if (automatic&&this.backgroundPaused() || !this.snapshot || this.homeBusy) return;
    const { homeId, generation } = this.snapshot;
    const epoch = this.homeEpoch;
    this.homeBusy = true; this.homeError = undefined; if (!automatic) this.render();
    try {
      const snapshot = await this.transport.refreshDevices(homeId, generation);
      if (epoch !== this.homeEpoch || this.snapshot?.homeId !== homeId || this.snapshot.generation !== generation) return;
      if (snapshot.homeId !== homeId || snapshot.generation !== generation) throw new Error('家庭数据已变化，请重新选择家庭。');
      const previous=this.snapshot;this.snapshot = snapshot; this.homeBusy = false;
      if(!automatic||this.preferences.view?.splitSwitches)void this.loadHomeCards();
      void this.scenes.load();if(this.roomId==='@scenes')void this.scenes.loadEnvironment(this.sceneDevices());
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
    if(this.workPaused){this.resourceRenderPending=true;return true;}
    if(!previous||!this.snapshot||this.context||this.settingsOpen||this.accountOpen||this.accountMenuOpen||this.homeMenuOpen||this.deviceMenu||this.arrangement||this.drag.active||this.homeError||this.uiNotice||this.preferencesError||this.preferences.error||previous.orderNotice!==this.snapshot.orderNotice)return false;
    // The scene dashboard has no device grid. Keep its charts mounted during
    // the inventory poll too, rather than falling back to a full workspace render.
    if(this.roomId==='@scenes'&&this.root.querySelector('.home-screen .scene-dashboard')){this.homeCardChanged();return true;}
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
    sizeDeviceGrid(grid,devices.map(d=>d.did));this.homeCardChanged();return true;
  }

  private renderWorkspace(): HTMLElement {
    this.scenesView.dispose();
    if(this.settingsOpen)return settingsPage({application:{card:(category,view)=>this.application.card(category,view,this.homes,this.selectedHomeId,()=>{void this.enterDeveloperMode();})},homeAvailable:!!this.session?.loggedIn&&!!this.selectedHomeId,changed:()=>this.render(),view:this.settingsView,homeName:this.currentHome()?.name??'',devices:this.snapshot?.devices??[],monitorCatalog:this.monitorCatalog,preferences:this.preferences.view?{...this.preferences.view,monitor:{enabled:this.monitorRunning,excludedDeviceIds:this.preferences.view.monitor?.excludedDeviceIds??[]}}:undefined,loading:this.preferencesLoading,pending:this.preferences.pendingCount>0,error:this.preferencesError??this.preferences.error,
      back:()=>leave(this.root.querySelector('.settings-page'),()=>{++this.monitorStartEpoch;this.settingsOpen=false;this.render();}),retry:()=>{void this.loadPreferences();},change:change=>this.changePreferences(change),artwork:device=>this.deviceArtwork(device)});
    const devices = visibleHomeDevices(this.snapshot?.devices ?? [], !!this.preferences.view?.splitSwitches);
    const main = element('main', 'home-screen');
    let afterScroll:ReturnType<typeof setTimeout>|undefined;
    main.addEventListener('scroll',()=>{
      clearTimeout(afterScroll);
      afterScroll=setTimeout(()=>{
        if(main.isConnected&&!this.context&&!this.drag.active&&!this.sceneDrag.active)void this.refreshVisibleState(true);
      },180);
    },{passive:true});
    main.dataset.homeCardsReady=String(!!this.homeCards);main.dataset.quickPending=String(this.homeCardOps.pendingCount+this.propertyOps.pendingCount);
    main.inert=!!this.context;
    main.dataset.localPending=String(this.preferences.pendingCount);main.dataset.localPreferencesReady=String(!!this.preferences.view);
    const top = element('div', 'home-topbar');
    const account = button('', 'home-account', () => { this.accountMenuOpen = !this.accountMenuOpen; this.homeMenuOpen=false;this.deviceMenu=undefined;this.render();if(this.accountMenuOpen)this.root.querySelector<HTMLButtonElement>('.account-menu button')?.focus({preventScroll:true}); });
    account.setAttribute('aria-label', '小米账号');
    account.setAttribute('aria-haspopup','menu');account.setAttribute('aria-expanded',String(this.accountMenuOpen));if(this.accountMenuOpen)account.setAttribute('aria-controls','account-actions-menu');
    if(this.profileError)account.setAttribute('aria-description','账号资料暂时不可用');
    account.append(this.accountAvatar('home-account-avatar'));
    const picker = button(this.currentHome()?.name ?? (this.homesLoading ? '正在加载家庭' : '我的家庭'), 'home-title', () => { this.homeMenuOpen = !this.homeMenuOpen; this.render();if(this.homeMenuOpen)this.root.querySelector<HTMLButtonElement>('.home-menu .chosen,.home-menu button')?.focus({preventScroll:true}); });
    picker.append(officialIcon('home:dropdown'));picker.setAttribute('aria-haspopup','menu'); picker.setAttribute('aria-expanded', String(this.homeMenuOpen));if(this.homeMenuOpen)picker.setAttribute('aria-controls','home-switcher-menu');
    for(const [trigger,selector]of [[picker,'.home-menu'],[account,'.account-menu']]as const)trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();this.root.querySelector<HTMLButtonElement>(`${selector} .chosen,${selector} button`)?.focus({preventScroll:true});}});
    top.append(picker,account);main.append(top);
    if(this.accountMenuOpen)main.append(dropdownMenu({label:'账号菜单',className:'account-menu',id:'account-actions-menu',items:[{value:'settings',label:'设置',className:'account-menu-item',focusKey:'account-menu-settings'},{value:'profile',label:'个人信息',className:'account-menu-item',focusKey:'account-menu-profile'}],choose:value=>{this.accountMenuOpen=false;if(value==='settings'){this.settingsView=createSettingsViewState();this.monitorSettingsReturn=undefined;this.settingsOpen=true;}else this.accountOpen=true;this.render();},dismiss:()=>{this.accountMenuOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-account')?.focus({preventScroll:true});}}));
    if(this.homeMenuOpen)main.append(dropdownMenu({label:'切换家庭',className:'home-menu',id:'home-switcher-menu',selection:true,items:this.homes.map(home=>({value:home.id,label:`${home.name}${home.shared?' · 共享':''}`,selected:home.id===this.selectedHomeId,className:'home-choice',focusKey:`home-choice-${home.id}`})),choose:value=>{this.homeMenuOpen=false;void this.selectHome(value,true);},dismiss:()=>{this.homeMenuOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-title')?.focus({preventScroll:true});}}));
    const rooms = element('nav', 'room-tabs'); rooms.setAttribute('aria-label', '房间');
    rooms.append(button('场景',`room-tab${this.roomId==='@scenes'?' active':''}`,()=>{this.roomId='@scenes';this.render();void this.scenes.load();void this.scenes.loadEnvironment(this.sceneDevices());}));
    rooms.append(button('全屋', `room-tab${this.roomId === '*' ? ' active' : ''}`, () => { this.roomId = '*'; this.render(); }));
    for (const room of orderedRooms(this.currentHome()?.rooms ?? [], this.snapshot?.order)) rooms.append(button(room.name, `room-tab${this.roomId === room.id ? ' active' : ''}`, () => { this.roomId = room.id; this.render(); }));
    if (devices.some(device => !device.roomId || !this.currentHome()?.rooms.some(room => room.id === device.roomId))) rooms.append(button('未分配', `room-tab${this.roomId === '?' ? ' active' : ''}`, () => { this.roomId = '?'; this.render(); }));
    bindScrollStrip(rooms);main.append(rooms);
    const content = element('div', 'home-content');
    content.tabIndex=0;content.setAttribute('aria-label',this.roomId==='@scenes'?'家庭场景':'设备列表');
    if(this.snapshot&&this.preferences.view&&!this.homeContentLoading)content.append(this.renderSceneShortcuts());
    if (this.sessionNotice) {
      const box = notice({ tone: 'error', title: '登录已失效', message: this.sessionNotice.message }); box.append(button('重新登录', 'button button-small button-secondary', () => { void this.logout(); })); content.append(box);
    }
    if (this.homeError && !this.sessionNotice) {
      const box = notice({ tone: 'error', title: this.homeError.message });
      if (this.homeError.retryable) box.append(button('重试', 'button button-small button-secondary', () => { if (this.selectedHomeId) void this.selectHome(this.selectedHomeId); else void this.loadHomes(); })); content.append(box);
    }
    if (this.uiNotice) content.append(notice(this.uiNotice));
    const preferenceError=this.preferencesError??this.preferences.error;
    if(preferenceError){const box=notice({tone:'error',title:preferenceError.message});box.append(button('重试','button button-small button-secondary',()=>{void this.loadPreferences();}));content.append(box);}
    if (this.snapshot?.orderNotice) content.append(notice({ tone: 'warning', title: this.snapshot.orderNotice }));
    if (this.homesLoading || this.homeContentLoading || (this.homeBusy && !this.snapshot) || this.preferencesLoading) content.append(loading(this.homesLoading?'正在获取家庭…':this.homeContentLoading?'正在加载家庭…':this.preferencesLoading?'正在读取本地设置…':'正在获取设备…'));
    else if (!this.homes.length && !this.homeError) {
      const empty = emptyState('暂无可访问的家庭', '请确认米家 App 中同一账号的家庭和共享权限。', 'home'); empty.append(button('重新获取', 'button button-secondary', () => { void this.loadHomes(); }, 'refresh')); content.append(empty);
    } else if (!this.snapshot && this.homeError) content.append(emptyState('暂时无法获取设备', '请重试或切换家庭。'));
    else if (!this.preferences.view && this.snapshot) content.append(emptyState('本地设置未读取','读取设置后显示设备。'));
    else if(this.roomId==='@scenes')content.append(this.renderHomeScenes());
    else if (!this.filteredDevices().length) content.append(emptyState('暂无设备','可切换房间，或在设置中查看隐藏的设备。',null));
    else {
      const grid = element('div', 'device-grid');
      queueMicrotask(()=>sizeDeviceGrid(grid));
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
    const backdrop=element('div','modal-backdrop',box);dismissOnBackdrop(backdrop,()=>{if(!this.logoutBusy){this.accountOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-account')?.focus({preventScroll:true});}});
    return backdrop;
  }
  private resetLocalView():void{
    this.disposeCardPresentations();
    this.homeContentLoading=false;
    this.scenePicker?.close();this.scenePicker=undefined;this.sceneDrag.cancel();
    this.scenes.reset();this.scenesView.dispose();
    this.devicePreviewCache.clear();
    this.monitorWall?.close();this.monitorRunning=false;++this.monitorStartEpoch;this.monitorExitLatch=false;
    this.propertyOps.reset();this.propertyContexts.clear();this.deviceSends.clear();this.confirmedPanels.clear();this.confirmedPanelVersions.clear();this.recentPanel.values.clear();for(const motion of this.curtainMotions.values())motion.reset();this.curtainMotions.clear();this.curtainMotion.reset();this.homeCardsPropertyReadVersion=0;this.operationNoticeRevision=0;
    this.homeCards=undefined;this.homeCardsRequest=undefined;this.homeCardOps.reset();this.homeCardsReadVersion=0;
    this.arrangement=undefined;document.body.classList.remove('home-is-arranging');
    this.drag.cancel();this.deferredRender=false;this.preferences.reset();this.preferencesLoading=false;this.preferencesError=undefined;
    this.settingsOpen=false;this.settingsView=createSettingsViewState();this.monitorSettingsReturn=undefined;this.accountMenuOpen=false;this.deviceMenu=undefined;
  }
  private async loadPreferences():Promise<void>{
    const snapshot=this.snapshot,epoch=this.homeEpoch;
    if(!snapshot||this.preferences.pendingCount)return;
    this.preferences.reset();this.preferencesLoading=true;this.preferencesError=undefined;this.render();
    try{
      const view=await this.transport.homePreferences(snapshot.homeId,snapshot.generation);
      if(epoch!==this.homeEpoch||snapshot.homeId!==this.snapshot?.homeId||snapshot.generation!==this.snapshot?.generation)return;
      this.preferences.reset(view);
    }catch(error){
      if(epoch!==this.homeEpoch||snapshot.homeId!==this.snapshot?.homeId||snapshot.generation!==this.snapshot?.generation)return;
      this.preferencesError=normalizeError(error);this.handleSessionError(this.preferencesError);
    }finally{if(epoch===this.homeEpoch&&snapshot.homeId===this.snapshot?.homeId&&snapshot.generation===this.snapshot?.generation){this.preferencesLoading=false;this.render();}}
  }
  private preferenceChanged(change?:PreferenceChange):void{
    if(change?.operation==='setCardSize'){
      if(change.roomId!==this.roomId&&!this.preferences.error)return;
      if(this.arrangement?.roomId===change.roomId&&this.snapshot?.homeId===this.arrangement.homeId&&this.snapshot.generation===this.arrangement.generation)this.arrangement.sizes[change.did]=cardSizeForRoom(this.preferences.view,change.roomId,change.did);
      const updated=this.updateHomeCardSizes();if(updated&&!this.preferences.error)return;
    }
    this.render();
  }
  /** Size saves update existing cards. Acknowledgements leave their animations intact. */
  private updateHomeCardSizes():boolean{
    const view=this.preferences.view,grid=this.root.querySelector<HTMLElement>('.home-screen .device-grid');
    if(!view||!grid||!this.snapshot||this.renderedHomeId!==this.snapshot.homeId||this.context||this.settingsOpen||this.accountOpen||this.workPaused||this.drag.active||this.sceneDrag.active||!this.arrangement&&this.root.querySelector('.home-screen .notice-error'))return false;
    let changed=false;
    for(const card of grid.querySelectorAll<HTMLElement>(':scope > .device-card')){const size=this.visibleCardSize(card.dataset.deviceId!,view);if(card.dataset.cardSize!==size){card.dataset.cardSize=size;changed=true;}}
    if(changed){sizeDeviceGrid(grid,this.arrangement?.order,true);this.scheduleCardPresentations();}
    return true;
  }
  private async beginMonitor(allHomes=this.preferences.view?.monitorAllHomes??false):Promise<void>{
    const epoch=++this.monitorStartEpoch;
    if(allHomes){this.monitorCatalog.setAccount(this.application.data?.scope??null);await this.monitorCatalog.load();if(epoch!==this.monitorStartEpoch)return;if(!this.monitorCatalog.data||!selectedMonitorMembers(this.monitorCatalog.data).length)return;}
    else if(!this.snapshot?.devices.some(d=>monitorEligible(d)&&!this.preferences.view?.monitor?.excludedDeviceIds.includes(d.did)))return;
    if(!this.session?.loggedIn||epoch!==this.monitorStartEpoch)return;
    try{this.monitorModule??=await import('./ui/monitor-wall');}catch{if(epoch===this.monitorStartEpoch){this.uiNotice={tone:'error',title:'监控暂时无法加载，请重试。'};this.render();}return;}
    if(this.disposed||!this.session?.loggedIn||epoch!==this.monitorStartEpoch)return;
    this.monitorWall??=new this.monitorModule.MonitorWall(()=>this.exitMonitor(),error=>this.handleSessionError(normalizeError(error)));
    this.monitorWall.setPaused(this.monitorBackground(),this.resourcePaused||document.hidden);
    this.suppressStartupMonitor=false;this.monitorExitLatch=false;this.monitorAllActive=allHomes;this.monitorRunning=true;
    if(this.settingsOpen){captureSettingsView(this.root,this.settingsView);this.monitorSettingsReturn=this.settingsView;}else this.monitorSettingsReturn=undefined;
    this.settingsOpen=false;this.clearPanel();this.render();
  }
  private changePreferences(change:PreferenceChange):void{
    if(change.operation==='setMonitorEnabled'){
      if(change.value)void this.beginMonitor();else{++this.monitorStartEpoch;this.monitorRunning=false;this.monitorExitLatch=true;this.monitorWall?.close();}
      this.render();return;
    }
    if(change.operation==='setMonitorAllHomes'){++this.monitorStartEpoch;if(change.value)this.monitorCatalog.data=undefined;}
    this.preferencesError=undefined;this.deviceMenu=undefined;this.preferences.change(change);
  }
  private exitMonitor():void {++this.monitorStartEpoch;this.monitorRunning=false;void setNativeFullscreen(false);this.monitorExitLatch=true;this.monitorWall?.close();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});this.settingsView=this.monitorSettingsReturn??createSettingsViewState('monitor');this.monitorSettingsReturn=undefined;this.settingsOpen=true;void this.loadPreferences();void this.monitorCatalog.load();this.render();}
  private beginArrangement(id:string,sceneId?:string,pointerDrag=false):boolean{
    const view=this.preferences.view,snapshot=this.snapshot;
    if(!view||!snapshot||view.dragLocked||this.preferences.pendingCount||this.context||this.settingsOpen||this.sceneDrag.active)return false;
    if(!this.arrangement){
      const visible=this.filteredDevices().map(d=>d.did);if(!sceneId&&!visible.includes(id))return false;
      const all=localDevices(snapshot.devices,snapshot.order,this.currentHome()?.rooms??[],this.roomId,view,true).map(d=>d.did);
      const sceneOriginal=this.visibleSceneTasks().map(s=>s.id);
      const sizes=Object.fromEntries(all.map(did=>[did,cardSizeForRoom(view,this.roomId,did)]));
      this.arrangement={sizes,homeId:snapshot.homeId,generation:snapshot.generation,roomId:this.roomId,original:visible,order:[...visible],all,selected:new Set(),sceneOriginal,sceneOrder:[...sceneOriginal],sceneHidden:[...(view.sceneShortcuts?.[this.roomId]?.hiddenSceneIds??[])],sceneSelected:new Set()};
    }
    if(sceneId){if(!this.arrangement.sceneOrder.includes(sceneId))return false;this.arrangement.sceneSelected.add(sceneId);}
    else{if(!this.arrangement.order.includes(id))return false;this.arrangement.selected.add(id);}
    this.homeMenuOpen=false;this.accountMenuOpen=false;this.deviceMenu=undefined;this.updateArrangementChrome(pointerDrag);return true;
  }
  private beginSceneArrangement(id:string):boolean{return !this.drag.active&&this.visibleSceneTasks().some(s=>s.id===id)&&this.beginArrangement('',id);}
  private sceneShortcutLayout():SceneShortcutLayout{return this.arrangement?{sceneIds:this.arrangement.sceneOrder,hiddenSceneIds:this.arrangement.sceneHidden}:this.preferences.view?.sceneShortcuts?.[this.roomId]??{sceneIds:[],hiddenSceneIds:[]};}
  private visibleSceneTasks(){return visibleSceneShortcuts(this.scenes.scenes,this.roomId,this.sceneShortcutLayout());}
  private saveSceneShortcutLayout(layout:SceneShortcutLayout):void{
    if(this.arrangement){this.arrangement.sceneOrder=visibleSceneShortcuts(this.scenes.scenes,this.roomId,layout).map(s=>s.id);this.arrangement.sceneHidden=layout.hiddenSceneIds;this.arrangement.sceneSelected.clear();this.refreshSceneShortcuts();this.updateArrangementChrome();}
    else this.changePreferences({operation:'setSceneShortcuts',roomId:this.roomId,...layout});
  }
  private renderSceneShortcuts():HTMLElement{
    const state=this.arrangement,locked=this.preferences.view?.dragLocked!==false;
    return sceneShortcuts(this.scenes,this.roomId,{layout:this.sceneShortcutLayout(),order:state?.sceneOrder,arranging:!!state,selected:state?.sceneSelected,
      activate:scene=>{if(this.arrangement){const selected=this.arrangement.sceneSelected;selected.has(scene.id)?selected.delete(scene.id):selected.add(scene.id);this.updateArrangementChrome();}else void this.scenes.run(scene);},
      bind:(card,scene)=>{this.sceneDrag.bind(card,scene.id,locked);card.addEventListener('contextmenu',event=>{event.preventDefault();this.openSceneMenu(scene.id,event.clientX,event.clientY);});card.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const r=card.getBoundingClientRect();this.openSceneMenu(scene.id,r.x+r.width/2,r.y+r.height/2);}else if(!locked&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const ids=this.arrangement?.sceneOrder??this.visibleSceneTasks().map(s=>s.id),index=ids.indexOf(scene.id),target=ids[index+(event.key==='ArrowLeft'?-1:1)];if(target)this.sceneDrag.moveByKeyboard(card,target);}});},
      add:state?()=>this.openScenePicker():undefined
    });
  }
  private refreshSceneShortcuts():void{const host=this.root.querySelector('.home-screen .scene-shortcuts');if(host&&!this.sceneDrag.active)host.replaceWith(this.renderSceneShortcuts());}
  private openSceneMenu(id:string,x:number,y:number):void{
    if(this.arrangement||!this.visibleSceneTasks().some(s=>s.id===id))return;this.drag.cancel();this.sceneDrag.cancel();this.closeDeviceMenu();this.accountMenuOpen=false;this.homeMenuOpen=false;
    this.root.querySelector('.account-menu')?.remove();this.root.querySelector('.home-menu')?.remove();
    this.deviceMenu={kind:'scene',did:id,x:Math.max(8,Math.min(x,innerWidth-188)),y:Math.max(8,Math.min(y,innerHeight-65))};this.root.append(this.renderDeviceMenu());this.root.querySelector<HTMLButtonElement>('.device-context-menu button:not(:disabled)')?.focus({preventScroll:true});
  }
  private openScenePicker():void{
    const snapshot=this.snapshot;if(!snapshot||this.scenePicker?.open||!this.sceneDrag.settleLanding()||!this.drag.settleLanding())return;
    const roomId=this.roomId,epoch=this.homeEpoch,visible=this.visibleSceneTasks().map(s=>s.id),ids=new Set(visible);
    const picker=sceneShortcutPicker(this.scenes.scenes.filter(s=>!ids.has(s.id)),orderedRooms(this.currentHome()?.rooms??[],this.snapshot?.order),added=>{if(epoch!==this.homeEpoch||this.snapshot?.homeId!==snapshot.homeId||this.snapshot.generation!==snapshot.generation||roomId!==this.roomId)return;this.saveSceneShortcutLayout(addSceneShortcuts(this.sceneShortcutLayout(),this.visibleSceneTasks().map(s=>s.id),added));},()=>{if(this.scenePicker===picker)this.scenePicker=undefined;if(this.deferredRender&&!this.arrangement){this.deferredRender=false;this.render();}});
    updateSceneShortcutPicker(picker,this.scenes.scenes.filter(s=>!ids.has(s.id)),orderedRooms(this.currentHome()?.rooms??[],this.snapshot?.order),this.scenes.loading);
    this.scenePicker=picker;this.root.append(picker);picker.showModal();
  }
  private deferArrangeShortcuts=false;
  private updateArrangementChrome(pointerDrag=false):void{
    this.updateCardPresentationViews();
    const state=this.arrangement;if(!state)return;
    document.body.classList.add('home-is-arranging');
    const home=this.root.querySelector('.home-screen');home?.classList.add('is-arranging');
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('.home-topbar button,.room-tabs button'))button.disabled=true;
    for(const card of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
      const selected=state.selected.has(card.dataset.deviceId??'');card.classList.toggle('arrange-selected',selected);card.setAttribute('aria-pressed',String(selected));
      card.setAttribute('aria-label',`${card.querySelector('h3')?.textContent??'设备'}，${selected?'已选中':'未选中'}`);
    }
    const shortcuts=this.root.querySelector<HTMLElement>('.scene-shortcuts');
    // Keep the held task mounted: replacing its section would lose pointer capture.
    this.deferArrangeShortcuts=!!shortcuts&&(pointerDrag||this.drag.active)&&!shortcuts.querySelector('.scene-add');
    if(shortcuts&&!this.deferArrangeShortcuts){
      if(!shortcuts.querySelector('.scene-add')){const add=this.renderSceneShortcuts().querySelector('.scene-add');if(add)shortcuts.append(add);}
      shortcuts.hidden=false;shortcuts.classList.add('scene-shortcuts-arranging');sizeSceneShortcuts(shortcuts);
      for(const card of shortcuts.querySelectorAll<HTMLElement>('.scene-task')){const selected=state.sceneSelected.has(card.dataset.sceneId!);card.classList.toggle('arrange-selected',selected);const button=card.querySelector<HTMLButtonElement>('.scene-task-open');if(button){button.disabled=false;button.setAttribute('aria-pressed',String(selected));}}
    }
    let toolbar=this.root.querySelector<HTMLElement>('.home-arrange-toolbar');
    if(!toolbar){
      const cancel=button('','arrange-toolbar-button',()=>this.finishArrangement(false));cancel.append(officialIcon('home:arrange-cancel'));cancel.setAttribute('aria-label','取消排列');
      const done=button('','arrange-toolbar-button',()=>this.finishArrangement(true));done.append(officialIcon('home:arrange-done'));done.setAttribute('aria-label','完成排列');
      const count=element('span','arrange-selection-count');count.setAttribute('aria-live','polite');
      toolbar=element('div','home-arrange-toolbar',cancel,count,done);toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','设备排列');this.root.append(toolbar);
    }
    toolbar.querySelector('.arrange-selection-count')!.textContent=`已选择${state.selected.size+state.sceneSelected.size}`;
  }
  private finishArrangement(save:boolean):void{
    const state=this.arrangement;if(!state)return;
    const current=this.snapshot?.homeId===state.homeId&&this.snapshot.generation===state.generation&&this.roomId===state.roomId;
    const ids=save&&current?mergeVisibleOrder(state.all,state.original,state.order):undefined;
    const sceneChanged=JSON.stringify({sceneIds:state.sceneOrder,hiddenSceneIds:state.sceneHidden})!==JSON.stringify({sceneIds:state.sceneOriginal,hiddenSceneIds:this.preferences.view?.sceneShortcuts?.[state.roomId]?.hiddenSceneIds??[]});
    
    this.arrangement=undefined;document.body.classList.remove('home-is-arranging');this.drag.cancel();this.sceneDrag.cancel();this.root.querySelector('.home-arrange-toolbar')?.remove();
    const view=this.preferences.view;
    const sizes=Object.fromEntries(Object.entries(state.sizes).filter(([id,size])=>size!==cardSizeForRoom(view,state.roomId,id)));
    if(ids&&(Object.keys(sizes).length||state.order.some((id,index)=>id!==state.original[index])||sceneChanged))this.changePreferences({operation:'setCardLayout',roomId:state.roomId,deviceIds:ids,cardSizes:sizes,...(sceneChanged?{scenes:{sceneIds:state.sceneOrder,hiddenSceneIds:state.sceneHidden}}:{})});
    this.render();
  }
  private openDeviceMenu(did:string,x:number,y:number):void{
    if(!this.drag.settleLanding()||!this.sceneDrag.settleLanding())return;
    if(!this.preferences.view||!this.filteredDevices().some(d=>d.did===did))return;
    this.drag.cancel();this.closeDeviceMenu();this.accountMenuOpen=false;this.homeMenuOpen=false;
    this.root.querySelector('.account-menu')?.remove();this.root.querySelector('.home-menu')?.remove();
    for(const toggle of this.root.querySelectorAll('.home-account,.home-title'))toggle.setAttribute('aria-expanded','false');
    this.deviceMenu={did,x:Math.max(8,Math.min(x,innerWidth-188)),y:Math.max(8,y)};
    this.root.append(this.renderDeviceMenu());
    const menu=this.root.querySelector<HTMLElement>('.device-context-menu')!;menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.getBoundingClientRect().height-8))}px`;
    this.root.querySelector<HTMLButtonElement>('.device-context-menu button:not(:disabled):not([hidden])')?.focus({preventScroll:true});
    const current=this.deviceMenu,snapshot=this.snapshot;
    if(snapshot&&this.visibleCardSize(did)!=='large'){
      void this.transport.homeCardLargeAvailable(snapshot.homeId,snapshot.generation,did).then(available=>{
        if(this.deviceMenu!==current||this.snapshot?.homeId!==snapshot.homeId||this.snapshot?.generation!==snapshot.generation)return;
        current.large=available;
        const active=this.root.querySelector<HTMLElement>('.device-context-menu');if(!active)return;
        showLargeCardChoice(active,available);active.style.top=`${Math.max(8,Math.min(y,innerHeight-active.getBoundingClientRect().height-8))}px`;
      }).catch(()=>{});
    }
  }
  private closeDeviceMenu():void{
    this.deviceMenu=undefined;this.root.querySelector('.device-context-menu')?.remove();
  }
  private renderDeviceMenu():HTMLElement{
    const current=this.deviceMenu!,menu=element('div','device-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','设备选项');
    menu.style.left=`${current.x}px`;menu.style.top=`${current.y}px`;cardMenuKeys(menu,()=>this.closeDeviceMenu());
    if(current.kind==='scene'){menu.setAttribute('aria-label','自动化选项');const hide=button('隐藏','account-menu-item',()=>{const layout=removeSceneShortcuts(this.sceneShortcutLayout(),[current.did]);this.closeDeviceMenu();this.saveSceneShortcutLayout(layout);});hide.setAttribute('role','menuitem');menu.append(hide);return menu;}
    const roomId=this.roomId,selected=this.visibleCardSize(current.did);
    menu.append(cardSizeMenu(selected,size=>{
      this.closeDeviceMenu();if(this.roomId!==roomId||size===selected)return;
      this.changePreferences({operation:'setCardSize',roomId,did:current.did,size});
    },undefined,current.large));
    if(this.arrangement)return menu;
    const homeHidden=this.preferences.view?.homeHiddenDeviceIds?.includes(current.did)??false;
    const home=button(homeHidden?'在全屋中显示':'仅在全屋隐藏','account-menu-item',()=>this.changePreferences({operation:'setHomeHidden',did:current.did,hidden:!homeHidden}));home.setAttribute('role','menuitem');
    const hide=button('隐藏设备','account-menu-item',()=>this.changePreferences({operation:'setHidden',did:current.did,hidden:true}));hide.setAttribute('role','menuitem');menu.append(home,hide);
    if(this.widgetSupport.supported){
      const pinned=this.widgetSupport.pins.find(p=>p.homeId===this.snapshot?.homeId&&p.did===current.did);
      const pin=button(pinned?'取消固定到桌面':'固定到桌面','account-menu-item',()=>{
        const snapshot=this.snapshot;this.closeDeviceMenu();if(!snapshot)return;
        void (pinned?desktopWidgets.unpin(pinned.id):desktopWidgets.pin({homeId:snapshot.homeId,generation:snapshot.generation,did:current.did})).then(()=>this.refreshWidgetSupport()).catch(error=>{this.homeError=normalizeError(error);this.render();});
      });pin.setAttribute('role','menuitem');pin.disabled=!pinned&&this.widgetSupport.enabledDisplays===0;menu.append(pin);
    }return menu;
  }
  private filteredDevices(): Device[] {
    const preferences=this.preferences.view;
    return preferences?localDevices(this.snapshot?.devices??[],this.snapshot?.order,this.currentHome()?.rooms??[],this.roomId,preferences,false,this.homeCards?.cards):[];
  }
  private sceneDevices():Device[]{
    const preferences=this.preferences.view;
    return preferences?localDevices(this.snapshot?.devices??[],this.snapshot?.order,this.currentHome()?.rooms??[],'*',{...preferences,splitSwitches:true},false,this.homeCards?.cards):[];
  }
  private renderHomeScenes():HTMLElement{
    const devices=this.sceneDevices(),cards=devices.map(d=>this.displayedHomeCard(d)).filter((c):c is HomeCardEntry=>!!c);
    return this.scenesView.render({devices,rooms:orderedRooms(this.currentHome()?.rooms??[],this.snapshot?.order),cards,state:this.scenes});
  }
  private updateHomeScenes():void{
    if(!this.snapshot||this.settingsOpen||this.homeContentLoading)return;
    if(this.scenePicker?.open){const visible=new Set(this.visibleSceneTasks().map(scene=>scene.id));updateSceneShortcutPicker(this.scenePicker,this.scenes.scenes.filter(scene=>!visible.has(scene.id)),orderedRooms(this.currentHome()?.rooms??[],this.snapshot.order),this.scenes.loading);}
    if(this.arrangement){
      if(!this.sceneDrag.active){this.arrangement.sceneOrder=this.visibleSceneTasks().map(scene=>scene.id);this.refreshSceneShortcuts();}
      this.updateArrangementChrome();return;
    }
    if(this.sceneDrag.active||this.scenePicker?.open)return;
    const active=document.activeElement instanceof HTMLElement?document.activeElement.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey:undefined;
    const shortcuts=this.root.querySelector('.home-screen .scene-shortcuts');
    if(shortcuts)shortcuts.replaceWith(this.renderSceneShortcuts());
    const page=this.root.querySelector('.home-screen .scene-dashboard');
    if(page&&this.roomId==='@scenes'){const next=this.renderHomeScenes();if(next!==page)page.replaceWith(next);}
    if(active)[...this.root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node=>node.dataset.focusKey===active&&!node.matches(':disabled'))?.focus({preventScroll:true});
  }
  private writeSceneDevice(device:Device,intent:HomeCardIntent):void{
    this.activateHomeCard(device,intent);
  }

  private async loadHomeCards(idsToRefresh?:string[]):Promise<void>{
    if(!idsToRefresh)this.scheduleCardPresentations(true);
    const snapshot=this.snapshot;if(!snapshot)return;
    if(this.homeCardsRequest?.homeId===snapshot.homeId&&this.homeCardsRequest.generation===snapshot.generation)return this.homeCardsRequest.promise;
    const epoch=this.homeEpoch,version=this.homeCardOps.version,propertyVersion=this.propertyOps.version;
    const current=()=>epoch===this.homeEpoch&&this.snapshot?.homeId===snapshot.homeId&&this.snapshot.generation===snapshot.generation;
    const request={homeId:snapshot.homeId,generation:snapshot.generation,promise:Promise.resolve()};
    this.homeCardsRequest=request;
    request.promise=(async()=>{
      try{
        const report=await this.transport.homeCards(snapshot.homeId,snapshot.generation,idsToRefresh);
        if(!current())return;
        if(report.homeId!==snapshot.homeId||report.generation!==snapshot.generation)throw Error('快捷状态与当前家庭不匹配。');
        const ids=new Set(snapshot.devices.map(device=>device.did));
        const superseded=(did:string)=>{const op=this.homeCardOps.get(did);return !!op&&(op.pending||op.settledRevision>version);};
        const statuses=new Map((this.homeCards?.statuses??[]).filter(status=>ids.has(status.did)).map(status=>[status.did,status]));
        const cards=new Map((this.homeCards?.cards??[]).filter(card=>ids.has(card.did)).map(card=>[card.did,card]));
        const latest=new Set<string>();
        for(const status of report.statuses??[]){const old=statuses.get(status.did);if(ids.has(status.did)&&!superseded(status.did)&&(status.revision??0)>=(old?.revision??0)){statuses.set(status.did,retainConfirmedStatus(old,status));latest.add(status.did);}}
        const reported=new Set(report.cards.map(card=>card.did));
        const statusesByDid=new Map(report.statuses?.map(status=>[status.did,status]));
        for(const did of latest)if(!reported.has(did)){cards.delete(did);this.switchGroups.get(did)?.dispose();this.switchGroups.delete(did);}
        for(const card of report.cards){
          const old=cards.get(card.did),status=statusesByDid.get(card.did);
          if(ids.has(card.did)&&!superseded(card.did)&&(!status||latest.has(card.did))&&(card.group?.revision??Infinity)>=(old?.group?.revision??0)){cards.set(card.did,card);latest.add(card.did);}
        }
        for(const device of snapshot.devices)if(!device.online){if(statuses.delete(device.did)||cards.has(device.did))latest.add(device.did);cards.delete(device.did);}
        this.homeCards={...report,cards:[...cards.values()],statuses:[...statuses.values()]};this.homeCardsReadVersion=version;this.homeCardsPropertyReadVersion=propertyVersion;
        this.homeCardChanged(latest);
      }catch(error){if(current()){this.handleSessionError(normalizeError(error));if(idsToRefresh)throw error;}}
      finally{if(this.homeCardsRequest===request)this.homeCardsRequest=undefined;}
    })();
    return request.promise;
  }
  private displayedHomeCard(device:Device):HomeCardEntry|undefined{
    const card=this.cardIndex.find(this.homeCards?.cards,device.did);if(!card)return;
    if(card.group)return this.switchGroupSession(card)?.display;
    const external=this.widgetIntents.get(device.did);if(external&&!this.homeCardOps.get(device.did)?.pending&&!this.propertyOps.get(this.operationKey(device.did,card.binding.siid,card.binding.piid))?.pending)return cardDisplay(card,device,external,true);
    if(card.kind==='power'){const key=this.operationKey(device.did,card.binding.siid,card.binding.piid),op=this.propertyOps.get(key);if(op){const state=this.propertyOps.display(key,card.selected,this.homeCardsPropertyReadVersion);return cardDisplay(card,device,state.value===true?'on':state.value===false?'off':undefined,!!state.phase);}}
    if(card.kind==='curtain'&&device.model==='xiaomi.curtain.acn009'){const op=this.propertyOps.get(this.operationKey(device.did,2,5));if(op?.pending)return {...card,selected:Number(op.target)>0,action:'pause'};}
    const state=this.homeCardOps.display(card.did,cardReportedIntent(card),this.homeCardsReadVersion);
    return cardDisplay(card,device,state.value,!!state.phase);
  }
  private activateHomeCard(device:Device,intent:HomeCardIntent):void{
    const card=this.displayedHomeCard(device);
    if(!card?.enabled||this.arrangement||this.context||!this.snapshot)return;
    this.uiNotice=undefined;
    if(card.group){if(intent==='on'||intent==='off')this.switchGroupSession(card)?.write(intent==='on');return;}
    if(card.kind==='power'){
      if(!['on','off'].includes(intent))return;
      const key=this.operationKey(device.did,card.binding.siid,card.binding.piid);
      this.propertyContexts.set(key,{context:{homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},homeEpoch:this.homeEpoch,homePower:true,homeCamera:cameraPageEligible(device)&&!isCloudDoorbell(device.model)});
      this.propertyOps.setActive(true);this.propertyOps.write(key,intent==='on',this.cardIndex.find(this.homeCards?.cards,device.did)?.selected??false);return;
    }
    if(card.kind==='curtain'&&device.model==='xiaomi.curtain.acn009'){const key=this.operationKey(device.did,2,5);if(intent==='pause'){this.curtainMotions.get(JSON.stringify({homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did}))?.pause();this.propertyOps.cancel(key,false);this.homeCardOps.write(device.did,'pause',null);}else{this.propertyContexts.set(key,{context:{homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},homeEpoch:this.homeEpoch,homeCurtain:true});const actual=numericValue(findProperty(this.confirmedPanels.get(device.did),['curtain'],['current-position']));this.propertyOps.write(key,intent==='open'?100:0,actual??(card.selected?100:0));const c={homeId:this.snapshot.homeId,generation:this.snapshot.generation,did:device.did},motionKey=JSON.stringify(c),motion=this.curtainMotions.get(motionKey)??new CurtainMotion();this.curtainMotions.set(motionKey,motion);motion.update(motionKey,{position:actual??(card.selected?100:0),target:intent==='open'?100:0,journey:numericValue(findProperty(this.confirmedPanels.get(device.did),['curtain'],['whole-journey-time'])),pending:true,revision:this.propertyOps.get(key)?.revision});return;}}
    this.homeCardOps.write(device.did,intent,cardReportedIntent(card));
  }

  private homeCardChanged(affected?:ReadonlySet<string>):void{
    // Card-only broadcasts cannot change settings or account UI. In particular,
    // waking a widget must not replace an unsubmitted settings input.
    if(this.settingsOpen||this.accountOpen)return;
    if(this.workPaused){this.resourceRenderPending=true;return;}
    if(this.homeContentLoading)return;
    if(this.drag.active||this.sceneDrag.active){this.deferredRender=true;return;}
    if(this.roomId!=='@scenes'&&this.preferences.view?.splitSwitches&&!this.context&&!this.settingsOpen&&!this.arrangement){
      const grid=this.root.querySelector('.device-grid');
      if(grid){
        const current=[...grid.querySelectorAll<HTMLElement>(':scope > .device-card')].map(card=>card.dataset.deviceId).sort();
        const next=this.filteredDevices().map(device=>device.did).sort();
        if(current.length!==next.length||current.some((id,index)=>id!==next[index])){this.render();return;}
      }else if(this.filteredDevices().length&&this.root.querySelector('.home-screen')){this.render();return;}
    }
    const settled=this.homeCardOps.lastSettled;
    if(settled&&settled.settledRevision>this.homeCardNoticeRevision){
      this.homeCardNoticeRevision=settled.settledRevision;
      if(settled.outcome==='rejected'){this.uiNotice=undefined;this.render();}
    }
    for(const card of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
      if(affected&&!affected.has(card.dataset.deviceId??''))continue;
      const device=this.deviceIndex.find(this.snapshot?.devices,card.dataset.deviceId);if(!device)continue;
      const state=this.displayedHomeCard(device),operation=this.homeCardOps.get(device.did);
      const caption=card.querySelector('.device-room'),text=this.deviceCardCaption(device);if(caption&&caption.textContent!==text)caption.textContent=text;
      card.classList.toggle('is-active',cardActive(state,device));
      card.dataset.shortcutPending=String(!!operation?.pending);
      const old=card.querySelector('.device-status');
      if(old)updateHomeShortcut(old,device,state,!!operation?.pending||!!(state?.kind==='power'&&this.propertyOps.get(this.operationKey(device.did,state.binding.siid,state.binding.piid))?.pending),intent=>this.activateHomeCard(device,intent));
    }
    const home=this.root.querySelector<HTMLElement>('.home-screen');
    if(home){home.dataset.homeCardsReady=String(!!this.homeCards);home.dataset.quickPending=String(this.homeCardOps.pendingCount+this.propertyOps.pendingCount);}
    this.updateHomeScenes();
  }
  private async homeCardRequest(did:string,value:Json,read:boolean):Promise<PropertyReply>{
    const snapshot=this.snapshot,epoch=this.homeEpoch;
    if(!snapshot)throw {kind:'staleContext',message:'家庭已经切换。'};
    const context={homeId:snapshot.homeId,generation:snapshot.generation,did};
    const current=()=>epoch===this.homeEpoch&&this.snapshot?.homeId===context.homeId&&this.snapshot.generation===context.generation;
    try{
      const result=await(read?this.transport.confirmHomeCard(context,value as HomeCardIntent):this.transport.changeHomeCard(context,value as HomeCardIntent));
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
    const status=this.homeCards?.statuses?.find(s=>s.did===device.did),intents:DisplayIntent[]=this.cardPropertyIntents(device.did);
    const template=this.templateCards?.sessions.get(device.did);
    intents.push(...this.switchGroups?.get(device.did)?.displayIntents??[],...template?.confirmedCaption(status?.revision)??[],...template?.displayIntents??[]);
    return cardCaption(device,device.roomName||this.currentHome()?.rooms.find(room=>room.id===device.roomId)?.name||'未分配房间',this.homeCards?.statuses,projectCardStatus(status,intents));
  }
  private cardPropertyIntents(did:string):DisplayIntent[]{return (this.propertyOps?.entries()??[]).flatMap(([key,op])=>{const[id,siid,piid]=JSON.parse(key)as[string,number,number];return id===did&&op.pending?[{fieldId:`${siid}:${piid}`,value:op.target,order:op.displayOrder??0}]:[];});}
  private visibleCardSize(did:string,view=this.preferences.view):CardSize{
    const draft=this.arrangement?.roomId===this.roomId?this.arrangement.sizes:undefined;
    return (draft&&Object.hasOwn(draft,did)?draft[did]:undefined)??cardSizeForRoom(view,this.roomId,did);
  }
  private renderDeviceCard(device: Device): HTMLElement {
    const shortcut=this.displayedHomeCard(device);
    const open=()=>{
      if(this.arrangement){const selected=this.arrangement.selected;selected.has(device.did)?selected.delete(device.did):selected.add(device.did);this.updateArrangementChrome();return;}
      const snapshot=this.snapshot;if(!snapshot)return;
      this.cardPress.activate(card,device.did,()=>{
        if(this.snapshot?.homeId!==snapshot.homeId||this.snapshot?.generation!==snapshot.generation||this.context||this.settingsOpen||this.accountOpen||this.arrangement)return;
        void this.openPanel(device);
      });
    };
    const session=this.templateSession(device);
    const card=deviceCardView({size:this.visibleCardSize(device.did),device,shortcut,pending:!!this.homeCardOps.get(device.did)?.pending,artwork:this.deviceArtwork(device),caption:this.deviceCardCaption(device),selected:this.context?.did===device.did,open,activate:intent=>this.activateHomeCard(device,intent),presentation:session?.presentation,activateControl:(id,value)=>{if(!this.arrangement&&!this.drag.active)session?.write(id,value);}});
    this.trackCardPresentation(card);
    this.homeCardBindings.set(card,JSON.stringify(device));
    this.cardPress.bind(card,device.did);
    const locked=this.preferences.view?.dragLocked!==false;
    this.drag.bind(card,device.did,locked);
    card.addEventListener('contextmenu',event=>{event.preventDefault();this.openDeviceMenu(device.did,event.clientX,event.clientY);});
    card.addEventListener('keydown',event=>{
      if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();open();return;}
      if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const rect=card.getBoundingClientRect();this.openDeviceMenu(device.did,rect.x+rect.width/2,rect.y+rect.height/2);}
      else if(!locked&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const ids=[...card.closest('.device-grid')!.querySelectorAll<HTMLElement>(':scope > .device-card')].sort((a,b)=>Number(a.dataset.visualOrder)-Number(b.dataset.visualOrder)).map(c=>c.dataset.deviceId!),index=ids.indexOf(device.did),target=ids[index+(event.key==='ArrowLeft'?-1:1)];if(target)this.drag.moveByKeyboard(card,target);}
    });
    return card;
  }

  private deviceArtwork(device: Device, className = '', switchCount = 3,product=false): HTMLElement {
    return renderDeviceArtwork(device,className,switchCount,product);
  }

  private clearPanel(): void {
    this.scale.close();this.scalePage.dispose();
    this.deviceEvents.close();
    this.bathHeater.close();
    this.ceilingFan.close();
    this.fryer.close();this.fryerView={};
    this.vacuum.close();
    this.doorbell.close();
    this.doorbellPlayer?.dispose();
    this.irRemote.close();
    this.televisionPendingRole=undefined;
    this.fridgeCommands.close();this.fridgeView={page:'home'};
    this.dispenserCommands.close();this.dispenserView={page:'home'};
    this.dispenserDnd.close();
    this.dispenserHistory.close();this.dispenserHistoryPicker=undefined;
    this.dispenserSelfCheck.close();this.dispenserSterilization.close();
    this.dispenserReminders.close();this.dispenserReminderView={page:'settings'};
    this.airerCommands.close();this.airerView={page:'home'};
    this.router.close();
    
    
    
    
    
    this.purifierGuide?.dispose();this.purifierGuide=undefined;
    this.purifierOptions.close();
    this.purifierDnd.close();
    this.purifierHistory.close();this.purifierHistoryPicker=undefined;
    this.purifierView=newPurifierView();
    this.deviceOpening.cancel();
    this.washerRuntimeCommands.close();
    this.washerCommands.reset();this.washerOrderAt=undefined;
    this.washerRuntimeConfirmation=undefined;clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;
    this.washerRecords.reset();
    this.washerConfig=undefined;this.washerLoading=false;this.washerProgramsOpen=false;this.washerError=undefined;this.washerView='home';this.washerDraft=undefined;
    this.deviceMenu=undefined;
    this.lightTab=undefined;
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
    this.cameraPlayer?.dispose();
    ++this.panelEpoch; this.context = undefined; this.panel = undefined; this.panelError = undefined;
    this.panelNotice = undefined; this.panelLoading = false; this.controlBusy = false; this.actionConfirm = undefined;
    this.panelIsCached=false;this.panelCachedAt=null;this.panelHasCachedState=false;
    this.speaker.close();
    this.curtainMotion.detach();
  }

  private closePanel(): void { if(this.purifierView.draft&&!this.purifierCommands.pending){this.purifierView.confirm='leave';this.render(true);return;}if(this.preview){this.preview.close();return;}const did=this.context?.did;this.clearPanel(); this.render();void this.loadHomeCards();[...this.root.querySelectorAll<HTMLElement>('.device-card')].find(card=>card.dataset.deviceId===did)?.querySelector<HTMLButtonElement>('.device-card-open')?.focus({preventScroll:true}); }
  private backFromWasherRuntime():void{
    this.washerView='home';this.washerRuntimeConfirmation=undefined;
    clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;this.render(true);
    this.root.querySelector<HTMLElement>('[data-focus-key=washer-runtime-entry]')?.focus({preventScroll:true});
  }

  private deviceCacheKey(device:Device,context:DeviceContext):string{return JSON.stringify([PRESENTATION_VERSION,this.session?.region,this.session?.userId,context.homeId,context.generation,context.did,device.model,device.specType,device.controlGroup,device.controlServiceId,device.unsupportedReason]);}
  private rememberDevice(panel:DevicePanel):void{
    const device=this.deviceIndex.find(this.snapshot?.devices,panel.did);if(!device||!this.context)return;
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
    const freshRequest=this.transport.devicePanel(context);
    if(device.model===routerModel){this.router.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.router.load(context);}
    if(speakerMetadataSupported(device.model)&&device.online){this.speaker.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.speaker.read();}
    if(device.model===bathHeaterModel){this.bathHeater.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.bathHeater.read();}
    if(device.model===fryerModel){this.fryer.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.fryer.read();}
    if(device.model===ceilingFanModel){this.ceilingFan.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.ceilingFan.read();}
    if(isCloudDoorbell(device.model)){this.doorbell.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.doorbell.read();}
    // Resource acquisition must never serialize or gate device state/preview.
    if (!this.preview) void this.loadDeviceUiResources(context, epoch);
    if(device.model==='midjd8.washer.42')void this.loadWasherConfig(context,epoch);
    if (!this.preview) void this.transport.devicePreview(context).then(preview=>{
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
    const promise = this.transport.deviceUiResources(context).then(resources => {
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
      const report=await this.transport.washerConfig(context);if(!current())return;
      if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw Error('洗涤程序与设备不匹配。');this.washerConfig=report;if(this.panel)this.rememberDevice(this.panel);
    }catch(error){if(current()){const failure=normalizeError(error);this.washerError=failure.message;this.handleSessionError(failure);}}
    finally{if(current()){this.washerLoading=false;this.deviceContentReady();if(!this.editing())this.render(true);}}
  }
  private closeWasherOrder():void{
    this.washerOrderAt=undefined;this.washerCommands.reservationAt=null;
    if(this.context&&this.washerDraft&&!this.washerCommands.locked)this.washerCommands.edit(this.context,this.washerDraft);this.render(true);
  }

  private panelSecondaryReadAt=0;
  private async readProperties(automatic = false, stateOnly = false): Promise<void> {
    if (automatic&&this.backgroundPaused() || !this.context || this.panelLoading || this.controlBusy) return;
    const context = { ...this.context }; const epoch = this.panelEpoch;
    const fridgeReadVersion=this.fridgeCommands.version,airerReadVersion=this.airerCommands.version;
    const dispenserReadVersion=this.dispenserCommands.version;
    const dispenserDndReadVersion=this.dispenserDnd.operationVersion;
    const sterilizationReadVersion=this.dispenserSterilization.version;
    const selfCheckReadVersion=this.dispenserSelfCheck.version;
    const reminderReadVersion=this.dispenserReminders.version;
    if (!automatic && (!this.uiResources || this.uiResources.cacheState === 'stale')) void this.loadDeviceUiResources(context, epoch);
    const readVersion=this.propertyOps.version;
    this.panelLoading = true; this.panelError = undefined;
    if (!automatic) { this.panelNotice = undefined; this.render(); }
    try {
      const panel = await (stateOnly?this.transport.observeProperties(context):this.transport.readProperties(context));
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (panel.did !== context.did) throw new Error('设备返回数据不匹配，请重新打开设备。');
      this.panelLoading = false;
      if(this.currentDevice()?.model===airerModel&&airerReadVersion!==this.airerCommands.version||this.currentDevice()?.model===fridgeModel&&fridgeReadVersion!==this.fridgeCommands.version){this.render(true);return;}
      if(this.currentDevice()?.model===dispenserModel&&(dispenserReadVersion!==this.dispenserCommands.version||dispenserDndReadVersion!==this.dispenserDnd.operationVersion||sterilizationReadVersion!==this.dispenserSterilization.version||selfCheckReadVersion!==this.dispenserSelfCheck.version||reminderReadVersion!==this.dispenserReminders.version)){this.render(true);return;}
      if (!automatic || !this.editing(stateOnly) || this.observingSterilization() || this.observingSelfCheck()) {
        this.acceptPanel(panel,readVersion,stateOnly);this.panelIsCached=false;this.panelHasCachedState=false;this.propertyOps.resume();this.render(true);
        if(stateOnly&&Date.now()-this.panelSecondaryReadAt<10_000)return;
        this.panelSecondaryReadAt=Date.now();
        await this.loadLinkedPanels(context, epoch);
        const device = this.currentDevice();
        if (device && panelLayout(device, panel) === 'temperature-humidity-sensor' && this.historyError?.retryable !== false && Date.now() - this.historyReadAt >= 300000) void this.loadSensorHistory(context, epoch);
        if(device&&energySupported(device,panel)&&!this.energyLoading&&!this.energyOpen&&Date.now()-this.energyReadAt>=300000)this.loadEnergy({period:'week',date:dateKey(new Date())},false);
      }
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      this.panelLoading = false;
      const failure=normalizeError(error);this.handleSessionError(failure);
      if(stateOnly)return;
      this.panelError = failure;if (!automatic || !this.editing()) this.render();
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) this.schedulePanelRefresh();
    }
  }

  private async loadSensorHistory(context: DeviceContext, epoch: number): Promise<void> {
    if (this.historyLoading || epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
    this.historyLoading = true; this.historyReadAt = Date.now(); this.historyError = undefined; this.render();
    try {
      const data = await this.transport.sensorHistory(context);
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
        const data = await this.transport.historyDetail(context, selection);
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
      try{const data=await this.transport.outletEnergy(context,selection);if(!current())return;
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
      try{const data=await this.transport.outletTimers(context);if(!current())return;
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
      next=>this.transport.changeOutletCountdown(context,next),()=>this.transport.outletTimers(context),()=>{
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
          const result=await this.transport.changeOutletTimer(context,change);if(!current())return;
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
        try { results[index] = { child, panel: await this.transport.devicePanel({ ...context, did: child.did }) }; }
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



  
  
  

  private irRemote:IrRemoteState;
  private scalePage=new ScalePage();
  private scale:ScaleState;
  private televisionPendingRole:TelevisionRole|undefined;
  private renderDrawer(previous?:HTMLElement|null): HTMLElement {
    const washer=this.currentDevice();
    if(this.doorbell.view!=='cloud'||!isCloudDoorbell(washer?.model??''))this.doorbellPlayer?.dispose();
    if(this.purifierGuide&&(washer?.model!=='xiaomi.waterpuri.lx32'||this.purifierView.page!=='guide')){this.purifierGuide.dispose();this.purifierGuide=undefined;}
    const artwork=()=>washer?this.deviceArtwork(washer):element('span','device-artwork',icon('device'));
    if(washer&&isScale(washer.model)&&!this.deviceOpening.waiting)return this.scalePage.update({device:washer,state:this.scale,back:()=>this.closePanel(),profile:this.accountProfile});
    if(washer&&isIrRemote(washer.model)&&!this.deviceOpening.waiting)return irRemotePage({device:washer,state:this.irRemote,back:()=>this.closePanel(),artwork});
    if(washer&&this.panel&&this.context&&!this.deviceOpening.waiting&&televisionPageEligible(washer,this.panel)){
      const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      return this.withUiResourceMetadata(televisionPage({device:washer,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,pendingRole:this.televisionPendingRole,back:()=>this.closePanel(),press:(role,command)=>{if(!current())return;this.televisionPendingRole=role;if(command.kind==='action')void this.runAction({action:command.action,service:command.service,inputs:[]});else void this.setProperty(command.property,command.value);}}));
    }
    if(washer?.model===vacuumModel&&!this.deviceOpening.waiting)return vacuumPage({device:washer,state:this.vacuum,back:()=>this.closePanel(),previous});
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='cloud'&&this.doorbell.selectedEvent)return this.doorbellPlayer?this.withUiResourceMetadata(this.doorbellPlayer.update({...this.context},washer,this.doorbell.date,this.doorbell.selectedEvent,this.doorbell.report?.events,id=>this.doorbell.thumbnail(id),id=>this.doorbell.play(id))):this.loadMediaDrawer('doorbell',washer);
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='events')return this.withUiResourceMetadata(doorbellPage({device:washer,state:this.doorbell,battery:doorbellBattery(this.panel),back:()=>this.closePanel(),live:()=>{this.doorbell.view='live';this.render(true);}}));
    if(washer&&this.context&&cameraPageEligible(washer)&&!this.deviceOpening.waiting){
      if(!this.cameraPlayer)return this.loadMediaDrawer('camera',washer);
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
    const hasGenericDescriptor=!dedicated&&!this.panelLoading&&!this.panelError&&!!this.panel?.specType&&!this.panel.unsupportedReason
      &&this.panel.did===washer?.did&&this.panel.model===washer?.model;
    const dataReady=presentationReady(washer,this.panel)||hasGenericDescriptor||(washer?.model===routerModel&&!!this.router.report);
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
    if(washer?.model===routerModel&&this.panel){return this.withUiResourceMetadata(routerPage({device:washer,state:this.router,artwork,back:()=>this.closePanel()}));}
    if(washer?.model===dispenserModel&&this.panel&&dispenserProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);this.dispenserCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserDnd.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserHistory.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSterilization.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSelfCheck.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-history'||this.dispenserView.page==='selfcheck-report'){return this.withUiResourceMetadata(dispenserSelfCheckPage({device:washer,panel:this.panel,commands:this.dispenserSelfCheck,view:this.dispenserView.page,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserCommands.pending||this.dispenserDnd.pending||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserSelfCheck.confirming=false;if(this.dispenserView.page==='selfcheck')this.dispenserSelfCheck.checked=false;this.dispenserView={page:this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-report'&&this.dispenserSelfCheck.selected?.time===0?'settings':this.dispenserView.page==='selfcheck-history'?'selfcheck':'selfcheck-history'};this.dispenserSelfCheck.selected=undefined;this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},history:()=>{if(current()){this.dispenserView={page:'selfcheck-history'};this.render(true);void this.dispenserSelfCheck.loadHistory(context);}},report:()=>{if(current()){this.dispenserView={page:'selfcheck-report'};this.render(true);}},run:(operation,expected)=>{if(current())void this.dispenserSelfCheck.run(context,operation,expected).finally(()=>{if(current())this.schedulePanelRefresh();});}}));}
      this.dispenserReminders.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='reminders')return this.withUiResourceMetadata(dispenserRemindersPage({state:this.dispenserReminders,view:this.dispenserReminderView,busy:this.controlBusy||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserReminderView={page:'settings'};this.dispenserView={page:'settings'};this.render(true);}},changed:()=>{if(current())this.render(true);},navigate:view=>{if(current()){this.dispenserReminderView=view;this.render(true);}},save:(update,revision)=>current()?this.dispenserReminders.save(context,update,revision):Promise.resolve(false),read:()=>{if(current())void this.dispenserReminders.read(context).then(()=>{if(current()&&!this.dispenserReminders.error&&this.dispenserReminderView.page==='edit'){this.dispenserReminderView={page:'list'};this.render(true);}});}}));
      if(this.dispenserView.page==='sterilization'){
        const run=(operation:'start'|'stop')=>{if(!current()||!this.panel)return;const status=sterilizationState(this.panel).status;if(status===null)return;void this.dispenserSterilization.run(context,{operation,expectedStatus:status}).finally(()=>{if(current())this.schedulePanelRefresh();});};
        return this.withUiResourceMetadata(dispenserSterilizationPage({device:washer,panel:this.panel,commands:this.dispenserSterilization,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserCommands.pending||this.dispenserDnd.pending,artwork,back:()=>{if(current()){this.dispenserSterilization.confirming=false;this.dispenserView={page:'settings'};this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},start:()=>run('start'),stop:()=>run('stop'),refresh:()=>{if(current())void this.dispenserSterilization.refresh(context).finally(()=>{if(current())this.schedulePanelRefresh();});},error:this.panelError?.message}));
      }
      if(this.dispenserView.page==='statistics'||this.dispenserView.page==='records'){
        const records=this.dispenserView.page==='records',select=(selection:import('./dispenser-history').DrinkSelection)=>{if(current()){this.dispenserHistoryPicker=undefined;void this.dispenserHistory.loadStatistics(context,selection);}};
        return this.withUiResourceMetadata(dispenserHistoryPage({view:records?'records':'statistics',state:this.dispenserHistory,artwork,back:()=>{if(current()){this.dispenserView={page:records?'statistics':'home'};this.dispenserHistoryPicker=undefined;this.render(true);}},records:()=>{if(current()){this.dispenserView={page:'records'};this.render(true);void this.dispenserHistory.loadRecords(context);}},more:()=>{if(current())this.dispenserHistory.more(context);},select,retry:()=>{if(current()){if(records)void this.dispenserHistory.loadRecords(context,null,true);else void this.dispenserHistory.loadStatistics(context,this.dispenserHistory.selection,true);}},changed:()=>{if(current())this.render(true);},picker:this.dispenserHistoryPicker,showPicker:picker=>{if(current()){this.dispenserHistoryPicker=picker;this.render(true);}}}));
      }
      if(this.dispenserView.page==='dnd')return this.withUiResourceMetadata(dispenserDndPage({state:this.dispenserDnd,artwork,busy:this.controlBusy,online:washer.online,back:()=>{if(current()){this.dispenserView={page:'settings'};this.render(true);}},changed:()=>{if(current())this.render(true);},save:change=>{if(current())void this.dispenserDnd.save(context,change).then(()=>{if(current())void this.readProperties();});},read:()=>{if(current())void this.dispenserDnd.read(context);}}));
      if(this.dispenserView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.siid===2?s.actions.filter(a=>![2,3,4].includes(a.aiid)):s.siid===7?s.actions.filter(a=>![1,2].includes(a.aiid)):s.actions,properties:s.properties.map(p=>[[2,7],[2,6],[3,1],[4,1],[5,1],[2,9],[2,10],[2,11],[2,12]].some(([siid,piid])=>p.siid===siid&&p.piid===piid)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',()=>{this.dispenserView={page:'settings'};this.render(true);},'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(dispenserPage({device:washer,panel:this.panel,view:this.dispenserView,dndEnabled:this.dispenserDnd.report?.enabled,commands:this.dispenserCommands,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserDnd.pending||this.dispenserSterilization.pending||this.dispenserReminders.pending,artwork,back:()=>this.closePanel(),navigate:view=>{if(current()){this.dispenserView=view;this.render(true);if(view.page==='settings'||view.page==='dnd')void this.dispenserDnd.read(context);if(view.page==='statistics')void this.dispenserHistory.loadStatistics(context,this.dispenserHistory.selection);if(view.page==='sterilization'||view.page==='selfcheck')void this.readProperties();if(view.page==='reminders'){this.dispenserReminderView={page:'settings'};void this.dispenserReminders.read(context);}}},changed:()=>{if(current())this.render(true);},change:change=>current()?this.dispenserCommands.change(context,change):Promise.resolve(false),refresh:()=>{if(current())void this.dispenserCommands.refresh(context);},compatibility:()=>{if(current()){this.dispenserView={page:'compatibility'};this.render(true);}},error:this.panelError?.message}));
    }
    if(washer?.model===fridgeModel&&this.panel&&fridgeProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context),home=()=>{if(current()){this.fridgeView={page:'home'};this.render(true);}};this.fridgeCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.fridgeView.page==='compatibility'){
        const controlled=(['mode','refrigerating','freezing','maternal']as const).map(f=>fridgeProperty(this.panel!,f)).filter(Boolean),panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.name==='fridge-reset'?[]:s.actions,properties:s.properties.map(p=>controlled.some(q=>q!.siid===p.siid&&q!.piid===p.piid)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))},document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});
        const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',home,'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(fridgePage({device:washer,panel:this.panel,view:this.fridgeView,commands:this.fridgeCommands,cached:this.panelIsCached,busy:this.controlBusy,artwork,back:()=>this.closePanel(),home,settings:()=>{if(current()){this.fridgeView={page:'settings'};this.render(true);}},compatibility:()=>{if(current()){this.fridgeView={page:'compatibility'};this.render(true);}},changed:()=>{if(current())this.render(true);},write:(field,value)=>{const expected=fridgeCurrent(this.panel!,field);if(current()&&expected!==undefined)void this.fridgeCommands.change(context,{field,expected,value});},reset:expected=>{if(current())void this.fridgeCommands.reset(context,expected);},refresh:()=>{if(current())void this.fridgeCommands.refresh(context);},error:this.panelError?.message}));
    }
    if(washer?.model===airerModel&&this.panel&&airerProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context),home=()=>{if(current()){this.airerView={page:'home'};this.render(true);}};this.airerCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.airerView.page==='compatibility'){const panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.siid===4?s.actions.filter(a=>a.aiid>5):s.actions,properties:s.properties.map(p=>(p.siid===2&&[2,6].includes(p.piid)||p.siid===4&&([1,2,3,4,5,6,9].includes(p.piid)))?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',home,'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);}
      return this.withUiResourceMetadata(airerPage({device:washer,panel:this.panel,view:this.airerView,commands:this.airerCommands,cached:this.panelIsCached,busy:this.controlBusy,artwork,back:()=>this.closePanel(),home,changed:()=>{if(current())this.render(true);},lift:intent=>{const status=airerStatus(this.panel!);if(current()&&status!==undefined)void this.airerCommands.lift(context,{intent,expectedStatus:status});},write:(p,v)=>{if(current())void this.setProperty(p,v);},night:()=>{const night=airerNight(this.panel!);if(current()&&night){this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}},save:()=>{const draft=this.airerView.draft;if(current()&&draft)void this.airerCommands.night(context,draft).then(saved=>{if(saved&&current())home();});},compatibility:()=>{if(current()){this.airerView={page:'compatibility'};this.render(true);}},refresh:()=>{if(current())void this.airerCommands.refresh(context).then(read=>{if(read&&current()&&this.airerView.page==='night'){const night=airerNight(this.panel!);if(night)this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}});},error:this.panelError?.message}));
    }
    if(washer?.model==='xiaomi.waterpuri.lx32'&&this.panel?.purifier&&!this.panel.unsupportedReason){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      if(this.purifierView.page==='guide'){this.purifierGuide??=purifierGuidePage(()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},artwork);return this.withUiResourceMetadata(this.purifierGuide.node);}
      this.purifierCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.purifierDnd.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.purifierOptions.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.purifierView.page==='functions'&&!this.purifierOptions.loading&&!this.purifierOptions.error&&!this.purifierOptions.pending&&!this.purifierOptions.blocked&&(!this.purifierOptions.report||this.purifierOptions.report.filterFlushingSupported===true&&typeof purifierSetting(this.panel,'flushing')?.value==='boolean'&&this.purifierOptions.report.flushing!==purifierSetting(this.panel,'flushing')?.value))queueMicrotask(()=>{if(current())void this.purifierOptions.read(context);});
      if(['functions','dnd'].includes(this.purifierView.page)&&!this.purifierDnd.report&&!this.purifierDnd.loading&&!this.purifierDnd.error&&!this.purifierDnd.pending)queueMicrotask(()=>{if(current())void this.purifierDnd.read(context);});
      if(this.purifierView.page==='dnd')return this.withUiResourceMetadata(purifierDndPage({state:this.purifierDnd,artwork,busy:this.panelIsCached,online:washer.online,changed:()=>{if(current())this.render(true);},back:()=>{if(current()){this.purifierDnd.picker=undefined;this.purifierView={page:'functions',filter:0};this.render(true);}},save:change=>{if(current())void this.purifierDnd.save(context,change);},read:()=>{if(current())void this.purifierDnd.read(context);}}));
      this.purifierHistory.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      const home=()=>{if(current()){this.purifierHistoryPicker=undefined;this.purifierView=newPurifierView();this.render(true);}};
      const water=this.purifierHistory,week:WaterSelection={period:'week',date:dateKey(new Date())};
      const statistics=(selection:WaterSelection)=>{if(current()){this.purifierHistoryPicker=undefined;this.purifierView={page:'statistics',filter:0};void water.loadStatistics(context,selection).then(()=>{if(current()&&this.purifierView.page==='statistics'&&water.selection.period===selection.period&&water.selection.date===selection.date&&water.selectedTime!==undefined)water.chooseBucket(context,water.selectedTime);});this.render(true);}};
      if(this.purifierView.page==='tds'||this.purifierView.page==='statistics')return this.withUiResourceMetadata(purifierHistoryPage({mode:this.purifierView.page,state:water,artwork,back:home,
        record:id=>{if(current())water.chooseRecord(id);},more:()=>{if(current())water.showMore(context);},select:statistics,bucket:time=>{if(current())water.chooseBucket(context,time);},
        retry:()=>{if(current()){if(this.purifierView.page==='tds')void water.loadRecords(context,{scope:'latest',before:null},true);else if(water.recordError&&!water.statisticsError)void water.loadRecords(context,{...water.query,before:null},true);else {const selection={...water.selection};void water.loadStatistics(context,selection,true).then(()=>{if(current()&&this.purifierView.page==='statistics'&&water.selection.period===selection.period&&water.selection.date===selection.date&&water.selectedTime!==undefined)water.chooseBucket(context,water.selectedTime);});}}},
        picker:this.purifierHistoryPicker,showPicker:picker=>{if(current()){this.purifierHistoryPicker=picker;this.render(true);}}}));
      if(this.purifierView.page==='home'&&(!water.statistics||water.selection.period!=='week'||water.selection.date!==week.date)&&!water.statisticsLoading&&!water.statisticsError)queueMicrotask(()=>{if(current()&&this.purifierView.page==='home')void water.loadStatistics(context,week);});
      if(['functions','pipeline','water-mode'].includes(this.purifierView.page))return this.withUiResourceMetadata(purifierSettingsPage({device:washer,panel:this.panel,view:this.purifierView,cached:this.panelIsCached,busy:this.controlBusy||this.purifierDnd.pending||this.purifierOptions.pending,error:this.panelNotice?.title??this.panelError?.message,dnd:{enabled:this.purifierDnd.report?.enabled??null,visible:!this.currentHome()?.shared&&(!!this.preview||this.currentHome()?.ownerId===this.session?.userId)},options:this.purifierOptions,push:enabled=>{if(current())void this.purifierOptions.save(context,enabled);},
        back:()=>{if(current()){if(this.purifierView.page==='functions')home();else{this.purifierView={page:'functions',filter:0};this.render(true);}}},
        open:page=>{if(current()){this.purifierView={page,filter:0};this.render(true);}},changed:()=>{if(current())this.render(true);},write:(p,value)=>{if(current())void this.setProperty(p,value);},refresh:()=>{if(current()){void this.readProperties(true);void this.purifierOptions.read(context);}}}));
      if(this.purifierView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.map(s=>({...s,properties:s.properties.map(p=>p.siid===7&&p.piid===1||p.siid===6&&p.piid===1||isPurifierSetting(p)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};
        const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});
        const stage=element('div','device-stage'),page=element('section','device-page page-generic');
        const back=button('','page-icon-button',()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},'back');back.setAttribute('aria-label','返回设备设置');
        page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','','设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(purifierPage({device:washer,panel:this.panel,view:this.purifierView,commands:this.purifierCommands,cached:this.panelIsCached,artwork,error:this.panelError?.message,
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
      const runtime=this.washerRuntimeCommands.display(this.panel).washerRuntime;
      const runtimeReadAt=!this.panelIsCached&&washer.online?this.devicePreviewCache.get(this.deviceCacheKey(washer,context))?.at:undefined;
      if(this.washerView==='runtime'&&this.panel.washerRuntime?.stage==='blowing and shaking'&&!this.panel.washerRuntime.cleaning)this.washerView='home';
      if(this.washerView==='runtime'){
        if(runtime?.active){clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;}
        else if(runtime&&['off','idle'].includes(runtime.state)&&!this.washerRuntimeCommands.pending&&!this.washerRuntimeExitTimer){this.washerRuntimeExitTimer=setTimeout(()=>{this.washerRuntimeExitTimer=undefined;if(current()&&this.washerView==='runtime'){this.washerView='home';this.washerRuntimeConfirmation=undefined;this.render(true);}},1000);}
        return this.withUiResourceMetadata(washerRuntimePage({device:washer,panel:this.panel,programs,commands:this.washerRuntimeCommands,cached:this.panelIsCached||this.controlBusy||this.washerCommands.pending,readAt:runtimeReadAt,confirmation:this.washerRuntimeConfirmation,
          back:()=>{if(current())this.backFromWasherRuntime();},refresh:()=>{if(current())void this.washerRuntimeCommands.refresh(context);},
          choose:control=>{if(!current()||this.panelIsCached||this.washerRuntimeCommands.blocked||!control.enabled)return;if(control.confirmation){this.washerRuntimeConfirmation=control;this.render(true);}else void this.washerRuntimeCommands.execute(context,control);},
          cancel:()=>{if(current()){this.washerRuntimeConfirmation=undefined;this.render(true);}},
          submit:()=>{const control=this.washerRuntimeConfirmation;if(current()&&control){this.washerRuntimeConfirmation=undefined;void this.washerRuntimeCommands.execute(context,control);}}}));
      }
      if(this.washerView==='records')return this.withUiResourceMetadata(washerRecordsPage({state:this.washerRecords,programs,config:this.washerConfig,panel:this.panel,artwork,
        back:()=>{if(!current())return;if(this.washerRecords.selected)this.washerRecords.closeDetail();else{this.washerView='home';this.render(true);}},
        select:selection=>{if(current())void this.washerRecords.load(context,selection);},more:()=>{if(current())void this.washerRecords.load(context,this.washerRecords.selection,true);},retry:()=>{if(current())void this.washerRecords.retry(context);},bucket:index=>{if(current())void this.washerRecords.selectBucket(context,index);},
        open:row=>{if(current())void this.washerRecords.openDetail(context,row);},retryDetail:()=>{if(current()&&this.washerRecords.selected)void this.washerRecords.openDetail(context,this.washerRecords.selected);},changed:()=>{if(current())this.render(true);}}));
      return this.withUiResourceMetadata(washerPage({device:washer,panel:this.panel,report:this.washerConfig,programs,draft:this.washerDraft,view:this.washerView,loading:this.washerLoading,error:this.washerError,commands:this.washerCommands,orderAt:this.washerOrderAt,artwork,runtime:runtime??undefined,runtimeReadAt,
        openRuntime:()=>{if(current()&&this.panel&&this.washerRuntimeCommands.display(this.panel).washerRuntime?.active){this.washerView='runtime';this.render(true);}},
        back:()=>{if(washer.model!=='midjd8.washer.42'){this.washerProgramsOpen=false;this.washerView='home';this.render(true);}else this.closePanel();},home:()=>{if(current()){this.washerView='home';this.washerDraft=undefined;this.washerCommands.reset();this.washerOrderAt=undefined;this.render(true);}},more:()=>{if(current()){this.washerView='more';this.render(true);}},records:washer.model==='midjd8.washer.42'?()=>{if(current()){this.washerView='records';void this.washerRecords.load(context);}}:undefined,
        select:program=>{if(current()&&this.washerConfig&&!(runtime?.active&&runtime.state!=='completed')){this.washerCommands.reset();this.washerDraft=newWasherDraft(this.washerConfig,program);this.washerView='program';this.washerCommands.edit(context,this.washerDraft);this.render(true);}},
        change:draft=>{if(!current()||!this.washerConfig||!this.washerDraft||!this.panel||this.washerCommands.locked)return;const program=programs.find(p=>p.name===draft.program);if(!program)return;
          const changed=Object.keys(draft.values).find(key=>draft.values[key]!==this.washerDraft!.values[key]);
          this.washerDraft=changed?changeWasherDraft(this.washerConfig,program,this.panel,this.washerDraft,changed,draft.values[changed]):{...this.washerDraft,selector:draft.selector};if(changed)this.washerCommands.edit(context,this.washerDraft);this.render(true);
        },refresh:()=>{if(!current())return;if(this.washerDraft)void this.washerCommands.refresh(context,this.washerDraft);else void this.loadWasherConfig(context,epoch);},
        order:()=>{if(!current()||!this.washerDraft||!this.washerCommands.canStart)return;const at=Math.ceil((Date.now()+((this.washerCommands.preview?.estimatedMinutes??0)+6)*60000)/60000)*60000;this.washerOrderAt=at;this.washerCommands.reservationAt=at;this.washerCommands.edit(context,this.washerDraft);},
        changeOrder:at=>{if(current()&&this.washerDraft&&!this.washerCommands.locked){this.washerOrderAt=at;this.washerCommands.reservationAt=at;this.washerCommands.edit(context,this.washerDraft);}},cancelOrder:()=>{if(current())this.closeWasherOrder();},
        start:()=>{if(current()&&this.washerDraft)void this.washerCommands.start(context,this.washerDraft);},confirm:()=>{if(current()&&this.washerDraft)void this.washerCommands.confirm(context,this.washerDraft);}}));
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
    if((layout==='light'||layout==='light-group')&&lightControlBindings(this.panel).color)page.classList.add('page-yeelight-strip');
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
        if(layout!=='light'&&layout!=='light-group'){
          const relayOnly = layout === 'outlet' && capabilityCategory(this.panel.specType) === 'air-condition-outlet';
          const excludedServices = new Set(this.panel.services.filter(s=>
            (layout === 'air-conditioner' || relayOnly) && s.name === 'power-consumption' ||
            relayOnly && ['air-conditioner','fan-control'].includes(s.name)).map(s=>s.siid));
          this.applyOfficialCustomItems(content, document, device, excludedServices);
          const omitted=new Set([...content.querySelectorAll<HTMLElement>('[data-siid][data-piid]')].map(n=>`${n.dataset.siid}.${n.dataset.piid}`));
          for(const node of content.querySelectorAll<HTMLElement>('[data-bound-properties]'))for(const key of node.dataset.boundProperties!.split(' '))if(key)omitted.add(key);
          for(const b of resolveDeviceCapabilities(this.panel).properties)if(b.kind==='reading'||excludedServices.has(b.siid))omitted.add(`${b.siid}.${b.piid}`);
          const extraContext=this.context?{...this.context}:undefined,extraEpoch=this.panelEpoch;
          const extraCurrent=()=>extraEpoch===this.panelEpoch&&sameContext(extraContext,this.context);
          const extras=renderCategoryPage({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,omit:omitted,write:(p,v)=>{if(extraCurrent())void this.setBoundProperty(p,v,device.did);},error:e=>{if(extraCurrent()){this.panelError=normalizeError(e);this.render(true);}}});
          if(extras.querySelector('.device-control-unit'))content.append(extras);
        }
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
      device, panel: this.panel!, busy:this.panelIsCached,
      write: (property, value) => { void this.setBoundProperty(property, value, device.did); },
      error: error => { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); },
      propertyEditor: (property, service, label) => this.renderPropertyEditor(property, service, device, label),
      action: (action, service) => this.renderAction(action, service, device.online),
    });
  }

  private applyOfficialCustomItems(content: HTMLElement, document: PanelDocument, device: Device, excludedServices: ReadonlySet<number>): void {
    const additions: ComponentNode[] = [];
    const siblingOrders = new Map<HTMLElement, HTMLElement[]>();
    for (const item of document.items) {
      if (!('binding' in item.props)) continue;
      const binding = item.props.binding;
      if (excludedServices.has(binding.siid)) continue;
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
      if (control.classList.contains('climate-socket-relay') || control.closest('.outlet-channel.is-climate-relay')) continue;
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
    return sharedDeviceViews.renderSwitchPage.call(this.presenterHost(), device);
  }

  private nativeUnavailableFeature(title: string, glyph: IconName, reason: string, subtitle?: string): HTMLElement {
    const item = element('div', 'native-card native-feature', element('span', 'native-feature-icon', icon(glyph)), element('div', '', element('strong', '', title), subtitle ? element('span', '', subtitle) : null));
    item.setAttribute('aria-description',reason);item.setAttribute('aria-disabled','true');
    // Unsupported optional features do not occupy cards on another model's UI.
    item.hidden=true;return item;
  }

  private presenterHost():sharedDeviceViews.DevicePresenterHost {
    const app=this;
    return {
      get panel(){return app.panel;},
      get context(){return app.context;},
      get panelEpoch(){return app.panelEpoch;},
      get controlBusy(){return app.controlBusy;},
      get panelIsCached(){return app.panelIsCached;},
      get snapshot(){return app.snapshot;},
      get linkedPanels(){return app.linkedPanels;},
      get linkedErrors(){return app.linkedErrors;},
      get sensorHistory(){return app.sensorHistory;},
      get historyLoading(){return app.historyLoading;},
      get historyError(){return app.historyError;},
      get energyData(){return app.energyData;},
      get energyLoading(){return app.energyLoading;},
      get energyError(){return app.energyError;},
      get panelNotice(){return app.panelNotice;},
      set panelNotice(value){app.panelNotice=value;},
      control:(...args)=>app.control(...args),
      deviceArtwork:(...args)=>app.deviceArtwork(...args),
      nativeSlider:(...args)=>app.nativeSlider(...args),
      nativeUnavailableFeature:(...args)=>app.nativeUnavailableFeature(...args),
      nativeTemperatureControl:(...args)=>app.nativeTemperatureControl(...args),
      nativeClimateChoices:(...args)=>app.nativeClimateChoices(...args),
      nativeP69Swing:(...args)=>app.nativeP69Swing(...args),
      get lightTab(){return app.lightTab;},
      selectLightTab:tab=>{app.lightTab=tab;},
      render:(...args)=>app.render(...args),
      setBoundProperty:(...args)=>app.setBoundProperty(...args),
      setProperty:(...args)=>app.setProperty(...args),
      selectHistoryDetail:(...args)=>app.selectHistoryDetail(...args),
      loadEnergy:(...args)=>app.loadEnergy(...args),
    };
  }

  private renderLightPage(device: Device, group: boolean): HTMLElement {
    return sharedDeviceViews.renderLightPage.call(this.presenterHost(), device, group);
  }

  private nativeSlider(property: Property | undefined, label: string, unit: string, device: Device, disabledByPower = false, theme = '', valueProperty?: Property): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label, unit, theme, valueProperty, disabledReason: disabledByPower ? '设备开启后可调节。' : undefined } }, device);
  }

  private renderCurtainPage(device: Device): HTMLElement {
    const motionKey=JSON.stringify(this.context);this.curtainMotion=this.curtainMotions.get(motionKey)??new CurtainMotion();this.curtainMotions.set(motionKey,this.curtainMotion);
    const position = findProperty(this.panel, ['curtain'], ['current-position']);
    const target = findProperty(this.panel, ['curtain'], ['target-position']);
    const value = numericValue(position);
    const {view,backdrop}=curtainView({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,write:(endpoint,desired,meaning)=>{if(meaning==='pause'){this.curtainMotion.pause();if(target)this.propertyOps.cancel(this.operationKey(device.did,target.siid,target.piid));}else if(endpoint!==target){this.curtainMotion.start(motionKey,{position:rawPosition??value,target:meaning==='open'?100:0,journey:numericValue(findProperty(raw,['curtain'],['whole-journey-time']))});}void this.setProperty(endpoint,desired);this.schedulePanelRefresh();}});
    const operation=target?this.propertyOps.get(this.operationKey(device.did,target.siid,target.piid)):undefined;
    const raw=this.confirmedPanels.get(device.did)??this.panel,rawPosition=numericValue(findProperty(raw,['curtain'],['current-position']));
    const slider = this.nativeSlider(target, '窗帘开合', '%', device, false, 'curtain', operation?.pending?target:position);
    view.append(slider);
    this.curtainMotion.attach(backdrop,JSON.stringify(this.context),{position:rawPosition??value,target:operation?.pending?Number(operation.target):numericValue(target),status:numericValue(findProperty(raw,['curtain'],['status'])),journey:numericValue(findProperty(raw,['curtain'],['whole-journey-time'])),pending:operation?.pending,revision:operation?.revision,outcome:operation?.outcome},(current,goal)=>{
      const output=slider.querySelector('.native-slider-value'),input=slider.querySelector<HTMLInputElement>('input');if(output)output.textContent=`${Math.round(current)}%`;
      slider.dataset.displayPosition=current.toFixed(2);if(!slider.dataset.interacting)slider.style.setProperty('--curtain-progress',`${current}%`);
      if(input&&!slider.dataset.interacting){input.value=String(operation?.pending?Number(operation.target):this.curtainMotion.moving?goal:current);input.setAttribute('aria-valuetext',`目标 ${input.value}%，当前 ${Math.round(current)}%`);}
    },()=>{const context={...this.context!},motion=this.curtainMotion,generation=motion.generation;void this.readProperties(true).then(()=>{if(!sameContext(context,this.context)||motion!==this.curtainMotion||motion.generation!==generation)return;const report=this.confirmedPanels.get(device.did),status=numericValue(findProperty(report,['curtain'],['status'])),position=numericValue(findProperty(report,['curtain'],['current-position']));if(position!==undefined&&status!==1&&status!==2)motion.reconcile(position);});});
    return view;
  }

  private renderFanPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderFanPage.call(this.presenterHost(), device);
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
    return sharedDeviceViews.nativeP69Swing.call(this.presenterHost(), property, angle, title, direction, device, disabledByPower);
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
    return sharedDeviceViews.renderAirConditionerPage.call(this.presenterHost(), device);
  }

  private nativeTemperatureControl(property: Property | undefined, device: Device, disabledByPower: boolean): HTMLElement {
    return sharedDeviceViews.nativeTemperatureControl.call(this.presenterHost(), property, device, disabledByPower);
  }

  private nativeClimateChoices(property: Property | undefined, title: string, device: Device, disabledByPower: boolean): HTMLElement {
    return sharedDeviceViews.nativeClimateChoices.call(this.presenterHost(), property, title, device, disabledByPower);
  }

  private renderPropertyEditor(property: Property, service: Service, device: Device, title = property.description || property.name): HTMLElement {
      title=devicePropertyLabel(property,title);
      // The schema's explicit-input slot retains the previous advanced form,
      // including write-only/string values and unbounded numeric properties.
      const row = element('div', 'property-row');
      row.dataset.control = 'PropertyEditor'; row.dataset.siid = String(property.siid); row.dataset.piid = String(property.piid); row.dataset.boundDeviceId = device.did;
      const label = element('label', 'property-label', title);
      const reading=propertyReading(property),recent=reading.source==='recent';
      const value = element('span', `property-value${!recent&&property.code != null && property.code !== 0 ? ' value-error' : ''}`, displayValue(recent?{...property,code:0,value:reading.value}:property));
      row.append(element('div', 'property-heading', label, value));
      const reported = recent?'最近一次读取':reportedValueText(property);
      if (reported) {row.setAttribute('aria-description',reported);row.dataset.readingSource=recent?'recent':'reported';}
      if (property.access.includes('write')) {
        const reason = writeUnsupportedReason(property);
        if (reason) row.setAttribute('aria-description', [reported, reason].filter(Boolean).join(' · '));
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
          if (!property.access.includes('read')) input.setAttribute('aria-description', '此属性仅支持写入，无法回读确认；请观察设备实际反馈。');
          if (property.valueRange) row.append(element('p', 'field-help', `范围 ${property.valueRange[0]}–${property.valueRange[1]} · 步长 ${property.valueRange[2]}`));
        }
      } else row.append(element('span', 'read-only-label', '只读'));
      return row;
  }

  private propertyInput(property: Property, id: string): HTMLInputElement | HTMLButtonElement {
    let input: HTMLInputElement | HTMLButtonElement;
    if (property.valueList || property.format === 'bool') {
      const options=property.valueList?.map((choice,index)=>({value:String(index),label:deviceChoiceLabel(choice.description,`选项${index+1}`)}))??[{value:'false',label:'关闭'},{value:'true',label:'开启'}];
      const select=dropdownSelect({label:property.description||property.name,className:'control-field',options:[{value:'',label:'请选择',disabled:true},...options]});
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
      execute.disabled=!online||this.panelIsCached;
      form.append(execute);form.addEventListener('submit',event=>event.preventDefault());return form;
    }
    const title = element('div', 'action-title', element('strong', '', action.description || action.name), element('span', 'action-tag', '动作'));
    form.append(title);
    const inputs: { property: Property; input: HTMLInputElement | HTMLButtonElement }[] = [];
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
    if (unsupported) form.setAttribute('aria-description', unsupported);
    else {
      const execute = button('执行动作', 'button button-small button-secondary', () => {
        try { this.actionConfirm = { action, service, inputs: inputs.map(({ property, input }) => coercePropertyInput(property, input.value)) }; this.render(); }
        catch (error) { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); }
      }, 'arrow');
      execute.disabled = !online || this.controlBusy;
      form.append(execute);

    }
    form.addEventListener('submit', event => event.preventDefault());
    return form;
  }

  private renderActionConfirmation(): HTMLElement {
    const pending = this.actionConfirm!;
    const modal = element('section', 'confirm-dialog'); modal.tabIndex = -1; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'confirm-title');
    const title = element('h2', '', '确认执行设备动作'); title.id = 'confirm-title';
    modal.append(element('div', 'confirm-icon', icon('warning')), title, element('p', '', `即将在「${this.currentDevice()?.name ?? '设备'}」上执行「${pending.action.description || pending.action.name}」。${this.preview?'此操作仅用于模拟。':'此操作会影响真实设备。'}`));
    if (pending.inputs.length) modal.append(element('div', 'confirm-values', ...pending.inputs.map((value, index) => {
      const property = pending.service.properties.find(item => item.piid === pending.action.in[index]);
      return element('div', '', element('span', '', property?.description ?? `参数 ${index + 1}`), element('strong', '', typeof value === 'string' ? value : JSON.stringify(value)));
    })));
    modal.append(element('p', 'confirm-note', '请确认设备周围环境安全，并在执行后观察设备反馈。接口接受请求不代表动作已实际完成。'));
    const cancel = button('取消', 'button button-secondary', () => { this.actionConfirm = undefined; this.render(); }); cancel.disabled = this.controlBusy;
    const confirm = button('确认执行', 'button button-primary', () => { void this.runAction(pending); }); confirm.disabled = this.panelIsCached;
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
  private propertyDependencies(did:string,property:Property):{key:string;revision:number}[]{const panel=this.confirmedPanels.get(did)??(this.context?.did===did?this.panel:this.linkedPanels.get(did));return this.propertyOps.entries().filter(([k,op])=>{const[d,s]=JSON.parse(k)as[string,number,number];return d===did&&s===property.siid&&op.pending&&property.name!=='on'&&panel?.services.flatMap(s=>s.properties).some(p=>p.siid===s&&p.name==='on'&&k===this.operationKey(did,p.siid,p.piid));}).map(([key,op])=>({key,revision:op.revision}));}
  private startOptimisticProperty(property:Property,value:Json,did:string):boolean{
    if(!this.context)return false;
    const panel=did===this.context.did?this.panel:this.linkedPanels.get(did);
    const device=this.deviceIndex.find(this.snapshot?.devices,did),category=panel?.specType?.split(':')[3];
    if(property.name==='color'&&(category!=='light'||rgbPropertyReason(property)))return false;
    const actual=(this.confirmedPanels.get(did)??panel)?.services.flatMap(s=>s.properties).find(p=>p.siid===property.siid&&p.piid===property.piid)??property;
    if(!panel||!device?.online||device.sharedReadOnly||!actual.access.includes('write')||writeUnsupportedReason(actual))return false;
    const key=this.operationKey(did,property.siid,property.piid);this.propertyContexts.set(key,{context:{...this.context,did},homeEpoch:this.homeEpoch});
    const dependencies=this.propertyDependencies(did,actual);
    this.panelNotice=undefined;this.propertyOps.write(key,value,actual.value??null,dependencies);return true;
  }
  private recentPanel={epoch:-1,values:new Map<string,NonNullable<Property['recentObservation']>>()};
  private acceptPanel(panel:DevicePanel,readVersion:number,passive=false):void{
    const previous=this.confirmedPanels.get(panel.did);const curtainTarget=panel.services.flatMap(s=>s.properties).find(p=>p.name==='target-position'),curtainOp=curtainTarget?this.propertyOps.get(this.operationKey(panel.did,curtainTarget.siid,curtainTarget.piid)):undefined;
    const carried=new Set<Property>();
    panel={...panel,services:panel.services.map(s=>({...s,properties:s.properties.map(p=>{const op=this.propertyOps.get(this.operationKey(panel.did,p.siid,p.piid));if((op&&op.revision>readVersion||p.name==='current-position'&&curtainOp&&curtainOp.revision>readVersion)&&previous){const old=previous.services.find(s=>s.siid===p.siid)?.properties.find(q=>q.piid===p.piid);if(old){carried.add(old);return old;}}return p;})}))};
    this.confirmedPanels.set(panel.did,panel);
    this.confirmedPanelVersions.set(panel.did,readVersion);
    this.rememberDevice(panel);
    let display=panel;
    if(this.context?.did===panel.did){
      if(this.recentPanel.epoch!==this.panelEpoch)this.recentPanel={epoch:this.panelEpoch,values:new Map()};
      const device=this.currentDevice(),now=Date.now(),values=this.recentPanel.values;
      if(!device?.online||device.sharedReadOnly)values.clear();
      else display={...panel,services:panel.services.map(s=>({...s,properties:s.properties.map(p=>{
        const key=`${p.siid}:${p.piid}`,old=values.get(key);
        if(isReadableValue(p)){if(!carried.has(p))values.set(key,{value:p.value!,expiresAt:now+30000});return p;}
        if(p.code===-704042011||p.code===-704010000||!passive||old&&old.expiresAt<=now){values.delete(key);return p;}
        return old?{...p,recentObservation:old}:p;
      })}))};
    }
    const merged=this.projectPanel(display,readVersion);
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
    const settled=this.propertyOps.lastSettled;if(settled&&settled.settledRevision>this.operationNoticeRevision){this.operationNoticeRevision=settled.settledRevision;if(settled.outcome==='rejected'){this.panelNotice=undefined;this.uiNotice=undefined;}}
    if(this.context)this.render(true);else this.homeCardChanged();
  }
  private async propertyRequest(key:string,value:Json,read:boolean):Promise<PropertyReply>{
    if(read)return this.propertyTransport(key,value,true);const revision=this.propertyOps.get(key)?.revision,did=(JSON.parse(key)as[string])[0];
    return this.serializeDevice(did,()=>this.propertyOps.get(key)?.revision!==revision||!this.propertyOps.get(key)?.pending?Promise.resolve({outcome:'pending' as const,message:'已由最新操作替代'}):this.propertyTransport(key,value,false));
  }
  private pendingDeviceSends=0;
  private serializeDevice<T>(did:string,send:()=>Promise<T>):Promise<T>{this.pendingDeviceSends++;const task=(this.deviceSends.get(did)??Promise.resolve()).then(send).finally(()=>{this.pendingDeviceSends--;});this.deviceSends.set(did,task.then(()=>{},()=>{}));return task;}
  private async propertyTransport(key:string,value:Json,read:boolean):Promise<PropertyReply>{
    const binding=this.propertyContexts.get(key);if(!binding)throw {kind:'staleContext',message:'设备已经关闭。'};
    const[did,siid,piid]=JSON.parse(key) as [string,number,number],context={...binding.context},version=this.propertyOps.version;
    const current=()=>binding.homeEpoch===this.homeEpoch&&this.snapshot?.homeId===context.homeId&&this.snapshot.generation===context.generation;
    try{
      if(!current())throw {kind:'staleContext',message:'家庭已经切换，未发送排队操作。'};
      if(binding.homePower){

        const intent=value?'on':'off';const r=await(read?this.transport.confirmHomeCard(context,intent):this.transport.changeHomeCard(context,intent));if(!current())throw {kind:'staleContext',message:'家庭已经切换。'};if(r.card&&this.homeCards)this.homeCards={...this.homeCards,cards:this.homeCards.cards.map(c=>c.did===did?r.card!:c)};return{outcome:r.verified?'confirmed':'pending',actual:r.actual==='on'?true:r.actual==='off'?false:undefined,message:r.message};}
      const p=this.confirmedPanels.get(did)?.services.flatMap(s=>s.properties).find(p=>p.siid===siid&&p.piid===piid),position=binding.homeCurtain?{siid:2,piid:4}:p?.name==='target-position'?findProperty(this.confirmedPanels.get(did),['curtain'],['current-position']):undefined;
      const result=await(read?this.transport.confirmProperty({...context,did},position?.siid??siid,position?.piid??piid,value):this.transport.setProperty({...context,did},siid,piid,value));
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
      const result = await this.transport.setProperty({ ...context, did }, property.siid, property.piid, value);
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
    this.controlBusy = true; this.panelNotice = undefined; this.render();
    try {
      const result = await this.serializeDevice(context.did,()=>this.transport.setProperty(context, property.siid, property.piid, value));
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      if (result.panel.did !== context.did) throw new Error('控制返回的设备不匹配，请重新读取状态。');
      this.acceptPanel(result.panel,this.propertyOps.version);
      this.panelDrafts.delete(`property-${property.siid}-${property.piid}`);
      this.panelNotice = result.verified?undefined:{tone:'warning',title:'设备状态尚未确认',message:result.message};
    } catch (error) {
      if (epoch !== this.panelEpoch || !sameContext(context, this.context)) return;
      const appError = normalizeError(error); this.panelNotice = { tone: 'error', title: appError.message }; this.handleSessionError(appError);
    } finally {
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.controlBusy = false; this.render(); }
    }
  }

  private actionRevision=0;
  private async runAction(pending: PendingAction): Promise<void> {
    if(this.presentationRoute.changed||!this.context||this.panelIsCached||!this.currentDevice()?.online||this.currentDevice()?.sharedReadOnly)return;
    const context={...this.context},epoch=this.panelEpoch,revision=++this.actionRevision;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    this.actionConfirm=undefined;this.panelNotice=undefined;this.render(true);
    // Action keys have no persistent value to predict. Accept each deliberate
    // press immediately; serialize transport without locking unrelated controls.
    try{
      const result=await this.serializeDevice(context.did,async()=>{
        if(!current())throw {kind:'staleContext',message:'设备已经关闭，未发送排队操作。'};
        const version=this.propertyOps.version,result=await this.transport.runAction(context,pending.action.siid,pending.action.aiid,pending.inputs);
        if(current()&&revision===this.actionRevision){if(result.panel.did!==context.did)throw Error('动作返回的设备不匹配。');this.acceptPanel(result.panel,version);}
        return result;
      });
      if(!current()||revision!==this.actionRevision)return;
      for(const piid of pending.action.in)this.panelDrafts.delete(`action-${pending.service.siid}-${pending.action.aiid}-${piid}`);
      void result;
    }catch(error){if(current()&&revision===this.actionRevision){const failure=normalizeError(error);this.panelNotice={tone:'error',title:failure.message};this.handleSessionError(failure);}}
    finally{if(current())this.render(true);}
  }

  private async logout(): Promise<void> {
    if (this.logoutBusy) return;
    this.logoutBusy = true; this.render();
    try {
      await this.transport.logout();
      ++this.loginEpoch; ++this.homeEpoch;
      if (this.loginTimer) clearTimeout(this.loginTimer);
      if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
      this.session = undefined;this.accountProfile=undefined;this.profileError=false;this.homes = []; this.selectedHomeId = ''; this.snapshot = undefined;
      this.clearPanel(); this.resetLocalView(); this.homeError = undefined; this.sessionNotice = undefined; this.loginError = undefined; this.loginState = 'idle'; this.homeBusy = false;
    } catch (error) { this.homeError = normalizeError(error); }
    this.logoutBusy = false; this.render();
  }
  private control(node: ControlNode, device: Device): HTMLElement {
    const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
    const control = renderControl(node, { device, busy:this.panelIsCached, write: (property, value) => { if(current())void this.setBoundProperty(property, value, device.did); }, error: error => { if(current()){this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render();} },interactionEnded:()=>{if(current())this.render(true);} });
    control.dataset.boundDeviceId = device.did;
    return control;
  }

  private renderSensorPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderSensorPage.call(this.presenterHost(), device);
  }

  private renderOutletPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderOutletPage.call(this.presenterHost(), device);
  }

  private renderStandardFanPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderStandardFanPage.call(this.presenterHost(), device);
  }

}
