export function checkWidgetDependencies(entry,getInfo){
 const seen=new Set(),pending=[entry];
 while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const file=id.replaceAll('\\','/');
  if(/\/(?:src\/(?:main|camera-page|ui\/history-engine)\.(?:ts|js)|node_modules\/(?:echarts|zrender|mpegts\.js)\/)/.test(file))throw Error(`Desktop widget loads a forbidden heavyweight module: ${file}`);
  const info=getInfo(id);if(info)pending.push(...info.importedIds,...info.dynamicallyImportedIds);
 }
 return seen.size;
}
export function widgetBoundary(){return{name:'lightweight-widget-boundary',generateBundle(){const entry=[...this.getModuleIds()].find(id=>id.replaceAll('\\','/').endsWith('/src/widget.ts'));if(!entry)this.error('Desktop widget entry is missing');checkWidgetDependencies(entry,id=>this.getModuleInfo(id));}};}
