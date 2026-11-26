import type {HomeScene} from './home-scenes';
export interface SceneShortcutLayout {sceneIds:string[];hiddenSceneIds:string[]}
export function visibleSceneShortcuts(scenes:readonly HomeScene[],roomId:string,layout?:SceneShortcutLayout):HomeScene[]{
 const hidden=new Set(layout?.hiddenSceneIds??[]),available=new Map(scenes.map(s=>[s.id,s]));
 const defaults=roomId==='*'||roomId==='@scenes'?[]:scenes.filter(s=>s.roomIds.includes(roomId)).map(s=>s.id);
 const ids=[...new Set([...(layout?.sceneIds??[]),...defaults])];
 return ids.filter(id=>available.has(id)&&!hidden.has(id)).map(id=>available.get(id)!);
}
export function removeSceneShortcuts(layout:SceneShortcutLayout,ids:readonly string[]):SceneShortcutLayout{
 const removed=new Set(ids);return{sceneIds:layout.sceneIds.filter(id=>!removed.has(id)),hiddenSceneIds:[...new Set([...layout.hiddenSceneIds,...ids])]};
}
export function addSceneShortcuts(layout:SceneShortcutLayout,visible:readonly string[],ids:readonly string[]):SceneShortcutLayout{
 const added=new Set(ids);return{sceneIds:[...new Set([...visible,...layout.sceneIds,...ids])],hiddenSceneIds:layout.hiddenSceneIds.filter(id=>!added.has(id))};
}
