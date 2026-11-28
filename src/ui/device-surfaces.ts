/** Presentation-only layout roles. Existing nodes and their listeners are moved,
 * never cloned; property bindings and command callbacks remain unchanged. */
const rows='.airer-night-link,.purifier-other-functions,.router-menu-row';
const settings='.purifier-settings-row,.airer-night-row,.dispenser-setting-row,.purifier-cup-row,.purifier-filter-row,.dispenser-mode-row,.reminder-row';
const regions='.outlet-page-content,.switch-page-content,.light-page-content,.fan-page-content,.p69-fan-content,.air-conditioner-content,.curtain-page-content,.yeelight-page-content,.generic-functions,.sensor-page-content,.airer-content,.fridge-content,.washer-home-content,.purifier-home-content,.purifier-settings-content,.dispenser-content,.reminder-content,.router-content';
const cards='.native-card,.sensor-history-card,.router-tools,.router-password-card,.router-menu-row,.router-client,.router-details,.reminder-row';
const groups='.detail-power-row,.schema-panel,.daily-actions,.router-toolbar,.router-menu';
const listRows='.switch-key-row,.outlet-channel,.washer-more-row';
const rowCopies='.switch-key-label,.dispenser-mode-label,.reminder-copy';
const standaloneSettings=settings.split(',').map(s=>`${s}:not(.device-row-card)`).join(',');

/** Structural roles are declared by each existing control's markup. They do not
 * depend on string length or rendered wrapping, so a resize cannot change the
 * row's semantic density. Longer content remains free to grow. */
function rowRole(row:HTMLElement):'text'|'icon'|'two-line' {
 if(row.matches('.switch-key-row,.reminder-row')||row.querySelector('.device-row-copy > span'))return'two-line';
 if(row.matches('.dispenser-mode-row,.airer-night-link,.outlet-channel,.washer-more-row')||row.querySelector('.device-function-disc,.dispenser-mode-symbol,.dispenser-add-icon'))return'icon';
 return'text';
}

export function deviceSurfaces<T extends HTMLElement>(stage:T):T {
 const page=stage.matches('.device-page')?stage:stage.querySelector<HTMLElement>('.device-page');
 if(!page)return stage;
 page.classList.add('device-surfaces');
 const mark=(selector:string,name:string)=>page.querySelectorAll<HTMLElement>(selector).forEach(n=>n.classList.add(name));
 mark(regions,'device-controls-region');mark(rows,'device-row-card');
 mark('.curtain-page-content,.page-dispenser-home .dispenser-content,.page-router-home .router-content','device-backdrop-offset');
 mark('.sterilization-action,.selfcheck-action,.router-tool-action,.washer-program-command,.purifier-picker footer button,.dispenser-dialog footer button,.router-confirm footer button','device-action');
 mark(standaloneSettings,'device-setting-row');
 mark(listRows,'device-list-row');mark(rowCopies,'device-row-copy');
 mark('.airer-clock,.purifier-filter-icon,.washer-more-row > .washer-glyph','device-function-disc');
 mark('.air-choice','device-option');
 mark('.airer-toggle,.purifier-settings-switch,.dispenser-switch,.settings-toggle,.reminder-switch,.washer-parameter-toggle','device-toggle');
 mark(groups,'device-control-unit');
 mark(cards,'device-control-unit');
 mark('.schema-panel > *','device-control-unit');
 page.querySelectorAll<HTMLElement>('.device-row-card,.device-setting-row,.device-list-row').forEach(row=>{
  row.dataset.surfaceRow=rowRole(row);
  // Standalone setting cards own their inset; rows already inside a padded
  // surface keep that surface's inset. Dispenser's edge-to-edge list owns 20px.
  if(row.matches('.reminder-row'))row.classList.add('device-row-inset');
 });
 page.querySelectorAll<HTMLElement>('.purifier-settings-section-label,.dispenser-section-title').forEach(n=>{if(!n.closest('.native-card'))n.classList.add('device-section-title');});
 // Direct rows inside one surface remain a list; the surface owns its spacing.
 const parents=new Set([...page.querySelectorAll<HTMLElement>('.device-control-unit')].map(n=>n.parentElement!));
 for(const parent of parents){
  if(parent.matches('.native-card,.detail-power-row,.daily-actions,.speaker-transport,.device-card-stack,.scale-overview-content,.scale-entries')||
    parent.closest('.native-card')||parent.closest('[role="dialog"]'))continue;
  if(parent.matches('.schema-panel')){parent.classList.add('device-card-stack','device-nested-stack');continue;}
  if(parent.matches('.device-page-scroll')&&!parent.closest('.device-controls-region'))parent.classList.add('device-controls-region');
  const children=[...parent.children];let stack:HTMLElement|undefined;
  for(const child of children){
   if(!(child instanceof HTMLElement)||!child.matches('.device-control-unit')||child.hidden){stack=undefined;continue;}
   if(!stack){stack=document.createElement('div');stack.className='device-card-stack';parent.insertBefore(stack,child);}
   stack.append(child);
  }
 }
 // Region padding is supplied once, including when official controls are nested.
 page.querySelectorAll<HTMLElement>('.device-controls-region .device-controls-region').forEach(n=>n.classList.add('device-nested-region'));
 return stage;
}
