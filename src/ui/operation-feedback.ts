/** Command feedback stays in the existing control state. Legacy callers may
 * append this result, but it never creates text, a toast or an adoption button. */
export function operationFeedback(_message:string,_adopt?:()=>void):DocumentFragment{return document.createDocumentFragment();}
/** Preserve diagnostic context without adding visible command notifications. */
export function describeOperation(host:HTMLElement,message?:string):void{if(message)host.setAttribute('aria-description',message);}
