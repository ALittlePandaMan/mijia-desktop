import {deviceChoiceLabel} from '../device-labels';
import {initialInput} from '../logic';
import type {Property} from '../types';
import {element} from './dom';
import {dropdownSelect} from './dropdown';

type PropertyInput = HTMLInputElement|HTMLButtonElement;

export function propertyEditorInput(property:Property,id:string,draft?:string,remember?:(value:string)=>void):PropertyInput {
 let input:PropertyInput;
 if(property.valueList||property.format==='bool'){
  const choices=property.valueList?.map((choice,index)=>({value:String(index),label:deviceChoiceLabel(choice.description,`选项${index+1}`)}))??
   [{value:'false',label:'关闭'},{value:'true',label:'开启'}];
  input=dropdownSelect({label:property.description||property.name,className:'control-field',options:[{value:'',label:'请选择',disabled:true},...choices]});
 }else{
  const field=element('input','control-field');
  field.type=property.format==='string'?'text':'number';
  if(field.type==='number'){
   field.step=property.valueRange?String(property.valueRange[2]):['float','double'].includes(property.format)?'any':'1';
   if(property.valueRange){field.min=String(property.valueRange[0]);field.max=String(property.valueRange[1]);}
  }
  field.placeholder=property.format==='string'?'输入文本':'输入数值';
  input=field;
 }
 input.id=id;input.value=draft??initialInput(property);
 if(remember){
  const update=()=>remember(input.value);
  input.addEventListener('input',update);input.addEventListener('change',update);
 }
 return input;
}
