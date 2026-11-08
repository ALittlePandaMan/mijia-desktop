/** Desktop breakpoints chosen for card density, not a capped grid/card width. */
const columns = [
  [520, 3], [760, 4], [1000, 5], [1240, 6], [1480, 7], [1720, 8],
  [1960, 9], [2200, 10], [2440, 11], [2680, 12], [2920, 13],
  [3160, 14], [3400, 15], [3640, 16],
] as const;

export function deviceColumnCount(width: number): number {
  if (!Number.isFinite(width) || width < columns[0][0]) return 2;
  const last=columns.at(-1)!;
  // Continue the same breakpoint spacing on ultra-wide desktops, without a
  // hard column limit or a max-width that leaves unused space beside the grid.
  if (width >= last[0]) return last[1]+Math.floor((width-last[0])/240);
  for(let index=columns.length-2;index>=0;index--)if(width>=columns[index][0])return columns[index][1];
  return 2;
}
