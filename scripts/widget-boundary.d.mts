import type{Plugin}from'vite';
export function checkWidgetDependencies(entry:string,getInfo:(id:string)=>{importedIds:readonly string[];dynamicallyImportedIds:readonly string[]}|null|undefined):number;
export function widgetBoundary():Plugin;
