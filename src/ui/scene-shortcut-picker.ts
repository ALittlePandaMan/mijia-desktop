import type {HomeScene} from '../home-scenes';
import {sceneShortcutGroups} from '../home-scenes';
import type {Room} from '../types';
import {button,element} from './dom';
import {icon,officialIcon} from '../icons';
import {dismissOnBackdrop} from './dialog-dismiss';
const updates=new WeakMap<HTMLDialogElement,(scenes:readonly HomeScene[],rooms:readonly Room[],loading:boolean)=>void>();
export function updateSceneShortcutPicker(dialog:HTMLDialogElement,scenes:readonly HomeScene[],rooms:readonly Room[],loading=false):void{
 updates.get(dialog)?.(scenes,rooms,loading);
}
export function sceneShortcutPicker(scenes:readonly HomeScene[],rooms:readonly Room[],added:(ids:string[])=>void,closed:()=>void,loading=false):HTMLDialogElement{
 const dialog=element('dialog','scene-shortcut-picker'),selected=new Set<string>();dialog.setAttribute('aria-label','添加自动化');
 const close=()=>dialog.close();const cancel=button('','scene-picker-close',close);cancel.append(officialIcon('home:arrange-cancel'));cancel.setAttribute('aria-label','关闭');
 const heading=element('header','scene-picker-heading',element('h2','','添加自动化'),cancel),list=element('div','scene-picker-list');
 list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','按房间选择自动化');
 const done=button('添加','scene-picker-done',()=>{if(selected.size){added([...selected]);close();}});
 const count=()=>{done.disabled=!selected.size;done.querySelector('span')!.textContent=selected.size?`添加（${selected.size}）`:'添加';};
 const render=(scenes:readonly HomeScene[],rooms:readonly Room[],loading:boolean)=>{
  const scroll=list.scrollTop,available=new Set(scenes.map(scene=>scene.id));for(const id of selected)if(!available.has(id))selected.delete(id);
  const choices=new Map<string,HTMLButtonElement[]>();list.replaceChildren();list.setAttribute('aria-busy',String(loading));
  for(const group of sceneShortcutGroups(scenes,rooms)){
   const section=element('section','scene-picker-room'),title=element('h3','scene-picker-room-title',group.name),grid=element('div','scene-picker-room-grid');section.dataset.roomId=group.id;section.setAttribute('aria-label',group.name);section.append(title,grid);
   for(const scene of group.scenes){
    const choice=button('','scene-picker-choice',()=>{selected.has(scene.id)?selected.delete(scene.id):selected.add(scene.id);for(const node of choices.get(scene.id)??[])node.setAttribute('aria-pressed',String(selected.has(scene.id)));count();});choice.dataset.sceneId=scene.id;choice.setAttribute('aria-pressed',String(selected.has(scene.id)));choices.set(scene.id,[...(choices.get(scene.id)??[]),choice]);
    const art=element('span','scene-task-icon',icon('play'));if(scene.icon){const img=element('img');img.src=scene.icon;img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('load',()=>art.classList.add('has-image'),{once:true});img.addEventListener('error',()=>img.remove(),{once:true});art.append(img);}
    choice.append(art,element('span','scene-picker-label',element('strong','scene-task-name',scene.name)),element('span','scene-picker-selected',officialIcon('home:selected')));grid.append(choice);
   }
   list.append(section);
  }
  if(!scenes.length)list.append(element('p','scene-picker-empty',loading?'正在获取自动化…':'暂无可添加的自动化'));
  list.scrollTop=scroll;count();
 };
 updates.set(dialog,render);render(scenes,rooms,loading);
 dialog.append(heading,list,element('footer','scene-picker-footer',button('取消','scene-picker-cancel',close),done));
 dialog.addEventListener('close',()=>{updates.delete(dialog);dialog.remove();closed();},{once:true});
 dismissOnBackdrop(dialog,close);
 return dialog;
}
