import { orderedDevices, projectDeviceOrder, visibleHomeDevices } from './home-order';
import { normalizeError } from './logic';
import type { AppError, Device, HomeCardEntry, HomeSnapshot, Room } from './types';

export interface LocalPreferences {
  hideOffline: boolean;
  dragLocked: boolean;
  splitSwitches: boolean;
  hiddenDeviceIds: string[];
  homeHiddenDeviceIds: string[];
  roomOrders: Record<string, string[]>;
  routerCommonDevices?: Record<string, string[]>;
  monitor?: {enabled:boolean;excludedDeviceIds:string[]};
  cameraPrimaryLenses?:Record<string,number>;
}
export type PreferenceChange =
  | { operation:'setCameraPrimaryLens';did:string;lensId:number }
  | { operation: 'setHideOffline' | 'setDragLocked' | 'setSplitSwitches'; value: boolean }
  | { operation: 'setMonitorEnabled'; value:boolean }
  | { operation: 'setMonitorExcluded'; did:string; excluded:boolean }
  | { operation: 'setHidden' | 'setHomeHidden'; did: string; hidden: boolean }
  | { operation: 'setOrder'; roomId: string; deviceIds: string[] }
  | { operation: 'resetOrder' }
  | { operation: 'setRouterCommon'; did:string; expected:string[]; macs:string[] };

export function projectPreferences(view: LocalPreferences, change: PreferenceChange): LocalPreferences {
  switch (change.operation) {
    case 'setCameraPrimaryLens': return {...view,cameraPrimaryLenses:{...view.cameraPrimaryLenses,[change.did]:change.lensId}};
    case 'setMonitorEnabled': return {...view,monitor:{excludedDeviceIds:[],...view.monitor,enabled:change.value}};
    case 'setMonitorExcluded': {const current=view.monitor??{enabled:false,excludedDeviceIds:[]};return {...view,monitor:{...current,excludedDeviceIds:change.excluded?[...new Set([...current.excludedDeviceIds,change.did])]:current.excludedDeviceIds.filter(id=>id!==change.did)}};}
    case 'setHideOffline': return { ...view, hideOffline: change.value };
    case 'setDragLocked': return { ...view, dragLocked: change.value };
    case 'setSplitSwitches': return { ...view, splitSwitches: change.value };
    case 'setHidden': return { ...view, hiddenDeviceIds: change.hidden ? [...new Set([...view.hiddenDeviceIds, change.did])] : view.hiddenDeviceIds.filter(id => id !== change.did) };
    case 'setHomeHidden': return { ...view, homeHiddenDeviceIds: change.hidden ? [...new Set([...(view.homeHiddenDeviceIds ?? []), change.did])] : (view.homeHiddenDeviceIds ?? []).filter(id => id !== change.did) };
    case 'setOrder': return { ...view, roomOrders: { ...view.roomOrders, [change.roomId]: [...change.deviceIds] } };
    case 'resetOrder': return { ...view, roomOrders: {} };
    case 'setRouterCommon': return {...view,routerCommonDevices:{...view.routerCommonDevices,[change.did]:[...change.macs]}};
  }
}

/** Base card projection first, local ranking second, user visibility last.
 * Hidden/offline cards keep their saved slots for a later restore. */
export function localDevices(inventory: readonly Device[], order: HomeSnapshot['order'], rooms: readonly Room[], roomId: string, preferences: LocalPreferences, includeHidden = false, cards: readonly HomeCardEntry[] = []): Device[] {
  const split = !!preferences.splitSwitches;
  const base = orderedDevices(visibleHomeDevices(inventory, split).filter(device => roomId === '*' || (roomId === '?' ? !rooms.some(room => room.id === device.roomId) : device.roomId === roomId)), order, roomId, inventory, split);
  const saved = Object.hasOwn(preferences.roomOrders, roomId) ? preferences.roomOrders[roomId] : [];
  const ranks = new Map<string,number>();
  for(const id of projectDeviceOrder(Array.isArray(saved)?saved:[],inventory,split))if(!ranks.has(id))ranks.set(id,ranks.size);
  const ranked = base.map((device, index) => ({ device, index })).sort((a, b) => {
    const first = ranks.get(a.device.did), second = ranks.get(b.device.did);
    if (first !== undefined || second !== undefined) return (first ?? Infinity) - (second ?? Infinity);
    return a.index - b.index;
  }).map(row => row.device);
  const hidden = new Set(preferences.hiddenDeviceIds);
  const homeHidden = new Set(roomId === '*' ? preferences.homeHiddenDeviceIds ?? [] : []);
  // A hidden physical card stays hidden when its authenticated channels replace
  // it. Hiding one channel still affects only that channel.
  const parents = new Map(inventory.filter(d => d.controlGroup && d.controlServiceId == null).map(d => [d.controlGroup!, d.did]));
  const blockedModes = new Set(cards.filter(card => card.modeAllowed === false).map(card => card.did));
  return includeHidden ? ranked : ranked.filter(device => {
    const parent = device.controlServiceId != null && device.controlGroup ? parents.get(device.controlGroup) : undefined;
    return !hidden.has(device.did) && !homeHidden.has(device.did) && !(parent && (hidden.has(parent) || homeHidden.has(parent)))
      && (!preferences.hideOffline || device.online) && !(split && device.controlServiceId != null && blockedModes.has(device.did));
  });
}

/** Insert at the hovered slot, keeping intermediate cards in relative order. */
export function moveDeviceIds(ids: readonly string[], from: string, target: string): string[] | undefined {
  const start = ids.indexOf(from), end = ids.indexOf(target);
  if (start < 0 || end < 0 || start === end || new Set(ids).size !== ids.length) return undefined;
  const result = [...ids]; result.splice(start, 1); result.splice(end, 0, from); return result;
}

/** Keep filtered cards in their existing slots when a visible draft is saved. */
export function mergeVisibleOrder(all: readonly string[], visible: readonly string[], reordered: readonly string[]): string[] | undefined {
  const allowed = new Set(visible), full = new Set(all);
  if (full.size !== all.length || allowed.size !== visible.length || reordered.length !== visible.length || new Set(reordered).size !== reordered.length || visible.some(id => !full.has(id)) || reordered.some(id => !allowed.has(id))) return undefined;
  let index = 0; return all.map(id => allowed.has(id) ? reordered[index++] : id);
}

/** Immediate local projection with ordered persistence and context cancellation. */
export class PreferenceOperations {
  private confirmed: LocalPreferences | undefined;
  private changes: PreferenceChange[] = [];
  private epoch = 0;
  private flushing = false;
  error: AppError | undefined;
  constructor(private persist: (change: PreferenceChange) => Promise<LocalPreferences>, private changed: () => void) {}
  get view(): LocalPreferences | undefined { return this.confirmed ? this.changes.reduce(projectPreferences, this.confirmed) : undefined; }
  get pendingCount(): number { return this.changes.length; }
  reset(view?: LocalPreferences): void { ++this.epoch; this.confirmed = view; this.changes = []; this.error = undefined; this.flushing = false; }
  change(change: PreferenceChange): void {
    if (!this.confirmed) return;
    this.error = undefined; this.changes.push(change); this.changed();
    if (!this.flushing) { this.flushing = true; void this.flush(this.epoch); }
  }
  private async flush(epoch: number): Promise<void> {
    while (epoch === this.epoch && this.changes.length) {
      try {
        const view = await this.persist(this.changes[0]);
        if (epoch !== this.epoch) return;
        this.confirmed = view;
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.error = normalizeError(error);
      }
      this.changes.shift(); this.changed();
    }
    if(epoch === this.epoch)this.flushing = false;
  }
}
