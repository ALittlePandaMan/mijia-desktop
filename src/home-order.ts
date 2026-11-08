import type { Device, HomeSnapshot, Room } from './types';

type Order = HomeSnapshot['order'];

/** Card projection only. All authenticated records remain available to routing.
 * Names, rooms and brands never establish a merge relationship. */
function cardProjection(devices:readonly Device[], splitSwitches=false):{visible:Device[];aliases:Map<string,string>;expansions:Map<string,string[]>}{
  const byId=new Map(devices.map(d=>[d.did,d]));
  const parents=new Map(devices.filter(d=>!d.hiddenOnHome&&!d.unsupportedReason&&d.controlGroup&&d.controlServiceId==null).map(d=>[d.controlGroup,d.did]));
  const aliases=new Map(devices.filter(d=>d.controlServiceId!=null&&d.controlGroup&&parents.has(d.controlGroup)).map(d=>[d.did,parents.get(d.controlGroup)!]));
  const groups=new Map(devices.filter(d=>d.groupMembers?.length&&d.groupMembers.every(id=>id&&id!==d.did)).map(d=>[d.did,d.groupMembers!]));
  // Malformed cyclic groups must not make every card disappear.
  const cyclic=new Set<string>(),visited=new Set<string>(),path:string[]=[];
  const inspect=(id:string):void=>{
    const at=path.indexOf(id);if(at>=0){for(const member of path.slice(at))cyclic.add(member);return;}
    if(visited.has(id))return;path.push(id);
    for(const child of groups.get(id)??[])if(groups.has(child))inspect(child);
    path.pop();visited.add(id);
  };
  for(const id of groups.keys())inspect(id);
  const candidates=devices.filter(d=>!d.hiddenOnHome&&!d.unsupportedReason&&!aliases.has(d.did)&&groups.has(d.did)&&!cyclic.has(d.did));
  const covered=new Set<string>();
  const descendants=(id:string,result:Set<string>):void=>{
    for(const child of groups.get(id)??[]){
      if(cyclic.has(child)||result.has(child))continue;
      result.add(child);if(groups.has(child))descendants(child,result);
    }
  };
  for(const group of candidates)descendants(group.did,covered);
  // Only visible outer groups cover their members; missing/hidden/unusable
  // parents retain standalone cards. Stable ordering resolves shared members.
  const roots=candidates.filter(d=>!covered.has(d.did)).sort((a,b)=>a.did<b.did?-1:a.did>b.did?1:0);
  for(const root of roots){
    const members=new Set<string>();descendants(root.did,members);
    for(const id of members)if(byId.has(id)&&!aliases.has(id))aliases.set(id,root.did);
  }
  // A split channel can resolve through a physical member into its outer group.
  for(const[id,target]of aliases){let root=target;const seen=new Set([id]);while(aliases.has(root)&&!seen.has(root)){seen.add(root);root=aliases.get(root)!;}if(!seen.has(root))aliases.set(id,root);else aliases.delete(id);}
  const expansions=new Map<string,string[]>();
  if(splitSwitches)for(const [group,parent] of parents){
    // Existing outer groups continue to own their members. Only actual cloud
    // channels replace a switch; no DID or service is manufactured locally.
    if(aliases.has(parent))continue;
    const physical=byId.get(parent)!;
    const category=/^urn:miot-spec-v[23]:device:([^:]+):/.exec(physical.specType??'')?.[1];
    if(!['switch','relay','control-panel','outlet'].includes(category??''))continue;
    const children=devices.filter(d=>d.controlGroup===group&&d.controlServiceId!=null&&(!d.hiddenOnHome||d.splitDisplayAvailable)&&!d.unsupportedReason)
      .sort((a,b)=>a.controlServiceId!-b.controlServiceId!||(a.did<b.did?-1:1));
    if(!children.length)continue;
    expansions.set(parent,children.map(d=>d.did));
    for(const child of children)aliases.delete(child.did);
  }
  const expandedChildren=new Set([...expansions.values()].flat());
  return {visible:devices.filter(d=>(!d.hiddenOnHome||expandedChildren.has(d.did))&&!aliases.has(d.did)&&!expansions.has(d.did)),aliases,expansions};
}
export function visibleHomeDevices(devices:readonly Device[],splitSwitches=false):Device[]{return cardProjection(devices,splitSwitches).visible;}
export function projectDeviceOrder(ids:readonly string[],inventory:readonly Device[],splitSwitches=false):string[]{
  const {aliases,expansions}=cardProjection(inventory,splitSwitches);
  return ids.flatMap(id=>{const target=aliases.get(id)??id;return expansions.get(target)??[target];});
}
function ranked<T>(items: readonly T[], ids: readonly string[], identity: (item: T) => string,stableUnranked=false): T[] {
  const ranks = new Map<string, number>();
  for (const id of ids) if (!ranks.has(id)) ranks.set(id, ranks.size);
  return [...items].sort((a,b)=>{
    const left=identity(a),right=identity(b),rank=(ranks.get(left)??Infinity)-(ranks.get(right)??Infinity);
    if(rank)return rank;
    return stableUnranked&&!ranks.has(left)&&!ranks.has(right)?left<right?-1:left>right?1:0:0;
  });
}

export function orderedRooms(rooms: readonly Room[], order: Order): Room[] {
  return ranked(rooms, order?.roomIds ?? [], room => room.id);
}

export function orderedDevices(devices: readonly Device[], order: Order, roomId: string,inventory:readonly Device[]=devices,splitSwitches=false): Device[] {
  // Front order contains selected cards; remaining devices still inherit the
  // user's room/device order instead of the cloud inventory's arbitrary order.
  const ids = roomId === '*' ? [...order?.frontDevices??[],...(order?.roomIds??[]).flatMap(id=>order?.roomDevices[id]??[])] : order?.roomDevices[roomId];
  // Entries without any saved rank follow all ranked devices in a stable order.
  // This fallback is a desktop choice, not a claimed APK order for new devices.
  // A merged parent inherits the earliest saved position of itself or a child.
  // This projection does not change the mobile app's saved split-view order.
  return ranked(devices, projectDeviceOrder(ids??[],inventory,splitSwitches), device => device.did,!!order);
}
