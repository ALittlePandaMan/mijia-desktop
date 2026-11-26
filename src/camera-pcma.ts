/** ITU G.711 A-law, signed 16-bit PCM input. Camera capture remains mono. */
export function encodePcma(samples:Float32Array):Uint8Array {
 const out=new Uint8Array(samples.length);
 for(let i=0;i<samples.length;i++){
  let pcm=Math.max(-32768,Math.min(32767,Math.round(samples[i]*32768))),mask=0xd5;
  if(pcm<0){mask=0x55;pcm=-pcm-1;}
  pcm=Math.min(pcm,32767);let segment=0;
  for(let limit=255;pcm>limit&&segment<7;limit=(limit<<1)|1)segment++;
  const value=segment===0?(pcm>>4)&15:((segment<<4)|((pcm>>(segment+3))&15));out[i]=value^mask;
 }
 return out;
}
