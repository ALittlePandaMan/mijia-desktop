import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const mediaDecoderFiles=Object.freeze(['mijia-media-decoder.exe','avcodec-63.dll','avformat-63.dll','avutil-61.dll','swscale-10.dll','swresample-7.dll','COPYING.LGPLv2.1','ffmpeg-source.tar.xz','build-decoder.sh','media-decoder.json','manifest.json']);
export function verifyMediaDecoder(directory){
 const actual=fs.readdirSync(directory).sort();
 if(JSON.stringify(actual)!==JSON.stringify([...mediaDecoderFiles].sort()))throw Error('Preview decoder distribution differs from the exact file list.');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
 const expected=JSON.parse(fs.readFileSync('native/media-decoder.json','utf8'));
 if(JSON.stringify(manifest.source)!==JSON.stringify(expected))throw Error('Preview decoder source identity mismatch.');
 const members=new Map(manifest.files.map(entry=>[entry.file,entry]));
 if(members.size!==mediaDecoderFiles.length-1)throw Error('Incomplete decoder manifest.');
 for(const file of mediaDecoderFiles){if(file==='manifest.json')continue;const bytes=fs.readFileSync(path.join(directory,file)),entry=members.get(file);if(!entry||entry.bytes!==bytes.length||entry.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Preview decoder hash mismatch: '+file);
  if(/\.(?:exe|dll)$/.test(file)){const pe=bytes.readUInt32LE(0x3c);if(bytes.toString('ascii',0,2)!=='MZ'||bytes.toString('ascii',pe,pe+4)!=='PE\0\0'||bytes.readUInt16LE(pe+4)!==0x8664)throw Error('Incorrect decoder binary architecture: '+file);}
 }
 if(members.get('ffmpeg-source.tar.xz').sha256!==expected.sourceSha256)throw Error('Decoder source archive mismatch.');
 return manifest;
}
export function copyMediaDecoder(destination,source='src-tauri/media-decoder'){
 verifyMediaDecoder(source);const target=path.join(destination,'media-decoder');fs.mkdirSync(target,{recursive:true});
 for(const file of mediaDecoderFiles)fs.copyFileSync(path.join(source,file),path.join(target,file));
}
