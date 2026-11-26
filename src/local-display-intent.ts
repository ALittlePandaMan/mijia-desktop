import type {Json} from './types';
let serial=0;
export const nextDisplayOrder=()=>++serial;
export interface DisplayIntent {fieldId:string;value:Json;order:number;effect?:boolean}
