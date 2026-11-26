export const DRAG_START_DIP=4;
export type InsertionSide='before'|'after';

/** Relative order of the other cards is always preserved. */
export function insertCardIds(ids:readonly string[],from:string,target?:string,side:InsertionSide='after'):string[]|undefined{
 const start=ids.indexOf(from);
 if(start<0||target===from||new Set(ids).size!==ids.length)return;
 const next=ids.filter(id=>id!==from);
 const anchor=target===undefined?next.length:next.indexOf(target);
 if(anchor<0)return;
 const index=anchor+(target!==undefined&&side==='after'?1:0);
 if(index===start)return;
 next.splice(index,0,from);
 return next;
}
