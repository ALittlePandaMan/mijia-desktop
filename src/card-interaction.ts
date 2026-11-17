import {packCards,type CardSize} from './card-size';
export const DRAG_START_DIP=4;
/** A swap is valid only if the existing compact layout represents the two
 * exchanged origins exactly, with every third card left in its original slot. */
export function swapCardIds(ids:readonly string[],from:string,target:string,sizes:Readonly<Record<string,CardSize>>,columns:number):string[]|undefined{
 const a=ids.indexOf(from),b=ids.indexOf(target);if(a<0||b<0||a===b||new Set(ids).size!==ids.length)return;
 const next=[...ids];[next[a],next[b]]=[next[b],next[a]];
 const before=new Map(packCards(ids,sizes,columns).map(s=>[s.id,s])),after=packCards(next,sizes,columns);
 if(after.some(s=>{const old=before.get(s.id===from?target:s.id===target?from:s.id)!;return s.column!==old.column||s.row!==old.row;}))return;
 return next;
}
