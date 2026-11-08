import { moveDeviceIds } from '../local-preferences';
import { cancelCardPress, settleCardPress, cardPressBounds } from './card-press';

/** Pad APK evidence: 1.05 scale, outlined vacant slot, insertion moves.
 * This DOM/WAAPI implementation is original desktop code. */
export const CARD_HOLD_MS = 280;
export const CARD_DRAG_MS = 160;
export const CARD_SCALE_MS = 300;
export const CARD_REFLOW_MS = 250;
interface DragState {
  card: HTMLElement; grid: HTMLElement; id: string; pointer: number;
  startX: number; startY: number; x: number; y: number; offsetX: number; offsetY: number;
  started: boolean; movedEarly: boolean; timer?: ReturnType<typeof setTimeout>; pressedAt: number; dragDelay: number;
  ghost?: HTMLElement; slot?: HTMLElement; styles?: Record<string, string>; raise?: Animation; frame?: number; original: string[];
  slots: DOMRect[]; scrollTop: number; viewport?: HTMLElement;
}
interface DragCallbacks { begin: (id: string) => boolean; preview: (ids: string[]) => void; ended: () => void; arranging?: () => boolean }
function visualCards(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>(':scope > .device-card')].sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
}
export class DeviceDrag {
  private state?: DragState;
  private landing?: { state: DragState; animation?: Animation };
  private reflows = new Map<HTMLElement, Animation>();
  constructor(private callbacks: DragCallbacks) {}
  get active(): boolean { return !!this.state?.started || !!this.landing; }
  cancel(): void {
    const state = this.state; this.state = undefined;
    if (state) {
      clearTimeout(state.timer); if (state.frame !== undefined) cancelAnimationFrame(state.frame);
      if (state.started) this.order(state.grid, state.original, false);
      this.clearFloating(state); delete state.card.dataset.interacting;
      if (state.card.hasPointerCapture(state.pointer)) state.card.releasePointerCapture(state.pointer);
    }
    if (this.landing) {
      const landing = this.landing; this.landing = undefined; landing.animation?.cancel();
      this.clearFloating(landing.state);
    }
    for (const animation of this.reflows.values()) animation.cancel(); this.reflows.clear();
    document.body.classList.remove('device-drag-active');
  }
  moveByKeyboard(card: HTMLElement, target: string): void {
    const grid = card.closest<HTMLElement>('.device-grid'); if (!grid || this.active) return;
    const ids = moveDeviceIds(visualCards(grid).map(c => c.dataset.deviceId!), card.dataset.deviceId!, target);
    if (ids && this.callbacks.begin(card.dataset.deviceId!)) this.order(grid, ids, true);
  }
  bind(card: HTMLElement, id: string, locked: boolean): void {
    card.dataset.deviceId = id; card.dataset.dragLocked = String(locked);
    card.addEventListener('dragstart', event => event.preventDefault());
    if (locked) return;
    card.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.state || this.landing) return;
      const grid = card.closest<HTMLElement>('.device-grid'); if (!grid) return;
      const rect = cardPressBounds(card), viewport = card.closest<HTMLElement>('.home-screen') ?? undefined;
      const state: DragState = { card, grid, id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        offsetX: rect.x - event.clientX, offsetY: rect.y - event.clientY, started: false, movedEarly: false, pressedAt: performance.now(), dragDelay: this.callbacks.arranging?.() ? 0 : CARD_DRAG_MS,
        original: visualCards(grid).map(c => c.dataset.deviceId!), slots: [], scrollTop: viewport?.scrollTop ?? 0, viewport };
      this.state = state; card.setPointerCapture(event.pointerId);
      state.timer = setTimeout(() => this.start(state), CARD_HOLD_MS);
    });
    card.addEventListener('pointermove', event => {
      const state = this.state; if (!state || state.card !== card || state.pointer !== event.pointerId) return;
      state.x = event.clientX; state.y = event.clientY;
      if (!state.started) {
        if (Math.hypot(state.x - state.startX, state.y - state.startY) <= 8) return;
        if (!state.movedEarly && performance.now() - state.pressedAt >= state.dragDelay && (event.pointerType !== 'touch' || state.dragDelay === 0)) this.start(state);
        else { clearTimeout(state.timer); state.movedEarly = true; return; }
        if (!state.started) return;
      }
      if (!state.ghost && Math.hypot(state.x - state.startX, state.y - state.startY) > 8) this.lift(state);
      if (state.ghost) { event.preventDefault(); this.position(state); }
    });
    card.addEventListener('pointerup', event => this.end(event, card, true));
    card.addEventListener('pointercancel', event => this.end(event, card, false));
    card.addEventListener('lostpointercapture', event => this.end(event, card, false));
  }
  private start(state: DragState): void {
    if (this.state !== state || state.started || state.movedEarly || !state.card.isConnected) return;
    settleCardPress(state.card);
    if(!this.callbacks.begin(state.id))return;
    clearTimeout(state.timer);
    state.started = true; state.card.dataset.interacting = 'true'; state.slots = visualCards(state.grid).map(cardPressBounds);
    const rect = cardPressBounds(state.card); state.offsetX = rect.x - state.startX; state.offsetY = rect.y - state.startY;
  }
  private lift(state: DragState): void {
    this.reflows.get(state.card)?.cancel(); this.reflows.delete(state.card);
    const rect = cardPressBounds(state.card), pressTransform=getComputedStyle(state.card).transform;
    cancelCardPress(state.card);
    // Keep the original card/image mounted throughout lift, movement and landing.
    // Only the empty grid slot is temporary; there is no clone-to-image handoff.
    const ghost = state.card, slot = document.createElement('div');
    slot.className = 'device-drag-slot drag-placeholder'; slot.dataset.dragFor = state.id; slot.setAttribute('aria-hidden', 'true');
    slot.style.height = `${rect.height}px`; slot.style.order = ghost.style.order;
    state.styles = Object.fromEntries(['width', 'height', 'left', 'top'].map(key => [key, ghost.style.getPropertyValue(key)]));
    ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; ghost.style.left = `${rect.x}px`; ghost.style.top = `${rect.y}px`;
    ghost.classList.add('device-drag-ghost'); ghost.before(slot); state.ghost = ghost; state.slot = slot;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)state.raise=ghost.animate([{ transform: pressTransform==='none'?'scale(1)':pressTransform }, { transform: 'scale(1.05)' }], { duration: CARD_SCALE_MS, easing: 'ease-out' });
    document.body.classList.add('device-drag-active');
    const frame = (): void => {
      if (this.state !== state) return;
      const viewport = state.viewport;
      if (viewport) {
        const bounds = viewport.getBoundingClientRect(), edge = 60;
        if (state.y > bounds.bottom - edge) viewport.scrollBy(0, Math.min(12, (state.y - bounds.bottom + edge) / 5));
        else if (state.y < bounds.top + edge) viewport.scrollBy(0, -Math.min(12, (bounds.top + edge - state.y) / 5));
      }
      this.position(state); state.frame = requestAnimationFrame(frame);
    };
    state.frame = requestAnimationFrame(frame);
  }
  private clearFloating(state: DragState): void {
    state.raise?.cancel(); state.slot?.remove(); state.card.classList.remove('device-drag-ghost');
    for (const [key, value] of Object.entries(state.styles ?? {})) value ? state.card.style.setProperty(key, value) : state.card.style.removeProperty(key);
    state.ghost = undefined; state.slot = undefined;
  }
  private position(state: DragState): void {
    const ghost = state.ghost; if (!ghost) return;
    ghost.style.left = `${state.x + state.offsetX}px`; ghost.style.top = `${state.y + state.offsetY}px`;
    const centerX = state.x + state.offsetX + ghost.offsetWidth / 2, centerY = state.y + state.offsetY + ghost.offsetHeight / 2;
    const scrollDelta = (state.viewport?.scrollTop ?? 0) - state.scrollTop;
    const grid = state.grid.getBoundingClientRect(); if (centerX < grid.left || centerX > grid.right || centerY < grid.top - 20 || centerY > grid.bottom + 20) return;
    let nearest = -1, distance = Infinity;
    for (const [index, slot] of state.slots.entries()) {
      const next = (centerX - slot.x - slot.width / 2) ** 2 + (centerY - slot.y + scrollDelta - slot.height / 2) ** 2;
      if (next < distance) { nearest = index; distance = next; }
    }
    const cards = visualCards(state.grid), target = cards[nearest]?.dataset.deviceId;
    if (!target) return;
    const ids = moveDeviceIds(cards.map(card => card.dataset.deviceId!), state.id, target);
    if (ids) this.order(state.grid, ids, true);
  }
  private order(grid: HTMLElement, ids: string[], animate: boolean): void {
    const cards = visualCards(grid), before = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
    for (const card of cards) { this.reflows.get(card)?.cancel(); this.reflows.delete(card); }
    const ranks = new Map(ids.map((id, index) => [id, index]));
    for (const card of cards) { const index = ranks.get(card.dataset.deviceId!); if (index !== undefined) { card.style.order = String(index); card.dataset.reorderIndex = String(index); } }
    for (const slot of grid.querySelectorAll<HTMLElement>('.device-drag-slot')) { const index = ranks.get(slot.dataset.dragFor!); if (index !== undefined) slot.style.order = String(index); }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const after=animate&&!reduced?new Map(cards.map(card=>[card,card.getBoundingClientRect()])):undefined;
    if (after) for (const card of cards) {
      if (card === this.state?.card) continue;
      const first = before.get(card)!, last = after.get(card)!, x = first.x - last.x, y = first.y - last.y;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      const animation = card.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: 'none' }], { duration: CARD_REFLOW_MS, easing: 'cubic-bezier(.2,0,0,1)' });
      this.reflows.set(card, animation); void animation.finished.catch(() => {}).then(() => { if (this.reflows.get(card) === animation) this.reflows.delete(card); });
    }
    this.callbacks.preview(ids);
  }
  private end(event: PointerEvent, card: HTMLElement, commit: boolean): void {
    const state = this.state; if (!state || state.card !== card || state.pointer !== event.pointerId) return;
    this.state = undefined; clearTimeout(state.timer); if (state.frame !== undefined) cancelAnimationFrame(state.frame);
    if (card.hasPointerCapture(state.pointer)) card.releasePointerCapture(state.pointer);
    if (state.started || state.movedEarly) {
      event.preventDefault(); event.stopPropagation();
      const suppress = (click: MouseEvent): void => { click.preventDefault(); click.stopImmediatePropagation(); };
      document.addEventListener('click', suppress, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', suppress, true), 0);
    }
    delete card.dataset.interacting;
    if (!state.started || !state.ghost) { document.body.classList.remove('device-drag-active'); this.callbacks.ended(); return; }
    if (!commit) this.order(state.grid, state.original, true);
    const ghost = state.ghost, bounds = state.slot!.getBoundingClientRect(), transform = getComputedStyle(ghost).transform, landing = { state, animation: undefined as Animation | undefined };
    state.raise?.cancel();
    this.landing = landing;
    const cleanup = (): void => {
      if (this.landing !== landing) return;
      this.landing = undefined; landing.animation?.cancel(); this.clearFloating(state); document.body.classList.remove('device-drag-active'); this.callbacks.ended();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { cleanup(); return; }
    landing.animation = ghost.animate([{ left: ghost.style.left, top: ghost.style.top, transform }, { left: `${bounds.x}px`, top: `${bounds.y}px`, transform: 'scale(1)' }], { duration: CARD_SCALE_MS, easing: 'cubic-bezier(.2,0,0,1)', fill: 'forwards' });
    void landing.animation.finished.then(cleanup, cleanup);
  }
}
