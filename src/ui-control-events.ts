import type {Json} from './types';
/** Backend-authenticated submissions; receipt is never proof of measured state. */
export interface UiSubmission {homeId:string;userId:string;region:string;dids:string[];siid:number;piid:number;value:Json;sequence:number;controlIds:string[]}
export interface UiReadbackFailure {homeId:string;userId:string;region:string;dids:string[];fields:{id:string;sequence:number}[]}
