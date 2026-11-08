import type{AppError}from './types';
export interface CameraEvent{state:string;data?:string;codec?:string;error?:AppError;sampleRate?:number;timestamp?:number;file?:SavedCameraMedia;streamRevision?:number;lensId?:number;mediaGeneration?:number;keyframe?:boolean;receiveBytesPerSecond?:number}
export interface SavedCameraMedia{id:string;fileName:string;kind:'screenshot'|'recording'}
export interface CameraLens{id:number;label:string;ptz:boolean}
export interface CameraFeatures{qualities:{id:string;label:string}[];listen:boolean;talk:boolean;ptz:boolean;playback:boolean;care?:boolean;reason?:string;talkFormat?:{codec:string;sampleRate:number};lenses?:CameraLens[]|null}
export interface CameraClip{start:number;duration:number;event:boolean;channel:number}
export type CameraOperation={kind:'quality';quality:string}|{kind:'listen';enabled:boolean}|{kind:'talk';enabled:boolean}|{kind:'ptz';direction:'up'|'down'|'left'|'right'}|{kind:'record';enabled:boolean;width?:number;height?:number;lensId?:number;atTimestamp?:number;mediaGeneration?:number}|{kind:'recordings'}|{kind:'playback';start:number;channel:number;offset?:number;speed?:number}|{kind:'live'};
export interface CameraReply{state:string;features?:CameraFeatures;clips?:CameraClip[];file?:SavedCameraMedia;streamRevision?:number}
export interface CameraPower {awake:boolean|null;supported:boolean;writable:boolean;reason:string|null}
export interface CameraPowerChanged {report:CameraPower;confirmed:boolean}
export interface CameraAuxControl{supported:boolean;active:boolean|null;remainingSeconds:number|null;writable:boolean;reason:string|null}
export interface CameraAuxSnapshot{alarm:CameraAuxControl;light:CameraAuxControl}
