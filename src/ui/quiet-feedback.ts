/** Visible feedback is carried by control state, never notification prose.
 * Keep this explicit: device readings, empty states, loading and confirmation
 * dialogs are content and must not disappear through a broad text selector. */
const notifications=new Set([
 'notice','account-error','bath-error','camera-browser-notice','camera-inline-message',
 'camera-recording-notice','category-private-notes','ceiling-error','dispenser-dnd-notice',
 'dispenser-history-error','dispenser-name-error','error-message','family-feedback',
 'fryer-error','home-operation-feedback','ir-remote-message','light-favorites-error',
 'light-settings-error','monitor-tile-notice','purifier-error','reminder-note',
 'router-ipv6-error','router-ipv6-note','router-password-error','router-records-feedback',
 'router-warning','scale-error','scale-message','scale-read-note','scene-note',
 'selfcheck-notice','settings-caption','settings-error','vacuum-feedback',
]);
export function quietFeedback(node:HTMLElement):void{
 if(![...node.classList].some(c=>notifications.has(c)))return;
 // The native hidden attribute can be toggled by retained component updates.
 // A dedicated, unstyled host prevents those updates from showing notifications.
 node.dataset.quietFeedback=node.classList.contains('notice')||node.classList.contains('settings-error')?'actions':'prose';
}
