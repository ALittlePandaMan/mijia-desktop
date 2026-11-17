import './camera-talking-status.css';

/** A view of the shared session's confirmed talk state; never starts audio. */
export function cameraTalkingStatus(className=''):HTMLDivElement{
 const badge=document.createElement('div');badge.className='camera-talking-status'+(className?' '+className:'');
 badge.textContent='正在通话';badge.hidden=true;badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');badge.setAttribute('aria-atomic','true');
 return badge;
}
