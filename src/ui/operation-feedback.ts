/** Preserve diagnostic context without adding visible command notifications. */
export function describeOperation(host:HTMLElement,message?:string):void{if(message)host.setAttribute('aria-description',message);}
