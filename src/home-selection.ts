import type {SessionView} from './types';

function selectionKey(session?:SessionView):string|undefined {
  if(session?.loggedIn&&session.userId)return 'mijia.last-home.v1:'+JSON.stringify([session.region,session.userId]);
}
export function preferredHome(homes:readonly {id:string}[],session?:SessionView,current?:string,startup?:string):string|undefined {
  let remembered:string|null=null;
  const key=selectionKey(session);
  try{if(key)remembered=localStorage.getItem(key);}catch{/* Fall back when storage is unavailable. */}
  return [startup,current,remembered].find(id=>id&&homes.some(home=>home.id===id))??homes[0]?.id;
}
export function rememberHome(session:SessionView,homeId:string):void {
  const key=selectionKey(session);
  try{if(key)localStorage.setItem(key,homeId);}catch{/* Selection still works without persistence. */}
}
