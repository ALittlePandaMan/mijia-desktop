/** Mouse/pen panning without turning a drag into a room selection.
 * Touch uses the browser's native horizontal scrolling. */
export function bindScrollStrip(strip: HTMLElement): void {
  let pointer: { id: number; x: number; start: number; dragged: boolean } | undefined;
  let suppressClick = false;
  strip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch' || strip.scrollWidth <= strip.clientWidth) return;
    pointer = { id: event.pointerId, x: event.clientX, start: strip.scrollLeft, dragged: false };
  });
  strip.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if ((event.buttons & 1) === 0) { pointer = undefined; strip.classList.remove('is-panning'); return; }
    const delta = event.clientX - pointer.x;
    if (!pointer.dragged && Math.abs(delta) <= 6) return;
    pointer.dragged = true; strip.classList.add('is-panning');
    if (!strip.hasPointerCapture(event.pointerId)) strip.setPointerCapture(event.pointerId);
    event.preventDefault(); strip.scrollLeft = pointer.start - delta;
  });
  const end = (event: PointerEvent): void => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dragged = pointer.dragged; pointer = undefined; strip.classList.remove('is-panning');
    if (strip.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId);
    if (dragged) { event.preventDefault(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  };
  strip.addEventListener('pointerup', end); strip.addEventListener('pointercancel', end); strip.addEventListener('lostpointercapture', end);
  strip.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
    const previous = strip.scrollLeft, delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1);
    strip.scrollLeft += delta; if (strip.scrollLeft !== previous) event.preventDefault();
  }, { passive: false });
}
