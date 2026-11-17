/** Choose full grid tracks from the available CSS-pixel width, including gaps.
 * Empty tracks stay in place when only a few rooms exist, so cards never stretch
 * across the whole section. Narrow single-card containers remain usable. */
export function sceneRoomColumns(width:number,gap=12):number{
 if(!Number.isFinite(width)||width<280)return 1;
 const spacing=Number.isFinite(gap)&&gap>=0?gap:12;
 return Math.max(1,Math.ceil((width+spacing)/(190+spacing)));
}
