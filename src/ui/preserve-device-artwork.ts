/** Keep decoded product images alive when state/resource responses rebuild a page.
 * Only matching artwork is retained; controls and their device bindings are new. */
export function preserveDeviceArtwork(previous:Element,next:Element):void {
 const available=new Map<string,HTMLElement[]>();
 for(const node of previous.querySelectorAll<HTMLElement>('.device-artwork[data-artwork-key]')){
  const image=node.querySelector('img');if(!image||image.complete&&!image.naturalWidth)continue;
  const key=node.dataset.artworkKey!,nodes=available.get(key)??[];nodes.push(node);available.set(key,nodes);
 }
 for(const node of next.querySelectorAll<HTMLElement>('.device-artwork[data-artwork-key]')){
  const retained=available.get(node.dataset.artworkKey!)?.shift();
  if(retained&&retained.className===node.className)node.replaceWith(retained);
 }
}
