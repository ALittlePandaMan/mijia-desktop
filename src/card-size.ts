/** Shared by the home grid and the lightweight desktop entry. */
export type CardSize = 'small' | 'medium' | 'large';
export const CARD_GAP = 12;
export function cardSize(value:unknown):CardSize{return value==='small'||value==='large'?value:'medium';}
export function cardDimensions(width:number,height:number,size:CardSize,gap=CARD_GAP){return {width:size==='large'?2*width+gap:width,height:size==='small'?(height-gap)/2:height};}
export interface CardSlot{id:string;column:number;row:number;columns:number;rows:number}
/** First fit in full-height bands. Small cards fill vertically before advancing. */
export function packCards(ids:readonly string[],sizes:Readonly<Record<string,CardSize>>,columns:number):CardSlot[]{
 const occupied=new Set<string>(),result:CardSlot[]=[];columns=Math.max(2,Math.floor(columns));
 for(const id of ids){const size=cardSize(sizes[id]),w=size==='large'?2:1,h=size==='small'?1:2;let found=false;
  for(let band=0;!found;band++)for(let col=0;col<=columns-w&&!found;col++)for(let half=0;half<(h===1?2:1)&&!found;half++){
   const row=band*2+half;let free=true;for(let x=0;x<w;x++)for(let y=0;y<h;y++)if(occupied.has(`${col+x}:${row+y}`))free=false;
   if(!free)continue;for(let x=0;x<w;x++)for(let y=0;y<h;y++)occupied.add(`${col+x}:${row+y}`);
   result.push({id,column:col,row,columns:w,rows:h});found=true;
  }
 }return result;
}
/** Nearest size anchor with an 8 DIP advantage before leaving the current snap. */
export function snapCardSize(width:number,height:number,w:number,h:number,current:CardSize):CardSize{
 const sizes:CardSize[]=['small','medium','large'];const distance=(s:CardSize)=>{const a=cardDimensions(w,h,s);return Math.hypot(width-a.width,height-a.height);};
 const next=sizes.reduce((a,b)=>distance(a)<distance(b)?a:b);return distance(next)+8<distance(current)?next:current;
}
