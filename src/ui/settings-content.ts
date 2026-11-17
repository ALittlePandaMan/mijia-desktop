import {element} from './dom';
import {icon,officialIcon,type IconName} from '../icons';

/** Shared right-panel structure; sidebar layout and navigation stay independent. */
export function settingsCopy(title:string,description=''):HTMLElement{
 const copy=element('span','settings-row-copy',element('span','settings-row-label',title));
 if(description)copy.append(element('small','settings-row-description',description));
 return copy;
}
export function settingsGroup(title:string,content:HTMLElement):HTMLElement{
 const group=element('section','settings-group',element('h2','settings-group-title',title),content);
 group.setAttribute('aria-label',title);return group;
}
/** Original Mi Home MiSymbol resources; no hand-authored icon geometry. */
export function settingsContentIcon(name:'copy'|'reset'|'folder'|'folder-open'):SVGSVGElement{
 return officialIcon(`settings:${name==='folder-open'?'folder':name}`);
}
export function settingsSymbol(name:IconName,accent=false):HTMLElement{
 return element('span',`settings-panel-symbol${accent?' settings-panel-symbol-accent':''}`,icon(name));
}
