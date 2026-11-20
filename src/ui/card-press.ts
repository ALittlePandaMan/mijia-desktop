import {motionDuration} from './motion';
/** Card press feedback is independent of device opening and drag transforms. */
interface Motion {
  started: number; from: number; to: number; duration: number; easing: string;
  phase: 'press'|'release'|'activate'; node?: HTMLElement; animation?: Animation;
  removeMediaListener?: () => void;
}
const owners = new WeakMap<HTMLElement, () => void>();
export function cancelCardPress(card: HTMLElement): void { owners.get(card)?.(); }
/** Drag slots use layout bounds even while this independent scale is returning. */
export function cardPressBounds(card: HTMLElement): DOMRect {
  const rect=card.getBoundingClientRect();
  if(!card.dataset.cardPress)return rect;
  const transform=getComputedStyle(card).transform;
  if(transform==='none')return rect;
  const scale=new DOMMatrixReadOnly(transform).a;
  if(!Number.isFinite(scale)||scale<=0)return rect;
  const width=rect.width/scale,height=rect.height/scale;
  return new DOMRect(rect.x+(rect.width-width)/2,rect.y+(rect.height-height)/2,width,height);
}

export class CardPress {
  private motions = new Map<string, Motion>();
  private active?: { key: string; cancel: () => void; settle: () => void };
  private activation?: string;

  clear(): void {
    this.active?.cancel();
    for (const key of this.motions.keys()) this.stop(key);
  }

  private stop(key: string): void {
    const motion = this.motions.get(key);
    if (!motion) return;
    if (this.activation === key) this.activation = undefined;
    this.motions.delete(key); motion.removeMediaListener?.(); motion.animation?.cancel();
    if (motion.node) delete motion.node.dataset.cardPress;
  }

  private complete(key: string, motion: Motion): void {
    if (this.motions.get(key) !== motion) return;
    this.stop(key);
  }

  /** Start feedback and navigation together; the animation never gates opening. */
  activate(card: HTMLElement, key: string, activated: () => void): void {
    if (this.activation === key) return;
    const node = this.motions.get(key)?.node ?? card, transform = getComputedStyle(node).transform;
    const scale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    this.active?.cancel();
    if (this.activation) this.stop(this.activation);
    this.stop(key);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { activated(); return; }
    const motion: Motion = { phase: 'activate', from: Number.isFinite(scale) && scale > 0 ? scale : 1,
      to: 1, duration: 240, easing: 'linear', started: performance.now() };
    this.activation = key; this.motions.set(key, motion); this.mount(key, node, motion);
    activated();
  }

  private mount(key: string, card: HTMLElement, motion: Motion): void {
    motion.removeMediaListener?.(); motion.animation?.cancel();
    if (motion.node) delete motion.node.dataset.cardPress;
    motion.node = card;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) { this.complete(key, motion); return; }
    card.dataset.cardPress = motion.phase;
    const frames: Keyframe[] = motion.phase === 'activate' ? [
      { transform: `scale(${motion.from})`, offset: 0, easing: 'ease-out' },
      { transform: 'scale(.96)', offset: .3, easing: 'cubic-bezier(.2,.8,.2,1)' },
      { transform: 'scale(1)', offset: 1 },
    ] : [{ transform: `scale(${motion.from})` }, { transform: `scale(${motion.to})` }];
    const animation = card.animate(frames, {
      duration: motion.duration, easing: motion.easing, fill: motion.phase === 'press' ? 'forwards' : 'none',
    });
    motion.animation = animation;
    // Recreated home cards continue the same timeline while a panel opens.
    animation.currentTime = Math.max(0, performance.now() - motion.started);
    const reduce = (): void => { if (media.matches) { if (this.active?.key === key) this.active.cancel(); this.complete(key, motion); } };
    media.addEventListener('change', reduce);
    motion.removeMediaListener = () => media.removeEventListener('change', reduce);
    void animation.finished.then(() => {
      if (motion.phase !== 'press' && motion.animation === animation) this.complete(key, motion);
    }).catch(() => { /* Replaced node, new press or drag owns the visual now. */ });
  }

  private play(key: string, card: HTMLElement, phase: 'press'|'release', from: number, spring=true): void {
    this.stop(key);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const motion: Motion = { phase, from, to: phase === 'press' ? .96 : 1,
      duration: phase === 'press' ? motionDuration('fast',130) : motionDuration('medium',190),
      easing: phase === 'press' ? 'ease-out' : spring ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.2,.9,.2,1)', started: performance.now() };
    this.motions.set(key, motion); this.mount(key, card, motion);
  }

  bind(card: HTMLElement, key: string): void {
    const cancel = (): void => { if (this.active?.key === key) this.active.cancel(); this.stop(key); };
    owners.set(card, cancel);
    const previous = this.motions.get(key);
    if (previous) this.mount(key, card, previous);
      const allowed = (target: EventTarget|null): boolean => !(target instanceof Element && target.closest('.device-shortcut,.card-control'))
      && !card.closest('.is-arranging') && !card.classList.contains('device-drag-ghost');
    const currentCard = (): HTMLElement => this.motions.get(key)?.node ?? card;
    const scale = (): number => {
      const transform = getComputedStyle(currentCard()).transform;
      return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    };
    const begin = (pointer?: PointerEvent): void => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (this.activation) this.stop(this.activation);
      this.active?.cancel();
      const from = scale(); this.play(key, card, 'press', from);
      const finish = (rebound: boolean, spring=true): void => {
        window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancelled, true);
        window.removeEventListener('pointermove', move, true); window.removeEventListener('blur', cancelled);
        if (this.active?.key === key) this.active = undefined;
        const node = currentCard(), from = scale();
        if (rebound && node.isConnected && allowed(node)) this.play(key, node, 'release', from, spring);
        else this.stop(key);
      };
      const up = (event: PointerEvent): void => { if (event.pointerId === pointer?.pointerId) finish(true); };
      const cancelled = (): void => finish(false);
      const move = (event: PointerEvent): void => {
        if (pointer && event.pointerId === pointer.pointerId && Math.hypot(event.clientX-pointer.clientX,event.clientY-pointer.clientY)>8) finish(true,false);
      };
      this.active = { key, cancel: cancelled, settle: () => finish(true,false) };
      if (pointer) {
        window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancelled, true);
        window.addEventListener('pointermove', move, true);
      }
      window.addEventListener('blur', cancelled);
    };
    card.addEventListener('pointerdown', event => { if (event.button === 0 && allowed(event.target)) begin(event); });
    card.addEventListener('keydown', event => {
      if (!event.repeat && !event.altKey && ['Enter',' '].includes(event.key) && allowed(event.target)) begin();
    });
    card.addEventListener('keyup', event => {
      if (['Enter',' '].includes(event.key) && this.active?.key === key) {
        const node=currentCard(),from=scale(); this.active.cancel(); this.play(key,node,'release',from);
      }
    });
    card.addEventListener('click', event => {
      if (!allowed(event.target)) return;
      if (this.active?.key === key) { const from=scale(); this.active.cancel(); this.play(key,card,'release',from); }
      else if (!this.motions.has(key)) this.play(key,card,'release',.96);
    });
    card.addEventListener('contextmenu', cancel);
  }
}
