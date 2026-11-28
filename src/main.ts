import {dropdownMenu,hasOpenDropdown} from './ui/dropdown';
import {propertyEditorInput} from './ui/property-editor';
import {backgroundWork,monitorInBackground,ResourceRevisions,setVisualWorkPaused,type ResourceState} from './background-work';
import {preferredHome,rememberHome} from './home-selection';
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
import {deviceUnavailableContent,deviceUnavailablePage} from './ui/device-unavailable';
import * as sharedDeviceViews from './ui/device-presenters';
import {monitorEligible} from './monitor';
import {MonitorCatalogController,readMonitorCatalog,selectedMonitorMembers,type MonitorCatalog} from './monitor-catalog';
import {ApplicationSettingsController} from './ui/application-settings';
import type {StartupMonitorTarget} from './application-settings';
import {showAppUpdateResult} from './ui/app-update-result';
import {isTauri,invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {nativeFullscreen,adoptFullscreen,setNativeFullscreen} from './desktop-fullscreen';
import {dismissOnBackdrop} from './ui/dialog-dismiss';
import {deviceSurfaces} from './ui/device-surfaces';
import type {CameraPlayer} from './camera-page';
import {cameraPageEligible} from './camera-eligibility';
import {loginPage} from './ui/login-page';
import {IrRemoteState,isIrRemote} from './ir-remote';
import {irRemotePage} from './ui/ir-remote-page';
import {televisionPage} from './ui/television-page';
import {televisionPageEligible,type TelevisionCommand} from './television';
import {SpecVacuumState,VacuumState,vacuumModel} from './vacuum';
import {specVacuumMapEligible,vacuumPageEligible} from './vacuum-spec';
import {vacuumPage} from './ui/vacuum-page';
import {CurtainMotion} from './curtain-motion';
import {dailyActionLabel,dailyPanel,desktopActionShortcut} from './daily-scope';
import { capabilityCategory,resolveDeviceCapabilities,hasCapabilityCategory,validChoices } from './device-capabilities';
import { renderCategoryPage } from './ui/category-page';
import {speakerPage} from './ui/speaker-page';
import {audioBindings,audioDetailEligible,playbackBinding,speakerMetadataSupported,SpeakerState} from './speaker';
import {BathHeaterState,bathHeaterModel} from './bath-heater';
import {bathHeaterPage} from './ui/bath-heater-page';
import {bathroomBattery,bathroomCategory,bathroomTemperature,type BathroomCommand} from './bathroom';
import {bathroomHeatingPage,standardBathHeaterPage,toiletPage} from './ui/bathroom-page';
import {CeilingFanState,ceilingFanModel,hasDedicatedCeilingFan} from './ceiling-fan';
import {FryerState,fryerModel,type FryerView} from './fryer';
import {fryerPage} from './ui/fryer-page';
import {ceilingFanPage,standardCeilingFanPage} from './ui/ceiling-fan-page';
import {DoorbellState,isCloudDoorbell,doorbellBattery} from './doorbell';
import {doorbellPage} from './ui/doorbell-page';
import type {DoorbellPlayer} from './doorbell-player';
import {DevicePresentationRoute,dedicatedPage,presentationReady,washerPageEligible,PRESENTATION_VERSION} from './device-presentation-route';
import {devicePropertyLabel} from './device-labels';
import './style.css';
import './login.css';
import './theme.css';
import {showToast} from './ui/toast';
import './ui/quiet-feedback.css';
import { api } from './api';
import { PropertyOperations,type PropertyReply } from './property-operations';
import {cardActive,cardCaption,cardDisplay,cardReportedIntent} from './home-cards';
import {RouterState,routerModel,routerPageEligible} from './router';
import {routerPage} from './ui/router-page';
import {updateHomeShortcut} from './ui/home-shortcut';
import type {HomeCardEntry,HomeCardIntent,HomeCardReport} from './types';
import { icon, officialIcon, type IconName } from './icons';
import { orderedRooms, visibleHomeDevices } from './home-order';
import { cardSizeForRoom, localDevices, mergeVisibleOrder, PreferenceOperations, type PreferenceChange } from './local-preferences';
import {settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView} from './ui/settings-page';
import type {MonitorWall} from './ui/monitor-wall';
import { washerPage, type WasherView } from './ui/washer-page';
import {WasherCommands} from './washer-commands';
import {WasherRuntimeCommands,washerHomeStatus,washerProgramsLocked,washerRuntimeHasDetail,type WasherRuntimeControl} from './washer-runtime';
import {washerRuntimePage} from './ui/washer-runtime-page';
import { changeWasherDraft, isDryerPanel, newWasherDraft, washerDrums, washerProgramCatalog, type WasherConfigReport, type WasherDraft, type WasherProgram } from './washer';
import { DeviceDrag } from './ui/device-drag';
import {DeviceOpening} from './device-opening';
import { CardPress } from './ui/card-press';
import { sizeDeviceGrid } from './ui/device-grid';
import {cardSizeMenu,cardMenuKeys,showLargeCardChoice} from './ui/card-size-menu';
import type {CardSize} from './card-size';
import { bindScrollStrip } from './ui/scroll-strip';
import {PurifierCommands,newPurifierView,type PurifierView} from './purifier';
import {purifierPage} from './ui/purifier-page';
import {purifierSettingsPage} from './ui/purifier-settings-page';
import {PurifierOptions} from './purifier-options';
import {purifierGuidePage} from './ui/purifier-guide';
import {AirerCommands,airerModel,airerProfile,airerStatus,airerNight,type AirerView} from './airer';
import {airerPage,standardAirerPage} from './ui/airer-page';
import {airerPageEligible} from './airer-spec';
import {SpecAirerCommands} from './airer-spec-commands';
import {batteryOnlyCleaner,cleanerBattery,currentCleanerBattery} from './cleaner-battery';
import {securityCategory,securityReadings} from './security-readings';
import {sensorDetailCategory,sensorDetailReadings} from './sensor-presentation';
import {ScaleHistoryState} from './scale-history';
import {scalePage} from './ui/scale-page';
import {FridgeCommands,fridgeModel,fridgeProfile,fridgeCurrent} from './fridge';
import {fridgePage,standardFridgePage} from './ui/fridge-page';
import {applianceDetailCategory,cardSwitchPower,matchingPanel,simpleLivingDetail,unavailableApplianceDetail} from './appliance-details';
import {curtainBindings,curtainExplicitlyPaused,curtainFeedback,curtainJourney,curtainMotorMeaning,curtainOpeningChoices,curtainOpeningLabels,curtainStatus} from './curtain-detail';
import {windowOpenerRails} from './window-opener';
import {windowOpenerPage} from './ui/window-opener-page';
import {clothesDryerPower} from './living-details';
import {livingDetailPage} from './ui/living-detail-page';
import {cookingCategory,cookingCommandAllowed,cookingPanel,fryerStyleCategory,type CookingCommand,type CookingView} from './cooking';
import {cookingPage,type CookingEditor} from './ui/cooking-page';
import {waterHeatingPage} from './ui/water-heating-page';
import {hoodPage,kitchenCyclePage,type KitchenCycleView} from './ui/kitchen-page';
import {kitchenCycleBindings,kitchenFanBindings} from './kitchen-controls';
import {ReportOperations,panelDisplay,panelReadback} from './report-operations';
import {dispenserPage,dispenserTemperaturePage} from './ui/dispenser-page';
import {DispenserCommands,dispenserModel,dispenserProfile,type DispenserView} from './dispenser';
import {DispenserReminders,type ReminderView} from './dispenser-reminders';
import {dispenserRemindersPage} from './ui/dispenser-reminders-page';
import {DispenserSelfCheck} from './dispenser-selfcheck';
import {dispenserSelfCheckPage} from './ui/dispenser-selfcheck-page';
import {DispenserSterilization,sterilizationState} from './dispenser-sterilization';
import {dispenserSterilizationPage} from './ui/dispenser-sterilization-page';
import {isPurifierSetting,purifierSetting} from './purifier-settings';
import { dateKey } from './history';
import { coercePropertyInput, displayValue, isSessionError, missingReadingText, normalizeError, reportedValueText, sameContext, writeUnsupportedReason } from './logic';
import { booleanValue, climateBindings, controlReason, findProperty, isReadableValue, numericValue, hasObservedDeviceLayout, miotCategory, panelLayout, propertyReading, splitChildren } from './panel-layout';
import {airPurifierBindings,environmentCategory,fanDetailBindings,simpleClimateBindings,simpleClimateCategory} from './environment-controls';
import {HomeScenesState,sceneRooms} from './home-scenes';
import { readHomeInventory } from './home-inventory-read';
import {HomeScenesView,sceneShortcuts,sizeSceneShortcuts} from './ui/home-scenes-page';
import {visibleSceneShortcuts,addSceneShortcuts,removeSceneShortcuts,type SceneShortcutLayout} from './scene-shortcut-preferences';
import {sceneShortcutPicker,updateSceneShortcutPicker} from './ui/scene-shortcut-picker';
import type { Action, AppError, Device, DeviceContext, DevicePanel, Home, HomeSnapshot, Json, Property, QrView, Service, SessionView, SensorHistory } from './types';

import { button, element } from './ui/dom';
import {enter,leave} from './ui/motion';
import { deviceLoading } from './ui/device-loading';
import { preserveDeviceArtwork } from './ui/preserve-device-artwork';
import {type LightColorTab} from './light-color';
import {lightChannelBindings,lightingCategory} from './light-bindings';
import type {AccountProfile} from './types';
import { renderControl, type ControlNode } from './ui/controls';
import { compilePanelDocument as compileFullPanelDocument, type ComponentNode, type DeviceUiResources, type PanelDocument } from './ui-schema';
import { renderPanelDocument } from './ui/schema-renderer';
import type { PanelLayout } from './panel-layout';
import { disposeHistoryCharts } from './ui/history-chart';
import {setCurveMotionScope} from './ui/curve-motion';
import { energySupported } from './energy';
import type { EnergyReport,EnergySelection } from './types';
type LoginState = 'idle' | 'loading' | 'ready' | 'expired' | 'error';
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
  private readonly transport = api;
  private readonly root = document.querySelector<HTMLDivElement>('#app')!;

  constructor() {
    const washerReadVersions=new WeakMap<DevicePanel,number>();
    const submitPanelControl=<T>(context:DeviceContext,send:()=>Promise<T>):Promise<T>=>{
      const epoch=this.panelEpoch,queuedAt=Date.now();
      return this.serializeDevice(context.did,()=>{
        if(epoch!==this.panelEpoch||!sameContext(context,this.context))throw {kind:'staleContext',message:''};
        if(Date.now()-queuedAt>=30000)throw {kind:'timeout',message:''};
        return send();
      });
    };
    this.cooking=new ReportOperations<DevicePanel,CookingCommand>({
      read:context=>this.transport.devicePanel(context),
      send:async(context,_panel,command)=>{
        const {action,inputs}=command;
        const result=await submitPanelControl(context,()=>this.transport.runAction(context,action.siid,action.aiid,inputs));
        return{report:result.panel,confirmed:result.verified};
      },
      validate:(panel,context)=>{if(panel.did!==context.did||panel.model!==this.currentDevice()?.model||!cookingCategory(panel.specType))throw {kind:'protocol',message:''};},
      accepted:(context,panel)=>{
        if(sameContext(context,this.context)&&this.cookingView&&'mode' in this.cookingView&&
          cookingPanel(panel)?.active&&this.cooking.intents.some(command=>command.kind==='start'||command.kind==='reserve'))this.cookingView={task:true};
      },
      key:()=> 'cooking',
      project:panel=>panel,
      allowed:cookingCommandAllowed,
      verifyRead:panel=>cookingPanel(panel)?.phase!==undefined,
      matches:(panel,command)=>{
        const phase=cookingPanel(panel)?.phase;
        return command.kind==='reserve'?phase==='scheduled':command.kind==='stop'?phase==='ready':command.kind==='resume'?phase==='cooking':command.kind==='pause'?phase==='paused':
          phase==='cooking'||phase==='warming'||phase==='scheduled';
      },
      interval:5000,
    },()=>{if(this.context&&!this.cookingEditor.picker&&!this.cookingEditor.confirmStop&&!this.cookingEditor.reservation)this.render(true);},error=>this.handleSessionError(error));
    this.washerRuntimeCommands = new WasherRuntimeCommands({
      action:(context,siid,aiid,inputs,intent)=>submitPanelControl(context,()=>this.transport.runAction(context,siid,aiid,inputs,intent)),
      write:(context,siid,piid,value)=>submitPanelControl(context,()=>this.transport.setProperty(context,siid,piid,value)),
      read:async (context,expected,intent)=>{
        const version=this.propertyOps.version,panel=await this.transport.confirmWasherRuntime(context,expected,intent);
        washerReadVersions.set(panel,version);return panel;
      },
    },()=>{if(this.context)this.render(true);},(context,panel)=>{
      if(sameContext(context,this.context)){this.acceptPanel(panel,washerReadVersions.get(panel)??this.propertyOps.version,false,Date.now());this.panelIsCached=false;}
    },error=>this.handleSessionError(error));
    this.washerCommands = new WasherCommands({
      preview:this.transport.washerProgramPreview,start:this.transport.startWasherProgram,confirm:this.transport.confirmWasherProgram,
    },()=>{
      const program=this.washerView==='program';
      if(this.washerCommands.result?.status==='confirmed'){
        this.washerReservationOpen=false;
        const runtime=this.washerDrum===undefined?this.panel?.washerRuntime:this.panel?.washerDrums?.find(drum=>drum.serviceId===this.washerDrum);
        if(program&&runtime?.active){this.washerView='home';this.washerDraft=undefined;this.washerSelectedProgram=undefined;}
      }
      if(this.context&&(program||this.washerView==='runtime'))this.render(true);
    },panel=>{
      if(this.context?.did===panel.did){this.acceptPanel(panel,this.propertyOps.version,false,Date.now());this.panelIsCached=false;}
    },error=>this.handleSessionError(error));
    this.scenes = new HomeScenesState({list:this.transport.homeScenes,run:this.transport.runHomeScene,panel:this.transport.devicePanel,history:this.transport.sensorHistory,write:(device,intent)=>this.writeSceneDevice(device,intent),refresh:()=>this.refreshVisibleState()},()=>this.updateHomeScenes(),error=>this.handleSessionError(error));
    this.router = new RouterState(this.transport.routerOverview,()=>{if(this.context)this.render(true);},error=>this.handleSessionError(error));
    this.speaker = new SpeakerState({read:this.transport.speakerPlayer,change:(context,change)=>
      submitPanelControl(context,()=>this.transport.changeSpeaker(context,change)),action:(context,action)=>
      submitPanelControl(context,()=>this.transport.runAction(context,action.siid,action.aiid,[]))},
      ()=>{if(speakerMetadataSupported(this.currentDevice()?.model??''))this.render(true);},e=>this.handleSessionError(e));
    this.bathHeater = new BathHeaterState({read:this.transport.bathHeater,change:this.transport.changeBathHeater},()=>{if(this.currentDevice()?.model===bathHeaterModel)this.render(true)},e=>this.handleSessionError(e));
    this.fryer = new FryerState({read:this.transport.fryer,change:this.transport.changeFryer},()=>{if(this.currentDevice()?.model===fryerModel&&!this.fryerView.picker&&!this.fryerView.confirmation)this.render(true);},e=>this.handleSessionError(e));
    this.ceilingFan = new CeilingFanState({read:this.transport.ceilingFan,change:this.transport.changeCeilingFan},()=>{if(hasDedicatedCeilingFan(this.currentDevice()))this.render(true)},e=>this.handleSessionError(e));
    this.vacuum = new VacuumState({read:this.transport.vacuum,readMap:this.transport.vacuumMap,change:this.transport.changeVacuum},()=>{if(!this.vacuum.loading)this.deviceOpening.ready();if(this.currentDevice()?.model===vacuumModel)this.render(true);},e=>this.handleSessionError(e));
    this.specVacuum = new SpecVacuumState({read:this.transport.readProperties,readMap:this.transport.vacuumMap,
      send:(context,change)=>submitPanelControl(context,()=>'setting' in change
        ? this.transport.setProperty(context,change.siid,change.piid,change.value)
        : this.transport.runAction(context,change.action.siid,change.action.aiid,[])),
    },()=>{if(vacuumPageEligible(this.currentDevice(),this.panel))this.render(true);},e=>this.handleSessionError(e));
    this.doorbell = new DoorbellState(this.transport.doorbellCloud,()=>{if(isCloudDoorbell(this.currentDevice()?.model??''))this.render(true)},e=>this.handleSessionError(e),this.transport.cameraCareThumbnail);
    this.purifierOptions = new PurifierOptions({read:this.transport.purifierOptions,save:this.transport.changePurifierPush},()=>this.render(true),error=>{this.handleSessionError(error);});
    this.dispenserReminders = new DispenserReminders({read:this.transport.dispenserReminders,save:this.transport.changeDispenserReminder},()=>{if(this.currentDevice()?.model===dispenserModel)this.render(true);},error=>this.handleSessionError(error));
    this.dispenserSelfCheck = new DispenserSelfCheck({run:this.transport.dispenserSelfCheck,confirm:this.transport.confirmDispenserSelfCheck,history:this.transport.dispenserSelfCheckRecords},()=>{if(this.dispenserView.page==='selfcheck'&&this.dispenserSelfCheck.selected?.time===0)this.dispenserView={page:'selfcheck-report'};this.render(true);},(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.dispenserSterilization = new DispenserSterilization({run:this.transport.dispenserSterilization,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.dispenserCommands = new DispenserCommands({change:this.transport.changeDispenser,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>this.handleSessionError(error));
    this.fridgeCommands = new FridgeCommands({change:this.transport.changeFridge,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    this.airerCommands = new AirerCommands({lift:this.transport.airerLift,night:this.transport.saveAirerNight,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    const airerReadVersions=new WeakMap<DevicePanel,number>();
    this.specAirerCommands=new SpecAirerCommands({read:async context=>{
      const version=this.propertyOps.version,panel=await this.transport.readProperties(context);airerReadVersions.set(panel,version);return panel;
    },write:(context,change)=>submitPanelControl(context,()=>this.transport.setProperty(context,change.siid,change.piid,change.value))},
    ()=>{if(airerPageEligible(this.currentDevice(),this.panel))this.render(true);},(context,panel)=>{
      if(sameContext(context,this.context)){this.acceptPanel(panel,airerReadVersions.get(panel)??this.propertyOps.version,false,Date.now());this.panelIsCached=false;}
    },error=>this.handleSessionError(error));
    this.purifierCommands = new PurifierCommands({save:this.transport.savePurifierCups,read:this.transport.readProperties},()=>this.render(true),(context,panel)=>{if(sameContext(context,this.context)){this.acceptPanel(panel,this.propertyOps.version);this.panelIsCached=false;this.panelHasCachedState=false;}},error=>{this.handleSessionError(error);});
    this.irRemote = new IrRemoteState({read:this.transport.irRemote,send:this.transport.sendIrKey},()=>{if(!this.irRemote.loading)this.deviceOpening.ready();this.render(true);},e=>this.handleSessionError(e));
    this.scaleHistory = new ScaleHistoryState(this.transport.scaleHistory,()=>this.render(true),e=>this.handleSessionError(e),
      this.transport.changeScalePending);
  }

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
  private washerReadAt:number|undefined;
  private washerView:WasherView='home';
  private washerProgramBack:'home'|'more'='home';
  private washerDraft:WasherDraft|undefined;
  private washerReservationOpen=false;
  private washerSelectedProgram:WasherProgram|undefined;
  private washerDrum:number|undefined;
  private washerRuntimeConfirmation:WasherRuntimeControl|undefined;
  private washerRuntimeExitTimer:ReturnType<typeof setTimeout>|undefined;
  private washerRuntimeCommands:WasherRuntimeCommands;
  private washerCommands:WasherCommands;

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
  private homeInventoryRead?: AbortController;
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
  private cooking:ReportOperations<DevicePanel,CookingCommand>;
  private cookingView:CookingView;
  private cookingEditor:CookingEditor={};
  private kitchenCycleView:KitchenCycleView;
  private kitchenCycleReadAt?:number;
  private ceilingFan:CeilingFanState;
  private curtainMotion=new CurtainMotion();
  private curtainMotions=new Map<string,CurtainMotion>();
  private vacuum:VacuumState;
  private specVacuum:SpecVacuumState;
  private doorbell:DoorbellState;
  private doorbellPlayer?:DoorbellPlayer;
  private uiResources: DeviceUiResources | undefined;
  private uiResourcesRequest: { epoch: number; promise: Promise<void> } | undefined;
  private uiResourcesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private uiResourcesRefreshAttempts = 0;
  private uiResourcesError: string | undefined;
  private panelLoading = false;
  private deviceDataPresented = false;
  private panelError: AppError | undefined;
  private purifierView:PurifierView=newPurifierView();
  private purifierOptions:PurifierOptions;
  private purifierGuide:ReturnType<typeof purifierGuidePage>|undefined;
  private airerView:AirerView={page:'home'};
  private dispenserView:DispenserView={page:'home'};
  private dispenserReminderView:ReminderView={page:'settings'};
  private dispenserReminders:DispenserReminders;
  private dispenserSelfCheck:DispenserSelfCheck;
  private dispenserSterilization:DispenserSterilization;
  private dispenserCommands:DispenserCommands;
  private fridgeCommands:FridgeCommands;
  private airerCommands:AirerCommands;
  private specAirerCommands:SpecAirerCommands;
  private purifierCommands:PurifierCommands;
  private sensorHistory: SensorHistory | undefined;
  private historyLoading = false;
  private historyError: AppError | undefined;
  private historyReadAt = 0;
  private renderedHistoryKey = '';
  private scaleReportReturn?: {scrollTop:number;focusKey?:string};
  private energyData:EnergyReport|undefined;
  private energyLoading=false;
  private energyError:AppError|undefined;
  private energyEpoch=0;
  private energyReadAt=0;
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
      void (kind==='camera'?import('./camera-page').then(({CameraPlayer})=>{
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
  private readonly lightTabs = new Map<number,LightColorTab>();
  private operationNoticeRevision=0;
  private propertyOps=new PropertyOperations((key,value)=>this.propertyRequest(key,value,false),(key,value)=>this.propertyRequest(key,value,true),()=>this.propertyOperationChanged());
  private confirmedPanels=new Map<string,DevicePanel>();
  private confirmedPanelVersions=new Map<string,number>();
  private homeCardsPropertyReadVersion=0;
  private propertyContexts=new Map<string,{context:DeviceContext;homeEpoch:number;homePower?:boolean;homeCamera?:boolean;homeCurtain?:boolean;windowOpener?:boolean;playbackEpoch?:number}>();
  private deviceSends=new Map<string,Promise<void>>();
  
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
  private monitorHome?:{id:string|null;catalog:MonitorCatalog};
  private monitorHomeSwitching=false;
  private detachedMonitor:string|null=null;
  private detachedMonitorRequest=0;
  private detachedMonitorBusy=false;
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
    fan: device => this.renderFanPage(device),
    'fan-p69': device => this.renderP69FanPage(device),
    'fan-standard': device => this.renderFanPage(device),
    'air-conditioner': device => this.renderAirConditionerPage(device),
    'air-purifier': device => sharedDeviceViews.renderAirPurifierPage.call(this.presenterHost(),device),
    outlet: device => this.renderOutletPage(device),
  };

  async start(): Promise<void> {
    this.render();
    // Start the two independent local reads while native event listeners bind.
    const sessionRead=this.transport.session().then(session=>({session}),error=>({error}));
    const applicationRead=isTauri()?this.application.load():undefined;
    window.addEventListener('pagehide',()=>{
      this.disposed=true;this.application.dispose();this.disposeCardPresentations();this.lifetime.abort();++this.loginEpoch;++this.homeEpoch;
      this.cancelHomeInventoryRead();
      for(const timer of [this.loginTimer,this.homeRefreshTimer,this.panelRefreshTimer,this.stateTimer,this.idleHeartbeat,this.uiResourcesRefreshTimer])clearTimeout(timer);
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
        listen('desktop-session-expired',()=>{void this.verifySessionExpiry();}),
        listen('desktop-monitor-window-changed',()=>{void this.refreshDetachedMonitor();}),
        listenResourceState('main',state=>this.acceptResourceState(state)),
        listen<import('./application-settings').AppUpdateStatus>('desktop-update-state',event=>{this.application.acceptUpdate(event.payload,this.settingsOpen);}),
      ]);
      const cleanup=()=>{for(const result of registered)if(result.status==='fulfilled')result.value();};
      if(this.disposed){cleanup();return;}
      this.lifetime.signal.addEventListener('abort',cleanup,{once:true});
      void this.refreshWidgetSupport();
      void invoke<ResourceState>('desktop_resource_snapshot').then(state=>this.acceptResourceState(state)).catch(()=>{});
      void this.refreshDetachedMonitor();
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
      if(this.context&&target.classList.contains('device-stage')&&!this.controlBusy)this.closePanel();
    },{signal:this.lifetime.signal});
    document.addEventListener('keydown', event => {
      if(this.scenePicker?.open)return;
      if(event.key==='Tab'&&(this.fryerView.picker||this.fryerView.confirmation))return;
      if(event.key==='Tab'&&(this.dispenserView.picker||this.dispenserView.discard||this.dispenserSterilization.confirming||this.dispenserSelfCheck.confirming||this.dispenserReminderView.picker||this.dispenserReminderView.confirmation))return;
      if(event.key==='Tab'&&(this.washerReservationOpen||this.washerRuntimeConfirmation||this.purifierView.picker||this.purifierView.confirm||this.purifierView.settingDialog||this.airerView.picker))return;
      if(event.key==='Tab'&&this.context&&!this.accountOpen){
        const page=this.root.querySelector('.device-page'),scope=page?.classList.contains('page-washer')?(page.querySelector('.history-date-picker,.washer-choice-dialog,.washer-order-dialog')??page):page,items=scope?[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length):[];
        if(items.length&&(!items.includes(document.activeElement as HTMLElement)||(event.shiftKey?document.activeElement===items[0]:document.activeElement===items.at(-1)))){event.preventDefault();(event.shiftKey?items.at(-1)!:items[0]).focus();}
      }
      if (event.key === 'Escape') {
        if(this.currentDevice()?.model===dispenserModel){
          if(this.dispenserReminderView.picker||this.dispenserReminderView.confirmation){this.dispenserReminderView.picker=undefined;this.dispenserReminderView.confirmation=undefined;this.render(true);return;}if(this.dispenserSelfCheck.confirming){this.dispenserSelfCheck.confirming=false;this.render(true);return;}if(this.dispenserSterilization.confirming){this.dispenserSterilization.confirming=false;this.render(true);return;}
          if(this.dispenserView.picker||this.dispenserView.discard){this.dispenserView.picker=undefined;this.dispenserView.discard=false;this.render(true);return;}
          if(this.dispenserView.page!=='home'){this.root.querySelector<HTMLButtonElement>('.device-page .device-page-header button')?.click();return;}
        }
        if(this.arrangement){this.finishArrangement(false);}
        else if(this.drag.active||this.sceneDrag.active){this.drag.cancel();this.sceneDrag.cancel();this.render();}
        else if(this.deviceMenu){this.closeDeviceMenu();}
        else if(this.accountMenuOpen){this.accountMenuOpen=false;this.render();this.root.querySelector<HTMLButtonElement>('.home-account')?.focus();}
        else if(this.homeMenuOpen){this.homeMenuOpen=false;this.render();}
        else if(this.accountOpen&&!this.logoutBusy){this.accountOpen=false;this.render();}
        else if(this.settingsOpen){this.settingsOpen=false;this.render();}
        else if(this.fryerView.picker){this.fryerView.picker=undefined;this.render(true);}
        else if(this.fryerView.confirmation){this.fryerView.confirmation=undefined;this.render(true);}
        else if(this.fryerView.draft){this.fryerView.draft=undefined;this.render(true);}
        else if(this.cookingEditor.picker||this.cookingEditor.confirmStop||this.cookingEditor.reservation){this.cookingEditor={};this.render(true);}
        else if(this.cookingView){this.cookingView=undefined;this.render();}
        else if(this.kitchenCycleView)this.root.querySelector<HTMLButtonElement>('.device-page-header .page-icon-button')?.click();
        else if(this.airerView.picker){this.airerView.picker=undefined;this.render(true);}
        else if(this.airerView.page!=='home'){this.airerView={page:'home'};this.render(true);}
        else if(this.purifierView.settingDialog){this.purifierView.settingDialog=undefined;this.render(true);}
        else if(this.purifierView.picker){this.purifierView.picker=undefined;this.render(true);}
        else if(this.purifierView.confirm){this.purifierView.confirm=undefined;this.render(true);}
        else if(this.purifierView.page!=='home'){if(this.purifierView.draft){this.purifierView.confirm='leave';this.render(true);}else{this.purifierView={page:['pipeline','water-mode','compatibility','guide'].includes(this.purifierView.page)?'functions':'home',filter:0};this.render(true);}}
        else if(this.washerRuntimeConfirmation){this.washerRuntimeConfirmation=undefined;this.render(true);}
        else if(this.washerReservationOpen)this.closeWasherOrder();
        else if(this.washerDraft?.selector){this.washerDraft={...this.washerDraft,selector:undefined};this.render(true);}
        else if(this.washerView==='runtime')this.backFromWasherRuntime();
        else if(this.washerView!=='home')this.backFromWasherFunctions();
        else if (this.context&&!this.scaleHistory.back()) this.closePanel();
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
    catch(error){if(this.session!==session)return;this.handleSessionError(normalizeError(error));if(this.session===session){this.profileError=true;this.render();}}
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

  private async verifySessionExpiry():Promise<void>{
    const session=this.session;
    if(!session?.loggedIn||this.disposed)return;
    try{
      const current=await this.transport.session();
      if(!this.disposed&&this.session===session&&!current.loggedIn)
        this.handleSessionError({kind:'authExpired',message:'登录已失效，请重新扫码登录。',retryable:false});
    }catch{/* The local session check is retried on the next foreground or expiry event. */}
  }

  private handleSessionError(error: AppError): void {
    if (!this.session?.loggedIn || !isSessionError(error)) return;
    const wasMonitoring=this.monitorRunning||this.monitorWall?.active;
    this.region = this.session?.region ?? this.region;
    ++this.loginEpoch; ++this.homeEpoch;
    this.cancelHomeInventoryRead();
    if (this.loginTimer) clearTimeout(this.loginTimer);
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    this.loginTimer = undefined; this.homeRefreshTimer = undefined;
    this.clearPanel(); this.panelRefreshTimer = undefined;
    void this.application.load();this.session = undefined; this.accountProfile=undefined;this.profileError=false;this.homes = []; this.snapshot = undefined; this.selectedHomeId = '';
    this.homesLoading = false; this.homeBusy = false; this.homeError = undefined;
    this.roomId = '*'; this.homeMenuOpen = false; this.resetLocalView();
    this.accountOpen = false; this.logoutBusy = false; this.uiNotice = undefined;
    this.qr = undefined; this.loginError = error; this.loginState = 'error'; this.starting = false;
    // The backend has already invalidated this session. Rendering immediately
    // is necessary because old async operations must now fail their epoch
    // guards and therefore cannot be relied on to render from their finally.
    // Do not call logout here: an obsolete failure must not delete a new login.
    if(wasMonitoring){
      void setNativeFullscreen(false);
      if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
    }
    this.render();
  }

  private render(deviceOnly=false): void {
    if(this.disposed)return;
    this.scheduleCardPresentations();
    if(this.disposed)return;
    if(this.workPaused){this.resourceRenderPending=true;return;}
    captureSettingsView(this.root,this.settingsView);
    this.monitorCatalog.setAccount(this.session?.loggedIn?this.application.data?.scope??null:null);
    const monitor=this.preferences.view?.monitor;
    if(this.settingsOpen&&this.settingsView.category==='monitor'&&this.preferences.view?.monitorAllHomes&&!this.monitorCatalog.data&&!this.monitorCatalog.loading&&!this.monitorCatalog.error)void this.monitorCatalog.load();
    if(!this.settingsOpen&&this.session?.loggedIn&&this.snapshot&&this.monitorWall&&this.monitorRunning&&!this.monitorExitLatch&&!this.suppressStartupMonitor&&!this.context){
      if(!this.root.contains(this.monitorWall.root))this.root.replaceChildren(this.monitorWall.root);
      const catalog=this.monitorHome?.catalog??(this.monitorAllActive?this.monitorCatalog.data:undefined);
      const homeId=this.monitorHome?this.monitorHome.id:catalog?null:this.snapshot.homeId;
      const localAccount=this.session.userId?JSON.stringify([this.session.region,this.session.userId]):undefined;
      if(catalog)this.monitorWall.updateAll(catalog,homeId??undefined,homeId===null?catalog.scope:localAccount);
      else this.monitorWall.update(this.snapshot,monitor?.excludedDeviceIds??[],undefined,localAccount);
      this.monitorWall.setHomeChoices(this.homes,homeId,this.monitorAllActive,
        id=>{void this.switchMonitorHome(id);},this.monitorHomeSwitching);
      return;
    }
    if(this.monitorWall?.active)this.monitorWall?.close();
    // Keep the native pointer owner mounted while reads or metadata resolve.
    // A close, account/home change or action dialog must still replace it.
    if(this.context&&sameContext(this.renderedContext,this.context)&&!this.settingsOpen&&!this.accountOpen&&this.root.querySelector('.device-page [data-interacting="true"]'))return;
    if(this.scenePicker?.open){this.deferredRender=true;return;}
    if(this.arrangement&&this.snapshot?.homeId===this.arrangement.homeId&&this.snapshot.generation===this.arrangement.generation&&!this.context&&!this.settingsOpen&&!this.accountOpen){this.deferredRender=true;this.updateArrangementChrome();return;}
    if((this.drag.active||this.sceneDrag.active)&&this.renderedHomeId===this.selectedHomeId&&!this.settingsOpen&&!this.accountOpen){this.deferredRender=true;return;}
    this.drag.cancel(); this.deferredRender=false;
    const active=(document.activeElement instanceof HTMLElement||document.activeElement instanceof SVGElement)&&this.root.contains(document.activeElement)?document.activeElement:undefined;
    const localFocusKey = active?.dataset.focusKey;
    const focusedControl=active?.closest<HTMLElement>('[data-control]');
    const focusKey=focusedControl?{kind:focusedControl.dataset.control,siid:focusedControl.dataset.siid,piid:focusedControl.dataset.piid,index:[...this.root.querySelectorAll<HTMLElement>('[data-control]')].filter(node=>node.dataset.control===focusedControl.dataset.control&&node.dataset.siid===focusedControl.dataset.siid&&node.dataset.piid===focusedControl.dataset.piid).indexOf(focusedControl),child:active===focusedControl?-1:[...focusedControl.querySelectorAll('button,input,select,[tabindex]')].indexOf(active!)}:undefined;
    const keepFocus=sameContext(this.renderedContext,this.context);
    const previousScroll=this.root.querySelector<HTMLElement>('.device-page-scroll');
    const previousScaleView=previousScroll?.closest<HTMLElement>('.page-scale')?.dataset.scaleView;
    const scaleView=this.scaleHistory.view;
    if(keepFocus&&previousScaleView&&previousScaleView!=='report'&&scaleView==='report'){
      this.scaleReportReturn={scrollTop:previousScroll?.scrollTop??0,focusKey:localFocusKey};
    }
    const fromScaleReport=keepFocus&&previousScaleView==='report'&&scaleView!=='report';
    const restoredScaleReturn=fromScaleReport?this.scaleReportReturn:undefined;
    if(!keepFocus||fromScaleReport)this.scaleReportReturn=undefined;
    const historyKey = this.scaleHistory.view!=='overview'?`scale/${this.scaleHistory.view}`:
      this.currentDevice()?.model===dispenserModel?`dispenser/${this.dispenserView.page}/${this.dispenserView.modeId??""}/${this.dispenserView.page==='reminders'?this.dispenserReminderView.page:""}`:this.currentDevice()?.model===airerModel?`airer/${this.airerView.page}`:this.currentDevice()?.model==='xiaomi.waterpuri.lx32'?`purifier/${this.purifierView.page}/${this.purifierView.filter}/${this.purifierView.draft?.index??''}`:washerPageEligible(this.currentDevice(),this.panel)?`washer/${this.washerView}/${this.washerDraft?.program??''}`:'';
    const scrollTop=restoredScaleReturn?.scrollTop??
      (keepFocus&&this.renderedHistoryKey===historyKey?previousScroll?.scrollTop??0:0);
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
    if((deviceOnly||!!this.currentDevice()&&cameraPageEligible(this.currentDevice()!))&&previousStage&&this.context&&this.session?.loggedIn&&!this.accountOpen){
      const nextStage=createDeviceStage();if(nextStage!==previousStage)previousStage.replaceWith(nextStage);
    }else{
    this.root.replaceChildren();
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
    const scroll = this.root.querySelector('.device-page-scroll'); if (scroll) scroll.scrollTop = scrollTop;
    const homeScrollView=this.root.querySelector('.home-screen');if(homeScrollView)homeScrollView.scrollTop=homeScroll;
    const roomStrip=this.root.querySelector('.room-tabs');if(roomStrip)roomStrip.scrollLeft=roomsScroll;
    const devicePage=this.root.querySelector<HTMLElement>('.device-page');
    if(devicePage){devicePage.setAttribute('role','dialog');devicePage.setAttribute('aria-modal','true');devicePage.tabIndex=-1;}
    if (this.accountOpen) this.root.append(this.renderAccount());
    if (this.deviceMenu&&!this.context&&!this.settingsOpen) this.root.append(this.renderDeviceMenu());
    if(localFocusKey&&!this.context&&!this.settingsOpen){const target=[...this.root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(node=>node.dataset.focusKey===localFocusKey)??this.root.querySelector<HTMLElement>('.hidden-devices button,.settings-header button');target?.focus({preventScroll:true});}
    const restoredFocusKey=restoredScaleReturn?.focusKey??localFocusKey;
    if(keepFocus&&restoredFocusKey&&this.context)this.root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(restoredFocusKey)}"]`)?.focus({preventScroll:true});
    if(keepFocus&&focusKey){const control=[...this.root.querySelectorAll<HTMLElement>('[data-control]')].filter(node=>node.dataset.control===focusKey.kind&&node.dataset.siid===focusKey.siid&&node.dataset.piid===focusKey.piid)[focusKey.index];const target=focusKey.child<0?control:control?.querySelectorAll<HTMLElement>('button,input,select,[tabindex]')[focusKey.child];if(target&&!target.matches(':disabled'))target.focus({preventScroll:true});}
    if(devicePage&&!devicePage.contains(document.activeElement))devicePage.focus({preventScroll:true});
    if(this.settingsOpen&&!this.context&&!this.accountOpen)restoreSettingsView(this.root,this.settingsView);
    const navigationKey=JSON.stringify([this.session?.loggedIn,this.selectedHomeId,this.roomId,this.settingsOpen,this.context?.did,historyKey,devicePage?.className.replace(/\bmotion-\S+/g,'').trim()]);
    if(navigationKey!==this.navigationKey){
      void this.refreshVisibleState();
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
        this.session = session; this.qr = undefined; this.loginState = 'idle';
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

  private retryStartup():void{
    clearTimeout(this.startupRetry);
    const epoch=this.homeEpoch;
    if(this.startupIntent==='pending'&&this.application.data?.settings.startupMonitor)
      this.startupRetry=setTimeout(()=>{
        if(epoch===this.homeEpoch&&this.startupIntent==='pending'&&this.session?.loggedIn&&!this.logoutBusy)
          void this.loadHomes();
      },20_000);
  }
  private async maybeStartupMonitor(force=false):Promise<void>{
    const data=this.application.data;if(!data||!this.session?.loggedIn)return;
    force=force||this.startupForced;if(force)this.startupForced=true;
    if(!force&&this.startupIntent!=='pending')return;
    if(!force&&!data.settings.startupMonitor){this.startupIntent='done';return;}
    const useSeparate=data.desktopOptions.monitorSeparateWindow||!!this.detachedMonitor;
    const scope=data.scope,current=this.selectedHomeId;
    const fallback=force&&scope&&current
      ?useSeparate&&this.preferences.view?.monitorAllHomes?{scope,allHomes:true}as const:{scope,homeId:current}
      :null;
    const saved=data.settings.startupHome;
    const target=saved?.scope===scope?saved:fallback;
    if(!target){this.startupIntent='done';this.suppressStartupMonitor=true;this.monitorWall?.close();this.render();return;}
    if(useSeparate&&!this.monitorWall?.active){
      this.startupIntent='done';this.startupForced=false;
      await this.launchDetachedMonitor(target);
      return;
    }
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
  private cancelHomeInventoryRead(): void {
    this.homeInventoryRead?.abort();
    this.homeInventoryRead = undefined;
    clearTimeout(this.startupRetry);
    this.startupRetry = undefined;
  }

  private beginHomeInventoryRead(): AbortSignal {
    this.cancelHomeInventoryRead();
    clearTimeout(this.homeRefreshTimer);
    this.homeInventoryRead = new AbortController();
    return this.homeInventoryRead.signal;
  }

  private async loadHomes(): Promise<void> {
    const session = this.session;
    if (!session?.loggedIn || this.disposed || this.logoutBusy) return;
    const epoch = ++this.homeEpoch;
    const signal = this.beginHomeInventoryRead();
    this.homesLoading = true; this.homeContentLoading = false; this.homeBusy = false;
    this.homeError = undefined; this.render();
    if(this.application.data?.desktopOptions.monitorSeparateWindow)void this.maybeStartupMonitor();
    try {
      const homes = await readHomeInventory(() => this.transport.listHomes(), signal);
      if (epoch !== this.homeEpoch || this.session !== session) return;
      this.homes = homes; this.homesLoading = false; this.render();
      const target=this.application.data?.settings.startupHome;
      const startup=this.startupIntent==='pending'&&this.application.data?.settings.startupMonitor&&target?.scope===this.application.data.scope;
      if(startup&&target&&'homeId' in target&&!homes.some(h=>h.id===target.homeId)){this.startupIntent='done';this.suppressStartupMonitor=true;}
      const inline=startup&&!this.application.data?.desktopOptions.monitorSeparateWindow;
      const homeId=preferredHome(homes,this.session,this.selectedHomeId,inline&&target&&'homeId' in target?target.homeId:undefined);
      if (homeId) await this.selectHome(homeId);
      else { this.selectedHomeId = ''; this.snapshot = undefined; this.render(); }
    } catch (error) {
      if (epoch !== this.homeEpoch || signal.aborted) return;
      const failure = normalizeError(error);
      this.homesLoading = false; this.homeError = failure; this.handleSessionError(failure); this.render();
      if (failure.retryable && !isSessionError(failure)) this.retryStartup();
      if (this.snapshot) this.scheduleHomeRefresh();
    }
  }

  private pendingHomeChoice?:{session:SessionView;homeId:string};
  private async selectHome(homeId: string, userChoice=false): Promise<void> {
    const session=this.session;
    if (!session?.loggedIn || this.disposed || this.logoutBusy) return;
    const epoch = ++this.homeEpoch;
    const signal = this.beginHomeInventoryRead();
    this.homesLoading = false;
    if(userChoice)this.pendingHomeChoice={session,homeId};
    else if(this.pendingHomeChoice?.session!==session||this.pendingHomeChoice?.homeId!==homeId)this.pendingHomeChoice=undefined;
    this.widgetIntents.clear();this.selectedHomeId = homeId; this.snapshot = undefined; this.homeBusy = true;
    this.resetLocalView(); this.homeContentLoading = true; this.homeScrollTop=0;
    this.homeError = undefined; this.roomId = '*'; this.clearPanel(); this.render();
    try {
      const snapshot = await readHomeInventory(() => this.transport.selectHome(homeId), signal);
      if (epoch !== this.homeEpoch || this.selectedHomeId !== homeId || this.session !== session) return;
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
      if (epoch !== this.homeEpoch || signal.aborted) return;
      const failure = normalizeError(error);
      this.homeContentLoading = false; this.homeBusy = false; this.homeError = failure; this.handleSessionError(failure); this.render();
      if (failure.retryable && !isSessionError(failure)) this.retryStartup();
    }
  }

  private editing(ignoreButtonFocus=false): boolean {
    if(hasOpenDropdown()||this.accountOpen||this.accountMenuOpen||this.homeMenuOpen||this.deviceMenu||this.scenes.pending||this.scenePicker?.open)return true;
    if(this.dispenserView.page!=='home'||this.dispenserView.picker||this.dispenserView.discard||this.dispenserSterilization.pending||this.dispenserSelfCheck.pending)return true;
    if(this.fridgeCommands.pending)return true;
    if(this.airerView.page!=='home'||this.airerCommands.pending)return true;
    if(this.fryerView.draft||this.fryerView.picker||this.fryer.pending||this.cookingEditor.picker||this.cookingEditor.confirmStop||this.cookingEditor.reservation)return true;
    if(this.purifierView.page!=='home'||this.purifierCommands.pending||this.purifierOptions.pending)return true;
    if(this.purifierView.draft||this.purifierCommands.pending)return true;
    if(this.washerRuntimeCommands.pending||this.washerRuntimeConfirmation)return true;
    return !!this.arrangement || this.drag.active || this.settingsOpen || !!this.washerDraft || this.washerCommands.pending || this.preferences.pendingCount>0 || this.controlBusy || this.panelDrafts.size > 0 || !!this.root.querySelector('.device-page [data-interacting="true"]') || document.activeElement instanceof HTMLInputElement&&document.activeElement.type!=='range' || !ignoreButtonFocus&&document.activeElement instanceof HTMLButtonElement;
  }

  private scheduleHomeRefresh(): void {
    if(this.disposed)return;
    this.scheduleVisibleState();
    if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
    if (this.backgroundPaused() || !this.session?.loggedIn || !this.snapshot) return;
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
    if(this.roomId==='@scenes'){
      // Group controls also cover rooms outside the visible scroll area.
      const devices=this.sceneDevices([]).filter(device=>device.online&&!device.sharedReadOnly);
      const rooms=this.currentHome()?.rooms??[];
      return [...new Set((['light','curtain'] as const).flatMap(kind=>
        sceneRooms(devices,rooms,[],kind).flatMap(room=>room.devices.map(device=>device.did))))];
    }
    const viewport=this.root.querySelector('.home-screen')?.getBoundingClientRect();
    if(!viewport)return [];
    const ids=new Set<string>();
    for(const node of this.root.querySelectorAll<HTMLElement>('.device-grid > .device-card')){
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
    if(this.stateTimer||this.disposed||this.backgroundPaused()||!this.snapshot||!this.session?.loggedIn||this.context||this.settingsOpen||this.accountOpen||this.monitorWall?.active)return;
    this.stateTimer=setTimeout(async()=>{
      this.stateTimer=undefined;
      if(this.backgroundPaused()||this.disposed||!this.session?.loggedIn)return;
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
    const idle=background&&![...(this.templateCards?.sessions.values()??[])].some(session=>session.pendingCount)&&!this.homeBusy&&!this.panelLoading&&!this.controlBusy&&!this.pendingDeviceSends&&!this.propertyOps.pendingCount&&!this.homeCardOps.pendingCount&&!this.preferences.pendingCount&&!this.scenes.pending&&!this.cameraPlayer?.blocksSuspension&&!this.monitorWall?.blocksSuspension&&!this.washerCommands.pending&&!this.washerRuntimeCommands.pending&&!this.fridgeCommands.pending&&!this.airerCommands.pending&&!this.dispenserCommands.pending&&!this.dispenserSelfCheck.pending&&!this.dispenserSterilization.pending&&!this.purifierCommands.pending&&!this.purifierOptions.pending&&!this.fryer.pending;
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
    if(resumed)void this.verifySessionExpiry();
    this.publishFrontendIdle();
    if(this.backgroundPaused()){clearTimeout(this.homeRefreshTimer);clearTimeout(this.panelRefreshTimer);clearTimeout(this.stateTimer);this.stateTimer=undefined;}
    else{this.scheduleVisibleState(resumed?0:undefined);this.scheduleHomeRefresh();this.schedulePanelRefresh(resumed);}
  }

  private observingSterilization():boolean {
    return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='sterilization'&&!this.dispenserSterilization.blocked&&!this.dispenserSterilization.confirming&&!this.dispenserCommands.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;
  }
  private observingSelfCheck():boolean{return this.currentDevice()?.model===dispenserModel&&this.dispenserView.page==='selfcheck'&&!this.dispenserSelfCheck.blocked&&!this.dispenserSelfCheck.confirming&&!this.dispenserCommands.pending&&!this.controlBusy&&this.propertyOps.pendingCount===0;}
  private schedulePanelRefresh(resumed=false): void {
    if(this.disposed)return;
    if (this.panelRefreshTimer) clearTimeout(this.panelRefreshTimer);
    if (this.backgroundPaused() || !this.context || !this.panel || this.settingsOpen || this.accountOpen || this.monitorWall?.active) return;
    const device=this.currentDevice();
    if(vacuumPageEligible(device,this.panel)||device?.model!==airerModel&&airerPageEligible(device,this.panel))return;
    if(device?.model!==fryerModel&&cookingCategory(this.panel.specType))return;
    const ordinary=!!device&&!dedicatedPage(device.model)&&!washerPageEligible(device,this.panel)&&!cameraPageEligible(device);
    this.panelRefreshTimer = setTimeout(() => {
      if (this.settingsOpen||this.accountOpen||this.monitorWall?.active||this.editing(this.kitchenCycleView==='runtime')&&!this.observingSterilization()&&!this.observingSelfCheck() || this.washerRuntimeCommands.pending || this.washerRuntimeConfirmation || this.panelLoading || !this.currentDevice()?.online) this.schedulePanelRefresh();
      else void this.readProperties(true,ordinary);
    }, resumed?0:this.curtainMotion.moving||this.observingSelfCheck()||this.observingSterilization()&&this.panel?.dispenser?.status===4?2_000:ordinary?5_000:10_000);
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
    if(this.settingsOpen)return settingsPage({application:{card:(category,view)=>this.application.card(category,view,this.homes,this.selectedHomeId)},homeAvailable:!!this.session?.loggedIn&&!!this.selectedHomeId,changed:()=>this.render(),view:this.settingsView,homeName:this.currentHome()?.name??'',devices:this.snapshot?.devices??[],monitorCatalog:this.monitorCatalog,preferences:this.preferences.view?{...this.preferences.view,monitor:{enabled:this.monitorRunning||!!this.detachedMonitor,excludedDeviceIds:this.preferences.view.monitor?.excludedDeviceIds??[]}}:undefined,loading:this.preferencesLoading,pending:this.preferences.pendingCount>0,error:this.preferencesError??this.preferences.error,
      monitorWindow:this.application.data?{separate:this.application.data.desktopOptions.monitorSeparateWindow,opening:this.detachedMonitorBusy,saving:this.application.saving,change:value=>this.application.changeDesktopOption('monitorSeparateWindow',value)}:undefined,
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
    rooms.append(button('场景',`room-tab${this.roomId==='@scenes'?' active':''}`,()=>{this.roomId='@scenes';this.render();void this.scenes.load();void this.scenes.loadEnvironment(this.sceneDevices());void this.refreshVisibleState();}));
    rooms.append(button('全屋', `room-tab${this.roomId === '*' ? ' active' : ''}`, () => { this.roomId = '*'; this.render(); }));
    for (const room of orderedRooms(this.currentHome()?.rooms ?? [], this.snapshot?.order)) rooms.append(button(room.name, `room-tab${this.roomId === room.id ? ' active' : ''}`, () => { this.roomId = room.id; this.render(); }));
    if (devices.some(device => !device.roomId || !this.currentHome()?.rooms.some(room => room.id === device.roomId))) rooms.append(button('未分配', `room-tab${this.roomId === '?' ? ' active' : ''}`, () => { this.roomId = '?'; this.render(); }));
    bindScrollStrip(rooms);main.append(rooms);
    const content = element('div', 'home-content');
    content.tabIndex=0;content.setAttribute('aria-label',this.roomId==='@scenes'?'家庭场景':'设备列表');
    if(this.snapshot&&this.preferences.view&&!this.homeContentLoading)content.append(this.renderSceneShortcuts());
    if (this.homeError) {
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
    this.monitorHome=undefined;this.monitorHomeSwitching=false;
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
  private async refreshDetachedMonitor():Promise<void>{
    const request=++this.detachedMonitorRequest;
    try{
      const label=await api.detachedMonitorStatus();
      if(this.disposed||request!==this.detachedMonitorRequest||label===this.detachedMonitor)return;
      this.detachedMonitor=label;
      if(this.settingsOpen&&this.settingsView.category==='monitor')this.render();
    }catch{/* A failed status read leaves the last confirmed window state visible. */}
  }
  private async launchDetachedMonitor(target:StartupMonitorTarget):Promise<boolean>{
    if(this.detachedMonitorBusy)return true;
    this.detachedMonitorBusy=true;
    if(this.settingsOpen)this.render();
    try{
      const opened=await api.openDetachedMonitor(target);
      if(opened)await this.refreshDetachedMonitor();
      return !!opened;
    }catch(error){
      const failure=normalizeError(error);
      if(isSessionError(failure))void this.verifySessionExpiry();
      else if(!this.disposed&&failure.kind!=='staleContext')showToast(document.body,failure.message,false);
      return true;
    }finally{
      this.detachedMonitorBusy=false;
      if(!this.disposed&&this.settingsOpen)this.render();
    }
  }
  private async stopDetachedMonitor(label:string):Promise<void>{
    if(this.detachedMonitorBusy)return;
    this.detachedMonitorBusy=true;this.render();
    try{await api.closeDetachedMonitor(label);}
    catch(error){if(!this.disposed)showToast(document.body,normalizeError(error).message,false);}
    finally{this.detachedMonitorBusy=false;if(!this.disposed&&this.settingsOpen)this.render();}
  }
  private async beginMonitor(allHomes=this.preferences.view?.monitorAllHomes??false):Promise<void>{
    const epoch=++this.monitorStartEpoch;
    const scope=this.application.data?.scope,homeId=this.snapshot?.homeId;
    if(scope&&this.session?.loggedIn&&!this.monitorWall?.active&&(this.application.data?.desktopOptions.monitorSeparateWindow||this.detachedMonitor)){
      const target=allHomes?{scope,allHomes:true}as const:homeId?{scope,homeId}:undefined;
      if(target&&await this.launchDetachedMonitor(target))return;
      if(epoch!==this.monitorStartEpoch)return;
    }
    if(allHomes){this.monitorCatalog.setAccount(this.application.data?.scope??null);await this.monitorCatalog.load();if(epoch!==this.monitorStartEpoch)return;if(!this.monitorCatalog.data||!selectedMonitorMembers(this.monitorCatalog.data).length)return;}
    else if(!this.snapshot?.devices.some(d=>monitorEligible(d)&&!this.preferences.view?.monitor?.excludedDeviceIds.includes(d.did)))return;
    if(!this.session?.loggedIn||epoch!==this.monitorStartEpoch)return;
    try{this.monitorModule??=await import('./ui/monitor-wall');}catch{if(epoch===this.monitorStartEpoch){this.uiNotice={tone:'error',title:'监控暂时无法加载，请重试。'};this.render();}return;}
    if(this.disposed||!this.session?.loggedIn||epoch!==this.monitorStartEpoch)return;
    this.monitorWall??=new this.monitorModule.MonitorWall(()=>this.exitMonitor(),error=>{
      const failure=normalizeError(error);
      if(failure.kind==='monitorWindowOpen'){this.exitMonitor();void this.refreshDetachedMonitor();}
      else if(isSessionError(failure))void this.verifySessionExpiry();
    });
    this.monitorWall.setPaused(this.monitorBackground(),this.resourcePaused||document.hidden);
    this.monitorHome=undefined;this.monitorHomeSwitching=false;
    this.suppressStartupMonitor=false;this.monitorExitLatch=false;this.monitorAllActive=allHomes;this.monitorRunning=true;
    if(this.settingsOpen){captureSettingsView(this.root,this.settingsView);this.monitorSettingsReturn=this.settingsView;}else this.monitorSettingsReturn=undefined;
    this.settingsOpen=false;this.clearPanel();this.render();
  }
  private async switchMonitorHome(homeId:string|null):Promise<void>{
    const wall=this.monitorWall,epoch=this.monitorStartEpoch,account=this.application.data?.scope;
    if(!account||!wall?.active||!wall.canSwitchHome||this.monitorHomeSwitching||
      (homeId===null?!this.monitorAllActive:!this.homes.some(home=>home.id===homeId)))return;
    const current=()=>epoch===this.monitorStartEpoch&&wall.active&&this.application.data?.scope===account;
    this.monitorHomeSwitching=true;this.render();
    try{
      const catalog=await readMonitorCatalog(false,homeId??undefined);
      if(current()&&wall.canSwitchHome&&catalog.scope===account)this.monitorHome={id:homeId,catalog};
    }catch(error){
      if(!current())return;
      const failure=normalizeError(error);
      if(isSessionError(failure))void this.verifySessionExpiry();
      else showToast(this.root,failure.message,false);
    }finally{
      if(epoch===this.monitorStartEpoch){this.monitorHomeSwitching=false;this.render();}
    }
  }
  private changePreferences(change:PreferenceChange):void{
    if(change.operation==='setMonitorEnabled'){
      if(change.value)void this.beginMonitor();
      else if(this.detachedMonitor)void this.stopDetachedMonitor(this.detachedMonitor);
      else{++this.monitorStartEpoch;this.monitorRunning=false;this.monitorExitLatch=true;this.monitorWall?.close();}
      this.render();return;
    }
    if(change.operation==='setMonitorAllHomes'){++this.monitorStartEpoch;if(change.value)this.monitorCatalog.data=undefined;}
    this.preferencesError=undefined;this.deviceMenu=undefined;this.preferences.change(change);
  }
  private exitMonitor():void {++this.monitorStartEpoch;this.monitorRunning=false;this.monitorHome=undefined;this.monitorHomeSwitching=false;void setNativeFullscreen(false);this.monitorExitLatch=true;this.monitorWall?.close();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});this.settingsView=this.monitorSettingsReturn??createSettingsViewState('monitor');this.monitorSettingsReturn=undefined;this.settingsOpen=true;void this.loadPreferences();void this.monitorCatalog.load();this.render();}
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
  private sceneDevices(cards=this.homeCards?.cards):Device[]{
    const preferences=this.preferences.view;
    return preferences?localDevices(this.snapshot?.devices??[],this.snapshot?.order,this.currentHome()?.rooms??[],'*',{...preferences,splitSwitches:true},false,cards):[];
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
    this.toiletSetting=undefined;
    this.bathHeater.close();
    this.ceilingFan.close();
    this.fryer.close();this.fryerView={};
    this.cooking.close();this.cookingView=undefined;this.cookingEditor={};
    this.kitchenCycleView=undefined;this.kitchenCycleReadAt=undefined;
    this.vacuum.close();
    this.specVacuum.close();
    this.doorbell.close();
    this.doorbellPlayer?.dispose();
    this.irRemote.close();
    this.scaleHistory.close();
    this.scaleReportReturn=undefined;
    this.fridgeCommands.close();
    this.dispenserCommands.close();this.dispenserView={page:'home'};
    this.dispenserSelfCheck.close();this.dispenserSterilization.close();
    this.dispenserReminders.close();this.dispenserReminderView={page:'settings'};
    this.airerCommands.close();this.airerView={page:'home'};
    this.specAirerCommands.close();
    this.router.close();
    
    
    
    
    
    this.purifierGuide?.dispose();this.purifierGuide=undefined;
    this.purifierOptions.close();
    this.purifierView=newPurifierView();
    this.deviceOpening.cancel();
    this.washerRuntimeCommands.close();
    this.washerCommands.reset();this.washerReservationOpen=false;
    this.washerRuntimeConfirmation=undefined;clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;
    this.washerConfig=undefined;this.washerLoading=false;this.washerReadAt=undefined;
    this.washerView='home';this.washerProgramBack='home';this.washerDraft=undefined;this.washerSelectedProgram=undefined;
    this.washerDrum=undefined;
    this.deviceMenu=undefined;
    this.lightTabs.clear();
    if (this.panelRefreshTimer) clearTimeout(this.panelRefreshTimer);
    if (this.uiResourcesRefreshTimer) clearTimeout(this.uiResourcesRefreshTimer);
    this.uiResourcesRefreshTimer = undefined; this.uiResourcesRequest = undefined;
    this.uiResources = undefined; this.uiResourcesError = undefined; this.uiResourcesRefreshAttempts = 0;
    this.panelDrafts.clear();
    this.linkedPanels.clear(); this.linkedErrors.clear();
    this.sensorHistory = undefined; this.historyLoading = false; this.historyError = undefined; this.historyReadAt = 0;
    this.energyData=undefined;this.energyLoading=false;this.energyError=undefined;this.energyReadAt=0;++this.energyEpoch;
    this.presentationRoute.reset();
    this.deviceDataPresented=false;
    this.cameraPlayer?.dispose();
    ++this.panelEpoch; this.context = undefined; this.panel = undefined; this.panelError = undefined;
    this.panelNotice = undefined; this.panelLoading = false; this.controlBusy = false;
    this.panelIsCached=false;this.panelCachedAt=null;this.panelHasCachedState=false;
    this.speaker.close();
    this.curtainMotion.detach();
  }

  private closePanel(): void { if(this.purifierView.draft&&!this.purifierCommands.pending){this.purifierView.confirm='leave';this.render(true);return;}const did=this.context?.did;this.clearPanel(); this.render();void this.loadHomeCards();[...this.root.querySelectorAll<HTMLElement>('.device-card')].find(card=>card.dataset.deviceId===did)?.querySelector<HTMLButtonElement>('.device-card-open')?.focus({preventScroll:true}); }
  private backFromWasherRuntime():void{
    this.washerView='home';this.washerRuntimeConfirmation=undefined;
    clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;this.render(true);
    this.root.querySelector<HTMLElement>('[data-focus-key=washer-runtime-entry]')?.focus({preventScroll:true});
  }
  private backFromWasherFunctions():void{
    const program=this.washerView==='program',name=this.washerDraft?.program;
    this.washerView=program?this.washerProgramBack:'home';
    this.washerDraft=undefined;this.washerSelectedProgram=undefined;this.washerCommands.reset();this.washerReservationOpen=false;this.render(true);
    const selector=program&&name?`[data-program="${CSS.escape(name)}"]`:'[data-focus-key=washer-more-entry]';
    this.root.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});
  }

  private deviceCacheKey(device:Device,context:DeviceContext):string{return JSON.stringify([PRESENTATION_VERSION,this.session?.region,this.session?.userId,context.homeId,context.generation,context.did,device.model,device.specType,device.controlGroup,device.controlServiceId,device.unsupportedReason]);}
  private rememberDevice(panel:DevicePanel):void{
    const device=this.deviceIndex.find(this.snapshot?.devices,panel.did);if(!device||!this.context)return;
    const key=this.deviceCacheKey(device,{...this.context,did:panel.did}),previous=this.devicePreviewCache.get(key);
    this.devicePreviewCache.delete(key);this.devicePreviewCache.set(key,{panel,cachedAt:Date.now()/1000,hasCachedState:panel.services.some(s=>s.properties.some(p=>isReadableValue(p)||!!p.lastReported)),washerConfig:panel.did===this.context.did?this.washerConfig:previous?.washerConfig,at:Date.now()});
    if(this.devicePreviewCache.size>64)this.devicePreviewCache.delete(this.devicePreviewCache.keys().next().value!);
  }
  private deviceContentReady():void{
    if(this.panelError||this.panel&&(presentationReady(this.currentDevice(),this.panel)||!this.panelLoading))this.deviceOpening.ready();
  }

  private async openPanel(device: Device): Promise<void> {
    if (!this.snapshot) return;
    this.clearPanel();
    const context = { homeId: this.snapshot.homeId, generation: this.snapshot.generation, did: device.did };
    const epoch = this.panelEpoch;
    const readVersion=this.propertyOps.version;
    this.context = context; this.panelLoading = true;
    this.propertyOps.setActive(true);
    const detail=applianceDetailCategory(device);
    if(detail==='scale'){
      this.panelLoading=false;
      this.scaleHistory.open(context,device.model);
      return;
    }
    if(unavailableApplianceDetail(detail,device.model)){this.panelLoading=false;this.render();return;}
    if(hasDedicatedCeilingFan(device)){
      this.panelLoading=false;
      this.ceilingFan.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      void this.ceilingFan.read();
      this.render();
      return;
    }
    if(isIrRemote(device.model)){this.panelLoading=false;this.deviceOpening.begin();this.irRemote.bind(context,device.model,JSON.stringify([this.session?.region,this.session?.userId]));void this.irRemote.read();this.render();return;}
    if(device.model===vacuumModel){this.panelLoading=false;this.deviceOpening.begin();this.vacuum.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.vacuum.read();this.render();return;}
    const cached=this.devicePreviewCache.get(this.deviceCacheKey(device,context));
    if(cached&&Date.now()-cached.at<300000){this.panel=this.projectPanel(cached.panel,-1);this.linkedPanels.set(context.did,this.panel);this.panelIsCached=true;this.panelCachedAt=cached.cachedAt;this.panelHasCachedState=cached.hasCachedState;this.washerConfig=cached.washerConfig;}
    if(!presentationReady(device,this.panel))this.deviceOpening.begin();this.render();
    const freshRequest=this.transport.devicePanel(context);
    if(device.model===routerModel&&device.online){this.router.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.router.load(context);}
    if(speakerMetadataSupported(device.model)&&device.online){this.speaker.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.speaker.read();}
    if(device.model===bathHeaterModel){this.bathHeater.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.bathHeater.read();}
    if(device.model===fryerModel){this.fryer.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.fryer.read();}
    if(isCloudDoorbell(device.model)){this.doorbell.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));void this.doorbell.read();}
    // Resource acquisition must never serialize or gate device state/preview.
    void this.loadDeviceUiResources(context, epoch);
    if(device.model==='midjd8.washer.42')void this.loadWasherConfig(context,epoch);
    void this.transport.devicePreview(context).then(preview=>{
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
      this.acceptPanel(panel,readVersion,false,Date.now()); this.panelLoading = false;
      if(vacuumPageEligible(device,panel))this.specVacuum.bind(context,JSON.stringify([this.session?.region,this.session?.userId]),panel,
        device.online&&specVacuumMapEligible(panel));
      if(device.model!==airerModel&&airerPageEligible(device,panel))this.specAirerCommands.bind(device,context,JSON.stringify([this.session?.region,this.session?.userId]),panel);
      if(device.model!=='midjd8.washer.42'&&washerPageEligible(device,panel)&&!isDryerPanel(panel)&&!washerDrums(panel).length)void this.loadWasherConfig(context,epoch);
      this.panelIsCached=false;this.panelHasCachedState=false;this.deviceContentReady();this.render(true);
      if (panelLayout(device, panel) === 'temperature-humidity-sensor') void this.loadSensorHistory(context, epoch);
      if(energySupported(device,panel))this.loadEnergy({period:'week',date:dateKey(new Date())});

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
    if(!current()||this.washerLoading)return;this.washerLoading=true;
    try{
      const report=await this.transport.washerConfig(context);if(!current())return;
      if(report.did!==context.did||report.model!==this.currentDevice()?.model)throw Error('洗涤程序与设备不匹配。');this.washerConfig=report;if(this.panel)this.rememberDevice(this.panel);
    }catch(error){if(current())this.handleSessionError(normalizeError(error));}
    finally{if(current()){this.washerLoading=false;this.deviceContentReady();if(!this.editing())this.render(true);}}
  }
  private closeWasherOrder():void{
    this.washerReservationOpen=false;this.render(true);
    this.root.querySelector<HTMLElement>('[data-focus-key=washer-program-order]')?.focus({preventScroll:true});
  }

  private panelSecondaryReadAt=0;
  private async readProperties(automatic = false, stateOnly = false): Promise<void> {
    if (automatic&&this.backgroundPaused() || !this.context || this.panelLoading || this.controlBusy) return;
    const context = { ...this.context }; const epoch = this.panelEpoch;
    const washerReadVersion=this.washerRuntimeCommands.version;
    const fridgeReadVersion=this.fridgeCommands.version,airerReadVersion=this.airerCommands.version;
    const dispenserReadVersion=this.dispenserCommands.version;
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
      if(washerPageEligible(this.currentDevice(),panel)&&washerReadVersion!==this.washerRuntimeCommands.version){this.render(true);return;}
      if(this.currentDevice()?.model===airerModel&&airerReadVersion!==this.airerCommands.version||this.currentDevice()?.model===fridgeModel&&fridgeReadVersion!==this.fridgeCommands.version){this.render(true);return;}
      if(this.currentDevice()?.model===dispenserModel&&(dispenserReadVersion!==this.dispenserCommands.version||sterilizationReadVersion!==this.dispenserSterilization.version||selfCheckReadVersion!==this.dispenserSelfCheck.version||reminderReadVersion!==this.dispenserReminders.version)){this.render(true);return;}
      if (!automatic || !this.editing(stateOnly) || this.observingSterilization() || this.observingSelfCheck()) {
        this.acceptPanel(panel,readVersion,stateOnly,Date.now());this.panelIsCached=false;this.panelHasCachedState=false;this.propertyOps.resume();this.render(true);
        if(stateOnly&&Date.now()-this.panelSecondaryReadAt<10_000)return;
        this.panelSecondaryReadAt=Date.now();
        await this.loadLinkedPanels(context, epoch);
        const device = this.currentDevice();
        if (device && panelLayout(device, panel) === 'temperature-humidity-sensor' && this.historyError?.retryable !== false && Date.now() - this.historyReadAt >= 300000) void this.loadSensorHistory(context, epoch);
        if(device&&energySupported(device,panel)&&!this.energyLoading&&Date.now()-this.energyReadAt>=300000)this.loadEnergy({period:'week',date:dateKey(new Date())});
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
      if (epoch === this.panelEpoch && sameContext(context, this.context)) { this.historyLoading = false; this.render(); }
    }
  }

  private loadEnergy(selection:EnergySelection):void {
    if(!this.context)return;
    this.energyData=undefined;this.energyLoading=true;this.energyError=undefined;this.energyReadAt=Date.now();
    const request=++this.energyEpoch,epoch=this.panelEpoch,context={...this.context};
    const current=()=>request===this.energyEpoch&&epoch===this.panelEpoch&&sameContext(context,this.context);
    this.render();void(async()=>{
      try{const data=await this.transport.outletEnergy(context,selection);if(!current())return;
        if(data.did!==context.did||data.model!==this.currentDevice()?.model||data.selection.period!==selection.period||data.selection.date!==selection.date)throw Error('统计记录与当前设备或周期不匹配，请重试。');this.energyData=data;
      }catch(error){if(!current())return;this.energyError=normalizeError(error);this.handleSessionError(this.energyError);}
      finally{if(current()){this.energyLoading=false;this.render();}}
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
  private scaleHistory:ScaleHistoryState;
  private renderDrawer(previous?:HTMLElement|null): HTMLElement {
    const washer=this.currentDevice();
    const dedicated=washer?dedicatedPage(washer.model):undefined;
    if(this.doorbell.view!=='cloud'||!isCloudDoorbell(washer?.model??''))this.doorbellPlayer?.dispose();
    if(this.purifierGuide&&(washer?.model!=='xiaomi.waterpuri.lx32'||this.purifierView.page!=='guide')){this.purifierGuide.dispose();this.purifierGuide=undefined;}
    const artwork=()=>washer?this.deviceArtwork(washer):element('span','device-artwork',icon('device'));
    const panel=washer?matchingPanel(washer,this.panel):undefined;
    const appliance=washer&&applianceDetailCategory(washer,panel);
    const environment=washer&&environmentCategory(washer,panel);
    if(washer&&appliance==='scale'){
      const account=this.session?.userId&&this.accountProfile
        ?{id:this.session.userId,profile:this.accountProfile}:undefined;
      const page=scalePage(washer,this.scaleHistory,artwork,()=>this.closePanel(),account);
      return this.withUiResourceMetadata(element('div','device-stage',page));
    }
    if(washer&&unavailableApplianceDetail(appliance,washer.model))
      return this.withUiResourceMetadata(deviceUnavailablePage(washer,()=>this.closePanel()));
    if(washer&&hasDedicatedCeilingFan(washer))
      return this.withUiResourceMetadata(ceilingFanPage({device:washer,state:this.ceilingFan,back:()=>this.closePanel()}));
    if(washer&&!this.deviceOpening.waiting&&routerPageEligible(washer,panel))
      return this.withUiResourceMetadata(routerPage({device:washer,state:this.router,panel:this.panelIsCached||this.panelError?undefined:panel,artwork,back:()=>this.closePanel()}));
    if(washer&&panel&&panel.did===washer.did&&panel.model===washer.model&&
      !this.panelLoading&&!this.deviceOpening.waiting&&!this.panelError&&
      (panel.unsupportedReason||!panel.services.some(s=>s.name!=='device-information'&&(s.properties.length||s.actions.length||s.events?.length)))&&
      !dedicated&&!cameraPageEligible(washer)&&!isIrRemote(washer.model)&&washer.model!==vacuumModel&&!speakerMetadataSupported(washer.model))
      return this.withUiResourceMetadata(deviceUnavailablePage(washer,()=>this.closePanel()));
    const sensor=washer&&sensorDetailCategory(washer,this.panel);
    if(washer&&sensor==='temperature-humidity-sensor'&&!this.deviceOpening.waiting){
      const back=button('','page-icon-button',()=>this.closePanel(),'back');
      back.setAttribute('aria-label','返回家庭');
      const page=element('section','device-page page-temperature-humidity-sensor');
      page.dataset.presentationTemplate=sensor;page.dataset.visualAdapter=sensor;
      const content=sharedDeviceViews.renderTemperatureHumidityPage.call(this.presenterHost(),washer);
      page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',washer.name))),
        element('div','device-page-scroll',content));
      return this.withUiResourceMetadata(element('div','device-stage',page));
    }
    if(washer&&sensor&&!this.deviceOpening.waiting)
      return this.withUiResourceMetadata(sharedDeviceViews.renderStatusReadingsPage.call(this.presenterHost(),washer,'sensor-readings',
        sensorDetailReadings(sensor,this.panel),()=>this.closePanel()));
    const security=washer&&securityCategory(washer);
    if(washer&&security&&!this.deviceOpening.waiting){
      const panel=washer.online&&!this.panelIsCached&&this.panel?.did===washer.did&&this.panel.model===washer.model&&!this.panel.unsupportedReason?this.panel:undefined;
      const readings=securityReadings(security,panel).map(({metric,label,value,property})=>({
        metric,label,property,unit:metric==='battery'?'%':undefined,
        displayValue:property?.value!=null?String(property.value):value,
      }));
      return this.withUiResourceMetadata(sharedDeviceViews.renderStatusReadingsPage.call(this.presenterHost(),washer,'security-readings',readings,()=>this.closePanel()));
    }
    if(washer&&batteryOnlyCleaner(washer)&&!this.deviceOpening.waiting){
      const property=this.panel?.did===washer.did&&this.panel.model===washer.model?cleanerBattery(this.panel):undefined;
      const value=washer.online&&!this.panelIsCached?currentCleanerBattery(property):undefined;
      const readings=property?[{metric:'battery',property:value===undefined?undefined:property,label:'当前电量',
        unit:'%',displayValue:value===undefined?undefined:String(value)}]:[];
      return this.withUiResourceMetadata(sharedDeviceViews.renderStatusReadingsPage.call(this.presenterHost(),washer,'cleaner-battery',readings,()=>this.closePanel(),
        property?undefined:this.panelError?.message));
    }
    const remoteExtrasOpen=previous?.querySelector<HTMLDetailsElement>('.ir-extra-keys')?.open;
    if(washer&&isIrRemote(washer.model)&&!this.deviceOpening.waiting)return irRemotePage({device:washer,state:this.irRemote,back:()=>this.closePanel(),extrasOpen:remoteExtrasOpen});
    if(washer&&!this.deviceOpening.waiting){
      if(washer.model===vacuumModel)return vacuumPage({device:washer,state:this.vacuum,back:()=>this.closePanel(),previous,mapSupported:true});
      if(this.panel&&vacuumPageEligible(washer,this.panel))return vacuumPage({device:washer,state:this.specVacuum,back:()=>this.closePanel(),previous,
        mapSupported:specVacuumMapEligible(this.panel),error:this.panelError?.message,retry:()=>void this.openPanel(washer)});
    }
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='cloud'&&this.doorbell.selectedEvent)return this.doorbellPlayer?this.withUiResourceMetadata(this.doorbellPlayer.update({...this.context},washer,this.doorbell.date,this.doorbell.selectedEvent,this.doorbell.report?.events,id=>this.doorbell.thumbnail(id),id=>this.doorbell.play(id))):this.loadMediaDrawer('doorbell',washer);
    if(washer&&this.context&&isCloudDoorbell(washer.model)&&!this.deviceOpening.waiting&&this.doorbell.view==='events')return this.withUiResourceMetadata(doorbellPage({device:washer,state:this.doorbell,battery:doorbellBattery(this.panel),back:()=>this.closePanel(),live:()=>{this.doorbell.view='live';this.render(true);}}));
    if(washer&&this.context&&cameraPageEligible(washer)&&!this.deviceOpening.waiting){
      if(!this.cameraPlayer)return this.loadMediaDrawer('camera',washer);
      return this.withUiResourceMetadata(this.cameraPlayer.update({...this.context},washer,{panel:this.panel,loading:this.panelLoading&&!presentationReady(washer,this.panel),cached:this.panelIsCached,busy:this.controlBusy,error:this.panelNotice?.tone==='error'?this.panelNotice.title:this.panelError?.message}));
    }
    const pinnedLayout=this.presentationRoute.choose(washer,this.panel);
    if(this.presentationRoute.changed){
      const stage=element('div','device-stage'),page=element('section',`device-page page-${dedicated??pinnedLayout}`);
      page.dataset.presentationTemplate=dedicated??pinnedLayout;
      page.append(element('header','device-page-header',button('','page-icon-button',()=>this.closePanel(),'back'),element('div','device-page-title',element('h2','',washer?.name??'设备'))),element('div','device-page-scroll',notice({tone:'warning',title:'设备能力描述已更新',message:'请返回后重新打开设备，以加载新的控制绑定。'})));
      stage.append(page);return this.withUiResourceMetadata(stage);
    }
    if(washer&&environment&&pinnedLayout==='generic'&&!this.deviceOpening.waiting&&!this.panelLoading&&!this.panelError)
      return this.withUiResourceMetadata(deviceUnavailablePage(washer,()=>this.closePanel()));
    if(washer&&this.context&&!this.deviceOpening.waiting){
      const back=()=>this.closePanel();
      if(washer.model===dispenserModel&&this.dispenserView.page==='home')
        return this.withUiResourceMetadata(dispenserTemperaturePage(washer,this.panelIsCached||this.panelError?undefined:panel,back));
      if(panel&&audioDetailEligible(washer,panel)){
        const context={...this.context},epoch=this.panelEpoch;
        const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
        return this.withUiResourceMetadata(speakerPage({device:washer,panel,state:this.speaker,back,artwork,
          busy:this.controlBusy,cached:this.panelIsCached,
          write:(property,value)=>{if(current())void this.setBoundProperty(property,value,washer.did);},
          error:error=>{if(current())this.handleSessionError(normalizeError(error));},
          interactionEnded:()=>{if(current())this.render(true);},
          play:track=>{if(current())void this.submitDirectAction(context,epoch,track);},
          pending:track=>this.directActions.has(this.directActionKey(context,epoch,track)),
          setPlayback:(property,value)=>{
            if(!current()||this.panelIsCached||!washer.online||washer.sharedReadOnly)return;
            const key=this.operationKey(washer.did,property.siid,property.piid);
            const confirmed=this.confirmedPanels.get(washer.did)?.services.find(s=>s.siid===property.siid)?.properties.find(p=>p.piid===property.piid);
            if(!isReadableValue(confirmed))return;
            this.propertyContexts.set(key,{context,homeEpoch:this.homeEpoch,playbackEpoch:epoch});
            this.propertyOps.write(key,value,confirmed.value);
          },
        }));
      }
      if(simpleLivingDetail(appliance)&&panel)
        return this.withUiResourceMetadata(livingDetailPage({device:washer,panel,category:appliance,back,
          artwork:()=>this.deviceArtwork(washer,'',3,true),control:node=>this.control(node,washer)}));
      if(appliance==='window-opener'&&panel){
        const context={...this.context},epoch=this.panelEpoch;
        return this.withUiResourceMetadata(windowOpenerPage({device:washer,panel,back,locked:this.controlBusy||this.panelIsCached,
          control:node=>this.control(node,washer),write:(property,value)=>{
            if(epoch!==this.panelEpoch||!sameContext(context,this.context))return;
            void this.setProperty(property,value);this.schedulePanelRefresh();
          }}));
      }
      if(appliance==='curtain'&&panel){
        const content=this.renderCurtainPage(washer);
        if(!content.querySelector('.native-card'))return this.withUiResourceMetadata(deviceUnavailablePage(washer,back));
        const goBack=button('','page-icon-button',back,'back');goBack.setAttribute('aria-label','返回家庭');
        const page=element('section','device-page page-curtain',
          element('header','device-page-header',goBack,element('div','device-page-title',element('h2','',washer.name))),
          element('div','device-page-scroll',content));
        page.dataset.presentationTemplate='curtain';
        return this.withUiResourceMetadata(element('div','device-stage',page));
      }
      const kitchenProps={device:washer,panel,back,artwork:()=>this.deviceArtwork(washer,'',3,true),control:(node:ControlNode)=>this.control(node,washer)};
      if(appliance==='kettle'||appliance==='teabar'||appliance==='water-dispenser'&&washer.model!==dispenserModel)
        return this.withUiResourceMetadata(waterHeatingPage({...kitchenProps,category:appliance}));
      if(appliance==='hood'||appliance==='integrated-stove')return this.withUiResourceMetadata(hoodPage(kitchenProps,appliance));
      if(appliance==='dishwasher'||appliance==='sterilizer'){
        const context={...this.context},epoch=this.panelEpoch;
        const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
        return this.withUiResourceMetadata(kitchenCyclePage({...kitchenProps,cached:this.panelIsCached||!!this.panelError,
          view:this.kitchenCycleView,readAt:this.panelIsCached||this.panelError?undefined:this.kitchenCycleReadAt,
          open:view=>{
            if(!current())return;
            const from=this.kitchenCycleView;this.kitchenCycleView=view;this.render();
            if(from==='runtime'&&!view)this.root.querySelector<HTMLElement>('[data-focus-key=washer-runtime-entry]')?.focus({preventScroll:true});
          },
          write:(property,value)=>{
            if(!current()||this.panelIsCached||this.panelError)return;
            const live=kitchenCycleBindings(washer,this.panel,appliance);
            if(live.canSelect&&live.mode?.siid===property.siid&&live.mode.piid===property.piid&&live.choices.some(choice=>choice.value===value))
              void this.setBoundProperty(live.mode,value,washer.did);
          }},appliance));
      }
      if(appliance==='ceiling-fan'&&washer.model!==ceilingFanModel)return this.withUiResourceMetadata(standardCeilingFanPage(kitchenProps));
      if(appliance==='water-softener')return this.withUiResourceMetadata(purifierPage({...kitchenProps,softener:true}));
      if(appliance==='cooker'||appliance==='pressure-cooker'||fryerStyleCategory(appliance)&&washer.model!==fryerModel){
        const context={...this.context},epoch=this.panelEpoch;
        const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
        if(washer.online&&panel&&!this.panelIsCached&&cookingPanel(panel)?.modes.length){
          this.cooking.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
          this.cooking.seed(panelReadback(panel));
        }else this.cooking.close();
        const display=panel&&this.cooking.actual?panelDisplay(this.cooking.actual,panel):this.cooking.actual??panel;
        return this.withUiResourceMetadata(cookingPage({device:washer,panel:display,category:appliance,view:this.cookingView,
          busy:this.panelIsCached||this.cooking.pending||!!this.cooking.error,
          actionBusy:panel?.services.some(service=>service.properties.some(property=>!!property.pending)),
          animationOwner:this.cooking,back,editor:this.cookingEditor,changed:()=>{if(current())this.render(true);},
          write:(property,value)=>{
            if(!current()||this.panelIsCached||this.cooking.pending||this.cooking.error)return;
            const live=cookingPanel(this.cooking.actual??this.panel);
            const field=[live?.target,live?.duration,live?.warm,live?.modeSetting].find(item=>item?.siid===property.siid&&item.piid===property.piid);
            if(live?.phase==='ready'&&field)void this.setBoundProperty(field,value,washer.did);
          },
          select:view=>{if(current()){this.cookingView=view;this.cookingEditor={};this.render();}},
          execute:command=>{
            if(!current()||this.panelIsCached||!washer.online||washer.sharedReadOnly||this.cooking.pending||this.cooking.error)return;
            void this.cooking.change(command);
          },
        }));
      }
      if(appliance==='card-switch'){
        const power=cardSwitchPower(panel);
        if(!power)return this.withUiResourceMetadata(deviceUnavailablePage(washer,back));
        const buttonBack=button('','page-icon-button',back,'back');buttonBack.setAttribute('aria-label','返回家庭');
        const control=this.control({name:'Power',props:{property:power,label:'开关',openLabel:'开启',closeLabel:'关闭'}},washer);
        const page=element('section','device-page page-card-switch',
          element('header','device-page-header',buttonBack,element('div','device-page-title',element('h2','',washer.name))),
          element('div','device-page-scroll device-controls-region',
            element('div','category-product',this.deviceArtwork(washer,'',3,true),element('h1','',washer.name)),
            element('div','device-card-stack',control)));
        page.dataset.presentationTemplate='card-switch';
        return this.withUiResourceMetadata(element('div','device-stage',page));
      }
      if(appliance==='water-purifier'&&this.purifierView.page==='home')
        return this.withUiResourceMetadata(purifierPage({device:washer,panel,back}));
      if(appliance==='fridge'&&(!panel||!fridgeProfile(panel))){
        const context={...this.context},epoch=this.panelEpoch;
        const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
        return this.withUiResourceMetadata(standardFridgePage(washer,panel,{
          device:washer,busy:this.panelIsCached,
          write:(property,value)=>{if(current())void this.setBoundProperty(property,value,washer.did);},
          error:error=>{if(current()){this.panelNotice={tone:'error',title:normalizeError(error).message};this.render(true);}},
          interactionEnded:()=>{if(current())this.render(true);},
        },back));
      }
    }
    const lightType=panel?.specType??washer?.specType;
    if(washer&&panel&&!this.panelLoading&&!this.deviceOpening.waiting&&pinnedLayout==='generic'&&
      lightingCategory(lightType)&&capabilityCategory(lightType)!=='ceiling-fan')
      return this.withUiResourceMetadata(deviceUnavailablePage(washer,()=>this.closePanel()));
    if(washer&&this.panel&&this.context&&!this.deviceOpening.waiting&&televisionPageEligible(washer,this.panel)){
      const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const press=(command:TelevisionCommand)=>{
        if(!current()||this.presentationRoute.changed)return;
        if(command.kind==='action')void this.submitDirectAction(context,epoch,command);
        else void this.setBoundProperty(command.property,command.value,washer.did);
      };
      return this.withUiResourceMetadata(televisionPage({device:washer,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,
        back:()=>this.closePanel(),press:(_role,command)=>press(command),pressExtra:press,extrasOpen:remoteExtrasOpen,
        pending:command=>this.directActions.has(this.directActionKey(context,epoch,command))}));
    }
    const hasGenericDescriptor=!dedicated&&!this.panelLoading&&!this.panelError&&!!this.panel?.specType&&!this.panel.unsupportedReason
      &&this.panel.did===washer?.did&&this.panel.model===washer?.model;
    const dataReady=presentationReady(washer,this.panel)||hasGenericDescriptor||pinnedLayout==='light'||pinnedLayout==='light-group';
    if(dataReady)this.deviceDataPresented=true;
    if(this.deviceOpening.waiting||!this.deviceDataPresented){
      const stage=element('div','device-stage'),page=element('section',`device-page page-${dedicated??pinnedLayout} device-page-loading`),body=element('div','device-page-scroll');
      page.dataset.presentationVersion=String(PRESENTATION_VERSION);page.dataset.presentationTemplate=dedicated??pinnedLayout;
      page.append(element('header','device-page-header',button('','page-icon-button',()=>this.closePanel(),'back'),element('div','device-page-title',element('h2','',washer?.name??'设备'))),body);
      const pending=this.panelLoading||(washer?.model==='midjd8.washer.42'&&this.washerLoading);
      if(!pending&&!this.deviceOpening.waiting)body.append(notice({tone:'warning',title:!washer?.online?'设备离线':this.panelError?.message??this.panel?.unsupportedReason??this.router.error?.message??'暂未取得设备状态',message:!washer?.online?'设备恢复在线后会自动更新。':'本次读取未返回可用状态，恢复后将自动显示。'}));
      else body.append(deviceLoading(washer?this.deviceArtwork(washer):element('span','device-artwork',icon('device')),washer?.name??'设备'));
      page.querySelector('button')?.setAttribute('aria-label','返回家庭');stage.append(page);return this.withUiResourceMetadata(stage);
    }
    if(washer?.model===bathHeaterModel&&this.panel)return this.withUiResourceMetadata(bathHeaterPage({device:washer,state:this.bathHeater,back:()=>this.closePanel()}));
    const bathroom=bathroomCategory(washer,this.panel);
    if(bathroom&&washer&&this.panel&&this.context){
      const panel=this.panel,context={...this.context},epoch=this.panelEpoch;
      const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const back=()=>this.closePanel();
      const props={
        device:washer,panel,back,disabled:this.panelIsCached||!washer.online||!!washer.sharedReadOnly,
        control:(node:ControlNode)=>this.control(node,washer),
        execute:(command:BathroomCommand)=>{
          if(!current())return;
          if('property' in command)void this.setBoundProperty(command.property,command.value,washer.did);
          else void this.submitDirectAction(context,epoch,command);
        },
        actionPending:(command:BathroomCommand)=>'action' in command&&
          this.directActions.has(this.directActionKey(context,epoch,command)),
      };
      if(bathroom==='toilet')return this.withUiResourceMetadata(toiletPage({...props,setting:this.toiletSetting,select:setting=>{
        if(current()){this.toiletSetting=setting;this.render(true);}
      }}));
      if(bathroom==='bath-heater')return this.withUiResourceMetadata(standardBathHeaterPage(props));
      if(bathroom==='water-heater'||bathroom==='boiler'||bathroom==='towel-rack')return this.withUiResourceMetadata(bathroomHeatingPage({
        ...props,category:bathroom,artwork:()=>this.deviceArtwork(washer,'',3,true),
      }));
      const temperature=bathroomTemperature(panel,bathroom==='shower'?'shower.water-temperature':'water-faucet.temperature');
      const battery=bathroomBattery(panel);
      const unit=temperature?.unit==='kelvin'?'K':temperature?.unit==='fahrenheit'?'℉':'℃';
      const readings=[
        ...(temperature?[{metric:'temperature',label:'当前温度',property:temperature,unit}]:[]),
        ...(battery?[{metric:'battery',label:'当前电量',property:battery,unit:'%'}]:[]),
      ];
      return this.withUiResourceMetadata(sharedDeviceViews.renderStatusReadingsPage.call(this.presenterHost(),washer,bathroom,readings,back));
    }
    if(washer?.model===fryerModel&&this.panel)return this.withUiResourceMetadata(fryerPage({device:washer,state:this.fryer,view:this.fryerView,changed:()=>this.render(true),back:()=>this.closePanel()}));
    if(washer?.model===dispenserModel&&this.panel&&dispenserProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);this.dispenserCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSterilization.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.dispenserSelfCheck.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-history'||this.dispenserView.page==='selfcheck-report'){return this.withUiResourceMetadata(dispenserSelfCheckPage({device:washer,panel:this.panel,commands:this.dispenserSelfCheck,view:this.dispenserView.page,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserCommands.pending||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserSelfCheck.confirming=false;if(this.dispenserView.page==='selfcheck')this.dispenserSelfCheck.checked=false;this.dispenserView={page:this.dispenserView.page==='selfcheck'||this.dispenserView.page==='selfcheck-report'&&this.dispenserSelfCheck.selected?.time===0?'settings':this.dispenserView.page==='selfcheck-history'?'selfcheck':'selfcheck-history'};this.dispenserSelfCheck.selected=undefined;this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},history:()=>{if(current()){this.dispenserView={page:'selfcheck-history'};this.render(true);void this.dispenserSelfCheck.loadHistory(context);}},report:()=>{if(current()){this.dispenserView={page:'selfcheck-report'};this.render(true);}},run:(operation,expected)=>{if(current())void this.dispenserSelfCheck.run(context,operation,expected).finally(()=>{if(current())this.schedulePanelRefresh();});}}));}
      this.dispenserReminders.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.dispenserView.page==='reminders')return this.withUiResourceMetadata(dispenserRemindersPage({state:this.dispenserReminders,view:this.dispenserReminderView,busy:this.controlBusy||this.dispenserSterilization.pending,artwork,back:()=>{if(current()){this.dispenserReminderView={page:'settings'};this.dispenserView={page:'settings'};this.render(true);}},changed:()=>{if(current())this.render(true);},navigate:view=>{if(current()){this.dispenserReminderView=view;this.render(true);}},save:(update,revision)=>current()?this.dispenserReminders.save(context,update,revision):Promise.resolve(false),read:()=>{if(current())void this.dispenserReminders.read(context).then(()=>{if(current()&&!this.dispenserReminders.error&&this.dispenserReminderView.page==='edit'){this.dispenserReminderView={page:'list'};this.render(true);}});}}));
      if(this.dispenserView.page==='sterilization'){
        const run=(operation:'start'|'stop')=>{if(!current()||!this.panel)return;const status=sterilizationState(this.panel).status;if(status===null)return;void this.dispenserSterilization.run(context,{operation,expectedStatus:status}).finally(()=>{if(current())this.schedulePanelRefresh();});};
        return this.withUiResourceMetadata(dispenserSterilizationPage({device:washer,panel:this.panel,commands:this.dispenserSterilization,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserCommands.pending,artwork,back:()=>{if(current()){this.dispenserSterilization.confirming=false;this.dispenserView={page:'settings'};this.render(true);this.schedulePanelRefresh();}},changed:()=>{if(current())this.render(true);},start:()=>run('start'),stop:()=>run('stop'),refresh:()=>{if(current())void this.dispenserSterilization.refresh(context).finally(()=>{if(current())this.schedulePanelRefresh();});},error:this.panelError?.message}));
      }
      if(this.dispenserView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.filter(s=>s.name!=='no-disturb').map(s=>({...s,actions:s.siid===2?s.actions.filter(a=>![2,3,4].includes(a.aiid)):s.siid===7?s.actions.filter(a=>![1,2].includes(a.aiid)):s.actions,properties:s.properties.map(p=>[[2,7],[2,6],[3,1],[4,1],[2,9],[2,10],[2,11],[2,12]].some(([siid,piid])=>p.siid===siid&&p.piid===piid)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',()=>{this.dispenserView={page:'settings'};this.render(true);},'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(dispenserPage({device:washer,panel:this.panel,view:this.dispenserView,commands:this.dispenserCommands,cached:this.panelIsCached,busy:this.controlBusy||this.dispenserSterilization.pending||this.dispenserReminders.pending,artwork,back:()=>this.closePanel(),navigate:view=>{if(current()){this.dispenserView=view;this.render(true);if(view.page==='sterilization'||view.page==='selfcheck')void this.readProperties();if(view.page==='reminders'){this.dispenserReminderView={page:'settings'};void this.dispenserReminders.read(context);}}},changed:()=>{if(current())this.render(true);},change:change=>current()?this.dispenserCommands.change(context,change):Promise.resolve(false),refresh:()=>{if(current())void this.dispenserCommands.refresh(context);},compatibility:()=>{if(current()){this.dispenserView={page:'compatibility'};this.render(true);}},error:this.panelError?.message}));
    }
    if(washer?.model===fridgeModel&&this.panel&&fridgeProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      this.fridgeCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      return this.withUiResourceMetadata(fridgePage({
        device:washer,panel:this.panel,commands:this.fridgeCommands,cached:this.panelIsCached,busy:this.controlBusy,
        back:()=>this.closePanel(),changed:()=>{if(current())this.render(true);},error:this.panelError?.message,
        write:(field,value)=>{
          if(!current()||!this.panel)return;
          const expected=fridgeCurrent(this.panel,field);
          if(expected!==undefined)void this.fridgeCommands.change(context,{field,expected,value});
        },
      }));
    }
    if(washer?.model===airerModel&&this.panel&&airerProfile(this.panel)){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context),home=()=>{if(current()){this.airerView={page:'home'};this.render(true);}};this.airerCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.airerView.page==='compatibility'){const panel={...this.panel,services:this.panel.services.map(s=>({...s,actions:s.siid===4?s.actions.filter(a=>a.aiid>5):s.actions,properties:s.properties.map(p=>(p.siid===2&&[2,6].includes(p.piid)||p.siid===4&&([1,2,3,4,5,6,9].includes(p.piid)))?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});const stage=element('div','device-stage'),page=element('section','device-page page-generic');page.append(element('header','device-page-header',button('','page-icon-button',home,'back'),element('div','device-page-title',element('h2','','其他设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);}
      return this.withUiResourceMetadata(airerPage({device:washer,panel:this.panel,view:this.airerView,commands:this.airerCommands,cached:this.panelIsCached,busy:this.controlBusy,artwork,back:()=>this.closePanel(),home,changed:()=>{if(current())this.render(true);},lift:intent=>{const status=airerStatus(this.panel!);if(current()&&status!==undefined)void this.airerCommands.lift(context,{intent,expectedStatus:status});},write:(p,v)=>{if(current())void this.setProperty(p,v);},night:()=>{const night=airerNight(this.panel!);if(current()&&night){this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}},save:()=>{const draft=this.airerView.draft;if(current()&&draft)void this.airerCommands.night(context,draft).then(saved=>{if(saved&&current())home();});},compatibility:()=>{if(current()){this.airerView={page:'compatibility'};this.render(true);}},refresh:()=>{if(current())void this.airerCommands.refresh(context).then(read=>{if(read&&current()&&this.airerView.page==='night'){const night=airerNight(this.panel!);if(night)this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.render(true);}});},error:this.panelError?.message}));
    }
    if(washer&&this.panel&&this.context&&airerPageEligible(washer,this.panel)){
      const context={...this.context},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      return this.withUiResourceMetadata(standardAirerPage({device:washer,panel:this.panel,commands:this.specAirerCommands,cached:this.panelIsCached,busy:this.controlBusy,
        artwork:()=>this.deviceArtwork(washer,'',3,true),back:()=>this.closePanel(),write:(p,v)=>{if(current())void this.setProperty(p,v);},changed:()=>{if(current())this.render(true);}}));
    }
    if(washer?.model==='xiaomi.waterpuri.lx32'&&this.panel?.purifier&&!this.panel.unsupportedReason){
      const context={...this.context!},epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      if(this.purifierView.page==='guide'){this.purifierGuide??=purifierGuidePage(()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},artwork);return this.withUiResourceMetadata(this.purifierGuide.node);}
      this.purifierCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      this.purifierOptions.bind(context,JSON.stringify([this.session?.region,this.session?.userId]));
      if(this.purifierView.page==='functions'&&!this.purifierOptions.loading&&!this.purifierOptions.error&&!this.purifierOptions.pending&&!this.purifierOptions.blocked&&(!this.purifierOptions.report||this.purifierOptions.report.filterFlushingSupported===true&&typeof purifierSetting(this.panel,'flushing')?.value==='boolean'&&this.purifierOptions.report.flushing!==purifierSetting(this.panel,'flushing')?.value))queueMicrotask(()=>{if(current())void this.purifierOptions.read(context);});
      if(['functions','pipeline','water-mode'].includes(this.purifierView.page))return this.withUiResourceMetadata(purifierSettingsPage({device:washer,panel:this.panel,view:this.purifierView,cached:this.panelIsCached,busy:this.controlBusy||this.purifierOptions.pending,error:this.panelNotice?.title??this.panelError?.message,options:this.purifierOptions,push:enabled=>{if(current())void this.purifierOptions.save(context,enabled);},
        back:()=>{if(current()){if(this.purifierView.page==='functions'){this.purifierView=newPurifierView();this.render(true);}else{this.purifierView={page:'functions',filter:0};this.render(true);}}},
        open:page=>{if(current()){this.purifierView={page,filter:0};this.render(true);}},changed:()=>{if(current())this.render(true);},write:(p,value)=>{if(current())void this.setProperty(p,value);},refresh:()=>{if(current()){void this.readProperties(true);void this.purifierOptions.read(context);}}}));
      if(this.purifierView.page==='compatibility'){
        const panel={...this.panel,services:this.panel.services.filter(s=>s.name!=='no-disturb').map(s=>({...s,properties:s.properties.map(p=>p.siid===7&&p.piid===1||isPurifierSetting(p)?{...p,access:p.access.filter(a=>a!=='write')}:p)}))};
        const document=compilePanelDocument({device:washer,panel,resources:this.uiResources,includeModelFallback:true});
        const stage=element('div','device-stage'),page=element('section','device-page page-generic');
        const back=button('','page-icon-button',()=>{if(current()){this.purifierView={page:'functions',filter:0};this.render(true);}},'back');back.setAttribute('aria-label','返回设备设置');
        page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','','设备功能'))),element('div','device-page-scroll',this.renderGenericFunctions(washer,true,document)));stage.append(page);return this.withUiResourceMetadata(stage,document);
      }
      return this.withUiResourceMetadata(purifierPage({device:washer,panel:this.panel,back:()=>this.closePanel()}));
    }
    if(washer&&this.panel&&this.context&&washerPageEligible(washer,this.panel)){
      const panel=this.panel,context={...this.context},epoch=this.panelEpoch;
      const drums=washerDrums(panel);
      if(drums.length&&!drums.some(d=>d.siid===this.washerDrum))this.washerDrum=drums[0].siid;
      const drum=drums.length?this.washerDrum:undefined,liveProgram=isDryerPanel(panel)||drum!==undefined;
      const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const forDrum=(devicePanel:DevicePanel,siid:number|undefined)=>siid===undefined?devicePanel:{...devicePanel,washerRuntime:devicePanel.washerDrums?.find(d=>d.serviceId===siid)};
      const catalog=washerProgramCatalog(this.washerConfig,panel,drum),pinned=this.washerSelectedProgram;
      const programs=pinned&&this.washerView==='program'&&!catalog.some(program=>program.name===pinned.name)?[...catalog,pinned]:catalog;
      this.washerRuntimeCommands.bind(context,JSON.stringify([this.session?.region,this.session?.userId]),washer.model);
      const selectedPanel=forDrum(panel,drum);
      const runtime=washer.online&&!this.panelIsCached?this.washerRuntimeCommands.display(selectedPanel).washerRuntime:undefined;
      const runtimeReadAt=selectedPanel.washerRuntime?.state===runtime?.state?this.washerReadAt:undefined;
      const canOpenRuntime=!!runtime&&washerRuntimeHasDetail(runtime,!!washer.sharedReadOnly);
      const power=clothesDryerPower(panel);
      const modeOnly=appliance==='clothes-dryer'&&!panel.services.some(s=>s.name==='clothes-dryer'&&s.actions.some(a=>a.name==='start-drying'));
      const modeBinding=this.washerSelectedProgram?.published;
      const modeValue=this.washerSelectedProgram?.value;
      const adjustableMode=modeOnly&&modeBinding&&panel.services.find(s=>s.siid===modeBinding.siid&&s.name==='clothes-dryer')
        ?.properties.find(p=>p.name==='mode'&&p.piid===modeBinding.piid&&p.access.includes('write')&&
          isReadableValue(p)&&validChoices(p)&&p.valueList?.some(option=>option.value===modeValue));
      if(appliance==='clothes-dryer'&&!programs.length&&!power&&!runtime?.active&&!canOpenRuntime)
        return this.withUiResourceMetadata(deviceUnavailablePage(washer,()=>this.closePanel()));
      const powerControl=power?this.control({name:'Power',props:{...power,label:'电源',openLabel:'开启',closeLabel:'关闭'}},washer):undefined;
      const maySelect=()=>{
        const device=this.currentDevice();
        const latest=this.panel&&this.washerRuntimeCommands.display(forDrum(this.panel,drum)).washerRuntime;
        return current()&&!!device?.online&&!device.sharedReadOnly&&(drum===undefined||drum===this.washerDrum)&&!washerProgramsLocked(latest)&&!this.washerCommands.pending
          &&(drum===undefined||!!latest&&latest.state!=='unknown'&&!this.panelIsCached);
      };
      const enabledControl=(wanted:WasherRuntimeControl)=>{
        const device=this.currentDevice();
        if(!current()||!this.panel||this.panelIsCached||!device?.online||device.sharedReadOnly||this.controlBusy||this.washerCommands.pending)return;
        return this.washerRuntimeCommands.display(forDrum(this.panel,drum)).washerRuntime?.controls.find(control=>
          control.key!=='lock'&&control.enabled&&control.key===wanted.key&&control.siid===wanted.siid&&control.aiid===wanted.aiid&&control.piid===wanted.piid&&control.value===wanted.value);
      };
      if(drum===undefined&&this.washerView==='runtime'&&runtime?.stage==='blowing and shaking'&&!runtime.cleaning)this.washerView='home';
      if(this.washerView==='runtime'){
        if(runtime?.active||this.washerRuntimeCommands.projecting){clearTimeout(this.washerRuntimeExitTimer);this.washerRuntimeExitTimer=undefined;}
        else if(runtime&&['off','idle'].includes(runtime.state)&&!this.washerRuntimeExitTimer){
          this.washerRuntimeExitTimer=setTimeout(()=>{this.washerRuntimeExitTimer=undefined;if(current()&&this.washerView==='runtime')this.backFromWasherRuntime();},1000);
        }
        return this.withUiResourceMetadata(washerRuntimePage({device:washer,panel:runtime?selectedPanel:{...panel,washerRuntime:undefined},programs,drum:drums.find(d=>d.siid===drum)?.label,commands:this.washerRuntimeCommands,cached:this.panelIsCached||this.controlBusy||this.washerCommands.pending,readAt:runtimeReadAt,confirmation:this.washerRuntimeConfirmation,
          back:()=>{if(current())this.backFromWasherRuntime();},refresh:()=>{if(current())void this.washerRuntimeCommands.refresh(context);},
          choose:wanted=>{const control=enabledControl(wanted);if(!control)return;if(control.confirmation){this.washerRuntimeConfirmation=control;this.render(true);}else void this.washerRuntimeCommands.execute(context,control,drum!==undefined);},
          cancel:()=>{if(current()){this.washerRuntimeConfirmation=undefined;this.render(true);}},
          submit:()=>{if(!current())return;const wanted=this.washerRuntimeConfirmation;this.washerRuntimeConfirmation=undefined;const control=wanted&&enabledControl(wanted);if(control)void this.washerRuntimeCommands.execute(context,control,drum!==undefined);else this.render(true);}}));
      }
      return this.withUiResourceMetadata(washerPage({device:washer,panel,report:this.washerConfig,programs,draft:this.washerDraft,view:this.washerView,loading:this.washerLoading,commands:this.washerCommands,reservationOpen:this.washerReservationOpen,artwork,runtime:runtime??undefined,runtimeReadAt,
        powerControl,modeOnly,modeSetting:adjustableMode&&modeValue!==undefined?{
          selected:adjustableMode.value===modeValue,
          disabled:this.panelIsCached,
          apply:()=>{if(maySelect()&&!this.panelIsCached)void this.setBoundProperty(adjustableMode,modeValue,washer.did);},
        }:undefined,
        drums:drums.length?drums.map(d=>{
          const snapshot=washer.online&&!this.panelIsCached?this.washerRuntimeCommands.display(forDrum(panel,d.siid)).washerRuntime:undefined;
          const status=snapshot?.active?washerHomeStatus(snapshot):snapshot?.state==='off'?'关机':snapshot?.state==='idle'?'待机':snapshot?.state==='fault'?'故障':undefined;
          return {...d,status,selected:d.siid===drum,select:()=>{if(current()&&d.siid!==drum){this.washerDrum=d.siid;this.washerCommands.reset();this.render(true);}}};
        }):undefined,
        openRuntime:canOpenRuntime?()=>{if(current()){this.washerView='runtime';this.render(true);}}:undefined,
        back:()=>this.closePanel(),home:()=>{if(current())this.backFromWasherFunctions();},
        more:()=>{if(maySelect()&&programs.length>6){this.washerView='more';this.render(true);}},
        select:program=>{
          if(!maySelect())return;
          this.washerProgramBack=this.washerView==='more'?'more':'home';this.washerCommands.reset();
          this.washerSelectedProgram=program;
          this.washerDraft=newWasherDraft(this.washerConfig,program,panel);this.washerView='program';
          if(!modeOnly&&(!program.published||liveProgram))this.washerCommands.edit(context,this.washerDraft);
          this.render(true);
        },
        change:draft=>{
          if(modeOnly||!maySelect()||!this.washerDraft||!this.panel||this.washerCommands.locked)return;
          const program=programs.find(p=>p.name===draft.program);if(!program)return;
          const changed=Object.keys(draft.values).find(key=>draft.values[key]!==this.washerDraft!.values[key]);
          this.washerDraft=changed?changeWasherDraft(this.washerConfig,program,this.panel,this.washerDraft,changed,draft.values[changed]):{...this.washerDraft,selector:draft.selector};
          if(changed&&(!program.published||liveProgram))this.washerCommands.edit(context,this.washerDraft);
          this.render(true);
        },refresh:()=>{if(!current())return;if(this.washerDraft&&(!this.washerSelectedProgram?.published||liveProgram))void this.washerCommands.refresh(context,this.washerDraft);else void this.loadWasherConfig(context,epoch);},
        order:()=>{if(maySelect()&&this.washerDraft&&this.washerSelectedProgram?.isOrder&&this.washerCommands.canStart){this.washerReservationOpen=true;this.render(true);}},
        reserve:at=>{if(maySelect()&&this.washerReservationOpen&&this.washerDraft&&this.washerSelectedProgram?.isOrder&&this.washerCommands.canStart){this.washerReservationOpen=false;void this.washerCommands.start(context,this.washerDraft,at);}},
        cancelOrder:()=>{if(current())this.closeWasherOrder();},
        start:()=>{if(maySelect()&&this.washerDraft)void this.washerCommands.start(context,this.washerDraft);},confirm:()=>{if(current()&&this.washerDraft)void this.washerCommands.confirm(context,this.washerDraft);}}));
    }
    const device = this.currentDevice();
    const layout = this.presentationRoute.choose(device, this.panel);
    const document = this.panel && device ? compilePanelDocument({ device, panel: this.panel, resources: this.uiResources, includeModelFallback: layout === 'generic' }) : undefined;
    const stage = element('div', 'device-stage');
    const page = element('section', `device-page page-${layout}`);
    page.dataset.presentationVersion=String(PRESENTATION_VERSION);page.dataset.presentationTemplate=layout;
    const initialLoading=this.panelLoading&&!this.panel;
    page.classList.toggle('device-page-loading',initialLoading);
    page.dataset.pendingOperations=String(this.propertyOps.pendingCount);
    page.dataset.uncertainOperations=String(this.propertyOps.uncertainCount);
    page.setAttribute('aria-busy',String(!!(this.panelLoading||this.controlBusy||this.propertyOps.pendingCount>0)));
    page.setAttribute('aria-label', `${device?.name ?? '设备'}控制`);
    const back = button('', 'page-icon-button', () => this.closePanel(), 'back'); back.setAttribute('aria-label','返回家庭');
    if(this.panelIsCached&&this.panel)page.setAttribute('aria-description',`上次状态${this.panelCachedAt?` · ${new Date(this.panelCachedAt*1000).toLocaleString()}`:''}${this.panelLoading?' · 更新中':''}`);
    const title = layout === 'outlet' ? '' : device?.name ?? '设备';
    page.append(element('header', 'device-page-header', back, element('div', 'device-page-title', element('h2', '', title), layout === 'light-group' ? element('p', '', device?.online ? '已连接' : '设备离线') : null)));
    const body = element('div', 'device-page-scroll');
    if (!device?.online) body.append(notice({ tone: 'warning', title: '设备离线', message: '设备恢复在线后可读取和控制。' }));
    if (this.panelError) body.append(notice({ tone: 'error', title: this.panelError.message }));
    if(this.panelNotice)page.setAttribute('aria-description',[page.getAttribute('aria-description'),this.panelNotice.title,this.panelNotice.message].filter(Boolean).join(' · '));
    if (initialLoading) body.append(deviceLoading(device?this.deviceArtwork(device):element('span','device-artwork',icon('device')),device?.name??'设备'));
    else if (this.panel && device) {
      if (this.panel.unsupportedReason) body.append(notice({ tone: 'warning', title: '此设备功能受限', message: this.panel.unsupportedReason }));
      const adapter = simpleClimateCategory(layout)?
        (target:Device)=>sharedDeviceViews.renderSimpleClimatePage.call(this.presenterHost(),target,layout):this.deviceVisualAdapters[layout];
      if (adapter && document) {
        const content = adapter(device);
        if(content.dataset.lightTheme==='rgb')page.classList.add('page-yeelight-strip');
        if(content.dataset.lightTint)page.style.setProperty('--light-tint',content.dataset.lightTint);
        if(content.dataset.headerStatus){const title=page.querySelector('.device-page-title');title?.querySelector('p')?.remove();title?.append(element('p','device-header-status',content.dataset.headerStatus));}
        if(layout!=='light'&&layout!=='light-group'&&!environment){
          this.applyOfficialCustomItems(content, document, device);
          const omitted=new Set([...content.querySelectorAll<HTMLElement>('[data-siid][data-piid]')].map(n=>`${n.dataset.siid}.${n.dataset.piid}`));
          for(const node of content.querySelectorAll<HTMLElement>('[data-bound-properties]'))for(const key of node.dataset.boundProperties!.split(' '))if(key)omitted.add(key);
          for(const b of resolveDeviceCapabilities(this.panel).properties)if(b.kind==='reading')omitted.add(`${b.siid}.${b.piid}`);
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
        const content=renderCategoryPage({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,
          artwork:()=>this.deviceArtwork(device),
          write:(property,value)=>{if(current())void this.setBoundProperty(property,value,device.did);},
          error:error=>{if(current()){this.panelNotice={tone:'error',title:normalizeError(error).message};this.render();}},
          action:action=>{if(context&&current())void this.submitDirectAction(context,epoch,{action,inputs:[]});},
          interactionEnded:()=>{if(current())this.render(true);}});
        body.append(content.querySelector('[data-capability-role]')
          ?content:deviceUnavailableContent(device));
        page.dataset.visualAdapter='standard-capability';
        page.dataset.capabilityCategory=resolveDeviceCapabilities(this.panel).category??'unknown';
      } else if (document) body.append(this.renderGenericFunctions(device, true, document));
      page.dataset.layoutCompared=String(hasObservedDeviceLayout(device.model));
    }
    page.append(body);
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
    const context=this.context,epoch=this.panelEpoch,panel=this.panel!;
    return renderPanelDocument(document, {
      device, panel, busy:this.panelIsCached,
      write: (property, value) => { void this.setBoundProperty(property, value, device.did); },
      error: error => { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); },
      propertyEditor: (property, service, label) => this.renderPropertyEditor(property, service, device, label),
      action: (action, service) => {
        const label=dailyActionLabel(miotCategory(panel.specType),service,action);
        if(!label||!context||!desktopActionShortcut(service,action))return;
        const control=button(label,'button daily-action-button',()=>void this.submitDirectAction(context,epoch,{action,inputs:[]}),
          action.name==='turn-off'?'power':action.name.includes('pause')?'pause':undefined);
        control.disabled=!device.online||!!device.sharedReadOnly||this.panelIsCached||this.controlBusy;
        return element('div','daily-action-row',control);
      },
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
      if (control.classList.contains('climate-socket-relay') || control.closest('.outlet-channel.is-climate-relay')) continue;
      // Reuse the compared visual node. Only its known title slot changes;
      // callbacks, dependency rules and surrounding cards remain the adapter's.
      const title = control.querySelector<HTMLElement>('.native-slider-heading strong,.air-temperature-heading strong,.air-choices-title,h3 strong,h3')
        ?? control.closest('.detail-power-card')?.querySelector<HTMLElement>('.detail-power-label')
        ?? (control.classList.contains('native-power') ? control.closest('.switch-key-row')?.querySelector<HTMLElement>('.switch-key-label strong') : null);
      if (title) title.textContent = label;
      const named = [control, ...control.querySelectorAll<HTMLElement>('[aria-label]')].filter(node => node.hasAttribute('aria-label'));
      for (const node of named) { const previous = node.getAttribute('aria-label')!; const colon = previous.indexOf('：'); node.setAttribute('aria-label', `${label}${colon < 0 ? '' : previous.slice(colon)}`); }
      control.dataset.uiConfigTitle = label;
      const wrapper = control.closest<HTMLElement>('.switch-key-row') ?? control.closest<HTMLElement>('.native-card') ?? control;
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
    if(!document.items.length)return deviceUnavailableContent(device);
    const view = element('div', 'generic-functions');
    view.dataset.referenceKind=unverifiedLayout?'capability':'observed';
    view.append(element('div', 'generic-heading', element('span', '', '设备功能')));
    const draftStatus = element('div', 'draft-status', element('span', '', '自动刷新已暂停，保留未提交输入。'), button('放弃编辑', 'button button-small button-quiet', () => { this.panelDrafts.clear(); this.render(); this.schedulePanelRefresh(); })); draftStatus.id = 'draft-status'; draftStatus.hidden = this.panelDrafts.size === 0; view.append(draftStatus);
    view.append(this.renderUiDocument(document, device));
    return view;
  }

  private renderSwitchPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderSwitchPage.call(this.presenterHost(), device);
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
      nativeTemperatureControl:(...args)=>app.nativeTemperatureControl(...args),
      nativeClimateChoices:(...args)=>app.nativeClimateChoices(...args),
      lightTab:siid=>app.lightTabs.get(siid),
      selectLightTab:(siid,tab)=>{app.lightTabs.set(siid,tab);},
      render:(...args)=>app.render(...args),
      setBoundProperty:(...args)=>app.setBoundProperty(...args),
      setProperty:(...args)=>app.setProperty(...args),
    };
  }

  private renderLightPage(device: Device, group: boolean): HTMLElement {
    return sharedDeviceViews.renderLightPage.call(this.presenterHost(), device, group);
  }

  private nativeSlider(property: Property | undefined, label: string, unit: string, device: Device, disabledByPower = false, theme = '', valueProperty?: Property): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label, unit, theme, valueProperty, disabledReason: disabledByPower ? '设备开启后可调节。' : undefined } }, device);
  }

  private renderCurtainPage(device: Device): HTMLElement {
    const context=this.context!,epoch=this.panelEpoch,motionKey=JSON.stringify(context);
    const currentContext=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
    const bindings=curtainBindings(this.panel,device.controlServiceId);
    const target=bindings?.target,position=bindings?.position,motor=bindings?.motor;
    const operationFor=(property:Property|undefined)=>property&&this.propertyOps.get(this.operationKey(device.did,property.siid,property.piid));
    const targetOp=operationFor(target),motorOp=operationFor(motor);
    const fromMotor=!!motorOp&&motorOp.revision>(targetOp?.revision??-1);
    const operation=fromMotor?motorOp:targetOp;
    const meaning=fromMotor&&motor?curtainMotorMeaning(motor,motorOp.target):undefined;
    const raw=curtainBindings(this.confirmedPanels.get(device.did)??this.panel,device.controlServiceId);
    const rawPosition=numericValue(raw?.position);
    const status=curtainStatus(raw?.status);
    const motion=this.curtainMotions.get(motionKey)??new CurtainMotion();
    this.curtainMotion=motion;this.curtainMotions.set(motionKey,motion);
    const requestedPosition=typeof targetOp?.target==='number'?targetOp.target:undefined;
    const delta=requestedPosition!==undefined&&rawPosition!==undefined?requestedPosition-rawPosition:0;
    const intent=fromMotor?meaning:requestedPosition===100||delta>0?'open':requestedPosition===0||delta<0?'close':undefined;
    const active=motion.selectCommand(device.online&&!device.sharedReadOnly&&!this.panelIsCached?{
      intent,position:rawPosition,status,explicitlyPaused:curtainExplicitlyPaused(raw?.status),
      revision:operation?.revision,pending:operation?.pending,outcome:operation?.outcome,
    }:undefined);
    const {view,backdrop}=curtainView({device,panel:this.panel,busy:this.controlBusy,cached:this.panelIsCached,active,write:(endpoint,desired)=>{
      if(!currentContext())return;
      void this.setProperty(endpoint,desired);
      this.schedulePanelRefresh();
    }});
    const sliderProperty=target?.access.includes('write')?target:position??target;
    const slider=sliderProperty&&this.control({name:'Slider',props:{
      property:sliderProperty,label:'窗帘开合',unit:'%',theme:'curtain',curtainOpening:bindings?.opening,
      valueProperty:targetOp?.pending&&target?.access.includes('read')?target:position??target,
    }},device);
    if(slider)view.append(slider);
    if(!bindings)return view;
    const setting=bindings.openingProperty;
    const styles=curtainOpeningChoices(setting);
    const options=new Map(styles.map(({choice,opening})=>[choice.description,opening]));
    if(setting?.access.includes('write')&&styles.length>1&&options.size===styles.length&&new Set(options.values()).size===styles.length){
      view.append(this.control({name:'Selector',props:{
        property:setting,label:'开合方式',
        choiceOrder:choice=>styles.findIndex(option=>option.choice===choice),
        choiceLabel:description=>curtainOpeningLabels[options.get(description)!],
        choiceIcon:description=>options.get(description)==='double'?'curtain-open':options.get(description)==='single-left'?'back':'arrow',
      }},device));
    }
    const projected=operation?.pending&&meaning!=='pause'
      ?fromMotor?(meaning==='open'?100:meaning==='close'?0:undefined):Number(operation.target):undefined;
    const paint=(current:number,goal:number)=>{
      if(!slider||slider.dataset.interacting||rawPosition===undefined&&numericValue(raw?.target)===undefined&&projected===undefined)return;
      const value=projected??(rawPosition===undefined?numericValue(raw?.target)!:current);
      const output=slider.querySelector('.native-slider-value'),input=slider.querySelector<HTMLInputElement>('input');
      if(input?.hasAttribute('data-unread'))return;
      if(output)output.textContent=`${Math.round(value)}%`;
      slider.dataset.displayPosition=value.toFixed(2);
      slider.style.setProperty('--curtain-progress',`${value}%`);
      if(input){input.value=String(projected??(motion.moving?goal:value));input.setAttribute('aria-valuetext',`${Math.round(value)}%`);}
    };
    motion.attach(backdrop,motionKey,{position:rawPosition??numericValue(raw?.target),
      target:projected??numericValue(raw?.target)??(status===1?100:status===2?0:undefined),
      status,journey:curtainJourney(raw?.journey),pending:operation?.pending,paused:meaning==='pause',
      revision:operation?.revision,outcome:operation?.outcome},paint,()=>{
      const generation=motion.generation;
      void this.readProperties(true).then(()=>{
        if(!currentContext()||motion.generation!==generation)return;
        const report=curtainBindings(this.confirmedPanels.get(device.did),device.controlServiceId);
        const position=numericValue(report?.position),status=curtainStatus(report?.status);
        if(position!==undefined&&status!==1&&status!==2)motion.reconcile(position);
      });
    });
    return view;
  }

  private renderFanPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderFanPage.call(this.presenterHost(), device);
  }

  private renderP69FanPage(device: Device): HTMLElement {
    const view=this.renderFanPage(device);
    const state=this.panel&&booleanValue(fanDetailBindings(device,this.panel).on);
    const directions=this.nativeP69DirectionPad(device,state!==true);
    if(directions)view.append(directions);
    return view;
  }

  private nativeP69DirectionPad(device: Device, disabledByPower: boolean): HTMLElement | undefined {
    const context=this.context,epoch=this.panelEpoch;
    if(!context)return;
    const card = element('section', 'native-card p69-manual-card', element('h3', '', '手动调节'));
    const disc = element('div', 'p69-direction-disc');
    const service = this.panel?.services.find(item => item.name === 'fan');
    for (const [name, direction, label] of [['turn-upward', 'up', '向上'], ['turn-left', 'left', '向左'], ['turn-right', 'right', '向右'], ['turn-downward', 'down', '向下']] as const) {
      const action = service?.actions.find(item => item.name === name);
      if(!action||!service||action.unsupportedReason||action.in.length)continue;
      const control = button('', `p69-direction p69-direction-${direction}`, () => void this.submitDirectAction(context,epoch,{action,inputs:[]},()=>!!this.panel&&
        booleanValue(fanDetailBindings(device,this.panel).on)===true), 'chevron');
      control.setAttribute('aria-label', label);
      control.disabled = !device.online||!!device.sharedReadOnly||disabledByPower||this.controlBusy||this.panelIsCached;
      disc.append(control);
    }
    if(disc.childElementCount){card.append(disc);return card;}
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
      const text = displayValue(recent?{...property,code:0,value:reading.value}:property);
      const value = element('span', `property-value${text===missingReadingText?' reading-unavailable':!recent&&property.code != null && property.code !== 0 ? ' value-error' : ''}`, text);
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
    return propertyEditorInput(property,id,this.panelDrafts.get(id),value=>{
      this.panelDrafts.set(id,value);
      const draftStatus=document.getElementById('draft-status');
      if(draftStatus)draftStatus.hidden=false;
    });
  }

  private operationKey(did:string,siid:number,piid:number):string{return JSON.stringify([did,siid,piid]);}
  private propertyDependencies(did:string,property:Property):{key:string;revision:number}[]{
    const panel=this.confirmedPanels.get(did)??(this.context?.did===did?this.panel:this.linkedPanels.get(did));
    if(!panel||property.name==='on')return [];
    const device=this.deviceIndex.find(this.snapshot?.devices,did);
    const category=device&&environmentCategory(device,panel),appliance=device&&applianceDetailCategory(device,panel);
    const same=(field:Property|undefined)=>field?.siid===property.siid&&field.piid===property.piid;
    const prerequisites:Property[]=[];
    if(device&&category==='fan'){
      const {on,mode,gear,continuous,horizontal,vertical,horizontalAngle,verticalAngle}=fanDetailBindings(device,panel);
      if(on&&[mode,gear,continuous,horizontal,vertical,horizontalAngle,verticalAngle].some(same))prerequisites.push(on);
      if(horizontal&&same(horizontalAngle))prerequisites.push(horizontal);
      if(vertical&&same(verticalAngle))prerequisites.push(vertical);
    }else if(device&&simpleClimateCategory(category)){
      const {on,mode,target,fan}=simpleClimateBindings(device,panel,category);
      if(on&&[mode,target,fan].some(same))prerequisites.push(on);
    }else if(device&&category==='air-purifier'){
      const bindings=airPurifierBindings(device,panel);
      if(bindings?.on&&[bindings.mode,bindings.fan,bindings.uv?.property,bindings.anion?.property,bindings.plasma?.property].some(same))
        prerequisites.push(bindings.on.property);
      if(bindings?.favorite&&bindings.mode&&same(bindings.fan))prerequisites.push(bindings.mode);
    }else if(device&&(category==='air-conditioner'||category==='air-condition-outlet')){
      const bindings=climateBindings(panel,undefined,device.controlServiceId);
      if(bindings&&[bindings.mode,bindings.target,bindings.fan,bindings.horizontal,bindings.vertical].some(same))
        prerequisites.push(bindings.on);
    }else if(device&&(appliance==='hood'||appliance==='integrated-stove'||appliance==='ceiling-fan')){
        const bindings=kitchenFanBindings(device,panel,appliance);
        if(bindings.on&&[bindings.mode,bindings.speed,bindings.swing?.property].some(same))prerequisites.push(bindings.on.property);
    }else{
      prerequisites.push(...panel.services.flatMap(s=>s.properties).filter(p=>p.siid===property.siid&&p.name==='on'));
    }
    return prerequisites.flatMap(p=>{
      const key=this.operationKey(did,p.siid,p.piid),op=this.propertyOps.get(key);
      return op?.pending?[{key,revision:op.revision}]:[];
    });
  }
  private startOptimisticProperty(property:Property,value:Json,did:string):boolean{
    if(!this.context)return false;
    const panel=did===this.context.did?this.panel:this.linkedPanels.get(did);
    const device=this.deviceIndex.find(this.snapshot?.devices,did);
    if(property.name==='color'&&!lightChannelBindings(panel,panel?.specType??device?.specType).some(({color})=>
      color?.siid===property.siid&&color.piid===property.piid))return false;
    const actual=(this.confirmedPanels.get(did)??panel)?.services.flatMap(s=>s.properties).find(p=>p.siid===property.siid&&p.piid===property.piid)??property;
    if(!panel||!device?.online||device.sharedReadOnly||!actual.access.includes('write')||writeUnsupportedReason(actual))return false;
    const opener=windowOpenerRails(panel,device.controlServiceId).find(rail=>rail.siid===actual.siid&&
      (rail.motor?.piid===actual.piid||rail.target?.piid===actual.piid));
    const key=this.operationKey(did,property.siid,property.piid);
    this.propertyContexts.set(key,{context:{...this.context,did},homeEpoch:this.homeEpoch,windowOpener:!!opener});
    if(opener||actual.name==='motor-control'||actual.name==='target-position'){
      const curtain=curtainBindings(panel,actual.siid);
      const movement=opener??curtain;
      const alternate=actual.piid===movement?.motor?.piid?movement?.target:movement?.motor;
      if(alternate){
        const alternateKey=this.operationKey(did,alternate.siid,alternate.piid);
        if(this.propertyOps.get(alternateKey)?.pending)this.propertyOps.cancel(alternateKey,false);
      }
    }
    const dependencies=this.propertyDependencies(did,actual);
    this.panelNotice=undefined;this.propertyOps.write(key,value,actual.value??null,dependencies);return true;
  }
  private recentPanel={epoch:-1,values:new Map<string,NonNullable<Property['recentObservation']>>()};
  private acceptPanel(panel:DevicePanel,readVersion:number,passive=false,washerObservedAt?:number):void{
    if(washerObservedAt!==undefined&&this.context?.did===panel.did){
      const device=this.currentDevice();
      if(washerPageEligible(device,panel))this.washerReadAt=panel.washerRuntime?.state&&panel.washerRuntime.state!=='unknown'?washerObservedAt:undefined;
      const category=device&&applianceDetailCategory(device,panel);
      if(category==='dishwasher'||category==='sterilizer')this.kitchenCycleReadAt=washerObservedAt;
    }
    const previous=this.confirmedPanels.get(panel.did);
    const carried=new Set<Property>();
    const openerRails=windowOpenerRails(panel);
    panel={...panel,services:panel.services.map(s=>{
      const opener=openerRails.find(rail=>rail.siid===s.siid);
      const motionRevision=opener?Math.max(-1,...[opener.motor,opener.target].flatMap(p=>p?
        [this.propertyOps.get(this.operationKey(panel.did,p.siid,p.piid))?.revision??-1]:[])):
        s.name==='curtain'?Math.max(-1,...s.properties.filter(p=>p.name==='motor-control'||p.name==='target-position')
        .map(p=>this.propertyOps.get(this.operationKey(panel.did,p.siid,p.piid))?.revision??-1)):-1;
      return {...s,properties:s.properties.map(p=>{
        const op=this.propertyOps.get(this.operationKey(panel.did,p.siid,p.piid));
        const motionReport=p.piid===opener?.position?.piid||['current-position','status'].includes(p.name);
        if(previous&&(op&&op.revision>readVersion||motionReport&&motionRevision>readVersion)){
          const old=previous.services.find(s=>s.siid===p.siid)?.properties.find(q=>q.piid===p.piid);
          if(old){carried.add(old);return old;}
        }
        return p;
      })};
    })};
    this.confirmedPanels.set(panel.did,panel);
    this.confirmedPanelVersions.set(panel.did,readVersion);
    if(panel.did===this.context?.did&&this.cooking.actual&&!this.cooking.pending&&
      cookingCategory(panel.specType)&&!this.presentationRoute.changed)this.cooking.observe(panel);
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
    if(this.context)this.render(true);
    this.homeCardChanged();
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
      const confirmed=this.confirmedPanels.get(did);
      if(!read&&binding.playbackEpoch!==undefined){
        const device=this.currentDevice();
        if(binding.playbackEpoch!==this.panelEpoch||!sameContext(context,this.context)||this.presentationRoute.changed||
          this.panelIsCached||!device?.online||device.sharedReadOnly||!confirmed||!audioDetailEligible(device,confirmed))
          throw {kind:'staleContext',message:''};
        const audio=audioBindings(device,confirmed),state=playbackBinding(audio.state);
        const command=state&&state.property.siid===siid&&state.property.piid===piid?
          value===state.playing?audio.play:value===state.paused?audio.pause:undefined:undefined;
        if(!command)throw {kind:'unsupported',message:''};
        if(command===audio.play){
          const availability=this.speaker.playbackStatus(audio);
          if(!availability.resumable&&!(availability.playing&&audio.hasSong!==false))throw {kind:'unavailable',message:''};
        }
        await this.transport.runAction(context,command.action.siid,command.action.aiid,command.inputs);
        return {outcome:'pending',message:''};
      }
      const p=confirmed?.services.find(s=>s.siid===siid)?.properties.find(p=>p.piid===piid);
      const curtain=p?.name==='motor-control'||p?.name==='target-position'?curtainBindings(confirmed,siid):undefined;
      const device=binding.windowOpener?this.deviceIndex.find(this.snapshot?.devices,did):undefined;
      const opener=device&&windowOpenerRails(confirmed,device.controlServiceId).find(rail=>rail.siid===siid&&
        (rail.motor?.piid===piid||rail.target?.piid===piid));
      if(binding.windowOpener&&(!device?.online||device.sharedReadOnly||!opener?.online))
        throw {kind:'unavailable',message:''};
      const movement=opener||curtain;
      const targetPosition=movement?.position;
      const range=targetPosition?.valueRange;
      const position=binding.homeCurtain?{siid:2,piid:4}:
        p===movement?.target&&range&&typeof value==='number'&&value>=range[0]&&value<=range[1]&&
        Math.abs((value-range[0])/range[2]-Math.round((value-range[0])/range[2]))<1e-7?targetPosition:undefined;
      const writeOnlyMotor=p===movement?.motor&&!!p&&!p.access.includes('read');
      const meaning=writeOnlyMotor&&p?curtainMotorMeaning(p,value):undefined;
      const feedback=movement&&meaning?
        (opener?curtainFeedback({position:opener.position},meaning):undefined)??curtainFeedback(movement,meaning):undefined;
      const submitOnly=!!opener&&writeOnlyMotor&&!feedback;
      const expected=feedback?.value??value,observed=feedback?.property??position;
      if(read&&writeOnlyMotor&&!feedback)throw {kind:'readbackFailed',message:''};
      const result=await(read?this.transport.confirmProperty(context,observed?.siid??siid,observed?.piid??piid,expected):
        this.transport.setProperty(context,siid,piid,value));
      if(!current())throw {kind:'staleContext',message:'家庭已经切换。'};
      if(result.panel.did!==did)throw {kind:'protocol',message:'设备回读标识不匹配，仍待确认。'};
      const actual=result.panel.services.find(service=>service.siid===(observed?.siid??siid))?.properties.find(property=>property.piid===(observed?.piid??piid));
      this.acceptPanel(result.panel,version);
      if(submitOnly)return {outcome:'submitted',message:''};
      if(writeOnlyMotor)return {outcome:read&&actual?.code===0&&actual.value===expected?'confirmed':'pending',actual:undefined,message:result.message};
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

  private toiletSetting?:string;
  private directActions=new Set<string>();
  private directActionKey(context:DeviceContext,epoch:number,{action,inputs}:{action:Action;inputs:Json[]}):string{
    return JSON.stringify([epoch,context.homeId,context.generation,context.did,action.siid,action.aiid,inputs]);
  }
  private async submitDirectAction(context:DeviceContext,epoch:number,command:{action:Action;inputs:Json[]},allowed?:()=>boolean):Promise<void>{
    const {action,inputs}=command,key=this.directActionKey(context,epoch,command);
    if(this.directActions.has(key))return;
    const current=()=>epoch===this.panelEpoch&&sameContext(context,this.context)&&!this.presentationRoute.changed;
    const queuedAt=Date.now();
    this.directActions.add(key);
    this.render(true);
    try{
      const submitted=await this.serializeDevice(context.did,()=>{
        if(!current()||this.panelIsCached||!this.currentDevice()?.online||this.currentDevice()?.sharedReadOnly||allowed?.()===false||Date.now()-queuedAt>=30000)
          return Promise.resolve(false);
        return this.transport.runAction(context,action.siid,action.aiid,inputs).then(()=>true);
      });
      if(submitted&&current())void this.readProperties();
    }catch(error){if(current())this.handleSessionError(normalizeError(error));}
    finally{
      this.directActions.delete(key);
      if(current())this.render(true);
    }
  }

  private async logout(): Promise<void> {
    if (this.logoutBusy) return;
    this.logoutBusy = true; this.render();
    try {
      await this.transport.logout();
      ++this.loginEpoch; ++this.homeEpoch;
      this.cancelHomeInventoryRead();
      if (this.loginTimer) clearTimeout(this.loginTimer);
      if (this.homeRefreshTimer) clearTimeout(this.homeRefreshTimer);
      this.session = undefined;this.accountProfile=undefined;this.profileError=false;this.homes = []; this.selectedHomeId = ''; this.snapshot = undefined;
      this.clearPanel(); this.resetLocalView(); this.homeError = undefined; this.loginError = undefined; this.loginState = 'idle'; this.homesLoading = false; this.homeBusy = false;
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


  private renderOutletPage(device: Device): HTMLElement {
    return sharedDeviceViews.renderOutletPage.call(this.presenterHost(), device);
  }


}
