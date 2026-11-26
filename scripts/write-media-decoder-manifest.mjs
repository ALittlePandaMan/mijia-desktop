import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mediaDecoderFiles,verifyMediaDecoder} from './media-decoder-files.mjs';

const dest=process.argv[2];
if(!dest)throw Error('Decoder output directory is required');
if(process.argv[3]==='--verify'){
 verifyMediaDecoder(dest);
 console.log('Verified downloaded Windows x64 decoder components.');
 process.exit(0);
}
const source=JSON.parse(fs.readFileSync('native/media-decoder.json','utf8'));
const files=mediaDecoderFiles.filter(file=>file!=='manifest.json').sort().map(file=>{
 const bytes=fs.readFileSync(path.join(dest,file));
 return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
});
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({schemaVersion:1,source,files},null,2)+'\n');
verifyMediaDecoder(dest);
console.log('Verified all Windows x64 decoder components and the LGPL source archive.');
