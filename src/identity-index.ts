/** Rebuild once when an immutable inventory/report array is replaced.
 * Keep first-match semantics and release the previous snapshot on replacement. */
export class IdentityIndex<T extends {did:string}> {
 private source?:readonly T[];private rows=new Map<string,T>();
 find(source:readonly T[]|undefined,did:string|undefined):T|undefined {
  if(source!==this.source){
   this.source=source;this.rows.clear();
   for(const row of source??[])if(!this.rows.has(row.did))this.rows.set(row.did,row);
  }
  return did===undefined?undefined:this.rows.get(did);
 }
}
