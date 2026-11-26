/** Decode IPC packets without allocating an array of intermediate characters. */
export function decodeCameraPacket(data:string):Uint8Array<ArrayBuffer> {
 const binary=atob(data);
 const bytes=new Uint8Array(binary.length);
 for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
 return bytes;
}
